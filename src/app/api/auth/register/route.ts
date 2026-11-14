import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, createSession, sha256Hex } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { createTrialOrganization } from "@/lib/provisioning";
import { issueAuthToken } from "@/lib/auth-tokens";
import { clientIp, consumeRateLimitWindow } from "@/lib/rate-limit";
import { appOriginFromRequest } from "@/lib/oauth-google";
import { resendConfigured, sendEmail, systemEmailHtml } from "@/lib/connectors/resend";

const schema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  organizationName: z.string().min(2).max(80),
});

const REGISTER_LIMIT = 5;
const REGISTER_WINDOW_MS = 15 * 60 * 1000;

type EmailVerificationDelivery = {
  required: boolean;
  delivery: "email" | "local_reveal" | "verification_email_non_envoyee";
  verifyPath?: string;
  raison?: string;
};

/**
 * Inscription réelle : organisation en essai 14 jours sans paiement,
 * référentiel de départ (client Général + dépôt direct) et token de
 * vérification d'adresse e-mail (usage unique, 24 h). Livraison honnête,
 * jamais simulée (audit P0 — LOCAL_REVEAL en production) : e-mail réel via
 * Resend si configuré ; lien révélé uniquement en développement ; en
 * production sans canal d'envoi, le compte est créé quand même mais le
 * statut « verification_email_non_envoyee » est explicite.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");

    // Anti-abus persisté : 5 inscriptions / 15 min par IP (audit P1)
    const rl = await consumeRateLimitWindow(`REGISTER:${sha256Hex(clientIp(req))}`, REGISTER_LIMIT, REGISTER_WINDOW_MS);
    if (!rl.allowed) {
      return Response.json({ error: "trop_de_tentatives", retryAfterSeconds: rl.retryAfterSeconds }, { status: 429 });
    }

    const email = body.data.email.toLowerCase().trim();
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) throw new Error("email_deja_utilise");

    const user = await db.user.create({
      data: {
        email,
        name: body.data.name.trim(),
        passwordHash: hashPassword(body.data.password),
      },
    });

    const { organization, trialEndsAt } = await createTrialOrganization(user.id, body.data.organizationName);

    // Vérification d'adresse e-mail (CDC §4) — token réel à usage unique
    const verifyToken = await issueAuthToken(user.id, "VERIFICATION_EMAIL");

    let emailVerification: EmailVerificationDelivery;

    if (resendConfigured()) {
      // Envoi réel via Resend : le lien n'est jamais révélé dans la réponse.
      const link = `${appOriginFromRequest(req)}/verification-email?token=${verifyToken}`;
      const sent = await sendEmail({
        to: email,
        subject: "Vérification de votre adresse e-mail — HESYD ONE",
        html: systemEmailHtml(
          "Vérification de l'adresse e-mail",
          `<p>Bienvenue dans votre espace HESYD ONE. Confirmez l'adresse ${email} pour activer toutes les fonctions.</p><p>Ce lien est valable 24 heures et à usage unique.</p>`,
          { label: "Vérifier mon adresse e-mail", url: link }
        ),
      });
      if (sent.sent) {
        emailVerification = { required: true, delivery: "email" };
      } else if (process.env.NODE_ENV === "production") {
        emailVerification = { required: true, delivery: "verification_email_non_envoyee", raison: sent.code };
      } else {
        emailVerification = {
          required: true,
          delivery: "local_reveal",
          verifyPath: `/verification-email?token=${verifyToken}`,
        };
      }
    } else if (process.env.NODE_ENV === "production") {
      // Production sans Resend : compte créé quand même, statut explicite,
      // aucune révélation de lien.
      emailVerification = { required: true, delivery: "verification_email_non_envoyee", raison: "email_non_configure" };
    } else {
      // Développement sans Resend : reveal local, clairement libellé.
      emailVerification = {
        required: true,
        delivery: "local_reveal",
        verifyPath: `/verification-email?token=${verifyToken}`,
      };
    }

    await createSession(user.id);
    return {
      ok: true,
      organization: { slug: organization.slug, name: organization.name },
      trialEndsAt,
      emailVerification,
    };
  });
}
