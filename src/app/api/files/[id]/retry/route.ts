import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { readArchivedFile } from "@/lib/storage/local";
import { archiveToConfiguredDestination } from "@/lib/storage/destination";

/** Reprise réelle d'un archivage en erreur — repart du dernier état confirmé. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    const { id } = await ctx.params;
    if (!["PROPRIETAIRE", "ADMINISTRATEUR", "EMPLOYE"].includes(auth.role)) throw new Error("forbidden");

    const file = await db.file.findFirst({
      where: { id, organizationId: auth.organization.id },
      include: { client: true, group: true },
    });
    if (!file) throw new Error("document_introuvable");
    if (!file.client || !file.group) throw new Error("rattachement_manquant");
    if (file.status === "ARCHIVE") throw new Error("deja_archive");

    // Matière première : chemin RÉEL de la réception (rawPath), avec repli sur
    // le chemin reconstruit pour les lignes antérieures au durcissement.
    const reception = await db.fileReception.findFirst({
      where: { fileId: id, organizationId: auth.organization.id, rawPath: { not: null } },
      orderBy: { receivedAt: "desc" },
      select: { rawPath: true },
    });
    const rawRel = reception?.rawPath ?? `storage/received/${auth.organization.slug}/${file.originalFilename}`;
    const data = await readArchivedFile(rawRel).catch(() => {
      throw new Error("matiere_premiere_absente");
    });
    // Reprise vers la destination réellement configurée : le Drive du CLIENT si
    // connecté (propriété documentaire), sinon repli local honnête.
    const result = await archiveToConfiguredDestination(
      auth.organization.id,
      {
        orgSlug: auth.organization.slug,
        clientCode: file.client.code,
        clientName: file.client.name,
        groupCode: file.group.code,
        groupName: file.group.name,
        category: file.category,
        receivedAt: file.receivedAt ?? new Date(),
      },
      file.originalFilename,
      file.mimeType,
      data
    );
    const updated = await db.file.update({
      where: { id },
      data: { status: "ARCHIVE", storedFilename: result.storedFilename, archivedPath: result.archivedPath, archivedAt: new Date(), confirmedByProof: result.proof, driveFileId: result.driveFileId },
    });
    await db.fileReception.updateMany({ where: { fileId: id, status: "ERREUR_REPRENABLE" }, data: { status: "TRAITEE" } });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "REPRISE_ARCHIVAGE", entityType: "File", entityId: id, after: { proof: result.proof } });
    await db.onboardingProgress.updateMany({
      where: { organizationId: auth.organization.id, firstDocArchived: false },
      data: { firstDocArchived: true, docAt: new Date() },
    });
    return { file: updated, proof: result.proof };
  });
}
