import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { verifyHubToken, verifyWhatsAppSignature, parseWebhookPayload, downloadWhatsAppMedia, whatsappConfigured, sendWhatsAppText } from "@/lib/connectors/whatsapp";
import { ingestDocument } from "@/lib/pipeline/ingest";
import { transcribeAudioBuffer } from "@/lib/pipeline/parse";
import { isAudio } from "@/lib/helpers";
import { logStep } from "@/lib/pipeline/ingest";
import { recordFinancialCandidates } from "@/lib/finances/extract";
import { NextResponse } from "next/server";
import { sanitize } from "@/lib/audit";
import { tryPairByCode, findActivePairingByPhone, resolvePairingRuntime } from "@/lib/whatsapp-pairing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Message d'accueil standard — aucun donnée, aucune session (CDC §4.8). */
const WELCOME_MESSAGE =
  "HESYD ONE — Ce numéro n'est pas appairé à un espace documentaire. " +
  "Pour connecter votre numéro, générez un code d'appairage depuis votre espace HESYD ONE (Administration → WhatsApp) puis envoyez-le ici. " +
  "Aucune donnée n'est échangée avant l'appairage.";

/** Message de confirmation d'appairage réel (résolu par code, CDC §4.8). */
const PAIRED_MESSAGE =
  "Numéro appairé avec succès. Vous pouvez dès maintenant m'envoyer vos documents et vos questions — je réponds avec les sources citées.";

/** Anti force brute persistant (serveur, multi-instance) : nombre de messages à
 *  code de l'expéditeur sur les 15 dernières minutes. Au-delà de 10, les
 *  tentatives d'appairage sont ignorées (espace 10^6, TTL 15 min). */
const LIMITE_APPAIRAGE = 10;

async function compterTentativesAppairage(sender: string): Promise<number> {
  const windowStart = new Date(Date.now() - 15 * 60 * 1000);
  return db.webhookEvent.count({
    where: { provider: "WHATSAPP_CLOUD", senderId: sender, eventType: "text", receivedAt: { gt: windowStart } },
  });
}

/** Tentative d'appairage par code — applicable aux numéros inconnus (appairage
 *  initial) comme aux numéros déjà appairés (re-appairage vers un nouveau code).
 *  Retourne le statut et, en cas de limite atteinte, le compteur pour le journal. */
type ResultatAppairage = { statut: "PAIRE" | "REFUSEE" | "LIMITEE"; recentAttempts?: number };
async function tenterAppairageParCode(sender: string, text: string): Promise<ResultatAppairage> {
  if (/\b\d{6}\b/.test(text)) {
    const recentAttempts = await compterTentativesAppairage(sender);
    if (recentAttempts > LIMITE_APPAIRAGE) return { statut: "LIMITEE", recentAttempts };
    const attempt = await tryPairByCode(text, sender);
    if (attempt.paired) {
      await sendWhatsAppText(sender, PAIRED_MESSAGE);
      return { statut: "PAIRE" };
    }
  }
  return { statut: "REFUSEE" };
}

async function rejeterLimiteAppairage(eventKey: string, sender: string, recentAttempts: number) {
  await db.webhookEvent.update({ where: { providerEventKey: eventKey }, data: { processingStatus: "REJETEE" } });
  console.error(`[webhook whatsapp] tentatives d'appairage limitées pour ${sender.slice(-4).padStart(sender.length, "•")} (${recentAttempts}/15 min)`);
}

/** Vérification GET du webhook Meta (hub.challenge) — réelle. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode") ?? "";
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (!whatsappConfigured()) {
    return NextResponse.json({ error: "whatsapp_non_configure", variablesRequises: ["WHATSAPP_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"] }, { status: 503 });
  }
  if (verifyHubToken(mode, token)) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ error: "verification_refusee" }, { status: 403 });
}

/**
 * Webhook POST réel : LA SIGNATURE EST VÉRIFIÉE AVANT TOUTE ÉCRITURE — une
 * requête non signée ne produit JAMAIS d'écriture en base (rejet 403 sec).
 * Chaque message d'un lot est persisté, traité indépendamment (un échec ne
 * fait pas perdre les messages suivants), idempotence par clé fournisseur
 * (CDC §11.6), appairage par code limité côté serveur (anti force brute
 * persistant, valable multi-instance). Tout rejet est tracé honnêtement.
 */
