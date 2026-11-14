import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Connecteur Google Drive — implémentation REST réelle (OAuth 2.0 + upload multipart).
 * DORMANT sans variables d'environnement : l'API renvoie « identifiants requis »
 * et l'interface l'affiche honnêtement. Aucun faux succès n'est jamais produit.
 *
 * Variables attendues : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
 * DRIVE_ENCRYPTION_KEY (32 octets hex) pour chiffrer les refresh tokens au repos.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

export function driveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? "",
    response_type: "code",
    scope: DRIVE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type DriveTokens = { accessToken: string; refreshToken: string; expiresIn: number };

export async function exchangeCodeForTokens(code: string): Promise<DriveTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? "",
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`drive_token_exchange: ${res.status}`);
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  if (!json.refresh_token) throw new Error("drive_refresh_token_absent");
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresIn: json.expires_in };
}

export async function refreshAccessToken(refreshTokenEncrypted: string): Promise<string> {
  const refreshToken = decryptToken(refreshTokenEncrypted);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`drive_token_refresh: ${res.status}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export async function driveEnsureFolder(token: string, name: string, parentId: string | null): Promise<string> {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder'${parentId ? ` and '${parentId}' in parents` : ""} and trashed=false`;
  const search = await fetch(`${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const searchJson = (await search.json()) as { files: { id: string }[] };
  if (searchJson.files?.length) return searchJson.files[0].id;
  const create = await fetch(`${FILES_URL}?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined }),
  });
  if (!create.ok) throw new Error(`drive_folder_create: ${create.status}`);
  const created = (await create.json()) as { id: string };
  return created.id;
}

export type DriveUploadResult = { fileId: string; webViewLink: string };

/** Upload multipart réel + récupération du lien — la confirmation Drive, exige la réponse API. */
export async function driveUpload(
  token: string,
  fileName: string,
  mimeType: string,
  data: Buffer,
  parentId: string
): Promise<DriveUploadResult> {
  const boundary = `hesyd${randomBytes(8).toString("hex")}`;
  const metadata = JSON.stringify({ name: fileName, parents: [parentId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`drive_upload: ${res.status}`);
  const json = (await res.json()) as { id: string; webViewLink?: string };
  return { fileId: json.id, webViewLink: json.webViewLink ?? `https://drive.google.com/file/d/${json.id}/view` };
}

// ————— Chiffrement des jetons au repos (AES-256-GCM, clé = DRIVE_ENCRYPTION_KEY) —————

function keyBytes(): Buffer {
  const raw = process.env.DRIVE_ENCRYPTION_KEY;
  if (!raw) throw new Error("DRIVE_ENCRYPTION_KEY_absente");
  return Buffer.from(raw, "hex");
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${tag.toString("hex")}.${enc.toString("hex")}`;
}

export function decryptToken(encrypted: string): string {
  const [ivHex, tagHex, dataHex] = encrypted.split(".");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return dec.toString("utf8");
}
