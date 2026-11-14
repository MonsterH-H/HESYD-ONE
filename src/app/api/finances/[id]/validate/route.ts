import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit, notify } from "@/lib/audit";

const schema = z.object({
  action: z.enum(["VALIDER", "REJETER"]),
  note: z.string().max(500).optional(),
});

/**
 * Décision humaine sur une opération financière — réservée à PROPRIETAIRE / ADMINISTRATEUR.
 * - VALIDER : uniquement depuis EXTRAITE / A_VERIFIER. C'est le seul chemin vers le
 *   statut VALIDE : une information extraite d'un message ou d'un document n'est
 *   JAMAIS un encaissement confirmé tant qu'un humain ne l'a pas validée.
 * - REJETER : depuis tout statut non VALIDE, motif obligatoire (400 sans note).
 * Chaque décision ajoute une entrée à historyJson (jamais d'effacement), est auditée
 * et notifiée au créateur si différent du décideur.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const { id } = await ctx.params;
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");

    const operation = await db.financialOperation.findFirst({
      where: { id, organizationId: auth.organization.id },
    });
    if (!operation) throw new Error("operation_introuvable");

    const maintenant = new Date();
    const historiqueBrut = JSON.parse(operation.historyJson || "[]") as unknown;
    const entrees = Array.isArray(historiqueBrut) ? historiqueBrut : [];

    if (body.data.action === "VALIDER") {
      if (operation.status !== "EXTRAITE" && operation.status !== "A_VERIFIER") {
        throw new Error("validation_statut_invalide");
      }
      entrees.push({
        at: maintenant.toISOString(),
        byId: auth.user.id,
        action: "VALIDATION",
        from: { status: operation.status },
        to: { status: "VALIDE" },
        note: body.data.note?.trim() ?? null,
      });
      const updated = await db.financialOperation.update({
        where: { id: operation.id },
        data: {
          status: "VALIDE",
          validatedById: auth.user.id,
          validatedAt: maintenant,
          needsReview: false,
          historyJson: JSON.stringify(entrees),
        },
      });
      await logAudit({
        organizationId: auth.organization.id,
        userId: auth.user.id,
        action: "FINANCE_OPERATION_VALIDEE",
        entityType: "FinancialOperation",
        entityId: operation.id,
        before: { status: operation.status },
        after: { status: "VALIDE", amountCents: operation.amountCents, currency: operation.currency },
      });
      if (operation.createdById && operation.createdById !== auth.user.id) {
        await notify({
          organizationId: auth.organization.id,
          userId: operation.createdById,
          type: "SYSTEME",
          title: "Opération financière validée",
          message: `« ${operation.label} » a été validée par ${auth.user.name} : l'encaissement est confirmé.`,
          relatedEntityType: "FinancialOperation",
          relatedEntityId: operation.id,
        });
      }
      return { operation: updated };
    }

    // REJETER — depuis tout statut non VALIDE, motif obligatoire
    if (operation.status === "VALIDE") throw new Error("rejet_statut_invalide");
    const note = body.data.note?.trim();
    if (!note) throw new Error("motif_rejet_requis");
    entrees.push({
      at: maintenant.toISOString(),
      byId: auth.user.id,
      action: "REJET",
      from: { status: operation.status },
      to: { status: "REJETEE" },
      note,
    });
    const updated = await db.financialOperation.update({
      where: { id: operation.id },
      data: {
        status: "REJETEE",
        rejectedById: auth.user.id,
        rejectionReason: note,
        needsReview: false,
        historyJson: JSON.stringify(entrees),
      },
    });
    await logAudit({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: "FINANCE_OPERATION_REJETEE",
      entityType: "FinancialOperation",
      entityId: operation.id,
      before: { status: operation.status },
      after: { status: "REJETEE", motif: note },
    });
    if (operation.createdById && operation.createdById !== auth.user.id) {
      await notify({
        organizationId: auth.organization.id,
        userId: operation.createdById,
        type: "SYSTEME",
        title: "Opération financière rejetée",
        message: `« ${operation.label} » a été rejetée par ${auth.user.name} — motif : ${note}`,
        relatedEntityType: "FinancialOperation",
        relatedEntityId: operation.id,
      });
    }
    return { operation: updated };
  });
}
