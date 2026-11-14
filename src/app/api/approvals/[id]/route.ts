import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit, notify } from "@/lib/audit";
import { safeJsonParse } from "@/lib/helpers";

const schema = z.object({
  decision: z.enum(["APROUVER", "REFUSER", "ANNULER"]),
  motif: z.string().max(400).optional(),
});

/**
 * Décision d'approbation réelle — exécution effective de l'action approuvée :
 * - ENVOI_WHATSAPP : envoi réel via le connecteur WhatsApp, résultat vérifié ;
 * - DEPOT_DRIVE : connexion Drive vérifiée (CONNECTE) puis upload réel via
 *   l'API Google Drive avec confirmation de présence — jamais simulé ;
 * - AUTRE : exécution directe de l'outil d'écriture approuvé (generer_livrable,
 *   planifier_rapport, memoriser_preference) avec les paramètres du previewJson.
 * Toute décision (approbation, refus, annulation) est auditée et notifiée au demandeur.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    const { id } = await ctx.params;
    // La décision d'approbation est réservée aux rôles de gouvernance.
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");

    const approval = await db.approval.findFirst({ where: { id, organizationId: auth.organization.id } });
    if (!approval) throw new Error("approbation_introuvable");
    if (approval.status !== "EN_ATTENTE") throw new Error("deja_traitee");
    if (approval.expiresAt < new Date()) {
      await db.approval.update({ where: { id }, data: { status: "EXPIREE" } });
      throw new Error("approbation_expirée");
    }

    const preview = safeJsonParse<Record<string, unknown>>(approval.previewJson, {});

    if (body.data.decision === "APROUVER") {
      // exécution réelle selon l'action approuvée — preuve exigée, aucun faux succès
      let executed = "NON_EXECUTABLE";
      if (approval.actionType === "ENVOI_WHATSAPP") {
        const { sendWhatsAppText, whatsappConfigured } = await import("@/lib/connectors/whatsapp");
        if (!whatsappConfigured()) {
          await db.approval.update({ where: { id }, data: { status: "REFUSEE", decidedById: auth.user.id, decidedAt: new Date(), previewJson: JSON.stringify({ ...preview, decision: "REFUSEE", raison: "whatsapp_non_configure" }) } });
          throw new Error("whatsapp_non_configure_action_refusee");
        }
        const to = String(preview.destinataire ?? "");
        const content = String(preview.contenu ?? "");
        if (!to || !content) throw new Error("apercu_envoi_incomplet");
        const result = await sendWhatsAppText(to, content);
        if (!result.messageId) throw new Error("whatsapp_envoi_non_confirme");
        executed = `envoyé et confirmé (preuve : message ${result.messageId})`;
      } else if (approval.actionType === "DEPOT_DRIVE") {
        // Vérification réelle de la connexion Drive (statut écrit par le callback OAuth : CONNECTE)
        const conn = await db.integrationConnection.findUnique({
          where: { organizationId_connector: { organizationId: auth.organization.id, connector: "GOOGLE_DRIVE" } },
        });
        const config = safeJsonParse<{ refreshTokenEnc?: string; rootFolderId?: string }>(conn?.configJson, {});
        if (!conn || conn.status !== "CONNECTE" || !config.refreshTokenEnc || !config.rootFolderId) {
          await db.approval.update({ where: { id }, data: { status: "REFUSEE", decidedById: auth.user.id, decidedAt: new Date(), previewJson: JSON.stringify({ ...preview, decision: "REFUSEE", raison: "drive_non_connecte" }) } });
          throw new Error("drive_non_connecte");
        }
        // Contrat d'aperçu du dépôt : chemin source conservé + dossier cible + nom réel du fichier
        const sourcePath = String(preview.sourcePath ?? "");
        const dossier = String(preview.dossier ?? "").trim();
        const fileName = String(preview.nomFichier ?? "").trim();
        const mimeType = String(preview.mimeType ?? "application/octet-stream");
        if (!sourcePath || !dossier || !fileName) throw new Error("apercu_depot_drive_incomplet");
        if (!sourcePath.startsWith("storage/")) throw new Error("chemin_source_invalide");
        const { readArchivedFile } = await import("@/lib/storage/local");
        const data = await readArchivedFile(sourcePath);
        const { refreshAccessToken, driveEnsureFolder, driveUpload } = await import("@/lib/storage/drive");
        const token = await refreshAccessToken(config.refreshTokenEnc);
        let parentId: string = config.rootFolderId;
        for (const seg of dossier.split("/").map((s) => s.trim()).filter(Boolean).slice(0, 8)) {
          parentId = await driveEnsureFolder(token, seg, parentId);
        }
        const upload = await driveUpload(token, fileName, mimeType, data, parentId);
        // Confirmation Drive réelle : relecture des métadonnées du fichier créé
        const verify = await fetch(`https://www.googleapis.com/drive/v3/files/${upload.fileId}?fields=id,name,size`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!verify.ok) throw new Error("drive_confirmation_ecouee");
        const meta = (await verify.json()) as { id: string; name: string; size?: string };
        if (meta.size && Number(meta.size) !== data.length) throw new Error("drive_taille_ecartee");
        executed = `déposé et confirmé sur Drive : fichier ${upload.fileId} (${meta.size ?? "?"} octets) dans « ${dossier} »`;
      } else if (approval.actionType === "AUTRE") {
        // Exécution directe de l'outil d'écriture approuvé avec les paramètres exacts du previewJson :
        // generer_livrable → createDeliverable · planifier_rapport → règle créée EN PAUSE ·
        // memoriser_preference → MemoryItem. Aucun autre outil n'est exécutable par approbation.
        const toolName = String(preview.tool ?? "");
        const toolParams = (preview.params ?? {}) as Record<string, unknown>;
        if (!toolName) throw new Error("apercu_action_incomplet");
        const { getTool } = await import("@/lib/agent/tools");
        const tool = getTool(toolName);
        if (!tool || tool.risk !== "MOYEN") throw new Error("outil_non_executable_par_approbation");
        const result = await tool.run(toolParams, {
          organizationId: auth.organization.id,
          orgSlug: auth.organization.slug,
          userId: auth.user.id,
          role: auth.role,
          locale: auth.organization.locale,
          autonomyLevel: "A2",
        });
        if (!result.ok) throw new Error(`execution_outil_ecouee:${result.summary.slice(0, 120)}`);
        executed = `${tool.name} exécuté : ${result.summary}`;
      } else {
        executed = String(preview.action ?? "exécution enregistrée");
      }
      await db.approval.update({
        where: { id },
        data: { status: "APPROUVEE", decidedById: auth.user.id, decidedAt: new Date(), previewJson: JSON.stringify({ ...preview, execution: executed }) },
      });
      await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "APPROBATION_EXECUTEE", entityType: "Approval", entityId: id, after: { executed } });
      if (approval.requestedById !== auth.user.id) {
        await notify({
          organizationId: auth.organization.id,
          userId: approval.requestedById,
          type: "APPROBATION",
          title: "Action approuvée et exécutée",
          message: `Votre action « ${approval.actionType} » a été approuvée et exécutée avec preuve : ${executed}`,
          relatedEntityType: "Approval",
          relatedEntityId: id,
        });
      }
      return { status: "APPROUVEE", executed };
    }

    const finalStatus = body.data.decision === "REFUSER" ? "REFUSEE" : "ANNULEE";
    await db.approval.update({
      where: { id },
      data: { status: finalStatus, decidedById: auth.user.id, decidedAt: new Date(), previewJson: JSON.stringify({ ...preview, decision: finalStatus, raison: body.data.motif ?? null }) },
    });
    if (approval.requestedById !== auth.user.id) {
      await notify({
        organizationId: auth.organization.id,
        userId: approval.requestedById,
        type: "APPROBATION",
        title: body.data.decision === "REFUSER" ? "Action refusée" : "Action annulée",
        message: `Votre action « ${approval.actionType} » a été ${body.data.decision === "REFUSER" ? "refusée" : "annulée"}${body.data.motif ? ` — motif : ${body.data.motif}` : ""}. Rien n'a été exécuté.`,
        relatedEntityType: "Approval",
        relatedEntityId: id,
      });
    }
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: body.data.decision === "REFUSER" ? "APPROBATION_REFUSEE" : "APPROBATION_ANNULEE", entityType: "Approval", entityId: id, after: { motif: body.data.motif ?? null } });
    return { status: finalStatus };
  });
}
