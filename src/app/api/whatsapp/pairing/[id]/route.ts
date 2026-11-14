import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { logAudit } from "@/lib/audit";

/** Révocation d'un appairage WhatsApp (le numéro ne dialogue plus avec l'agent). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    // Garde de rôle (audit P2 — défense en profondeur) : un EMPLOYE ne peut
    // révoquer que son propre appairage ; ADMINISTRATEUR+ peut révoquer tout.
    const { id } = await ctx.params;
    const pairing = await db.whatsappPairing.findFirst({ where: { id, organizationId: auth.organization.id } });
    if (!pairing) throw new Error("appariement_introuvable");
    if (auth.role === "EMPLOYE" || auth.role === "LECTEUR") {
      if (pairing.userId !== auth.user.id) throw new Error("forbidden");
    }
    if (pairing.status !== "REVOQUE") {
      await db.whatsappPairing.update({ where: { id }, data: { status: "REVOQUE", revokedAt: new Date() } });
    }
    await logAudit({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: "APPARIEMENT_WHATSAPP_REVOQUE",
      entityType: "WhatsappPairing",
      entityId: id,
      before: { status: pairing.status, phone: pairing.phone },
      after: { status: "REVOQUE" },
    });
    return { ok: true };
  });
}