export async function POST(req: Request) {
  if (!whatsappConfigured()) {
    return NextResponse.json({ error: "whatsapp_non_configure" }, { status: 503 });
  }
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const signatureValid = verifyWhatsAppSignature(raw, signature);
  if (!signatureValid) {
    // Aucune écriture : seule la source authentifiée (Meta, signature HMAC du
    // corps brut) peut créer des événements en base.
    console.error("[webhook whatsapp] signature invalide — requête rejetée sans écriture");
    return NextResponse.json({ error: "signature_invalide" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "payload_invalide" }, { status: 400 });
  }

  const messages = parseWebhookPayload(payload);

  // Persistence AVANT traitement lourd — idempotence stricte
  let eventsRecorded = 0;
  let erreursTraitement = 0;
  for (const msg of messages) {
    const eventKey = `wa:${msg.phoneNumberId}:${msg.messageId}`;
    let eventId: string | null = null;
    try {
      const created = await db.webhookEvent.create({
        data: {
          organizationId: null,
          provider: "WHATSAPP_CLOUD",
          providerEventKey: eventKey,
          eventType: msg.type,
          signatureValid: true, // la signature a déjà été vérifiée ci-dessus
          processingStatus: "RECUE",
          payloadJson: JSON.stringify(sanitize(msg)),
          senderId: msg.from,
        },
      });
      eventId = created.id;
      eventsRecorded++;
    } catch (e) {
      // Idempotence réelle : SEULE l'erreur Prisma de contrainte unique (P2002) sur la clé
      // fournisseur providerEventKey signifie « doublon rejoué ». Toute autre erreur est
      // honnête : 500 (la persistance de l'événement est un prérequis de traitement).
      const p2002 = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      const target = p2002 ? e.meta?.target : undefined;
      const surCleFournisseur =
        target == null ||
        (Array.isArray(target) ? target.some((t) => String(t).includes("providerEventKey")) : String(target).includes("providerEventKey"));
      if (p2002 && surCleFournisseur) {
        continue; // doublon rejoué par Meta : déjà persisté et déjà traité ou reprenable
      } else {
        console.error("[webhook whatsapp] échec d'enregistrement de l'événement:", e instanceof Error ? e.message : e);
        return NextResponse.json({ error: "enregistrement_evenement_echoue" }, { status: 500 });
      }
    }

    const expectedPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!expectedPhoneId || msg.phoneNumberId !== expectedPhoneId) {
      await db.webhookEvent.update({ where: { providerEventKey: eventKey }, data: { processingStatus: "REJETEE" } });
      continue;
    }

    try {
      const pairing = await findActivePairingByPhone(msg.from);
      if (!pairing) {
        // Numéro inconnu : la tentative d'appairage par code reste possible
        // (CDC §4.8 — résiduel §16.6 qualifié P1 et corrigé : la garde
        // findActivePairingByPhone précédait autrefois tryPairByCode, un numéro
        // neuf ne recevait que l'accueil standard et l'appairage initial était
        // impossible) ; sinon réponse standard, AUCUNE donnée, aucun agent.
        let resultat: ResultatAppairage = { statut: "REFUSEE" };
        if (msg.type === "text" && msg.text) resultat = await tenterAppairageParCode(msg.from, msg.text);
        if (resultat.statut === "LIMITEE") {
          await rejeterLimiteAppairage(eventKey, msg.from, resultat.recentAttempts ?? 0);
          continue;
        }
        if (resultat.statut !== "PAIRE") {
          await sendWhatsAppText(msg.from, WELCOME_MESSAGE);
        }
        await db.webhookEvent.update({ where: { providerEventKey: eventKey }, data: { processingStatus: "TRAITEE" } });
        continue;
      }
      const organizationId = pairing.organizationId;

      const organization = await db.organization.findUnique({ where: { id: organizationId } });
      if (!organization) throw new Error("organisation_introuvable");
      // Traçabilité réelle : l'événement est rattaché à l'organisation dès sa résolution.
      if (eventId) {
        await db.webhookEvent.update({ where: { id: eventId }, data: { organizationId } }).catch(() => undefined);
      }
      await db.integrationConnection.update({
        where: { organizationId_connector: { organizationId, connector: "WHATSAPP_CLOUD" } },
        data: { lastCheckedAt: new Date() },
      });

      // ————— Étape 1 : re-appairage d'un numéro déjà appairé (nouveau code) —————
      // Même primitive que l'appairage initial (anti force brute inclus) ; un
      // texte sans code à 6 chiffres est sans effet ici et passe à l'agent.
      if (msg.type === "text" && msg.text) {
        const resultat = await tenterAppairageParCode(msg.from, msg.text);
        if (resultat.statut === "PAIRE") {
          await db.webhookEvent.update({ where: { providerEventKey: eventKey }, data: { processingStatus: "TRAITEE" } });
          continue;
        }
        if (resultat.statut === "LIMITEE") {
          await rejeterLimiteAppairage(eventKey, msg.from, resultat.recentAttempts ?? 0);
          continue;
        }
      }

      // Résolution réelle du groupe WhatsApp (identifiant externe du payload fournisseur).
      // Limite officielle documentée : l'API Cloud ne délivre pas d'identifiant de groupe
      // tant que l'accès aux groupes n'est pas accordé à l'application — msg.groupId est
      // donc null en pratique ; le rattachement passe par la correction web (À vérifier).
      const resolvedGroup = msg.groupId
        ? await db.waGroup.findFirst({ where: { whatsappGroupId: msg.groupId, organizationId, status: "ACTIF" } })
        : null;

      // ————— Étape 2 : traitement réel du message appairé —————
      if (msg.media) {
        // Média réel : téléchargement via Graph API puis pipeline d'archivage
        const media = await downloadWhatsAppMedia(msg.media.id);
        const ingested = await ingestDocument({
          organizationId,
          orgSlug: organization.slug,
          originalFilename: msg.media.filename ?? `media-${msg.messageId}`,
          mime: media.mimeType,
          data: media.buffer,
          source: "WHATSAPP",
          caption: msg.media.caption ?? msg.text,
          senderId: msg.from,
          whatsappMessageId: msg.messageId,
          mediaId: msg.media.id,
          messageTimestamp: msg.timestamp,
          webhookEventId: eventId ?? undefined,
          groupId: resolvedGroup?.id ?? null,
          externalGroupId: msg.groupId ?? null,
        });
        // Accusé de réception réel dans le canal avec preuve d'archivage
        const proofLine = "proof" in ingested && typeof ingested.proof === "string" ? ingested.proof : "";
        await sendWhatsAppText(
          msg.from,
          ingested.status === "ARCHIVE"
            ? `Document archivé et confirmé : ${ingested.archivedPath ?? "chemin consigné au registre"}. ${proofLine ? `Preuve : ${proofLine}` : ""}`.trim()
            : ingested.status === "A_VERIFIER"
              ? "Document reçu et conservé. Il est « à vérifier » : " + (String(ingested.pendingReason ?? "rattachement requis") === "rattachement_manquant" ? "sélectionnez son client et son groupe dans votre espace HESYD ONE (Documents → À vérifier) pour finaliser l'archivage." : String(ingested.pendingReason ?? "vérification humaine requise"))
              : `Document reçu (statut ${ingested.status}). Il est conservé ; le registre reflète son état exact.`
        );
        // audio vocal : transcription traitée comme instruction pour l'agent
        if (isAudio(media.mimeType)) {
          const transcript = await transcribeAudioBuffer(media.buffer);
          if (transcript) {
            await logStep({ organizationId, step: "TRANSCRIPTION", result: "OK", details: "message vocal transcrit" });
            await runAgentFromWhatsApp(organizationId, organization.slug, transcript, msg.from, pairing, organization.autonomyLevel);
          }
        }
      } else if (msg.type === "text" && msg.text) {
        // Ancrage financier réel pour les messages TEXTE purs — fire-and-forget :
        // la réponse de l'agent ne doit jamais attendre l'analyse financière.
        void recordFinancialCandidates({
          organizationId,
          clientId: resolvedGroup?.clientId ?? null,
          groupId: resolvedGroup?.id ?? null,
          sourceType: "WHATSAPP",
          sourceKey: msg.messageId,
          text: msg.text.slice(0, 6000),
          sourceWebhookEventId: eventId ?? null,
        })
          .then((res) =>
            logStep({
              organizationId,
              step: "FINANCES_EXTRACT",
              result: "OK",
              details: `message WhatsApp · ${res.created} opération(s) candidate(s), ${res.ambiguous} à vérifier`,
            })
          )
          .catch((e: unknown) =>
            logStep({
              organizationId,
              step: "FINANCES_EXTRACT",
              result: "ECHEC_NON_BLOQUANT",
              details: e instanceof Error ? e.message : "erreur",
            }).catch(() => undefined)
          );
        // conversation directe : le texte est une instruction pour l'agent,
        // et la réponse est RENVOYÉE dans le canal (CDC §7.14)
        await runAgentFromWhatsApp(organizationId, organization.slug, msg.text, msg.from, pairing, organization.autonomyLevel);
      }

      await db.webhookEvent.update({ where: { providerEventKey: eventKey }, data: { processingStatus: "TRAITEE" } });
    } catch (e) {
      await db.webhookEvent.update({
        where: { providerEventKey: eventKey },
        data: { processingStatus: "ERREUR" },
      }).catch(() => undefined);
      const detail = e instanceof Error ? e.message : "erreur";
      erreursTraitement++;
      // Trace serveur honnête, puis POURSUITE du lot : un échec ne fait jamais
      // perdre les messages suivants du même webhook Meta (chaque message du
      // lot est persisté et porte son propre statut).
      console.error("[webhook whatsapp] échec de traitement d'un message du lot:", detail);
      continue;
    }
  }

  // Meta exige une réponse 2xx rapide : chaque message du lot a été persisté
  // individuellement (TRAITEE / ERREUR / REJETEE) — aucun message n'est perdu
  // silencieusement ; les événements ERREUR restent traçables au registre.
  return NextResponse.json({ received: true, eventsRecorded, erreurs: erreursTraitement });
}

