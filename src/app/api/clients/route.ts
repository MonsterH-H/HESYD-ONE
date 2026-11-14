import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(120),
  contact: z.string().max(200).optional(),
});

export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    const clients = await db.client.findMany({
      where: { organizationId: auth.organization.id, status: { not: "ARCHIVE" } },
      include: { groups: { where: { status: { not: "ARCHIVE" } } }, _count: { select: { files: true } } },
      orderBy: { name: "asc" },
    });
    return { clients };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const body = createSchema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    const code = body.data.code.toUpperCase().trim().replace(/\s+/g, "_");
    const client = await db.client.create({
      data: {
        organizationId: auth.organization.id,
        code,
        name: body.data.name.trim(),
        contact: body.data.contact?.trim() ?? null,
      },
    });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "CLIENT_CREE", entityType: "Client", entityId: client.id, after: { code, name: client.name } });
    await db.onboardingProgress.updateMany({ where: { organizationId: auth.organization.id, clientCreated: false }, data: { clientCreated: true, clientAt: new Date() } });
    return { client };
  });
}
