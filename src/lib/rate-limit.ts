/**
 * Limitation des tentatives de connexion — verrouillage progressif réel
 * (5 échecs → 15 min, puis doublement à chaque échec suivant, plafond 24 h).
 * Persisté en base (table LoginAttempt) : survit aux redémarrages et
 * fonctionne multi-instances au déploiement. Aucune donnée personnelle en
 * clair : la clé est le sha256(email|IP).
 */

import { createHash } from "crypto";
import { db } from "@/lib/db";

const MAX_FAILURES = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000; // les échecs se prescrivent après 1 h

function key(email: string, ip: string): string {
  return createHash("sha256").update(`${email.toLowerCase()}|${ip}`).digest("hex");
}

/**
 * IP client réelle derrière notre nginx de confiance (audit P1) : le DERNIER
 * maillon de X-Forwarded-For est celui posé par notre proxy après sa
 * réécriture — les maillons antérieurs sont forgés par le client et ne
 * doivent jamais être utilisés. Sans XFF : x-real-ip, sinon « local »
 * (accès direct hors proxy).
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim());
    return parts[parts.length - 1] || "local";
  }
  return req.headers.get("x-real-ip") || "local";
}

/** Restant de verrouillage en secondes, 0 si non verrouillé. */
export async function lockRemaining(email: string, ip: string): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MS);
  const failures = await db.loginAttempt.count({
    where: { emailHash: key(email, ip), success: false, createdAt: { gte: since } },
  });
  if (failures < MAX_FAILURES) return 0;
  // Le verrou part de l'heure du 5e échec et double à chaque échec suivant
  const recent = await db.loginAttempt.findMany({
    where: { emailHash: key(email, ip), success: false, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: failures - MAX_FAILURES + 1,
    select: { createdAt: true },
  });
  const anchor = recent[recent.length - 1]?.createdAt ?? new Date();
  const lockMs = Math.min(BASE_LOCK_MS * 2 ** (failures - MAX_FAILURES), MAX_LOCK_MS);
  const lockedUntil = anchor.getTime() + lockMs;
  return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
}

export async function registerFailure(email: string, ip: string): Promise<void> {
  await db.loginAttempt.create({ data: { emailHash: key(email, ip), success: false } });
  // Nettoyage opportuniste des traces de plus de 24 h (respect de la minimisation)
  if (Math.random() < 0.05) {
    await db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } } }).catch(() => undefined);
  }
}

export async function clearFailures(email: string, ip: string): Promise<void> {
  await db.loginAttempt.deleteMany({ where: { emailHash: key(email, ip) } }).catch(() => undefined);
}

/**
 * Fenêtre de consommation générique persistée (table RateLimitWindow,
 * audit P1) — upsert atomique en transaction : si windowStart est hors
 * fenêtre le compteur repart à zéro, sinon la comparaison au plafond
 * précède l'incrément, le tout dans la même transaction db.$transaction
 * (aucun dépassement concurrent possible). Clés typées par préfixe :
 * REGISTER:{hash(ip)}, FORGOT:{hash(ip|email)}, VERIFY:{hash(email)},
 * RESET_PASSWORD:{hash(ip)} — routes publiques anti-abus ;
 * AGENT_CHAT / VOICE_TRANSCRIBE / DELIVERABLES_POST:{orgId}:{userId} —
 * routes authentifiées à coût IA élevé. Les routes webhook (Polar,
 * WhatsApp) n'ont volontairement aucune fenêtre de débit : elles reposent
 * sur la vérification de signature et l'idempotence par identifiant
 * d'événement fournisseur.
 */
export async function consumeRateLimitWindow(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  return db.$transaction(async (tx) => {
    const row = await tx.rateLimitWindow.findUnique({ where: { key } });
    const now = Date.now();
    if (!row || now - row.windowStart.getTime() >= windowMs) {
      // Nouvelle fenêtre (ou première consommation) : compteur réinitialisé.
      await tx.rateLimitWindow.upsert({
        where: { key },
        create: { key, count: 1, windowStart: new Date(now) },
        update: { count: 1, windowStart: new Date(now) },
      });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (row.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((row.windowStart.getTime() + windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
    await tx.rateLimitWindow.update({ where: { key }, data: { count: { increment: 1 } } });
    return { allowed: true, retryAfterSeconds: 0 };
  });
}
