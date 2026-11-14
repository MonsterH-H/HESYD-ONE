import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { resendConfigured, sendEmail, systemEmailHtml } from "@/lib/connectors/resend";

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMINISTRATEUR", "EMPLOYE", "LECTEUR"]),
});

const patchSchema = z.object({
  membershipId: z.string().min(1),
  role: z.enum(["ADMINISTRATEUR", "EMPLOYE", "LECTEUR"]).optional(),
  status: z.enum(["ACTIF", "DESACTIVE"]).optional(),
});

/** URL canonique de l'app (convention oauth-google) : APP_URL sinon en-têtes de la requête. */
function baseOrigin(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

/** Invitation réelle : jeton à usage unique avec expiration, quota du plan vérifié.
 *  Livraison honnête : e-mail réel via Resend si configuré, sinon lien révélé en
 *  développement, et en production sans Resend la mention email_non_configure —
 *  l'invitation reste utilisable via le lien affiché à l'administrateur. */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const body = inviteSchema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    const email = body.data.email.toLowerCase().trim();

    const existingMembership = await db.membership.findFirst({
      where: { organizationId: auth.organization.id, user: { email } },
    });
    if (existingMembership) throw new Error("membre_deja_present");

    const plan = await db.plan.findUnique({ where: { code: (await db.subscription.findUnique({ where: { organizationId: auth.organization.id } }))?.planCode ?? "TRIAL" } });
    const members = await db.membership.count({ where: { organizationId: auth.organization.id } });
    if (plan && members >= plan.maxUsers) throw new Error("limite_utilisateurs_atteinte");

    const invite = await db.invite.create({
      data: {
        organizationId: auth.organization.id,
        email,
        role: body.data.role,
        token: crypto.randomUUID() + "-" + crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 7 * 86400000),
        createdById: auth.user.id,
      },
    });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "INVITATION_CREEE", entityType: "Invite", entityId: invite.id, after: { email, role: invite.role } });
    await db.onboardingProgress.updateMany({ where: { organizationId: auth.organization.id, teamInvited: false }, data: { teamInvited: true, teamAt: new Date() } });

    const inviteUrl = `${baseOrigin(req)}/?invite=${invite.token}`;
    let delivery: "email" | "lien_local" | "email_non_configure" | "email_echec" = "email_non_configure";
    let deliveryDetail: string | undefined;
    if (resendConfigured()) {
      const result = await sendEmail({
        to: email,
        subject: `HESYD ONE — Votre invitation à rejoindre « ${auth.organization.name} »`,
        html: systemEmailHtml(
          "Votre invitation HESYD ONE",
          `<p>Vous êtes invité(e) à rejoindre l'organisation « ${auth.organization.name} » sur HESYD ONE en tant que <strong>${body.data.role}</strong>.</p><p>Votre lien d'acceptation est personnel et à usage unique : il expire le ${invite.expiresAt.toLocaleDateString("fr-FR")}.</p>`,
          { label: "Accepter l'invitation", url: inviteUrl },
        ),
      });
      delivery = result.sent ? "email" : "email_echec";
      if (!result.sent) deliveryDetail = result.code;
      await logAudit({
        organizationId: auth.organization.id,
        userId: auth.user.id,
        action: result.sent ? "INVITATION_EMAIL_ENVOYE" : "INVITATION_EMAIL_ECHEC",
        entityType: "Invite",
        entityId: invite.id,
        after: result.sent ? { email, accuse: result.id } : { email, motif: result.code },
      });
    } else if (process.env.NODE_ENV !== "production") {
      // Développement sans Resend : le lien est révélé à l'administrateur (comportement existant).
      delivery = "lien_local";
    }
    // Production sans Resend : delivery = "email_non_configure" — honnête ; l'invitation
    // reste utilisable via le lien affiché à l'administrateur.
    return { invite: { id: invite.id, email: invite.email, role: invite.role, token: invite.token, expiresAt: invite.expiresAt }, delivery, deliveryDetail, inviteUrl: delivery === "email" ? undefined : inviteUrl };
  });
}

