import { createHash } from "crypto";

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 40) || "org";
}

/**
 * Assainit un nom de fichier fourni par le client AVANT toute écriture disque
 * (audit P0 — path traversal) : rejet des segments de traversée « .. » (../,
 * ..\, segments intermédiaires) et des caractères de contrôle, réduction au
 * basename, neutralisation des caractères interdits, troncature à 180
 * caractères en préservant l'extension. Une entrée irrecevable lève une
 * erreur honnête (« nom_fichier_invalide ») — jamais de réécriture silencieuse
 * d'un nom suspect (CDC §11.7).
 */
export function sanitizeFilename(name: string): string {
  const normalized = name.normalize("NFC");
  const segments = normalized.split(/[\\/]/);
  if (segments.some((segment) => segment === "..")) throw new Error("nom_fichier_invalide");
  if (/[\x00-\x1f\x7f]/.test(normalized)) throw new Error("nom_fichier_invalide");
  const base = segments[segments.length - 1] ?? "";
  const cleaned = base.replace(/[:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
  if (!cleaned) throw new Error("nom_fichier_invalide");
  const dot = cleaned.lastIndexOf(".");
  const hasExt = dot > 0 && dot < cleaned.length - 1;
  const ext = hasExt ? cleaned.slice(dot + 1).slice(0, 16) : "";
  const stem = hasExt ? cleaned.slice(0, dot) : cleaned;
  const maxStem = 180 - (ext ? ext.length + 1 : 0);
  return `${stem.slice(0, maxStem)}${ext ? "." + ext : ""}`;
}

export function sha256HexBuf(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Suffixe déterministe en cas de collision — aucun fichier existant n'est écrasé (CDC §11.7). */
export function withCollisionSuffix(path: string, exists: (p: string) => boolean): string {
  if (!exists(path)) return path;
  const dot = path.lastIndexOf(".");
  const stem = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem}_${String(i).padStart(3, "0")}${ext}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error("collision_nommage");
}

export function formatDateTime(d: Date, timezone = "Europe/Paris"): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: timezone,
  }).format(d);
}

export function formatMonthYear(d: Date): { year: string; month: string } {
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return { year, month };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export const MIME_OK = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/msword",
  "text/plain",
  "text/csv",
  "text/markdown",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "audio/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "application/json",
]);

/** Extension réelle attendue par MIME — rejet des déguisements. */
export function mimeMatchesExtension(mime: string, filename: string): boolean {
  const ext = (filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1) : "").toLowerCase();
  const allowed: Record<string, string[]> = {
    "application/pdf": ["pdf"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
    "text/plain": ["txt", "md", "log"],
    "text/csv": ["csv"],
    "image/png": ["png"],
    "image/jpeg": ["jpg", "jpeg"],
    "image/webp": ["webp"],
    "image/gif": ["gif"],
    "image/bmp": ["bmp"],
    "image/tiff": ["tif", "tiff"],
    "audio/webm": ["webm"],
    "audio/mpeg": ["mp3"],
    "audio/wav": ["wav"],
    "audio/ogg": ["ogg", "oga"],
    "audio/mp4": ["m4a", "mp4"],
    "application/json": ["json"],
  };
  const ok = allowed[mime];
  if (!ok) return false;
  return ok.includes(ext);
}

export function isAudio(mime: string): boolean {
  return mime.startsWith("audio/");
}

export function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

/** Clés de configuration d'intégration jamais exposées via l'API (jetons OAuth, états de flux, secrets). */
const CONFIG_KEYS_JAMAIS_EXPOSEES = new Set([
  "refreshTokenEnc",
  "refreshToken",
  "accessToken",
  "idToken",
  "state",
  "secret",
  "token",
  "apiKey",
  "apiSecret",
  "clientSecret",
]);

/**
 * Masquage des configJson d'intégrations (audit P1 — fuite de secrets aux
 * membres) : pour GOOGLE_DRIVE, seuls les champs explicitement sûrs sont
 * renvoyés (connectedEmail s'il existe) — jamais refreshTokenEnc ni state.
 * Pour les autres connecteurs, un parse JSON supprime systématiquement les
 * clés sensibles connues avant exposition.
 */
export function safeIntegrationConfig(connector: string, configJson: string | null | undefined): Record<string, unknown> {
  const cfg = safeJsonParse<Record<string, unknown>>(configJson, {});
  if (connector === "GOOGLE_DRIVE") {
    return typeof cfg.connectedEmail === "string" && cfg.connectedEmail ? { connectedEmail: cfg.connectedEmail } : {};
  }
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cfg)) {
    if (!CONFIG_KEYS_JAMAIS_EXPOSEES.has(key)) safe[key] = value;
  }
  return safe;
}

export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
