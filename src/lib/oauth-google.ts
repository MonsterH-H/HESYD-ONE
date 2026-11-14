import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * Google OAuth 2.0 — flux « authorization code » avec PKCE (S256).
 * Aucun secret côté client : GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET
 * vivent uniquement dans l'environnement serveur. Jamais NEXT_PUBLIC_*.
 */

export const OAUTH_STATE_COOKIE = "hesyd_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "hesyd_oauth_verifier";
export const OAUTH_COOKIE_MAX_AGE = 600; // 10 minutes — le temps d'aller chez Google et revenir

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** URL canonique de l'app : APP_URL si définie, sinon en-têtes de la requête (proxy inclus). */
export function appOriginFromRequest(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return `${proto}://${host}`;
}

export function redirectUri(origin: string): string {
  return `${origin}/api/auth/oauth/google/callback`;
}

export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newState(): string {
  return base64url(randomBytes(32));
}

export function newCodeVerifier(): string {
  return base64url(randomBytes(48));
}

export function codeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/** Comparaison d'états en temps constant. */
export function statesMatch(a: string | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function googleAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", params.clientId);
  u.searchParams.set("redirect_uri", params.redirectUri);
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", params.state);
  u.searchParams.set("code_challenge", params.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

/** Types des réponses réelles de Google (token + userinfo OIDC). */
export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  id_token?: string;
};

export type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
};

export async function exchangeCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
      code_verifier: params.codeVerifier,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`google_token_exchange_failed:${res.status}:${detail.slice(0, 200)}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`google_userinfo_failed:${res.status}`);
  }
  return (await res.json()) as GoogleUserInfo;
}
