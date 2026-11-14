import { getAuth, AuthError, type AuthContext } from "@/lib/auth";

/**
 * Console opérateur de la plateforme (CDC §4.9) — accès réservé aux e-mails
 * déclarés dans PLATFORM_ADMIN_EMAILS (variable d'environnement, séparés par
 * des virgules). Bootstrap honnête : aucun droit n'est modifiable depuis
 * l'application elle-même, uniquement par l'exploitant du déploiement.
 */

export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdminEmail(email: string): boolean {
  return platformAdminEmails().includes(email.trim().toLowerCase());
}

/** Exige une session valide dont l'utilisateur est opérateur plateforme. */
export async function requirePlatformAdmin(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) throw new AuthError("auth_required", 401);
  if (!isPlatformAdminEmail(auth.user.email)) throw new AuthError("forbidden", 403);
  return auth;
}
