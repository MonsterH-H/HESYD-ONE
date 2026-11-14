import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, AuthError } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  amountCents: z.number().int().positive().optional(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .optional(),
  operationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  note: z.string().min(1).max(500),
});

/**
 * Correction réelle d'une opération — garde EMPLOYE+.
 * AVANT écriture : l'état est capturé, puis l'historique reçoit une entrée
 * { at, byId, action: "CORRECTION", from, to, note }. Un enregistrement VALIDE
 * corrigé reste VALIDE : le delta est montré par l'historique, jamais d'effacement.
 * Un enregistrement REJETEE n'est pas modifiable (403 honnête).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR", "EMPLOYE"].includes(auth.role)) throw new Error("forbidden");
    const { id } = await ctx.params;
    const body = patchSchema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    const data = body.data;

    const operation = await db.financialOperation.findFirst({
      where: { id, organizationId: auth.organization.id },
    });
    if (!operation) throw new Error("operation_introuvable");
    if (operation.status === "REJETEE") throw new AuthError("operation_rejetee_non_modifiable", 403);
    if (
      data.label === undefined &&
      data.amountCents === undefined &&
      data.currency === undefined &&
      data.operationDate === undefined
    ) {
      throw new Error("aucune_correction");
    }

    const avant = {
      label: operation.label,
      amountCents: operation.amountCents,
      currency: operation.currency,
      operationDate: operation.operationDate ? operation.operationDate.toISOString() : null,
      status: operation.status,
    };
    const apres = {
      ...avant,
      label: data.label !== undefined ? data.label.trim() : operation.label,
      amountCents: data.amountCents !== undefined ? data.amountCents : operation.amountCents,
      currency: data.currency !== undefined ? data.currency.toUpperCase() : operation.currency,
      operationDate:
        data.operationDate !== undefined
          ? new Date(`${data.operationDate}T12:00:00Z`).toISOString()
          : avant.operationDate,
    };

    const historiqueBrut = JSON.parse(operation.historyJson || "[]") as unknown;
    const entrees = Array.isArray(historiqueBrut) ? historiqueBrut : [];
    entrees.push({
      at: new Date().toISOString(),
      byId: auth.user.id,
      action: "CORRECTION",
      from: avant,
      to: apres,
      note: data.note.trim(),
    });

    const updated = await db.financialOperation.update({
      where: { id: operation.id },
      data: {
        label: apres.label,
        amountCents: apres.amountCents,
        currency: apres.currency,
        operationDate: apres.operationDate ? new Date(apres.operationDate) : null,
        historyJson: JSON.stringify(entrees),
      },
    });
    await logAudit({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: "FINANCE_OPERATION_CORRIGEE",
      entityType: "FinancialOperation",
      entityId: operation.id,
      before: avant,
      after: apres,
    });
    return { operation: updated };
  });
}

/**
 * Suppression interdite — la trace comptable est conservée : utilisez le rejet.
 * Réponse 405 explicite, jamais de DELETE silencieux.
 */
export async function DELETE() {
  return NextResponse.json({ error: "les_operations_ne_se_suppriment_pas_utilisez_rejet" }, { status: 405 });
}
