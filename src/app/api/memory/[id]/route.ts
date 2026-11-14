import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { logAudit } from "@/lib/audit";

/** Suppression d'un souvenir de la mémoire de l'organisation — réservée aux membres en écriture. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR", "EMPLOYE"].includes(auth.role)) throw new Error("forbidden");
    const { id } = await ctx.params;
    const memory = await db.memoryItem.findFirst({ where: { id, organizationId: auth.organization.id } });
    if (!memory) throw new Error("souvenir_introuvable");
    await db.memoryItem.delete({ where: { id } });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "MEMOIRE_SUPPRIMEE", entityType: "MemoryItem", entityId: id, before: { content: memory.content } });
    return { ok: true };
  });
}
