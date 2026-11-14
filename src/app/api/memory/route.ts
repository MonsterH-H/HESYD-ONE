import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";

/** Mémoire de l'organisation — consultable, corrigeable, supprimable (CDC §7). */
export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    const memories = await db.memoryItem.findMany({
      where: { organizationId: auth.organization.id, status: "ACTIF" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { memories };
  });
}

const schema = z.object({ content: z.string().min(3).max(500) });

/** Ajout d'un souvenir durable (source : utilisateur). */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR", "EMPLOYE"].includes(auth.role)) throw new Error("forbidden");
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    const memory = await db.memoryItem.create({
      data: { organizationId: auth.organization.id, content: body.data.content.trim(), source: "UTILISATEUR" },
    });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "MEMOIRE_AJOUTEE", entityType: "MemoryItem", entityId: memory.id, after: { content: memory.content } });
    return { memory };
  });
}
