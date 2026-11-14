import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { readArchivedFile } from "@/lib/storage/local";
import { archiveToConfiguredDestination } from "@/lib/storage/destination";

const schema = z.object({
  clientId: z.string().min(1),
  groupId: z.string().min(1),
});

/** Correction humaine : rattacher à client/groupe puis archiver pour de vrai. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    const { id } = await ctx.params;
    if (!["PROPRIETAIRE", "ADMINISTRATEUR", "EMPLOYE"].includes(auth.role)) throw new Error("forbidden");
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");

    const file = await db.file.findFirst({ where: { id, organizationId: auth.organization.id } });
    if (!file) throw new Error("document_introuvable");

    const client = await db.client.findFirst({ where: { id: body.data.clientId, organizationId: auth.organization.id, status: "ACTIF" } });
    if (!client) throw new Error("rattachement_incoherent");
    const group = await db.waGroup.findFirst({ where: { id: body.data.groupId, organizationId: auth.organization.id, status: "ACTIF", clientId: client.id } });
    if (!group) throw new Error("rattachement_incoherent");

    // relecture de la matière première brute conservée
    const rawRel = `storage/received/${auth.organization.slug}/${file.originalFilename}`;
    let data: Buffer;
    try {
      data = await readArchivedFile(rawRel);
    } catch {
      throw new Error("matiere_premiere_absente");
    }

    // Archivage vers la destination réellement configurée : le Drive du CLIENT
    // si connecté (propriété documentaire), sinon repli local honnête.
    const result = await archiveToConfiguredDestination(
      auth.organization.id,
      {
        orgSlug: auth.organization.slug,
        clientCode: client.code,
        clientName: client.name,
        groupCode: group.code,
        groupName: group.name,
        category: file.category === "NON_CLASSES" ? "A_VERIFIER" : file.category,
        receivedAt: file.receivedAt ?? new Date(),
      },
      file.originalFilename,
      file.mimeType,
      data
    );

    const updated = await db.file.update({
      where: { id },
      data: {
        clientId: client.id,
        groupId: group.id,
        status: "ARCHIVE",
        storedFilename: result.storedFilename,
        archivedPath: result.archivedPath,
        archivedAt: new Date(),
        confirmedByProof: result.proof,
        driveFileId: result.driveFileId,
      },
    });
    await logAudit({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: "CORRECTION_RATTACHEMENT",
      entityType: "File",
      entityId: id,
      before: { clientId: file.clientId, groupId: file.groupId, status: file.status },
      after: { clientId: client.id, groupId: group.id, status: "ARCHIVE", proof: result.proof },
    });
    await db.onboardingProgress.updateMany({
      where: { organizationId: auth.organization.id, firstDocArchived: false },
      data: { firstDocArchived: true, docAt: new Date() },
    });

    // Extraction financière après finalisation (même contrat que le pipeline de réception) :
    // texte issu de l'index documentaire, sinon repli sur la matière première textuelle
    // conservée — l'écriture est fire-and-forget et TOUJOURS journalisée.
    void (async () => {
      try {
        const chunks = await db.documentChunk.findMany({
          where: { fileId: id, organizationId: auth.organization.id },
          select: { text: true },
          take: 5,
        });
        const mimeTexte = file.mimeType.startsWith("text/") || ["application/json", "text/csv", "text/markdown"].includes(file.mimeType);
        const texte = (chunks.map((c) => c.text).join("\n") || (mimeTexte ? data.toString("utf8") : "")).slice(0, 6000);
        if (texte.length >= 8) {
          const { recordFinancialCandidates } = await import("@/lib/finances/extract");
          const res = await recordFinancialCandidates({
            organizationId: auth.organization.id,
            clientId: client.id,
            groupId: group.id,
            sourceType: "DOCUMENT",
            sourceKey: id,
            text: texte,
            sourceFileId: id,
            documentFilename: file.originalFilename,
          });
          await db.processingLog.create({
            data: {
              organizationId: auth.organization.id,
              fileId: id,
              step: "FINANCES_EXTRACT",
              result: res.created > 0 ? "OK" : "RIEN",
              details: `${res.created} opération(s) créée(s), ${res.ambiguous} ambiguë(s)`,
            },
          });
        } else {
          await db.processingLog.create({
            data: {
              organizationId: auth.organization.id,
              fileId: id,
              step: "FINANCES_EXTRACT",
              result: "TEXTE_ABSENT",
              details: "aucun texte analysable (ni index, ni matière première textuelle)",
            },
          });
        }
      } catch (e) {
        await db.processingLog.create({
          data: {
            organizationId: auth.organization.id,
            fileId: id,
            step: "FINANCES_EXTRACT",
            result: "ECHEC",
            details: e instanceof Error ? e.message : "erreur_inconnue",
          },
        }).catch(() => undefined);
      }
    })();

    return { file: updated };
  });
}
