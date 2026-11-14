import { z } from "zod";
import { db } from "@/lib/db";
import { handle, readJson } from "@/lib/api";
import { issueAuthToken } from "@/lib/auth-tokens";
import { sha256Hex } from "@/lib/auth";
import { clientIp, consumeRateLimitWindow } from "@/lib/rate-limit";
import { appOriginFromRequest } from "@/lib/oauth-google";
import { resendConfigured, sendEmail, systemEmailHtml } from "@/lib/connectors/resend";

const schema = z.object({ email: z.string().email() });

const FORGOT_LIMIT = 5;
const FORGOT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Demande de réinitialisation de mot de passe (CDC §4) — réponse
 * générique (aucune divulgation), token réel 1 h à usage unique.
 * Livraison honnête, jamais simulée (audit P0 — LOCAL_REVEAL en production) :
 *  - Resend configuré → e-mail réel (connecteur), le lien n'est JAMAIS révélé ;
 *  - production sans Resend → 503 « email_non_configure » ;
 *  - développement sans Resend → lien révélé (delivery "local_reveal").
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("email_invalide");
    const email = body.data.email.toLowerCase().trim();

    // Anti-abus persisté : 5 demandes / 15 min par IP+email (audit P1)
    const rl = await consumeRateLimitWindow(
      `FORGOT:${sha256Hex(`${clientIp(req)}|${email}`)}`,
      FORGOT_LIMIT,
      FORGOT_WINDOW_MS
    );
    if (!rl.allowed) {
      return Response.json({ error: "trop_de_tentatives", retryAfterSeconds: rl.retryAfterSeconds }, { status: 429 });
    }

    const user = await db.user.findUnique({ where: { email } });
    const generic = {
      ok: true,
      delivery: "email",
      message: "Si un compte existe pour cette adresse, un lien de réinitialisation a été émis. Il expire dans 1 heure.",
    };
    if (!user || !user.passwordHash) return generic;

    const token = await issueAuthToken(user.id, "REINITIALISATION_MDP");

    if (resendConfigured()) {
      // Envoi réel via Resend : le lien n'est jamais révélé dans la réponse.
      const link = `${appOriginFromRequest(req)}/reinitialisation?token=${token}`;
      const sent = await sendEmail({
        to: email,
        subject: "Réinitialisation de votre mot de passe — HESYD ONE",
        html: systemEmailHtml(
          "Réinitialisation du mot de passe",
          `<p>Vous avez demandé la réinitialisation du mot de passe associé à l'adresse ${email}.</p><p>Ce lien est valable 1 heure et à usage unique. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail — votre mot de passe actuel reste inchangé.</p>`,
          { label: "Choisir un nouveau mot de passe", url: link }
        ),
      });
      if (sent.sent) return generic;
      if (process.env.NODE_ENV === "production") throw new Error("envoi_email_echoue");
    }

    if (process.env.NODE_ENV === "production") {
      // Jamais de reveal en production : sans canal d'envoi réel, échec honnête.
      return Response.json({ error: "email_non_configure" }, { status: 503 });
    }

    return {
      ...generic,
      delivery: "local_reveal",
      deliveryMode: "LOCAL_REVEAL",
      deliveryNote:
        "Aucun service e-mail n'est configuré sur ce déploiement (connecteur Resend absent). Le lien est affiché ici uniquement en développement — il ne le sera plus dès que RESEND_API_KEY sera configurée.",
      resetPath: `/reinitialisation?token=${token}`,
    };
  });
}
