import { promises as fs, accessSync, constants } from "fs";
import path from "path";
import { sha256HexBuf, sanitizeFilename, withCollisionSuffix } from "@/lib/helpers";

/**
 * Connecteur de stockage LOCAL — réel. L'archivage suit exactement la règle
 * du CDC §11.7 : Client → Groupe → Catégorie → Année → Mois, création à la
 * demande, aucun écrasement, confirmation par fs.stat + sha256 avant cachet.
 */

const ROOT = path.join(process.cwd(), "storage", "archives");
const RECEIVED_ROOT = path.join(process.cwd(), "storage", "received");

export type ArchiveTarget = {
  orgSlug: string;
  clientCode: string;
  clientName: string;
  groupCode: string;
  groupName: string;
  category: string;
  receivedAt: Date;
};

export function buildArchiveDir(target: ArchiveTarget): string {
  const year = String(target.receivedAt.getFullYear());
  const month = String(target.receivedAt.getMonth() + 1).padStart(2, "0");
  return path.join(
    ROOT,
    sanitizeSegment(target.orgSlug),
    `${sanitizeSegment(target.clientCode)} - ${sanitizeSegment(target.clientName)}`,
    `${sanitizeSegment(target.groupCode)} - ${sanitizeSegment(target.groupName)}`,
    sanitizeSegment(target.category),
    year,
    month
  );
}

export function archivedName(target: ArchiveTarget, originalFilename: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = target.receivedAt;
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  // Assainissement du nom client AVANT composition (audit P0 — path traversal)
  // : basename, rejet des traversées, caractères interdits neutralisés, troncature
  // finale à 180 caractères en conservant l'extension.
  const safeOriginal = sanitizeFilename(originalFilename);
  const dot = safeOriginal.lastIndexOf(".");
  const ext = dot > 0 && dot < safeOriginal.length - 1 ? safeOriginal.slice(dot) : "";
  const stem = ext ? safeOriginal.slice(0, dot) : safeOriginal;
  const composed = `${target.clientCode}_${target.groupCode}_${stamp}_${stem}`.replace(/[\/\\:*?"<>|\x00-\x1f\x7f]/g, "_");
  return `${composed.slice(0, 180 - ext.length)}${ext}`;
}

function sanitizeSegment(segment: string): string {
  const cleaned = segment
    .normalize("NFC")
    .replace(/[\/\\:*?"<>|\x00-\x1f\x7f]/g, "_")
    .replace(/\.\./g, "_") // aucun segment de répertoire ne peut désigner un parent
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "sans_nom";
}

export type ArchiveResult = {
  storedFilename: string;
  archivedPath: string;
  proof: string; // preuve technique réelle
};

function fsSyncExists(p: string): boolean {
  try {
    accessSync(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Écriture réelle + confirmation de présence (fs.stat + sha256 re-vérifié). */
export async function archiveFileLocally(
  target: ArchiveTarget,
  originalFilename: string,
  data: Buffer
): Promise<ArchiveResult> {
  const dir = buildArchiveDir(target);
  await fs.mkdir(dir, { recursive: true });
  const desired = archivedName(target, originalFilename);
  const storedFilename = withCollisionSuffix(desired, (p) => fsSyncExists(path.join(dir, p)));
  const fullPath = path.join(dir, storedFilename);
  await fs.writeFile(fullPath, data);

  // Confirmation de présence — exigence du produit : jamais « lancé » = « archivé »
  const stat = await fs.stat(fullPath);
  if (stat.size !== data.length) throw new Error("confirmation_taille_ecouee");
  const reRead = await fs.readFile(fullPath);
  if (sha256HexBuf(reRead) !== sha256HexBuf(data)) throw new Error("confirmation_sha256_ecouee");

  return {
    storedFilename,
    archivedPath: path.relative(process.cwd(), fullPath),
    proof: `fs.stat confirmé : ${stat.size} octets · sha256 re-vérifié après écriture · ${path.relative(process.cwd(), fullPath)}`,
  };
}

/** Stockage brut des réceptions — conservées même en cas d'échec en aval. */
export async function persistReceivedRaw(orgSlug: string, filename: string, data: Buffer): Promise<string> {
  // Assainissement systématique du nom client AVANT toute écriture (audit P0
  // — path traversal) : basename, rejet des traversées « .. » et des
  // caractères de contrôle, troncature 180 avec extension conservée. Un nom
  // irrecevable lève « nom_fichier_invalide » — rien n'est écrit.
  const safeName = sanitizeFilename(filename);
  const dir = path.join(RECEIVED_ROOT, sanitizeSegment(orgSlug));
  await fs.mkdir(dir, { recursive: true });
  const name = withCollisionSuffix(safeName, (p) => fsSyncExists(path.join(dir, p)));
  const full = path.join(dir, name);
  await fs.writeFile(full, data);
  return path.relative(process.cwd(), full);
}

/**
 * Garde de chemin réelle (audit P0) : rejet des chemins absolus, résolution
 * puis contrôle path.relative depuis process.cwd() — le préfixe faible
 * startsWith() est remplacé par un test d'inclusion exact (immunisé contre
 * les frères de préfixe comme « /app-hesyd » vs « /app »).
 */
function resolveInsideCwd(relPath: string): string {
  if (path.isAbsolute(relPath)) throw new Error("chemin_invalide");
  const resolved = path.resolve(process.cwd(), relPath);
  const rel = path.relative(process.cwd(), resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel.length === 0) throw new Error("chemin_invalide");
  return resolved;
}

export async function readArchivedFile(relPath: string): Promise<Buffer> {
  return fs.readFile(resolveInsideCwd(relPath));
}

export async function statArchivedFile(relPath: string): Promise<{ size: number; exists: boolean } | null> {
  try {
    const stat = await fs.stat(resolveInsideCwd(relPath));
    return { size: stat.size, exists: true };
  } catch {
    return null;
  }
}
