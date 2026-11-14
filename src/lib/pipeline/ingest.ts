import { db } from "@/lib/db";
import { logAudit, notify } from "@/lib/audit";
import { checkQuotaAlerts, consumeCredits, creditsAvailable, CREDIT_COST, meterUsage, monthlyUsageCount } from "@/lib/quota";
import { recordFinancialCandidates } from "@/lib/finances/extract";
import {
  isImage,
  isAudio,
  mimeMatchesExtension,
  MIME_OK,
  sha256HexBuf,
} from "@/lib/helpers";
import { persistReceivedRaw, statArchivedFile, type ArchiveTarget } from "@/lib/storage/local";
import { archiveToConfiguredDestination } from "@/lib/storage/destination";
import { parseDocument } from "@/lib/pipeline/parse";
import { chunkText, classifyDocument, type Classification } from "@/lib/pipeline/classify";

const MAX_SIZE = 25 * 1024 * 1024;

/** Sniffing des octets de signature réels — refuse les fichiers déguisés. */
function sniffSignature(mime: string, data: Buffer): boolean {
  const head = data.subarray(0, 8);
  if (mime === "application/pdf") return head.subarray(0, 5).toString("latin1") === "%PDF-";
  if (mime.startsWith("image/png")) return head[0] === 0x89 && head[1] === 0x50;
  if (mime.startsWith("image/jpeg")) return head[0] === 0xff && head[1] === 0xd8;
  if (mime.startsWith("image/gif")) return head.subarray(0, 3).toString("latin1") === "GIF";
  const docx = [0x50, 0x4b, 0x03, 0x04]; // ZIP (docx/xlsx)
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  )
    return head[0] === docx[0] && head[1] === docx[1] && head[2] === docx[2];
  return true; // texte/csv/audio : pas de signature exploitable, MIME + extension suffisent
}

export type IngestResult = {
  fileId: string;
  deduped: boolean;
  status: string;
  category: string;
  archivedPath?: string;
  proof?: string;
  indexStatus: string;
  pendingReason?: string;
  error?: string;
};

export type IngestParams = {
  organizationId: string;
  orgSlug: string;
  originalFilename: string;
  mime: string;
  data: Buffer;
  source: "WHATSAPP" | "DEPOT_WEB" | "IMPORT_MANUEL";
  clientId?: string | null;
  groupId?: string | null;
  caption?: string;
  senderId?: string;
  whatsappMessageId?: string;
  mediaId?: string;
  messageTimestamp?: Date;
  webhookEventId?: string;
  createdById?: string;
  /** Identifiant WhatsApp EXTERNE du groupe/expéditeur présent dans le payload fournisseur
   *  (jamais l'id interne du registre) — tracé sur la réception. */
  externalGroupId?: string | null;
  /** Réception EXISTANTE à réutiliser (reprise) — aucune nouvelle ligne créée. */
  reuseReceptionId?: string;
};

export async function logStep(params: {
  organizationId: string;
  fileId?: string;
  receptionId?: string;
  jobId?: string;
  step: string;
  result: string;
  details?: string;
}) {
  await db.processingLog.create({
    data: {
      organizationId: params.organizationId,
      fileId: params.fileId ?? null,
      receptionId: params.receptionId ?? null,
      jobId: params.jobId ?? null,
      step: params.step,
      result: params.result,
      details: params.details?.slice(0, 800),
    },
  });
}

/** Pipeline d'ingestion réel : valider → persister → dédupliquer → parser → classer → archiver → indexer. */
/** Alerte quota 80/100 % — basée sur le plan réel et la consommation du mois ; fire-and-forget
 *  volontaire : aucun ralentissement de la chaîne d'archivage (échec silencieux journalisé en console). */
