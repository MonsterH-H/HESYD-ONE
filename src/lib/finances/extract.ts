// Extraction d'opérations financières candidates (CDC §3.4, mission §3.4).
//
// Règles métier non négociables :
// - Une information financière lue dans un message WhatsApp ou un document n'est JAMAIS
//   un encaissement confirmé : le statut VALIDE ne peut être posé que par une
//   validation humaine (route /api/finances/[id]/validate, ADMIN+).
// - Traçabilité stricte : Organisation → Client → Groupe → Événement source → Opération.
// - Idempotence : la clé (organizationId, sourceKey) rend impossible tout doublon
//   issu d'un même message ou document (rejeu webhook compris).
// - Information ambiguë (montant incertain, devise absente, date absente) →
//   statut A_VERIFIER + needsReview, jamais VALIDÉ automatiquement.
// - L'extraction utilise le vrai modèle via le fournisseur configuré (Azure AI Foundry
//   sinon GLM — voir src/lib/ai/provider.ts) ; échec = aucune opération créée, statuts honnêtes.

import { z } from "zod";
import { db } from "@/lib/db";
import { chatComplete } from "@/lib/ai/provider";

export type FinancialCandidateParams = {
  organizationId: string;
  clientId?: string | null;
  groupId?: string | null;
  sourceType: "WHATSAPP" | "DOCUMENT" | "AGENT";
  /** Clé d'idempotence de la source (message WhatsApp / fichier / événement). */
  sourceKey: string;
  text: string;
  sourceReceptionId?: string | null;
  sourceFileId?: string | null;
  sourceWebhookEventId?: string | null;
  documentFilename?: string | null;
};

const ExtractionSchema = z
  .object({
    operations: z.array(z.record(z.string(), z.unknown())).max(10),
  })
  .passthrough();

/** Normalisation tolérante : le modèle peut renvoyer des clés FR ou EN — on n'invente rien. */
function normalizeOperation(raw: Record<string, unknown>): { label: string; amountCents: number; currency: string | null; operationDate: string | null; confidence: number; ambiguous: boolean } | null {
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      const v = raw[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  };
  const labelRaw = pick("label", "libelle", "libellé", "nature", "description");
  const amountRaw = pick("amountCents", "montantCentimes", "montant_centimes", "montant");
  if (typeof labelRaw !== "string" || !labelRaw.trim()) return null;
  if (typeof amountRaw !== "number" || !Number.isFinite(amountRaw)) return null;
  // montant saisi en unités principales (ex. 899.90) → conversion en centimes ; entier positif → déjà en centimes
  const amountCents = Number.isInteger(amountRaw) && amountRaw >= 1 ? amountRaw : Math.round(amountRaw * 100);
  if (amountCents <= 0) return null;
  const currencyRaw = pick("currency", "devise");
  let currency: string | null = null;
  if (typeof currencyRaw === "string") {
    const m = currencyRaw.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(m)) currency = m;
  }
  const dateRaw = pick("operationDate", "dateOperation", "date_operation", "date");
  let operationDate: string | null = null;
  if (typeof dateRaw === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateRaw)) operationDate = dateRaw.slice(0, 10);
  const confidenceRaw = pick("confidence", "confiance");
  const confidence = typeof confidenceRaw === "number" && confidenceRaw >= 0 && confidenceRaw <= 1 ? confidenceRaw : 0.5;
  const ambiguousRaw = pick("ambiguous", "ambigu");
  const ambiguous = ambiguousRaw === true || ambiguousRaw === "true";
  return { label: labelRaw.trim().slice(0, 200), amountCents, currency, operationDate, confidence, ambiguous };
}

type Candidate = {
  label: string;
  amountCents: number;
  currency: string | null;
  operationDate: Date | null;
  confidence: number;
  needsReview: boolean;
};

export type ExtractResult = { created: number; skipped: number; ambiguous: number };