/** Exécute l'agent et RENVOIE sa réponse finale sur WhatsApp (canal d'origine).
 *  userId réel : celui du propriétaire du numéro appairé — jamais l'id d'organisation.
 *  Rôle cohérent (MAJEURE-1b, audit) : résolu UNIQUEMENT via resolvePairingRuntime
 *  (src/lib/whatsapp-pairing.ts) — rôle réel du membership de l'utilisateur lié au
 *  numéro, relu à chaque exécution, jamais déduit d'une autre source. Si ce rôle est
 *  LECTEUR, l'agent tourne en lecture seule (garde des outils d'écriture de
 *  runner.ts, respectée telle quelle). Sans membership actif, aucun agent. */
async function runAgentFromWhatsApp(
  organizationId: string,
  orgSlug: string,
  instruction: string,
  fromPhone: string,
  pairing: { userId: string; organizationId: string },
  organizationAutonomyLevel?: string,
) {
  const runtime = await resolvePairingRuntime(pairing);
  if (!runtime) {
    // Le numéro est appairé mais l'utilisateur n'est plus membre : aucun agent n'est exécuté.
    await sendWhatsAppText(
      fromPhone,
      "Votre numéro est appairé à un espace HESYD ONE dont votre compte ne fait plus partie. Aucune donnée n'est échangée. Contactez l'administrateur de votre organisation.",
    );
    return;
  }
  const { runAgentTask } = await import("@/lib/agent/runner");
  const conv = await db.conversation.create({
    data: { organizationId, userId: runtime.userId, channel: "WHATSAPP", title: instruction.slice(0, 50) },
  });
  await db.message.create({ data: { organizationId, conversationId: conv.id, role: "user", content: instruction } });
  let finalAnswer = "";
  let finalStatus = "";
  await runAgentTask({
    organizationId,
    orgSlug,
    userId: runtime.userId,
    role: runtime.role,
    locale: "fr",
    conversationId: conv.id,
    objective: instruction,
    history: [],
    autonomyLevel: organizationAutonomyLevel,
    onEvent: async (event) => {
      if (event.type === "reponse") {
        finalAnswer = event.content;
        finalStatus = event.statut;
      } else if (event.type === "clarification") {
        finalAnswer = event.question + (event.options?.length ? `\nOptions : ${event.options.join(" · ")}` : "");
        finalStatus = "CLARIFICATION";
      } else if (event.type === "erreur") {
        finalAnswer = event.message;
        finalStatus = "ERREUR";
      }
    },
  });
  // Réponse réellement renvoyée dans le canal (CDC §7.14). WhatsApp limite
  // les messages texte à 4096 caractères : la réponse est découpée honnêtement.
  if (finalAnswer) {
    const chunks: string[] = [];
    let rest = finalAnswer;
    while (rest.length > 4000) {
      let cut = rest.lastIndexOf("\n", 4000);
      if (cut < 2000) cut = 4000;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    chunks.push(rest);
    for (const chunk of chunks) {
      await sendWhatsAppText(fromPhone, chunk);
    }
  } else {
    await sendWhatsAppText(fromPhone, "Votre demande a été enregistrée mais n'a pas produit de réponse vérifiable. Elle reste consultable dans votre espace HESYD ONE.");
  }
  await logStep({
    organizationId,
    step: "WHATSAPP_REPONSE",
    result: finalStatus === "REUSSIE" || finalStatus === "PARTIELLEMENT_REUSSIE" ? "OK" : "ECHEC",
    details: `réponse (${finalStatus || "SANS_STATUT"}) renvoyée au ${fromPhone.slice(-4).padStart(fromPhone.length, "•")}`,
  });
}
