import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { sha256Hex } from "@/lib/auth";

/**
 * Tokens à usage unique (vérification e-mail, réinitialisation de mot de
 * passe, étape MFA) — RFC-idiomatique : seul le sha256 est stocké, le token
 * brut n'est jamais persisté. Expiration stricte, usage unique atomique.
 */

export const TOKEN_TTL = {
  VERIFICATION_EMAIL: 24 * 3600 * 1000,
  REINITIALISATION_MDP: 60 * 60 * 1000, // ≤ 1 h (exigence cahier des charges)
  CONNEXION_MFA: 10 * 60 * 1000,
} as const;

export type TokenKind = keyof typeof TOKEN_TTL;

export async function issueAuthToken(userId: string, kind: TokenKind): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await db.authToken.create({
    data: {
      userId,
      kind,
      tokenHash: sha256Hex(raw),
      expiresAt: new Date(Date.now() + TOKEN_TTL[kind]),
    },
  });
  return raw;
}

/** Consomme le token : retourne l'userId si valide et non utilisé, sinon null. */
export async function consumeAuthToken(raw: string, kind: TokenKind): Promise<string | null> {
  const token = await db.authToken.findUnique({ where: { tokenHash: sha256Hex(raw) } });
  if (!token || token.kind !== kind) return null;
  if (token.usedAt || token.expiresAt < new Date()) return null;
  // Usage unique : marque immédiatement (pas de fenêtre de rejeu)
  const claimed = await db.authToken.updateMany({
    where: { id: token.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  return token.userId;
}

/** Invalide tous les tokens d'un utilisateur pour un usage donné. */
export async function revokeAuthTokens(userId: string, kind: TokenKind): Promise<void> {
  await db.authToken.updateMany({ where: { userId, kind, usedAt: null }, data: { usedAt: new Date() } });
}

/** Empreinte courte lisible (jamais le token complet) pour les journaux. */
export function tokenFingerprint(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 12);
}
