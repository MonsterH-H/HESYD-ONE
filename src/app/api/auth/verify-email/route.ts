import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, sha256Hex } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { consumeAuthToken, issueAuthToken } from "@/lib/auth-tokens";
import { consumeRateLimitWindow, clientIp } from "@/lib/rate-limit";
import { appOriginFromRequest } from "@/lib/oauth-google";
import { resendConfigured, sendEmail, systemEmailHtml } from "@/lib/connectors/resend";

const schema = z.object({ token: z.string().min(1).optional(), resend: z.boolean().optional() });

const VERIFY_LIMIT = 10;
const VERIFY_WINDOW_MS = 60 * 60 * 1000;

const VERIFY_TOKEN_LIMIT = 10; // consommations de token / fenêtre par IP
const VERIFY_TOKEN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Vérification d'adresse e-mail réelle (token usage unique, 24 h).
 * Livraison honnête, jamais simulée (audit P0 — LOCAL_REVEAL en production) :
 * Resend configuré → e-mail réel sans révélation ; production sans Resend →
 * 503 « email_non_configure » ; développement sans Resend → lien révélé.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");

    if (body.data.resend) {
      const auth = await requireAuth();
      const user = await db.user.findUnique({ where: { id: auth.user.id } });
      if (!user) throw new Error("utilisateur_introuvable");
      if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };

      // Anti-abus persisté : 10 renvois / heure par email (audit P1)
      const rl = await consumeRateLimitWindow(
        `VERIFY:${sha256Hex(user.email.toLowerCase().trim())}`,
        VERIFY_LIMIT,
        VERIFY_WINDOW_MS
      );
      if (!rl.allowed) {
        return Response.json({ error: "trop_de_tentatives", retryAfterSeconds: rl.retryAfterSeconds }, { status: 429 });
      }

      const token = await issueAuthToken(user.id, "VERIFICATION_EMAIL");

      if (resendConfigured()) {
        // Envoi réel via Resend : le lien n'est jamais révélé dans la réponse.
        const link = `${appOriginFromRequest(req)}/verification-email?token=${token}`;
        const sent = await sendEmail({
          to: user.email,
          subject: "Vérification de votre adresse e-mail — HESYD ONE",
          html: systemEmailHtml(
            "Vérification de l'adresse e-mail",
            `<p>Confirmez l'adresse ${user.email} pour activer toutes les fonctions de votre espace HESYD ONE.</p><p>Ce lien est valable 24 heures et à usage unique.</p>`,
            { label: "Vérifier mon adresse e-mail", url: link }
          ),
        });
        if (sent.sent) return { ok: true, delivery: "email" };
        if (process.env.NODE_ENV === "production") throw new Error("envoi_email_echoue");
      }

      if (process.env.NODE_ENV === "production") {
        // Jamais de reveal en production : sans canal d'envoi réel, échec honnête.
        return Response.json({ error: "email_non_configure" }, { status: 503 });
      }

      return {
        ok: true,
        delivery: "local_reveal",
        deliveryMode: "LOCAL_REVEAL",
        deliveryNote:
          "Aucun service e-mail n'est configuré sur ce déploiement (connecteur Resend absent) : le lien est affiché ici uniquement en développement — il ne le sera plus dès que RESEND_API_KEY sera configurée.",
        verifyPath: `/verification-email?token=${token}`,
      };
    }

    if (!body.data.token) throw new Error("token_requis");
    // MINEURE-6 (audit) : fenêtre de débit sur la CONSOMMATION du token, avant
    // toute lecture en base — même motif persisté par IP que register /
    // reset-password : la force brute de tokens devient impraticable.
    const rlToken = await consumeRateLimitWindow(
      `VERIFY_TOKEN:${sha256Hex(clientIp(req))}`,
      VERIFY_TOKEN_LIMIT,
      VERIFY_TOKEN_WINDOW_MS
    );
    if (!rlToken.allowed) {
      return Response.json({ error: "trop_de_tentatives", retryAfterSeconds: rlToken.retryAfterSeconds }, { status: 429 });
    }
    const userId = await consumeAuthToken(body.data.token, "VERIFICATION_EMAIL");
    if (!userId) throw new Error("lien_invalide_ou_expire");
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("utilisateur_introuvable");
    if (!user.emailVerifiedAt) {
      await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    }
    return { ok: true, verified: true, email: user.email };
  });
}
