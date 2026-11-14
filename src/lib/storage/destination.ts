// Destination d'archivage UNIQUE pour tout le produit (pipeline, correction, reprise).
//
// Règle de propriété documentaire (mission, verrou architectural) : lorsque le
// client a connecté son Google Drive, l'archive DOIT être écrite dans SON Drive
// (dossier racine créé par le callback OAuth) — jamais dans un stockage
// appartenant à HESYD ONE. Le stockage local réel n'est utilisé que lorsque le
// Drive n'est pas connecté : repli honnête, explicite (preuve fs.stat distincte
// de la preuve Drive API), assumé dans DECISIONS.md (D7) et dans l'UI.
//
// Cette fonction centralise la destination pour TOUTES les voies d'archivage :
// pipeline de réception (ingest), correction humaine (files/[id]/correct) et
// reprise d'archivage (files/[id]/retry) — aucune voie ne contourne le Drive.

import { db } from "@/lib/db";
import { safeJsonParse } from "@/lib/helpers";
import { archiveFileLocally, type ArchiveTarget } from "@/lib/storage/local";
import { driveEnsureFolder, driveUpload, refreshAccessToken } from "@/lib/storage/drive";

export type ArchiveDestinationResult = {
  destination: "GOOGLE_DRIVE" | "STORAGE_LOCAL";
  storedFilename: string;
  archivedPath: string;
  proof: string;
  driveFileId: string | null;
};

/** Archive la matière première vers la destination réellement configurée de l'organisation. */
export async function archiveToConfiguredDestination(
  organizationId: string,
  target: ArchiveTarget,
  originalFilename: string,
  mime: string,
  data: Buffer,
): Promise<ArchiveDestinationResult> {
  const driveConn = await db.integrationConnection.findUnique({
    where: { organizationId_connector: { organizationId, connector: "GOOGLE_DRIVE" } },
  });
  const driveConfig =
    driveConn?.status === "CONNECTE"
      ? safeJsonParse<{ refreshTokenEnc?: string; rootFolderId?: string }>(driveConn.configJson, {})
      : {};

  if (driveConfig.refreshTokenEnc && driveConfig.rootFolderId) {
    // Destination officielle : le Drive du CLIENT (scope drive.file, dossier racine
    // créé par le client lui-même lors du consentement OAuth).
    const token = await refreshAccessToken(driveConfig.refreshTokenEnc);
    const clientFolder = await driveEnsureFolder(token, `${target.clientCode} - ${target.clientName}`, driveConfig.rootFolderId);
    const groupFolder = await driveEnsureFolder(token, `${target.groupCode} - ${target.groupName}`, clientFolder);
    const categoryFolder = await driveEnsureFolder(token, target.category, groupFolder);
    const y = String(target.receivedAt.getFullYear());
    const m = String(target.receivedAt.getMonth() + 1).padStart(2, "0");
    const yearFolder = await driveEnsureFolder(token, y, categoryFolder);
    const monthFolder = await driveEnsureFolder(token, m, yearFolder);
    const upload = await driveUpload(token, originalFilename, mime, data, monthFolder);
    // Confirmation Drive réelle : relecture des métadonnées du fichier créé
    const verify = await fetch(`https://www.googleapis.com/drive/v3/files/${upload.fileId}?fields=id,name,size`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!verify.ok) throw new Error("drive_confirmation_ecouee");
    const meta = (await verify.json()) as { id: string; name: string; size?: string };
    if (meta.size && Number(meta.size) !== data.length) throw new Error("drive_taille_ecartee");
    return {
      destination: "GOOGLE_DRIVE",
      storedFilename: meta.name,
      archivedPath: `drive://${driveConfig.rootFolderId}/${upload.fileId}`,
      proof: `Drive API confirmé : fichier ${meta.id} présent dans le dossier du mois (${meta.size ?? "?"} octets)`,
      driveFileId: upload.fileId,
    };
  }

  // Repli honnête et déclaré : stockage local réel (Drive non connecté par le client).
  const result = await archiveFileLocally(target, originalFilename, data);
  return {
    destination: "STORAGE_LOCAL",
    storedFilename: result.storedFilename,
    archivedPath: result.archivedPath,
    proof: result.proof,
    driveFileId: null,
  };
}
