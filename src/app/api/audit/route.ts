import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";

/** Journal d'audit réel — lecture seule, réservée à la console opérateur. */
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const pageSize = 50;

    const where = { organizationId: auth.organization.id };
    const [total, entries] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // Jointure manuelle : AuditLog ne porte pas de relation Prisma vers User (intentionnel).
    const userIds = [...new Set(entries.map((e) => e.userId).filter((v): v is string => Boolean(v)))];
    const users = userIds.length
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
    const userParId = new Map(users.map((u) => [u.id, { name: u.name, email: u.email }]));

    return {
      total,
      page,
      pageSize,
      entries: entries.map((e) => ({
        id: e.id,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        actor: e.userId ? userParId.get(e.userId) ?? null : null,
        createdAt: e.createdAt,
      })),
    };
  });
}
