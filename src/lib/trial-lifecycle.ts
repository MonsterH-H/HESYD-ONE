import { db } from "@/lib/db";
import { notify, logAudit } from "@/lib/audit";
import { resendConfigured, sendEmail, systemEmailHtml } from "@/lib/connectors/resend";
import { promises as fs } from "fs";
import path from "path";

/**
 * Cycle de vie des essais et purge (CDC §9) — réel et idempotent :
 * - rappels J-7 / J-3 / J-1 (un seul chacun, horodaté en base) ;
 * - passage ESSAI_EXPIRE à l'échéance + programmation de purge à J+30 ;
 * - purge réelle des fichiers et registres documentaires à l'échéance de
 *   purge (les comptes, l'audit et les factures sont conservés).
 * Notifications : si le connecteur Resend est configuré, un e-mail RÉEL est
 * envoyé au propriétaire de l'organisation (résultat réel journalisé dans
 * ProcessingLog) ; sinon les notifications restent in-app, honnêtement
 * libellées — jamais de faux envoi déclaré.
 */

const DAY = 24 * 3600 * 1000;

/** Journalise le résultat RÉEL de l'envoi e-mail (traçabilité ProcessingLog). */
async function journaliserEnvoi(
  organizationId: string,
  step: string,
  result: { sent: true; id: string } | { sent: false; code: string },
  destinataire: string,
): Promise<void> {
  await db.processingLog
    .create({
      data: {
        organizationId,
        step,
        result: result.sent ? "OK" : "ECHEC",
        details: result.sent
          ? `e-mail réel envoyé à ${destinataire} — accusé Resend ${result.id}`
          : `envoi e-mail impossible à ${destinataire} — motif : ${result.code} — notification in-app émise`,
      },
    })
    .catch(() => undefined);
}

/** Envoi e-mail RÉEL au propriétaire de l'organisation (adresse du membership PROPRIETAIRE). */
async function emailProprietaire(
  org: { id: string; memberships: { user: { email: string } | null }[] },
  titre: string,
  bodyHtml: string,
  step: string,
): Promise<void> {
  const destinataire = org.memberships.find((m) => m.user?.email)?.user?.email;
  if (!destinataire) return; // aucun propriétaire joignable : la notification in-app fait foi
  const result = await sendEmail({
    to: destinataire,
    subject: `HESYD ONE — ${titre}`,
    html: systemEmailHtml(titre, bodyHtml),
  });
  await journaliserEnvoi(org.id, step, result, destinataire);
}

