import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { whatsappConfigured } from "@/lib/connectors/whatsapp";

const createSchema = z.object({
  clientId: z.string().min(1),
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(120),
  sourceType: z.enum(["WHATSAPP_DIRECT", "WHATSAPP_GROUPE", "DEPOT_WEB", "DOSSIER_SURVEILLE"]),
  whatsappGroupId: z.string().max(80).optional(),
});

export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    const groups = await db.waGroup.findMany({
      where: { organizationId: auth.organization.id, status: { not: "ARCHIVE" } },
      include: { client: true, _count: { select: { files: true } } },
      orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
    });
    return { groups, whatsappConfigured: whatsappConfigured() };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const body = createSchema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");

    const client = await db.client.findFirst({ where: { id: body.data.clientId, organizationId: auth.organization.id } });
    if (!client) throw new Error("client_introuvable");

    // Un groupe ne devient ACTIF qu'après validation technique (CDC §11.2) : dépôt web = actif réel immédiat ; WhatsApp réel sans identifiants = EN_VERIFICATION
    const needsVerification = body.data.sourceType !== "DEPOT_WEB" && body.data.sourceType !== "DOSSIER_SURVEILLE" && !whatsappConfigured();
    const code = body.data.code.toUpperCase().trim().replace(/\s+/g, "_");
    const group = await db.waGroup.create({
      data: {
        organizationId: auth.organization.id,
        clientId: client.id,
        code,
        name: body.data.name.trim(),
        sourceType: body.data.sourceType,
        whatsappGroupId: body.data.whatsappGroupId?.trim() || null,
        collectionStatus: needsVerification ? "A_CONFIGURER" : "ACTIF",
        status: "ACTIF",
      },
    });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "GROUPE_CREE", entityType: "WAGroup", entityId: group.id, after: { code, sourceType: group.sourceType } });
    await db.onboardingProgress.updateMany({ where: { organizationId: auth.organization.id, groupCreated: false }, data: { groupCreated: true, groupAt: new Date() } });
    return { group, note: needsVerification ? "collecte_whatsapp_requiert_configuration_meta" : "collecte_activee_a_la_premiere_reception" };
  });
}
