import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

const SESSION_COOKIE = "hesyd_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

// ————— Mots de passe (scrypt, réel) —————

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ————— Sessions —————

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: { userId, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
  }
  store.delete(SESSION_COOKIE);
}

export type AuthContext = {
  user: { id: string; email: string; name: string; locale: string; avatarUrl: string | null; hasPassword: boolean };
  organization: { id: string; name: string; slug: string; status: string; timezone: string; locale: string; trialEndsAt: Date | null; autonomyLevel: string };
  role: "PROPRIETAIRE" | "ADMINISTRATEUR" | "EMPLOYE" | "LECTEUR";
  session: { id: string; expiresAt: Date };
};

/**
 * Charge la session + l'organisation courante. Zéro confiance implicite :
 * chaque requête API passe ici. Retourne null si non authentifié.
 */
export async function getAuth(): Promise<AuthContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date() || session.user.status !== "ACTIF") return null;
  const membership = await db.membership.findFirst({
    where: { userId: session.user.id },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) return null;
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      locale: session.user.locale,
      avatarUrl: session.user.avatarUrl,
      hasPassword: Boolean(session.user.passwordHash),
    },
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      status: membership.organization.status,
      timezone: membership.organization.timezone,
      locale: membership.organization.locale,
      trialEndsAt: membership.organization.trialEndsAt,
      autonomyLevel: membership.organization.autonomyLevel,
    },
    role: membership.role as AuthContext["role"],
    session: { id: session.id, expiresAt: session.expiresAt },
  };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/** Exige une session + organisation. Lève AuthError sinon. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) throw new AuthError("auth_required", 401);
  return auth;
}

const ROLE_RANK: Record<AuthContext["role"], number> = {
  LECTEUR: 0,
  EMPLOYE: 1,
  ADMINISTRATEUR: 2,
  PROPRIETAIRE: 3,
};

export function hasRole(auth: AuthContext, min: AuthContext["role"]): boolean {
  return ROLE_RANK[auth.role] >= ROLE_RANK[min];
}

export async function requireRole(min: AuthContext["role"]): Promise<AuthContext> {
  const auth = await requireAuth();
  if (!hasRole(auth, min)) throw new AuthError("forbidden", 403);
  return auth;
}
