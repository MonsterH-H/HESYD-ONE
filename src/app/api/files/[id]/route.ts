import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";

/** Fiche documentaire complète : chaîne de garde, extractions, réceptions réelles. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    const { id } = await ctx.params;
    const file = await db.file.findFirst({
      where: { id, organizationId: auth.organization.id },
      include: { client: true, group: true },
    });
    if (!file) throw new Error("document_introuvable");
    const [extractions, receptions, logs, chunksCount] = await Promise.all([
      db.extraction.findMany({ where: { fileId: id, organizationId: auth.organization.id }, orderBy: { confidence: "desc" } }),
      db.fileReception.findMany({ where: { fileId: id, organizationId: auth.organization.id }, orderBy: { receivedAt: "desc" } }),
      db.processingLog.findMany({ where: { fileId: id, organizationId: auth.organization.id }, orderBy: { createdAt: "asc" } }),
      db.documentChunk.count({ where: { fileId: id, organizationId: auth.organization.id } }),
    ]);
    return {
      file,
      extractions,
      receptions,
      logs,
      chunksCount,
      sources: [] as { fileId: string; label: string }[],
    };
  });
}