/** Extraction réelle (modèle) + enregistrement idempotent des candidates — jamais VALIDE. */
export async function recordFinancialCandidates(params: FinancialCandidateParams): Promise<ExtractResult> {
  const text = (params.text ?? "").trim();
  if (text.length < 8) return { created: 0, skipped: 0, ambiguous: 0 };

  const system = [
    "Tu es un extracteur strict d'informations financières pour un registre comptable.",
    "Extrais UNIQUEMENT les montants monétaires explicites (factures, paiements, virements, montants dus, montants reçus) du texte fourni.",
    'Réponds STRICTEMENT en JSON valide avec EXACTEMENT ces clés anglaises :',
    '{"operations":[{"label":"nature courte de l\'opération","amountCents":<entier en centimes, ex 89990 pour 899,90 EUR>,"currency":"code ISO 4217 en 3 lettres ou null","operationDate":"YYYY-MM-DD ou null","confidence":0.0-1.0,"ambiguous":false}]}',
    "Règles absolues : n'invente jamais un montant absent ; un montant ambigu, mal isolé ou sans devise identifiable → ambiguous=true et confidence abaissée ; aucune autre clé acceptée.",
    'Si aucun montant n\'est présent, réponds {"operations":[]}.',
  ].join(" ");

  const user = [
    params.documentFilename ? `Document : ${params.documentFilename}` : "Message de groupe WhatsApp :",
    "—",
    text.slice(0, 6000),
  ].join("\n");

  let parsed: z.infer<typeof ExtractionSchema>;
  try {
    const result = await chatComplete(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { temperature: 0, jsonMode: true, maxTokens: 1200 },
    );
    // Le modèle encadre parfois son JSON d'un bloc de code : on isole l'objet réel.
    const fenced = result.content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : result.content;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1) return { created: 0, skipped: 0, ambiguous: 0 };
    parsed = ExtractionSchema.parse(JSON.parse(candidate.slice(start, end + 1)));
  } catch {
    // Modèle indisponible, JSON invalide ou hors contrat : aucune opération fabriquée.
    return { created: 0, skipped: 0, ambiguous: 0 };
  }

  const candidates: Candidate[] = [];
  let skipped = 0;
  for (const raw of parsed.operations) {
    if (typeof raw !== "object" || raw === null) {
      skipped += 1;
      continue;
    }
    const normalized = normalizeOperation(raw as Record<string, unknown>);
    if (!normalized) {
      skipped += 1;
      continue;
    }
    const ambiguous = normalized.ambiguous || !normalized.currency || !normalized.operationDate || normalized.confidence < 0.75;
    candidates.push({
      label: normalized.label,
      amountCents: normalized.amountCents,
      currency: normalized.currency,
      operationDate: normalized.operationDate ? new Date(`${normalized.operationDate}T12:00:00Z`) : null,
      confidence: normalized.confidence,
      needsReview: ambiguous,
    });
  }
  if (!candidates.length) return { created: 0, skipped, ambiguous: 0 };

  let created = 0;
  let ambiguous = 0;
  for (const [index, candidate] of candidates.entries()) {
    // Idempotence stricte : une seule opération par (organisation, source+index).
    const sourceKey = `${params.sourceType}:${params.sourceKey}:${index}`;
    const existing = await db.financialOperation.findUnique({
      where: { organizationId_sourceKey: { organizationId: params.organizationId, sourceKey } },
      select: { id: true },
    });
    if (existing) continue;

    await db.financialOperation.create({
      data: {
        organizationId: params.organizationId,
        clientId: params.clientId ?? null,
        groupId: params.groupId ?? null,
        sourceType: params.sourceType,
        sourceReceptionId: params.sourceReceptionId ?? null,
        sourceFileId: params.sourceFileId ?? null,
        sourceWebhookEventId: params.sourceWebhookEventId ?? null,
        sourceKey,
        label: candidate.label,
        amountCents: candidate.amountCents,
        // XXX = code ISO 4217 « devise inconnue » — jamais « ??? » qui polluait
        // l'agrégation groupBy(devise) côté registre (audit S9).
        currency: candidate.currency ?? "XXX",
        operationDate: candidate.operationDate,
        // Statut honnête : EXTRAITE si claire, A_VERIFIER si ambiguë — jamais VALIDE ici.
        status: candidate.needsReview ? "A_VERIFIER" : "EXTRAITE",
        confidence: candidate.confidence,
        needsReview: candidate.needsReview,
        createdById: null,
      },
    });
    created += 1;
    if (candidate.needsReview) ambiguous += 1;
  }

  if (ambiguous > 0) {
    const { notify } = await import("@/lib/audit");
    await notify({
      organizationId: params.organizationId,
      type: "SYSTEME",
      title: "Opérations financières à vérifier",
      message: `${ambiguous} opération(s) financière(s) extraite(s) sont ambiguës : validation humaine requise dans le registre Finances.`,
      relatedEntityType: "FinancialOperation",
    });
  }
  return { created, skipped: skipped, ambiguous };
}