export async function runTrialLifecycle(): Promise<{ reminders: number; expired: number; purged: number }> {
  const now = new Date();
  let reminders = 0;
  let expired = 0;
  let purged = 0;

  // 1. Rappels de fin d'essai J-7 / J-3 / J-1
  const trials = await db.organization.findMany({
    where: { status: "TRIAL", trialEndsAt: { not: null } },
    include: { memberships: { where: { role: "PROPRIETAIRE" }, take: 5, include: { user: { select: { email: true } } } } },
  });
  for (const org of trials) {
    if (!org.trialEndsAt) continue;
    const daysLeft = Math.ceil((org.trialEndsAt.getTime() - now.getTime()) / DAY);
    const steps: { threshold: number; field: "J7" | "J3" | "J1" }[] = [
      { threshold: 7, field: "J7" },
      { threshold: 3, field: "J3" },
      { threshold: 1, field: "J1" },
    ];
    for (const { threshold, field } of steps) {
      if (daysLeft <= threshold && daysLeft > 0 && !org[reminderField(field)]) {
        const titre = `Fin de l'essai dans ${daysLeft} jour(s)`;
        const message = `L'essai de « ${org.name} » se termine le ${org.trialEndsAt.toLocaleDateString("fr-FR")}. Choisissez une offre avant l'échéance pour conserver l'accès à l'agent et aux livrables. Les documents archivés restent conservés 30 jours après expiration.`;
        // E-mail réel au propriétaire si Resend est configuré (résultat journalisé) ; sinon in-app uniquement.
        if (resendConfigured()) {
          await emailProprietaire(
            org,
            titre,
            `<p>L'essai de « ${org.name} » se termine le <strong>${org.trialEndsAt.toLocaleDateString("fr-FR")}</strong>.</p><p>Choisissez une offre avant l'échéance pour conserver l'accès à l'agent et aux livrables. Les documents archivés restent conservés 30 jours après expiration.</p>`,
            "TRIAL_REMINDER_EMAIL",
          );
        }
        await notify({
          organizationId: org.id,
          userId: org.memberships[0]?.userId,
          type: "SYSTEME",
          title: titre,
          message,
          relatedEntityType: "Organization",
          relatedEntityId: org.id,
        });
        const patch: { reminderJ7At?: Date; reminderJ3At?: Date; reminderJ1At?: Date } = {};
        if (field === "J7") patch.reminderJ7At = now;
        else if (field === "J3") patch.reminderJ3At = now;
        else patch.reminderJ1At = now;
        await db.organization.update({ where: { id: org.id }, data: patch });
        reminders++;
      }
    }
  }

  // 2. Expiration des essais dépassés
  const overdue = await db.organization.findMany({
    where: { status: "TRIAL", trialEndsAt: { lt: now } },
    include: { memberships: { where: { role: "PROPRIETAIRE" }, take: 5, include: { user: { select: { email: true } } } } },
  });
  for (const org of overdue) {
    const purgeAt = new Date((org.trialEndsAt ?? now).getTime() + 30 * DAY);
    await db.organization.update({ where: { id: org.id }, data: { status: "ESSAI_EXPIRE", purgeScheduledAt: purgeAt } });
    await db.subscription.updateMany({ where: { organizationId: org.id }, data: { status: "ESSAI_EXPIRE" } });
    const titre = "Essai expiré";
    const message = `L'essai de « ${org.name} » est terminé. L'agent et les livrables sont en attente. Les documents archivés seront purgés le ${purgeAt.toLocaleDateString("fr-FR")} (30 jours après expiration) sauf passage à une offre.`;
    if (resendConfigured()) {
      await emailProprietaire(
        org,
        titre,
        `<p>L'essai de « ${org.name} » est terminé. L'agent et les livrables sont en attente.</p><p>Les documents archivés seront purgés le <strong>${purgeAt.toLocaleDateString("fr-FR")}</strong> (30 jours après expiration), sauf passage à une offre.</p>`,
        "TRIAL_EXPIRED_EMAIL",
      );
    }
    await notify({
      organizationId: org.id,
      userId: org.memberships[0]?.userId,
      type: "SYSTEME",
      title: titre,
      message,
      relatedEntityType: "Organization",
      relatedEntityId: org.id,
    });
    await logAudit({ organizationId: org.id, action: "ESSAI_EXPIRE", entityType: "Organization", entityId: org.id, after: { purgeScheduledAt: purgeAt } });
    expired++;
  }

  // 3. Purge réelle (essais expirés > 30 j, ou résiliations programmées)
  const toPurge = await db.organization.findMany({
    where: { purgeScheduledAt: { lte: now }, status: { in: ["ESSAI_EXPIRE", "RESILIE", "SUSPENDU"] } },
    include: { memberships: { where: { role: "PROPRIETAIRE" }, take: 5, include: { user: { select: { email: true } } } } },
  });
  for (const org of toPurge) {
    purged++;
    const purge = await purgeOrganizationData(org.id, org.slug);
    const titre = "Purge des données documentaires effectuée";
    const driveNote = purge.driveFilesKept > 0
      ? ` ${purge.driveFilesKept} document(s) archivé(s) dans le Google Drive du client y restent conservés — ils appartiennent au client et ne sont pas supprimés par la plateforme.`
      : "";
    const message = `La purge programmée de « ${org.name} » a été exécutée : ${purge.filesDeleted} document(s) supprimé(s) des registres de la plateforme, ${purge.bytesFreed} octets libérés.${driveNote} Les comptes, l'audit et les factures sont conservés comme preuve du traitement.`;
    if (resendConfigured()) {
      await emailProprietaire(
        org,
        titre,
        `<p>La purge programmée de « ${org.name} » a été exécutée le ${new Date().toLocaleDateString("fr-FR")}.</p><p>${purge.filesDeleted} document(s) supprimé(s) des registres de la plateforme, ${purge.bytesFreed} octets libérés.${driveNote ? " " + driveNote : ""} Les comptes, l'audit et les factures sont conservés comme preuve du traitement.</p>`,
        "PURGE_EXECUTEE_EMAIL",
      );
    }
    await notify({
      organizationId: org.id,
      userId: org.memberships[0]?.userId,
      type: "SYSTEME",
      title: titre,
      message,
    });
  }

  return { reminders, expired, purged };
}