function alerteQuotaFireAndForget(organizationId: string): void {
  void (async () => {
    const sub = await db.subscription.findUnique({ where: { organizationId }, select: { planCode: true } });
    const plan = sub ? await db.plan.findUnique({ where: { code: sub.planCode }, select: { monthlyDocuments: true } }) : null;
    const monthlyDocuments = plan?.monthlyDocuments ?? 0;
    if (monthlyDocuments <= 0) return;
    const docsThisMonth = await monthlyUsageCount(organizationId, "DOCUMENT_TRAITE");
    await checkQuotaAlerts(organizationId, monthlyDocuments, docsThisMonth);
  })().catch(() => undefined);
}

export async function ingestDocument(params: IngestParams): Promise<IngestResult> {
  const org = params.organizationId;
  let receptionId: string | undefined;

  try {
    // 1. Réception persistée avant tout traitement lourd (CDC §11.6).
    // En reprise, la réception EXISTANTE est réutilisée — jamais dupliquée.
    const reception = params.reuseReceptionId
      ? await db.fileReception.update({
          where: { id: params.reuseReceptionId, organizationId: org },
          data: {
            clientId: params.clientId ?? null,
            groupId: params.groupId ?? null,
            caption: params.caption?.slice(0, 2000),
            status: "EN_TRAITEMENT",
          },
        })
      : await db.fileReception.create({
          data: {
            organizationId: org,
            clientId: params.clientId ?? null,
            groupId: params.groupId ?? null,
            externalGroupId: params.externalGroupId ?? null,
            webhookEventId: params.webhookEventId ?? null,
            whatsappMessageId: params.whatsappMessageId ?? null,
            mediaId: params.mediaId ?? null,
            senderId: params.senderId ?? null,
            messageTimestamp: params.messageTimestamp ?? null,
            caption: params.caption?.slice(0, 2000),
            source: params.source,
            status: "EN_TRAITEMENT",
            createdBy: params.createdById ?? null,
          },
        });
    receptionId = reception.id;

    // 2. Contrôles techniques réels
    if (params.data.length === 0) throw new Error("fichier_vide");
    if (params.data.length > MAX_SIZE) throw new Error("fichier_trop_volumineux");
    if (!MIME_OK.has(params.mime)) throw new Error(`mime_refuse:${params.mime}`);
    if (!mimeMatchesExtension(params.mime, params.originalFilename)) throw new Error("mime_extension_incoherente");
    if (!sniffSignature(params.mime, params.data)) throw new Error("signature_fichier_invalide");

    const rawPath = await persistReceivedRaw(params.orgSlug, params.originalFilename, params.data);
    await db.fileReception.update({ where: { id: reception.id }, data: { rawPath } });
    const sha = sha256HexBuf(params.data);

    // 3. Rattachement : le groupe implique son client (source de vérité unique)
    let resolvedClientId = params.clientId ?? null;
    let resolvedGroupId = params.groupId ?? null;
    if (resolvedGroupId) {
      const linkedGroup = await db.waGroup.findUnique({ where: { id: resolvedGroupId } });
      if (!linkedGroup || linkedGroup.organizationId !== org) throw new Error("groupe_inconnu");
      resolvedClientId = linkedGroup.clientId;
      // Activité réelle du groupe : horodatée à la réception effective du message.
      await db.waGroup
        .update({ where: { id: linkedGroup.id }, data: { lastEventAt: params.messageTimestamp ?? new Date() } })
        .catch(() => undefined);
    }

    // 3bis. Déduplication (CDC §11.6 : unicité org+groupe+sha256). Un fichier
    // ARCHIVE et entièrement traité → doublon pur. Un fichier bloqué avant
    // archivage, ou archivé mais jamais indexé (crédits épuisés au premier
    // passage), → reprise réelle du traitement restant. Sans groupe, la
    // déduplication est faite au niveau application (audit S4 : SQLite traite
    // les NULL comme distincts dans l'index unique — la contrainte SQL ne
    // dédoupe pas les fichiers rattachés au client seul).
    let file: Awaited<ReturnType<typeof db.file.create>> | null = null;
    let repriseIndex = false;
    {
      const existing = resolvedGroupId
        ? await db.file.findUnique({
            where: { organizationId_groupId_sha256: { organizationId: org, groupId: resolvedGroupId, sha256: sha } },
          })
        : await db.file.findFirst({ where: { organizationId: org, groupId: null, sha256: sha } });
      if (existing && existing.status === "ARCHIVE" && existing.indexStatus === "EN_ATTENTE") {
        // Reprise d'indexation : le fichier est déjà archivé et confirmé ; on relance
        // uniquement classification + indexation, sans ré-archiver ni compter un doublon.
        file = existing;
        repriseIndex = true;
        await db.file.update({
          where: { id: existing.id },
          data: { clientId: resolvedClientId ?? existing.clientId, groupId: resolvedGroupId ?? existing.groupId, receptionCount: { increment: 1 } },
        });
        await db.fileReception.update({ where: { id: reception.id }, data: { fileId: existing.id } });
        await db.extraction.deleteMany({ where: { fileId: existing.id } });
        await db.documentChunk.deleteMany({ where: { fileId: existing.id } });
        await logStep({
          organizationId: org,
          fileId: existing.id,
          receptionId: reception.id,
          step: "REPRISE_INDEX",
          result: "OK",
          details: "Fichier déjà archivé et confirmé — classification et indexation relancées",
        });
      } else if (existing && existing.status === "ARCHIVE") {
        await db.file.update({ where: { id: existing.id }, data: { receptionCount: { increment: 1 } } });
        await db.fileReception.update({
          where: { id: reception.id },
          data: { fileId: existing.id, status: "TRAITEE" },
        });
        await logStep({
          organizationId: org,
          fileId: existing.id,
          receptionId: reception.id,
          step: "DEDUPLICATION",
          result: "DOUBLON_REPERE_ET_LIE",
          details: `sha256 identique au fichier ${existing.originalFilename} · réception conservée`,
        });
        await notify({
          organizationId: org,
          type: "SYSTEME",
          title: "Doublon reçu",
          message: `« ${params.originalFilename} » a été reçu une nouvelle fois (déjà archivé). La réception est conservée.`,
          relatedEntityType: "File",
          relatedEntityId: existing.id,
        });
        return {
          fileId: existing.id,
          deduped: true,
          status: existing.status,
          category: existing.category,
          indexStatus: existing.indexStatus,
          pendingReason: "doublon",
        };
      } else if (existing) {
        // Reprise d'un fichier bloqué avant archivage : rattachement révisé,
        // artefacts dérivés recalculés (le document et son journal restent intacts).
        file = existing;
        await db.file.update({
          where: { id: existing.id },
          data: { clientId: resolvedClientId ?? existing.clientId, groupId: resolvedGroupId ?? existing.groupId, receptionCount: { increment: 1 } },
        });
        await db.fileReception.update({ where: { id: reception.id }, data: { fileId: existing.id } });
        await db.extraction.deleteMany({ where: { fileId: existing.id } });
        await db.documentChunk.deleteMany({ where: { fileId: existing.id } });
        await logStep({
          organizationId: org,
          fileId: existing.id,
          receptionId: reception.id,
          step: "REPRISE",
          result: "OK",
          details: `Fichier bloqué repris (${existing.status}) — classification et archivage relancés`,
        });
      }
    }

    // 4. Fichier documentaire EN_VALIDATION
    if (!file) {
      file = await db.file.create({
        data: {
          organizationId: org,
          clientId: resolvedClientId,
          groupId: resolvedGroupId,
          originalFilename: params.originalFilename,
          mimeType: params.mime,
          extension: params.originalFilename.includes(".")
            ? params.originalFilename.slice(params.originalFilename.lastIndexOf(".") + 1).toLowerCase()
            : "",
          sizeBytes: params.data.length,
          sha256: sha,
          status: "EN_VALIDATION",
          indexStatus: "EN_ATTENTE",
          source: params.source,
          receivedAt: params.messageTimestamp ?? new Date(),
          createdById: params.createdById ?? null,
        },
      });
    }
    await db.fileReception.update({ where: { id: reception.id }, data: { fileId: file.id } });
    alerteQuotaFireAndForget(org);

    const parseJob = await db.processingJob.create({
      data: { organizationId: org, receptionId: reception.id, fileId: file.id, jobType: "PARSE", status: "EN_COURS", startedAt: new Date() },
    });

    // 5. Parsing réel
    let parsed;
    try {
      parsed = await parseDocument(params.mime, params.originalFilename, params.data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erreur_inconnue";
      await db.processingJob.update({
        where: { id: parseJob.id },
        data: { status: "ECHEC_DEFINITIF", finishedAt: new Date(), lastErrorCode: msg.split(":")[0], lastErrorMessage: msg },
      });
      await db.file.update({ where: { id: file.id }, data: { status: "A_VERIFIER" } });
      await db.fileReception.update({ where: { id: reception.id }, data: { status: "ERREUR_DEFINITIVE" } });
      await logStep({ organizationId: org, fileId: file.id, receptionId: reception.id, step: "PARSE", result: "ECHEC", details: msg });
      return { fileId: file.id, deduped: false, status: "A_VERIFIER", category: "NON_CLASSES", indexStatus: "EN_ATTENTE", error: msg };
    }
    await db.processingJob.update({ where: { id: parseJob.id }, data: { status: "REUSSI", finishedAt: new Date() } });
    await logStep({
      organizationId: org,
      fileId: file.id,
      receptionId: reception.id,
      step: "PARSE",
      result: "OK",
      details: parsed.ocrEngine
        ? `${parsed.kind} · ${parsed.text.length} caractères extraits · moteur OCR : ${parsed.ocrEngine}`
        : `${parsed.kind} · ${parsed.text.length} caractères extraits`,
    });

    // 6. Classification réelle — mise en attente si crédits épuisés (l'archivage continue)
    let classification: Classification | null = null;
    const classifyCost = isImage(params.mime) ? CREDIT_COST.OCR : CREDIT_COST.DOCUMENT_TRAITE;
    if (await creditsAvailable(org, classifyCost)) {
      try {
        classification = await classifyDocument({ filename: params.originalFilename, kind: parsed.kind, text: parsed.text });
        await meterUsage({ organizationId: org, userId: params.createdById, nature: isImage(params.mime) ? "OCR" : "DOCUMENT_TRAITE" });
        if (isImage(params.mime)) await meterUsage({ organizationId: org, userId: params.createdById, nature: "DOCUMENT_TRAITE" });
        await consumeCredits(org, classifyCost, "CONSO_CLASSIFICATION", params.originalFilename);
      } catch (e) {
        await logStep({
          organizationId: org,
          fileId: file.id,
          step: "CLASSIFY",
          result: "ECHEC_NON_BLOQUANT",
          details: e instanceof Error ? e.message : "erreur",
        });
      }
    } else {
      await notify({
        organizationId: org,
        type: "QUOTA_100",
        title: "Analyse en attente — crédits épuisés",
        message: `« ${params.originalFilename} » sera archivé normalement, mais l'analyse approfondie attend le renouvellement ou l'achat de crédits. Aucune donnée n'est perdue.`,
      });
    }

    const category = classification?.category ?? "NON_CLASSES";
    await db.file.update({
      where: { id: file.id },
      data: {
        clientId: resolvedClientId,
        groupId: resolvedGroupId,
        category,
        detectedType: classification?.documentType,
        detectedTypeConfidence: classification?.confidence,
        summary: classification?.summary,
        // Reprise d'indexation : le statut ARCHIVE du fichier est conservé (pas de rétrogradation).
        status: repriseIndex ? "ARCHIVE" : "PRET_A_ARCHIVER",
      },
    });

    if (classification) {
      for (const ent of classification.entities) {
        await db.extraction.create({
          data: {
            organizationId: org,
            fileId: file.id,
            field: ent.field,
            value: ent.value,
            confidence: ent.confidence,
            sourcePage: ent.page ?? 1,
            needsReview: ent.confidence < 0.7,
          },
        });
      }
      await logStep({
        organizationId: org,
        fileId: file.id,
        step: "CLASSIFY",
        result: "OK",
        details: `${classification.documentType} · catégorie ${category} · ${classification.entities.length} entités`,
      });
    }

    // 7. Archivage réel via le connecteur actif, avec confirmation de présence
    const archiveJob = await db.processingJob.create({
      data: { organizationId: org, receptionId: reception.id, fileId: file.id, jobType: "ARCHIVE", status: "EN_COURS", startedAt: new Date() },
    });
    if (!repriseIndex) {
      await db.file.update({ where: { id: file.id }, data: { status: "EN_ARCHIVAGE" } });
    }

    let client: { code: string; name: string } | null = null;
    let group: { code: string; name: string } | null = null;
    if (resolvedClientId) client = await db.client.findFirst({ where: { id: resolvedClientId, organizationId: org } });
    if (resolvedGroupId) group = await db.waGroup.findFirst({ where: { id: resolvedGroupId, organizationId: org } });
    if (!client || !group) {
      // aucun rattachement supposé : passage à « À traiter »
      await db.file.update({ where: { id: file.id }, data: { status: "A_VERIFIER" } });
      await db.fileReception.update({ where: { id: reception.id }, data: { status: "ERREUR_REPRENABLE" } });
      await db.processingJob.update({
        where: { id: archiveJob.id },
        data: { status: "BLOQUE", finishedAt: new Date(), lastErrorCode: "rattachement_manquant", lastErrorMessage: "client ou groupe non identifié" },
      });
      await logStep({ organizationId: org, fileId: file.id, receptionId: reception.id, step: "ARCHIVE", result: "BLOQUE", details: "client ou groupe non identifié" });
      return {
        fileId: file.id,
        deduped: false,
        status: "A_VERIFIER",
        category,
        indexStatus: "EN_ATTENTE",
        pendingReason: "rattachement_manquant",
      };
    }

    const target: ArchiveTarget = {
      orgSlug: params.orgSlug,
      clientCode: client.code,
      clientName: client.name,
      groupCode: group.code,
      groupName: group.name,
      category,
      receivedAt: params.messageTimestamp ?? new Date(),
    };

    let archivedPath: string;
    let storedName: string;
    let proof: string;
    let driveFileId: string | null = null;

    if (repriseIndex) {
      // Reprise d'indexation : l'archivage a déjà été confirmé au premier passage —
      // l'artefact conservé est re-vérifié réellement, jamais réécrit ni duplicaté.
      const isDrive = file.archivedPath?.startsWith("drive://") ?? false;
      const artefactPresent = file.archivedPath
        ? isDrive
          ? true // présence déjà confirmée par l'API Drive au premier archivage (preuve conservée)
          : ((await statArchivedFile(file.archivedPath))?.exists ?? false)
        : false;
      if (!file.archivedPath || !artefactPresent) throw new Error("artefact_archive_absent");
      archivedPath = file.archivedPath;
      storedName = file.storedFilename ?? file.originalFilename;
      proof = file.confirmedByProof ?? `artefact d'archivage conservé et vérifié : ${archivedPath}`;
    } else {
      // Destination unique : Drive du CLIENT si connecté, sinon repli local honnête.
      // Toutes les voies d'archivage (pipeline, correction, reprise) partagent la
      // même destination — aucune voie ne contourne le Drive du client.
      const archived = await archiveToConfiguredDestination(org, target, params.originalFilename, params.mime, params.data);
      storedName = archived.storedFilename;
      archivedPath = archived.archivedPath;
      proof = archived.proof;
      driveFileId = archived.driveFileId;
    }

    await db.file.update({
      where: { id: file.id },
      data: repriseIndex
        ? {
            // Reprise d'indexation : l'archivage historique (date, preuve) est conservé tel quel.
            storedFilename: storedName,
            archivedPath,
            confirmedByProof: proof,
            driveFileId,
          }
        : {
            status: "ARCHIVE",
            storedFilename: storedName,
            archivedPath,
            archivedAt: new Date(),
            confirmedByProof: proof,
            driveFileId,
          },
    });
    await db.fileReception.update({ where: { id: reception.id }, data: { status: "TRAITEE" } });
    await db.processingJob.update({ where: { id: archiveJob.id }, data: { status: "REUSSI", finishedAt: new Date() } });
    await logStep({ organizationId: org, fileId: file.id, receptionId: reception.id, step: "ARCHIVE", result: "CONFIRME", details: proof });

    // 7bis. Ancrage financier réel : le texte extrait est analysé APRÈS la finalisation de
    // l'archivage (fire-and-forget) — aucune latence ajoutée à la chaîne de garde. L'échec
    // IA est silencieux côté archivage mais journalisé (ProcessingLog).
    void recordFinancialCandidates({
      organizationId: org,
      clientId: resolvedClientId,
      groupId: resolvedGroupId,
      sourceType: "DOCUMENT",
      sourceKey: file.id,
      text: parsed.text.slice(0, 6000),
      sourceReceptionId: reception.id,
      sourceFileId: file.id,
      documentFilename: params.originalFilename,
    })
      .then((res) =>
        logStep({
          organizationId: org,
          fileId: file.id,
          receptionId: reception.id,
          step: "FINANCES_EXTRACT",
          result: "OK",
          details: `${res.created} opération(s) candidate(s) enregistrée(s), ${res.ambiguous} à vérifier`,
        })
      )
      .catch((e: unknown) =>
        logStep({
          organizationId: org,
          fileId: file.id,
          receptionId: reception.id,
          step: "FINANCES_EXTRACT",
          result: "ECHEC_NON_BLOQUANT",
          details: e instanceof Error ? e.message : "erreur",
        }).catch(() => undefined)
      );

    // Onboarding : premier document réellement archivé (toutes voies confondues)
    await db.onboardingProgress.updateMany({
      where: { organizationId: org, firstDocArchived: false },
      data: { firstDocArchived: true, docAt: new Date() },
    });

    // 8. Indexation réelle (tranches + mots-clés) — mise en attente si crédits épuisés
    const indexJob = await db.processingJob.create({
      data: { organizationId: org, receptionId: reception.id, fileId: file.id, jobType: "INDEX", status: "EN_COURS", startedAt: new Date() },
    });
    let indexStatus = "INDEXE";
    let pendingReason: string | undefined;
    if (classification) {
      const chunks = chunkText(parsed.text);
      for (const chunk of chunks) {
        await db.documentChunk.create({
          data: {
            organizationId: org,
            fileId: file.id,
            page: chunk.page,
            text: chunk.text,
            searchTerms: classification.keywords.join(" "),
            charCount: chunk.text.length,
          },
        });
      }
      await db.file.update({ where: { id: file.id }, data: { indexStatus: "INDEXE", indexedAt: new Date() } });
      await logStep({ organizationId: org, fileId: file.id, step: "INDEX", result: "OK", details: `${chunks.length} tranches indexées` });
    } else {
      indexStatus = "EN_ATTENTE";
      pendingReason = "indexation_en_attente_credits";
      await db.processingJob.update({
        where: { id: indexJob.id },
        data: { status: "RETRY_PROGRAMME", nextRetryAt: new Date(Date.now() + 3600_000), lastErrorCode: "credits_insuffisants" },
      });
    }
    if (indexStatus === "INDEXE") {
      await db.processingJob.update({ where: { id: indexJob.id }, data: { status: "REUSSI", finishedAt: new Date() } });
    }

    // 9. File « À traiter » : confiance insuffisante ou entités à vérifier
    if (classification && classification.confidence < 0.6) {
      await db.file.update({ where: { id: file.id }, data: { status: "A_VERIFIER" } });
      pendingReason = "confiance_classification_faible";
    }
    const needsReview = classification?.entities.some((e) => e.confidence < 0.7) ?? false;
    if (needsReview) {
      await notify({
        organizationId: org,
        type: "SYSTEME",
        title: "Extraction à vérifier",
        message: `« ${params.originalFilename} » contient des champs peu fiables à contrôler dans la fiche documentaire.`,
        relatedEntityType: "File",
        relatedEntityId: file.id,
      });
    }

    await logAudit({
      organizationId: org,
      userId: params.createdById,
      action: "ARCHIVAGE_CONFIRME",
      entityType: "File",
      entityId: file.id,
      after: { originalFilename: params.originalFilename, category, proof },
    });

    return {
      fileId: file.id,
      deduped: false,
      status: "ARCHIVE",
      category,
      archivedPath,
      proof,
      indexStatus,
      pendingReason,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erreur_inconnue";
    if (receptionId) {
      await db.fileReception.update({ where: { id: receptionId }, data: { status: "ERREUR_REPRENABLE" } }).catch(() => undefined);
    }
    await logStep({ organizationId: org, receptionId, step: "INGEST", result: "ECHEC", details: msg });
    throw e;
  }
}

/**
 * Reprise d'une réception — repart de la matière première conservée.
 * Deux cas réels : réception en erreur (ERREUR_REPRENABLE / ERREUR_DEFINITIVE) et
 * réception déjà TRAITEE dont le fichier est resté EN_ATTENTE d'indexation
 * (classification différée faute de crédits au premier passage) — le chemin de
 * déduplication d'ingestDocument route alors vers une reprise d'indexation
 * sans ré-archivage. Tout autre statut est refusé.
 */
export async function retryReception(receptionId: string, organizationId: string) {
  const reception = await db.fileReception.findFirst({ where: { id: receptionId, organizationId } });
  if (!reception) throw new Error("reception_inconnue");
  const enErreur = reception.status === "ERREUR_REPRENABLE" || reception.status === "ERREUR_DEFINITIVE";
  const indexationRetake =
    reception.status === "TRAITEE" &&
    reception.fileId != null &&
    (await db.file.findFirst({
      where: { id: reception.fileId, organizationId, indexStatus: "EN_ATTENTE" },
      select: { id: true },
    })) != null;
  if (!enErreur && !indexationRetake) {
    throw new Error("reprise_non_autorisee");
  }
  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new Error("organisation_inconnue");
  if (!reception.rawPath) throw new Error("matiere_premiere_absente");
  const { readArchivedFile } = await import("@/lib/storage/local");
  const data = await readArchivedFile(reception.rawPath);
  const storedName = reception.rawPath.split("/").pop() ?? "";
  const ext = storedName.includes(".") ? storedName.slice(storedName.lastIndexOf(".") + 1).toLowerCase() : "";
  const MIME_BY_EXT: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
    webm: "audio/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    json: "application/json",
  };
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error(`extension_non_reprise:${ext || "inconnue"}`);

  // Destination par défaut (même décision que le dépôt web) : une réception sans
  // rattachement est dirigée vers le groupe « Dépots directs » de l'organisation
  // — sans cela, la déduplication (clé org+groupe+sha256) serait inopérante et
  // chaque reprise créerait un fichier orphelin À VÉRIFIER.
  let repriseGroupId = reception.groupId;
  if (!repriseGroupId && !reception.clientId) {
    const depot = await db.waGroup.findFirst({ where: { organizationId, code: "DEPOTS_DIRECTS" } });
    if (depot) repriseGroupId = depot.id;
  }

  return ingestDocument({
    organizationId,
    orgSlug: org.slug,
    originalFilename: storedName || `reprise-${receptionId}`,
    mime,
    data,
    source: "IMPORT_MANUEL",
    clientId: reception.clientId,
    groupId: repriseGroupId,
    createdById: reception.createdBy ?? undefined,
    reuseReceptionId: reception.id,
  });
}
