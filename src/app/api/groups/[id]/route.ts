import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const SOURCES = ["WHATSAPP_DIRECT", "WHATSAPP_GROUPE", "DEPOT_WEB", "DOSSIER_SURVEILLE"] as const;

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  code: z.string().min(1).max(30).optional(),
  clientId: z.string().min(1).optional(),
  sourceType: z.enum(SOURCES).optional(),
  status: z.enum(["ACTIF", "SUSPENDU"]).optional(),
  collectionStatus: z.enum(["A_CONFIGURER", "EN_VERIFICATION", "ACTIF", "SUSPENDU", "DECONNECTE"]).optional(),
});

/** Normalisation du code référentiel : majuscules, espaces → tirets du bas. */
function normaliserCode(brut: string) {
  return brut.trim().toUpperCase().replace(/\s+/g, "_").slice(0, 30);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    const { id } = await ctx.params;
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const body = patchSchema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");

    const group = await db.waGroup.findFirst({ where: { id, organizationId: auth.organization.id } });
    if (!group) throw new Error("groupe_introuvable");

    const data: { name?: string; code?: string; clientId?: string; sourceType?: string; status?: string; collectionStatus?: string } = {};

    if (body.data.name !== undefined) data.name = body.data.name.trim();

    if (body.data.code !== undefined) {
      const code = normaliserCode(body.data.code);
      if (!code) throw new Error("donnees_incompletes");
      if (code !== group.code) {
        const conflit = await db.waGroup.findFirst({
          where: { organizationId: auth.organization.id, code, id: { not: id } },
        });
        if (conflit) throw new Error("code_deja_utilise");
      }
      data.code = code;
    }

    if (body.data.clientId !== undefined) {
      if (body.data.clientId !== group.clientId) {
        const client = await db.client.findFirst({
          where: { id: body.data.clientId, organizationId: auth.organization.id },
        });
        if (!client) throw new Error("client_introuvable");
      }
      data.clientId = body.data.clientId;
    }

    if (body.data.sourceType !== undefined) data.sourceType = body.data.sourceType;
    if (body.data.status !== undefined) data.status = body.data.status;
    if (body.data.collectionStatus !== undefined) data.collectionStatus = body.data.collectionStatus;

    const updated = await db.waGroup.update({ where: { id }, data });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "GROUPE_MODIFIE", entityType: "WAGroup", entityId: id, before: group, after: updated });
    return { group: updated };
  });
}

/** Archivage logique — jamais de suppression physique (CDC §11.8). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    const { id } = await ctx.params;
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const group = await db.waGroup.findFirst({ where: { id, organizationId: auth.organization.id } });
    if (!group) throw new Error("groupe_introuvable");
    if (group.status === "ARCHIVE") return { group };
    const updated = await db.waGroup.update({
      where: { id },
      data: { status: "ARCHIVE", collectionStatus: "SUSPENDU" },
    });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "GROUPE_ARCHIVE_LOGIQUE", entityType: "WAGroup", entityId: id, before: { status: group.status }, after: { status: "ARCHIVE" } });
    return { group: updated };
  });
}
