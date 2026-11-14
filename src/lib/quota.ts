import { db } from "@/lib/db";
import { notify } from "@/lib/audit";

/**
 * Mesure d'usage et crédits — tout est réel (CDC §9.5) :
 * - chaque opération consommant une ressource facturable est enregistrée (usage_metering) ;
 * - le solde de crédits est tenu dans un registre (credit_ledger) ;
 * - quota dépassé : l'archivage continue, l'agent et les livrables sont mis en attente.
 */

export type UsageNature = "DOCUMENT_TRAITE" | "QUESTION_AGENT" | "LIVRABLE" | "TRANSCRIPTION" | "OCR";

export const CREDIT_COST: Record<UsageNature, number> = {
  DOCUMENT_TRAITE: 2,
  QUESTION_AGENT: 1,
  LIVRABLE: 3,
  TRANSCRIPTION: 1,
  OCR: 2,
};

export async function creditBalance(organizationId: string): Promise<number> {
  const agg = await db.creditLedger.aggregate({
    where: { organizationId },
    _sum: { delta: true },
  });
  return agg._sum.delta ?? 0;
}

export async function grantCredits(organizationId: string, amount: number, reason: string, detail?: string, expiresAt?: Date): Promise<number> {
  return db.$transaction(async (tx) => {
    const agg = await tx.creditLedger.aggregate({ where: { organizationId }, _sum: { delta: true } });
    const balance = (agg._sum.delta ?? 0) + amount;
    await tx.creditLedger.create({
      data: { organizationId, delta: amount, reason, detail, balanceAfter: balance, expiresAt },
    });
    return balance;
  });
}

export async function consumeCredits(organizationId: string, amount: number, reason: string, detail?: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const agg = await tx.creditLedger.aggregate({ where: { organizationId }, _sum: { delta: true } });
    const balance = agg._sum.delta ?? 0;
    if (balance < amount) return false;
    await tx.creditLedger.create({
      data: { organizationId, delta: -amount, reason, detail, balanceAfter: balance - amount },
    });
    return true;
  });
}

export async function meterUsage(params: {
  organizationId: string;
  userId?: string;
  nature: UsageNature;
  quantity?: number;
  creditsUsed?: number;
}) {
  await db.usageMetering.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId ?? null,
      nature: params.nature,
      quantity: params.quantity ?? 1,
      creditsUsed: params.creditsUsed ?? CREDIT_COST[params.nature],
    },
  });
}

export async function monthlyUsageCount(organizationId: string, nature: UsageNature): Promise<number> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const agg = await db.usageMetering.aggregate({
    where: { organizationId, nature, createdAt: { gte: start } },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? 0;
}

/** Vérifie les crédits pour une opération consommatrice (agent, livrable, OCR). */
export async function creditsAvailable(organizationId: string, needed: number): Promise<boolean> {
  return (await creditBalance(organizationId)) >= needed;
}

/** Alerte 80 % puis 100 % (réelles, basées sur la consommation du mois). */
export async function checkQuotaAlerts(organizationId: string, monthlyDocuments: number, documentsThisMonth: number) {
  if (monthlyDocuments <= 0) return;
  const ratio = documentsThisMonth / monthlyDocuments;
  if (ratio >= 1) {
    await notifyOnce(organizationId, "QUOTA_100", "quota_100");
  } else if (ratio >= 0.8) {
    await notifyOnce(organizationId, "QUOTA_80", "quota_80");
  }
}

async function notifyOnce(organizationId: string, type: string, key: string) {
  const exists = await db.notification.findFirst({
    where: { organizationId, type, createdAt: { gte: new Date(Date.now() - 72 * 3600 * 1000) } },
  });
  if (exists) return;
  await notify({
    organizationId,
    type,
    title: key === "quota_80" ? "Quota à 80 %" : "Quota mensuel atteint",
    message:
      key === "quota_80"
        ? "Vous avez utilisé 80 % de votre quota de documents du mois. L'archivage continue normalement."
        : "Quota mensuel atteint : l'archivage continue, l'agent et les livrables sont mis en attente jusqu'au renouvellement.",
  });
}
