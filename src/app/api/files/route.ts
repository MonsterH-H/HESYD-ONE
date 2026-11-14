import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";

/** Registre des fichiers : recherche réelle (exacte + plein texte léger) + filtres. */
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const clientId = url.searchParams.get("clientId") ?? "";
    const groupId = url.searchParams.get("groupId") ?? "";
    const category = url.searchParams.get("category") ?? "";
    const status = url.searchParams.get("status") ?? "";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = 50;

    const where: Record<string, unknown> = {
      organizationId: auth.organization.id,
      status: status ? status : { not: "REJETE_JUSTIFIE" },
    };
    if (clientId) where.clientId = clientId;
    if (groupId) where.groupId = groupId;
    if (category) where.category = category;
    if (q) {
      where.OR = [
        { originalFilename: { contains: q } },
        { detectedType: { contains: q } },
        { summary: { contains: q } },
        { category: { contains: q } },
      ];
    }

    const [total, files] = await Promise.all([
      db.file.count({ where }),
      db.file.findMany({
        where,
        include: { client: true, group: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, files };
  });
}
