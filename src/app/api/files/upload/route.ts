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

    // Destination par défaut (décision provisioning : « le premier dépôt sans
    // configuration a toujours une destination ») : un dépôt web sans client
    // ni groupe explicites est rattaché au groupe « Dépots directs » créé à
    // l'inscription (client « Général »). Le rattachement reste explicite et
    // auditable ; sans ce groupe, le fichier passe honnêtement À VÉRIFIER.
    let resolvedGroupId = groupId;
    let resolvedClientId = clientId;
    if (!resolvedGroupId && !resolvedClientId) {
      const depot = await db.waGroup.findFirst({
        where: { organizationId: auth.organization.id, code: "DEPOTS_DIRECTS" },
      });
      if (depot) resolvedGroupId = depot.id;
    }

    if (resolvedGroupId) {
      const group = await db.waGroup.findFirst({ where: { id: resolvedGroupId, organizationId: auth.organization.id } });
      if (!group) throw new Error("groupe_inconnu");
    } else if (resolvedClientId) {
      const client = await db.client.findFirst({ where: { id: resolvedClientId, organizationId: auth.organization.id } });
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
      clientId: resolvedClientId,
      groupId: resolvedGroupId,
      caption,
      createdById: auth.user.id,
    });

    return result;
  });
}
