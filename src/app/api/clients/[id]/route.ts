import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  code: z.string().min(1).max(30).optional(),
  contact: z.string().max(200).optional(),
  status: z.enum(["ACTIF", "SUSPENDU"]).optional(),
});

/** Suppression = logique (ARCHIVE), jamais physique (CDC §11.8). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    const { id } = await ctx.params;
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const body = patchSchema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    const client = await db.client.findFirst({ where: { id, organizationId: auth.organization.id } });
    if (!client) throw new Error("client_introuvable");

    const data: { name?: string; code?: string; contact?: string; status?: string } = {};
    if (body.data.name !== undefined) data.name = body.data.name.trim();
    if (body.data.contact !== undefined) data.contact = body.data.contact.trim();
    if (body.data.status !== undefined) data.status = body.data.status;
    if (body.data.code !== undefined) {
      const code = body.data.code.trim().toUpperCase().replace(/\s+/g, "_").slice(0, 30);
      if (!code) throw new Error("donnees_incompletes");
      if (code !== client.code) {
        const conflit = await db.client.findFirst({
          where: { organizationId: auth.organization.id, code, id: { not: id } },
        });
        if (conflit) throw new Error("code_deja_utilise");
      }
      data.code = code;
    }

    const updated = await db.client.update({
      where: { id },
      data,
    });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "CLIENT_MODIFIE", entityType: "Client", entityId: id, before: client, after: updated });
    return { client: updated };
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    const { id } = await ctx.params;
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const client = await db.client.findFirst({ where: { id, organizationId: auth.organization.id } });
    if (!client) throw new Error("client_introuvable");
    const updated = await db.client.update({ where: { id }, data: { status: "ARCHIVE", archivedAt: new Date() } });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "CLIENT_ARCHIVE_LOGIQUE", entityType: "Client", entityId: id, before: { status: client.status }, after: { status: "ARCHIVE" } });
    return { client: updated };
  });
}
