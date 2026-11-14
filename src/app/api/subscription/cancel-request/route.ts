import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const schema = z.object({ reason: z.string().max(500).optional() });

/**
 * Demande de résiliation par le propriétaire (CDC §9.8) — honnête : la
 * résiliation n'est PAS appliquée ici. Les transitions d'abonnement liées
 * au paiement restent gouvernées par les webhooks signés (CDC §9.4) et le
 * traitement final est un geste opérateur (console plateforme) : demande
 * consignée, visible par l'exploitant, avec motif. Rien n'est supprimé à ce
 * stade ; l'export complet reste disponible.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireRole("PROPRIETAIRE");
    const body = schema.safeParse(await readJson<unknown>(req).catch(() => ({})));
    const reason = body.success ? body.data.reason?.trim() : undefined;

    const subscription = await db.subscription.findUnique({ where: { organizationId: auth.organization.id } });
    if (!subscription) throw new Error("abonnement_introuvable");
    if (subscription.cancelRequestedAt) {
      return { ok: true, alreadyRequested: true, requestedAt: subscription.cancelRequestedAt, message: "Une demande de résiliation est déjà enregistrée et attend le traitement par l'exploitant de la plateforme." };
    }

    await db.subscription.update({
      where: { organizationId: auth.organization.id },
      data: { cancelRequestedAt: new Date(), cancelReason: reason ?? null },
    });
    await logAudit({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: "RESILIATION_DEMANDEE",
      entityType: "Subscription",
      entityId: subscription.id,
      after: { reason: reason ?? null },
    });
    return {
      ok: true,
      message:
        "Demande de résiliation enregistrée. Rien n'est supprimé : l'exploitant de la plateforme la traite (attestation, export, purge 30 jours après la date d'effet). Vous pouvez exporter vos données à tout moment depuis l'onglet Paramètres.",
    };
  });
}
