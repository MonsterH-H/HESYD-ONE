import { NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  OAUTH_COOKIE_MAX_AGE,
  appOriginFromRequest,
  googleAuthorizeUrl,
  googleConfigured,
  newCodeVerifier,
  newState,
  codeChallenge,
  redirectUri,
} from "@/lib/oauth-google";

/**
 * Point d'entrée du flux Google : génère state + PKCE, pose des cookies
 * httpOnly éphémères, redirige vers la page de consentement Google réelle.
 */
export async function GET(req: Request) {
  const origin = appOriginFromRequest(req);
  const fail = (code: string) => NextResponse.redirect(`${origin}/?auth_error=${code}`);

  if (!googleConfigured()) {
    return fail("google_non_configure");
  }

  const state = newState();
  const verifier = newCodeVerifier();

  const target = googleAuthorizeUrl({
    clientId: process.env.GOOGLE_CLIENT_ID as string,
    redirectUri: redirectUri(origin),
    state,
    codeChallenge: codeChallenge(verifier),
  });

  const res = NextResponse.redirect(target);
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: OAUTH_COOKIE_MAX_AGE,
  });
  res.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: OAUTH_COOKIE_MAX_AGE,
  });
  return res;
}
