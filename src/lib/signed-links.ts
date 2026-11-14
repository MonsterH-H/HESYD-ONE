import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";

/**
 * Liens de téléchargement signés à expiration (CDC §7.6) — HMAC-SHA256 sur
 * (entité, id, organisation, expiration). Le secret est persisté hors du
 * dépôt (storage/.link-secret), généré une fois : les liens restent valides
 * entre deux redémarrages. Aucun secret en dur.
 */

const SECRET_PATH = path.join(process.cwd(), "storage", ".link-secret");
let cachedSecret: Buffer | null = null;

async function secret(): Promise<Buffer> {
  if (cachedSecret) return cachedSecret;
  try {
    cachedSecret = Buffer.from(await fs.readFile(SECRET_PATH, "utf8"), "hex");
    if (cachedSecret.length === 32) return cachedSecret;
  } catch {
    // premier usage : génération persistée
  }
  const generated = randomBytes(32).toString("hex");
  await fs.mkdir(path.dirname(SECRET_PATH), { recursive: true });
  // Secret de signature : écrit avec permissions restreintes au propriétaire
  // (audit P1 — aucun fichier de secret lisible par groupe/autres).
  await fs.writeFile(SECRET_PATH, generated, { encoding: "utf8", mode: 0o600 });
  cachedSecret = Buffer.from(generated, "hex");
  return cachedSecret;
}

export type SignedLink = { exp: number; sig: string };

async function compute(entity: string, id: string, organizationId: string, exp: number): Promise<string> {
  const key = await secret();
  return createHmac("sha256", key).update(`${entity}|${id}|${organizationId}|${exp}`).digest("hex");
}

/** Signe un lien avec une durée de vie en millisecondes (défaut 24 h). */
export async function signLink(entity: string, id: string, organizationId: string, ttlMs = 24 * 3600 * 1000): Promise<SignedLink> {
  const exp = Date.now() + ttlMs;
  return { exp, sig: await compute(entity, id, organizationId, exp) };
}

export async function verifyLink(entity: string, id: string, organizationId: string, exp: number, sig: string): Promise<boolean> {
  if (!Number.isFinite(exp) || exp < Date.now() || typeof sig !== "string" || sig.length !== 64) return false;
  const expected = await compute(entity, id, organizationId, exp);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
