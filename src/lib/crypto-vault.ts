import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "crypto";
import { totpAt } from "@/lib/totp";

/**
 * Coffre-fort de chiffrement applicatif — secrets sensibles au repos
 * (secret TOTP MFA) en AES-256-GCM. Réutilise exactement le formatage du
 * connecteur Drive (iv.tag.cipher en hexadécimal, clé = DRIVE_ENCRYPTION_KEY,
 * 32 octets hex — voir src/lib/storage/drive.ts) avec un préfixe de version
 * distinct « v1: » pour différencier les deux usages. Sans clé configurée,
 * l'erreur est claire et honnête : « chiffrement_non_configure ».
 */

export const VAULT_PREFIX = "v1:";

function keyBytes(): Buffer {
  const raw = process.env.DRIVE_ENCRYPTION_KEY;
  if (!raw) throw new Error("chiffrement_non_configure");
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) throw new Error("chiffrement_non_configure");
  return key;
}

/** Chiffre un secret au repos — payload « v1:<iv>:<tag>:<cipher> » (hexadécimal). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VAULT_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/** Déchiffre un payload « v1:… » — erreur honnête sur format ou authentification GCM. */
export function decryptSecret(payload: string): string {
  if (!payload.startsWith(VAULT_PREFIX)) throw new Error("format_chiffre_inconnu");
  const [ivHex, tagHex, dataHex] = payload.slice(VAULT_PREFIX.length).split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("format_chiffre_inconnu");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

/**
 * Lit un secret stocké : déchiffre le format « v1: », sinon considère la
 * valeur comme un ancien secret en clair (compatibilité pré-chiffrement) et
 * la retourne telle quelle — l'appelant la re-chiffre après usage.
 */
export function resolveSecret(stored: string): string {
  if (stored.startsWith(VAULT_PREFIX)) return decryptSecret(stored);
  return stored;
}

/**
 * Vérification TOTP consciente du pas de temps (RFC 6238, fenêtre ±1 pas)
 * — comparaison en temps constant et retour du PAS ACCEPTÉ, requis pour la
 * garde anti-rejeu persistée dans User.mfaLastUsedStep. Partagée par
 * /api/auth/mfa et /api/auth/login/mfa. Renvoie null si le code est invalide.
 */
export function verifyTotpStep(secret: string, code: string): number | null {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const step = Math.floor(Date.now() / 30_000);
  for (const drift of [-1, 0, 1]) {
    const candidate = totpAt(secret, step + drift);
    const a = Buffer.from(candidate, "utf8");
    const b = Buffer.from(normalized, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) return step + drift;
  }
  return null;
}
