import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { createTrialOrganization } from "@/lib/provisioning";
import { logAudit } from "@/lib/audit";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  appOriginFromRequest,
  exchangeCode,
  fetchUserInfo,
  googleConfigured,
  redirectUri,
  statesMatch,
} from "@/lib/oauth-google";

/**
 * Callback Google réel : vérification d'état (temps constant), échange du code
 * (PKCE), userinfo OIDC, puis trois chemins honnêtes :
 *  1. compte Google connu → connexion ;
 *  2. e-mail connu et vérifié chez Google → liaison du compte existant ;
 *  3. inconnu → création du compte + organisation d'essai 14 jours.
 */
export async function GET(req: Request) {
  const origin = appOriginFromRequest(req);
  const fail = (code: string) => NextResponse.redirect(`${origin}/?auth_error=${code}`);

  try {
    const url = new URL(req.url);
    const errorParam = url.searchParams.get("error");
    if (errorParam) {
      // Refus du consentement ou erreur renvoyée par Google elle-même
      return fail(errorParam === "access_denied" ? "google_refuse" : "google_erreur");
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return fail("google_reponse_incomplete");

    const jar = await cookies();
    const expectedState = jar.get(OAUTH_STATE_COOKIE)?.value;
    const verifier = jar.get(OAUTH_VERIFIER_COOKIE)?.value;
    if (!statesMatch(expectedState, state) || !verifier) return fail("google_etat_invalide");

    if (!googleConfigured()) return fail("google_non_configure");

    const tokens = await exchangeCode({
      code,
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      redirectUri: redirectUri(origin),
      codeVerifier: verifier,
    });

    const info = await fetchUserInfo(tokens.access_token);
    if (!info.email_verified) return fail("google_email_non_verifie");

    const email = info.email.toLowerCase().trim();

    // 1. Compte Google déjà lié → connexion
    let user = await db.user.findUnique({
      where: { oauthProvider_oauthSubject: { oauthProvider: "GOOGLE", oauthSubject: info.sub } },
    });

    // 2. E-mail connu (mot de passe local) → liaison du compte, propriété prouvée par Google
    if (!user) {
      const byEmail = await db.user.findUnique({ where: { email } });
      if (byEmail) {
        // Aucune mutation de statut au login : un compte désactivé reste désactivé
        // et ne peut pas se reconnecter via OAuth (audit P1).
        if (byEmail.status !== "ACTIF") return fail("compte_desactive");
        user = await db.user.update({
          where: { id: byEmail.id },
          data: {
            oauthProvider: "GOOGLE",
            oauthSubject: info.sub,
            avatarUrl: info.picture ?? byEmail.avatarUrl,
            lastLoginAt: new Date(),
          },
        });
        await logAudit({
          userId: user.id,
          action: "COMPTE_LIE_GOOGLE",
          entityType: "User",
          entityId: user.id,
          after: { email },
        });
      }
    }

    // 3. Nouvel arrivant → compte + organisation d'essai réelle (14 jours)
    if (!user) {
      const name = (info.name ?? email.split("@")[0]).trim().slice(0, 80) || "Utilisateur";
      user = await db.user.create({
        data: {
          email,
          name,
          oauthProvider: "GOOGLE",
          oauthSubject: info.sub,
          avatarUrl: info.picture ?? undefined,
          locale: info.locale?.startsWith("en") ? "en" : "fr",
          lastLoginAt: new Date(),
        },
      });
      await createTrialOrganization(user.id, `Espace ${name}`);
    } else {
      // JAMAIS de mutation de status au login (audit P1) : la réactivation
      // d'un compte désactivé via OAuth est refusée, honnêtement.
      if (user.status !== "ACTIF") return fail("compte_desactive");
      await db.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), avatarUrl: info.picture ?? user.avatarUrl },
      });
    }

    await createSession(user.id);

    // Session posée ; nettoyage des cookies de flux OAuth après usage
    const res = NextResponse.redirect(origin + "/");
    res.cookies.delete(OAUTH_STATE_COOKIE);
    res.cookies.delete(OAUTH_VERIFIER_COOKIE);
    return res;
  } catch (e) {
    console.error("[oauth-google] callback:", e instanceof Error ? e.message : e);
    return fail("google_erreur");
  }
}
