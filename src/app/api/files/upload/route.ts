import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { ingestDocument } from "@/lib/pipeline/ingest";

const MAX_SIZE = 25 * 1024 * 1024;

/** Dépôt web réel : multipart, validation complète, pipeline d'archivage confirmé. */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR", "EMPLOYE"].includes(auth.role)) throw new Error("forbidden");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("fichier_absent");
    if (file.size === 0 || file.size > MAX_SIZE) throw new Error("taille_refusee");

    const clientId = (form.get("clientId") as string) || null;
    const groupId = (form.get("groupId") as string) || null;
    const caption = (form.get("caption") as string) || undefined;

    if (groupId) {
      const group = await db.waGroup.findFirst({ where: { id: groupId, organizationId: auth.organization.id } });
      if (!group) throw new Error("groupe_inconnu");
    } else if (clientId) {
      const client = await db.client.findFirst({ where: { id: clientId, organizationId: auth.organization.id } });
      if (!client) throw new Error("client_inconnu");
    }

    const data = Buffer.from(await file.arrayBuffer());
    const result = await ingestDocument({
      organizationId: auth.organization.id,
      orgSlug: auth.organization.slug,
      originalFilename: file.name,
      mime: file.type || "application/octet-stream",
      data,
      source: "DEPOT_WEB",
      clientId,
      groupId,
      caption,
      createdById: auth.user.id,
    });

    return result;
  });
}