function reminderField(k: "J7" | "J3" | "J1"): "reminderJ7At" | "reminderJ3At" | "reminderJ1At" {
  const map: Record<"J7" | "J3" | "J1", "reminderJ7At" | "reminderJ3At" | "reminderJ1At"> = {
    J7: "reminderJ7At",
    J3: "reminderJ3At",
    J1: "reminderJ1At",
  };
  return map[k];
}

/**
 * Purge réelle : suppression physique des fichiers archivés et bruts, puis
 * des registres documentaires. Les utilisateurs, organisations, audit et
 * factures sont conservés (preuve du traitement). Retourne un compte rendu
 * horodaté — jamais « purge simulée ».
 */
export async function purgeOrganizationData(organizationId: string, orgSlug: string): Promise<{ filesDeleted: number; bytesFreed: number; driveFilesKept: number }> {
  const files = await db.file.findMany({ where: { organizationId } });
  let filesDeleted = 0;
  let bytesFreed = 0;
  let driveFilesKept = 0;
  const cwd = process.cwd();
  for (const f of files) {
    if (f.archivedPath?.startsWith("drive://")) {
      // Archives déposées dans le Drive du CLIENT : HESYD ONE ne les supprime
      // pas (elles appartiennent au client) — la purge ne porte que sur les
      // registres applicatifs. Compte rendu distinct et honnête (audit P2).
      driveFilesKept++;
      continue;
    }
    if (f.archivedPath) {
      try {
        const full = path.resolve(path.join(cwd, f.archivedPath));
        // Garde stricte par path.relative (audit S6 — un simple startsWith
        // laissait passer les répertoires frères de préfixe).
        const rel = path.relative(cwd, full);
        if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
          const stat = await fs.stat(full);
          await fs.unlink(full);
          bytesFreed += stat.size;
        }
      } catch {
        // fichier déjà absent : la purge continue, l'absence est le résultat attendu
      }
    }
    filesDeleted++;
  }
  // Matière première conservée pour reprise : purgée aussi (fin de vie)
  const receivedDir = path.join(cwd, "storage", "received", orgSlug);
  await fs.rm(receivedDir, { recursive: true, force: true }).catch(() => undefined);
  const archivesDir = path.join(cwd, "storage", "archives", orgSlug);
  await fs.rm(archivesDir, { recursive: true, force: true }).catch(() => undefined);
  // Livrables physiques (PDF/DOCX) générés pour cette organisation (audit S5)
  const deliverablesDir = path.join(cwd, "storage", "deliverables", orgSlug);
  await fs.rm(deliverablesDir, { recursive: true, force: true }).catch(() => undefined);

  // Registres documentaires (les cascades emportent chunks/extractions)
  await db.file.deleteMany({ where: { organizationId } });
  await db.fileReception.deleteMany({ where: { organizationId } });
  await db.deliverable.deleteMany({ where: { organizationId } });
  await db.conversation.deleteMany({ where: { organizationId } });
  await db.processingJob.deleteMany({ where: { organizationId } });
  await db.processingLog.deleteMany({ where: { organizationId } });
  await db.memoryItem.deleteMany({ where: { organizationId } });
  await db.automation.deleteMany({ where: { organizationId } });
  await db.whatsappPairing.deleteMany({ where: { organizationId } });
  // Données personnelles / métier résiduelles (audit S5 — RGPD/minimisation) :
  await db.agentTask.deleteMany({ where: { organizationId } });
  await db.approval.deleteMany({ where: { organizationId } });
  await db.webhookEvent.deleteMany({ where: { organizationId } }); // payloadJson = messages WhatsApp bruts
  await db.financialOperation.deleteMany({ where: { organizationId } }); // opérations métier de l'organisation
  await db.importBatch.deleteMany({ where: { organizationId } }); // lignes d'import en cascade
  await db.notification.deleteMany({ where: { organizationId } });
  await db.integrationConnection.deleteMany({ where: { organizationId } }); // jetons OAuth chiffrés
  await db.onboardingProgress.deleteMany({ where: { organizationId } });
  // Conservés volontairement comme preuve du traitement (décision produit
  // documentée) : comptes, journal d'audit, factures et événements/registres
  // d'abonnement et de crédits (SubscriptionEvent, CreditLedger, UsageMetering).

  await db.organization.update({ where: { id: organizationId }, data: { status: "PURGE", purgeScheduledAt: null } });
  await logAudit({
    organizationId,
    action: "PURGE_EXECUTEE",
    entityType: "Organization",
    entityId: organizationId,
    after: { filesDeleted, bytesFreed, driveFilesKept },
  });
  return { filesDeleted, bytesFreed, driveFilesKept };
}