/** Liste de l'équipe et des invitations — réservée aux rôles de gouvernance. */
export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const users = await db.membership.findMany({
      where: { organizationId: auth.organization.id },
      include: { user: { select: { id: true, email: true, name: true, lastLoginAt: true, status: true } } },
      orderBy: { createdAt: "asc" },
    });
    const invites = await db.invite.findMany({ where: { organizationId: auth.organization.id, status: "EN_ATTENTE" } });
    return { users, invites };
  });
}

/** Gestion d'équipe : changement de rôle et activation / désactivation d'un membre. */
export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const body = patchSchema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");

    const membership = await db.membership.findFirst({
      where: { id: body.data.membershipId, organizationId: auth.organization.id },
      include: { user: { select: { id: true, email: true, name: true, status: true } } },
    });
    if (!membership) throw new Error("membre_introuvable");

    // Le propriétaire n'est jamais modifiable — sécurité de la pérennité de l'organisation.
    if (membership.role === "PROPRIETAIRE") throw new Error("proprietaire_inmodifiable");
    // On ne modifie pas son propre accès (rôle ni statut) — évite le verrouillage accidentel.
    if (membership.userId === auth.user.id) throw new Error("auto_modification_interdite");

    const data: { role?: string } = {};
    let userStatusChanged = false;
    if (body.data.role !== undefined) data.role = body.data.role;
    if (body.data.status !== undefined && membership.user.status !== body.data.status) {
      await db.user.update({ where: { id: membership.userId }, data: { status: body.data.status } });
      userStatusChanged = true;
      // Désactivation : toutes les sessions actives du membre sont révoquées immédiatement.
      if (body.data.status === "DESACTIVE") {
        await db.session.deleteMany({ where: { userId: membership.userId } });
      }
    }

    const before = { role: membership.role, userStatus: membership.user.status };
    const updated = data.role !== undefined
      ? await db.membership.update({ where: { id: membership.id }, data })
      : membership;
    const after = { role: updated.role, userStatus: userStatusChanged ? body.data.status! : membership.user.status };

    await logAudit({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: body.data.status !== undefined && userStatusChanged
        ? (body.data.status === "DESACTIVE" ? "MEMBRE_DESACTIVE" : "MEMBRE_REACTIVE")
        : "MEMBRE_ROLE_MODIFIE",
      entityType: "Membership",
      entityId: membership.id,
      before,
      after,
    });
    return { membership: { ...updated, user: { ...membership.user, status: after.userStatus } } };
  });
}

/** Retrait d'un membre (accès uniquement — les documents sont conservés) ou révocation d'une invitation en attente. */
export async function DELETE(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");

    const url = new URL(req.url);
    const membershipId = url.searchParams.get("membershipId");
    const inviteId = url.searchParams.get("inviteId");

    if (inviteId) {
      const invite = await db.invite.findFirst({
        where: { id: inviteId, organizationId: auth.organization.id, status: "EN_ATTENTE" },
      });
      if (!invite) throw new Error("invitation_introuvable");
      // Révocation réelle : le jeton devient inutilisable (statut REVOQUEE, refusé par
      // la route d'acceptation comme ACCEPTEE ou EXPIREE).
      await db.invite.update({ where: { id: invite.id }, data: { status: "REVOQUEE" } });
      await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "INVITATION_REVOQUEE", entityType: "Invite", entityId: invite.id, after: { email: invite.email } });
      return { ok: true };
    }

    if (membershipId) {
      const membership = await db.membership.findFirst({
        where: { id: membershipId, organizationId: auth.organization.id },
        include: { user: { select: { email: true, name: true } } },
      });
      if (!membership) throw new Error("membre_introuvable");
      if (membership.role === "PROPRIETAIRE") throw new Error("proprietaire_inmodifiable");
      if (membership.userId === auth.user.id) throw new Error("auto_modification_interdite");
      await db.membership.delete({ where: { id: membership.id } });
      await db.session.deleteMany({ where: { userId: membership.userId } });
      await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "MEMBRE_RETIRE", entityType: "Membership", entityId: membership.id, after: { email: membership.user.email } });
      return { ok: true };
    }

    throw new Error("donnees_incompletes");
  });
}
