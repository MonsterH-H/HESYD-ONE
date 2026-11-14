import { db } from "@/lib/db";
import { slugify } from "@/lib/helpers";
import { grantCredits } from "@/lib/quota";
import { logAudit } from "@/lib/audit";

const TRIAL_DAYS = 14;
export const TRIAL_CREDITS = 500;

/**
 * Provisionnement réel d'une nouvelle organisation en essai 14 jours :
 * organisation, adhésion propriétaire, abonnement ESSAI, crédits d'essai,
 * connecteurs initialisés à leur état honnête, progression d'onboarding,
 * entrée d'audit. Utilisé par l'inscription e-mail ET l'arrivée Google.
 */
export async function createTrialOrganization(userId: string, organizationName: string) {
  let slug = slugify(organizationName);
  if (await db.organization.findUnique({ where: { slug } })) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400000);
  const organization = await db.organization.create({
    data: { name: organizationName.trim(), slug, status: "TRIAL", trialEndsAt },
  });

  await db.membership.create({
    data: { organizationId: organization.id, userId, role: "PROPRIETAIRE" },
  });

  await db.subscription.create({
    data: {
      organizationId: organization.id,
      planCode: "TRIAL",
      status: "ESSAI",
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEndsAt,
    },
  });

  // Crédits d'essai réels + connecteurs initialisés (états honnêtes)
  await grantCredits(organization.id, TRIAL_CREDITS, "DREDIT_ACCORDE", "Crédits d'essai (14 jours)");
  await db.integrationConnection.create({
    data: {
      organizationId: organization.id,
      connector: "STORAGE_LOCAL",
      status: "CONNECTE",
      configJson: JSON.stringify({ root: "storage/archives" }),
    },
  });
  for (const connector of ["GOOGLE_DRIVE", "WHATSAPP_CLOUD", "POLAR", "N8N"]) {
    await db.integrationConnection.create({
      data: { organizationId: organization.id, connector, status: "NON_CONFIGURE" },
    });
  }

  // Référentiel de départ (CDC §9.2 étape 3) : le premier dépôt sans
  // configuration a toujours une destination — client « Général » et son
  // dépôt direct, réellement créés à l'inscription.
  const general = await db.client.create({
    data: { organizationId: organization.id, code: "GENERAL", name: "Général", contact: null },
  });
  await db.waGroup.create({
    data: {
      organizationId: organization.id,
      clientId: general.id,
      code: "DEPOTS_DIRECTS",
      name: "Dépôts directs",
      sourceType: "DEPOT_WEB",
    },
  });

  await db.onboardingProgress.create({ data: { organizationId: organization.id } });

  await logAudit({
    organizationId: organization.id,
    userId,
    action: "ORGANISATION_CREEE",
    entityType: "Organization",
    entityId: organization.id,
    after: { slug },
  });

  return { organization, trialEndsAt };
}

export { TRIAL_DAYS };
