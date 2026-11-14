import { z } from "zod";
import { db } from "@/lib/db";
import { handle, readJson } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/platform";
import { grantCredits } from "@/lib/quota";
import { logAudit, notify } from "@/lib/audit";
import { purgeOrganizationData } from "@/lib/trial-lifecycle";

const schema = z.object({
  organizationId: z.string().min(1),
  action: z.enum(["PROLONGER_ESSAI", "OCTROYER_CREDITS", "CHANGER_PLAN", "SUSPENDRE", "REACTIVER", "RESILIER", "PURGER"]),
  jours: z.number().int().min(1).max(90).optional(),
  credits: z.number().int().min(1).max(100000).optional(),
  planCode: z.string().min(1).max(30).optional(),
  motif: z.string().max(300).optional(),
});

/**
 * Gestes commerciaux de l'opérateur plateforme (CDC §4.9) — chaque geste est
 * réel, journalisé avec l'auteur (l'opérateur), et notifié au propriétaire
 * de l'organisation concernée. La résiliation programme la purge à J+30 et
 * émet une attestation. Aucun geste n'outrepasse le contrat : les statuts
 * d'abonnement liés au paiement restent gouvernés par les webhooks signés.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requirePlatformAdmin();
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    const { organizationId, action } = body.data;

    const org = await db.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: true, memberships: { where: { role: "PROPRIETAIRE" }, take: 1 } },
    });
    if (!org) throw new Error("organisation_introuvable");
    const ownerId = org.memberships[0]?.userId;

    const after: Record<string, unknown> = { action };

    if (action === "PROLONGER_ESSAI") {
      if (!body.data.jours) throw new Error("jours_requis");
      const base = org.trialEndsAt && org.trialEndsAt > new Date() ? org.trialEndsAt : new Date();
      const trialEndsAt = new Date(base.getTime() + body.data.jours * 86400000);
      await db.organization.update({ where: { id: org.id }, data: { status: "TRIAL", trialEndsAt, purgeScheduledAt: null, reminderJ7At: null, reminderJ3At: null, reminderJ1At: null } });
      await db.subscription.updateMany({ where: { organizationId: org.id }, data: { status: "ESSAI", currentPeriodEnd: trialEndsAt } });
      after.trialEndsAt = trialEndsAt;
      await notify({ organizationId: org.id, userId: ownerId, type: "SYSTEME", title: "Essai prolongé", message: `Votre essai a été prolongé de ${body.data.jours} jour(s) par l'exploitant de la plateforme. Nouvelle échéance : ${trialEndsAt.toLocaleDateString("fr-FR")}.` });
    } else if (action === "OCTROYER_CREDITS") {
      if (!body.data.credits) throw new Error("credits_requis");
      const balance = await grantCredits(org.id, body.data.credits, "ACHAT", `Geste opérateur${body.data.motif ? ` : ${body.data.motif}` : ""}`);
      after.credits = body.data.credits;
      after.solde = balance;
      await notify({ organizationId: org.id, userId: ownerId, type: "SYSTEME", title: "Crédits octroyés", message: `${body.data.credits} crédits de traitement ont été ajoutés à votre organisation${body.data.motif ? ` (${body.data.motif})` : ""}. Solde : ${balance}.` });
    } else if (action === "CHANGER_PLAN") {
      if (!body.data.planCode) throw new Error("plan_requis");
      const plan = await db.plan.findUnique({ where: { code: body.data.planCode } });
      if (!plan) throw new Error("plan_inconnu");
      await db.subscription.updateMany({ where: { organizationId: org.id }, data: { planCode: plan.code, status: "ACTIF" } });
      await db.organization.update({ where: { id: org.id }, data: { status: "ACTIF", purgeScheduledAt: null } });
      after.planCode = plan.code;
      await notify({ organizationId: org.id, userId: ownerId, type: "SYSTEME", title: "Plan modifié", message: `Votre organisation est désormais sur le plan ${plan.name}${body.data.motif ? ` (${body.data.motif})` : ""}.` });
    } else if (action === "SUSPENDRE") {
      await db.organization.update({ where: { id: org.id }, data: { status: "SUSPENDU" } });
      await db.subscription.updateMany({ where: { organizationId: org.id }, data: { status: "SUSPENDU" } });
      after.status = "SUSPENDU";
      await notify({ organizationId: org.id, userId: ownerId, type: "SYSTEME", title: "Organisation suspendue", message: `Votre organisation a été suspendue par l'exploitant de la plateforme${body.data.motif ? ` : ${body.data.motif}` : ""}.` });
    } else if (action === "REACTIVER") {
      await db.organization.update({ where: { id: org.id }, data: { status: "ACTIF", purgeScheduledAt: null } });
      await db.subscription.updateMany({ where: { organizationId: org.id }, data: { status: "ACTIF" } });
      after.status = "ACTIF";
      await notify({ organizationId: org.id, userId: ownerId, type: "SYSTEME", title: "Organisation réactivée", message: "Votre organisation a été réactivée par l'exploitant de la plateforme." });
    } else if (action === "RESILIER") {
      const purgeAt = new Date(Date.now() + 30 * 86400000);
      await db.organization.update({ where: { id: org.id }, data: { status: "RESILIE", purgeScheduledAt: purgeAt } });
      await db.subscription.updateMany({ where: { organizationId: org.id }, data: { status: "RESILIE", cancelRequestedAt: null } });
      after.purgeScheduledAt = purgeAt;
      // Attestation de résiliation réelle (PDF)
      const attestation = await issueAttestation(org.id, org.name, org.slug, "RESILIATION", body.data.motif);
      after.attestation = attestation.number;
      await notify({ organizationId: org.id, userId: ownerId, type: "SYSTEME", title: "Résiliation enregistrée", message: `La résiliation de votre organisation est enregistrée. Un export complet reste possible jusqu'au ${purgeAt.toLocaleDateString("fr-FR")} ; vos données seront ensuite purgées. Attestation ${attestation.number} disponible dans Abonnement.` });
    } else if (action === "PURGER") {
      const result = await purgeOrganizationData(org.id, org.slug);
      after.purge = result;
      await notify({ organizationId: org.id, userId: ownerId, type: "SYSTEME", title: "Données purgées", message: "Les documents et registres documentaires de votre organisation ont été purgés comme convenu." });
    }

    await logAudit({
      organizationId: org.id,
      userId: admin.user.id,
      action: `GESTE_OPERATEUR_${action}`,
      entityType: "Organization",
      entityId: org.id,
      before: { status: org.status, plan: org.subscription?.planCode },
      after,
    });
    return { ok: true, action, after };
  });
}

/** Attestation PDF réelle (pdfkit, sans consommation de crédits — geste opérateur). */
async function issueAttestation(organizationId: string, orgName: string, orgSlug: string, kind: "RESILIATION" | "ESSAI", motif?: string) {
  const year = new Date().getFullYear();
  const count = await db.invoice.count({ where: { organizationId, number: { startsWith: `ATT-${year}-` } } });
  const number = `ATT-${year}-${String(count + 1).padStart(4, "0")}`;

  const PDFDocument = (await import("pdfkit")).default;
  const { promises: fs } = await import("fs");
  const path = await import("path");
  const dir = path.join(process.cwd(), "storage", "invoices");
  await fs.mkdir(dir, { recursive: true });
  // Nom de fichier assaini : aucun séparateur ni caractère de traversal ne peut
  // s'introduire via le slug ou le numéro d'attestation (défense en profondeur).
  const safeBase = `${orgSlug}_${number}`.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/\.+/g, ".").slice(0, 120);
  const filePath = path.join(dir, `${safeBase}.pdf`);

  const title = kind === "RESILIATION" ? "Attestation de résiliation" : "Attestation d'essai";
  const doc = new PDFDocument({ size: "A4", margins: { top: 72, bottom: 72, left: 64, right: 64 }, info: { Title: title } });
  const stream = doc.pipe((await import("fs")).createWriteStream(filePath));
  const done = new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#1c1917").text(title, { align: "center" });
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(10).fillColor("#57534e").text(`HESYD ONE · ${new Date().toLocaleDateString("fr-FR")}`, { align: "center" });
  doc.moveDown(1.4);
  doc.font("Helvetica").fontSize(11).fillColor("#1c1917");
  doc.text(`La plateforme HESYD ONE atteste que l'organisation « ${orgName} » ${kind === "RESILIATION" ? "a procédé à la résiliation de son abonnement." : "a ouvert un essai de 14 jours."}`, { align: "justify" });
  doc.moveDown(0.5);
  if (motif) {
    doc.text(`Motif consigné : ${motif}.`, { align: "justify" });
    doc.moveDown(0.5);
  }
  doc.text("Conformément aux engagements de la plateforme, les données documentaires sont conservées 30 jours après la date d'effet, puis purgées de manière irréversible. Aucune donnée n'est cédée à un tiers.", { align: "justify" });
  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(11).text("Cadre");
  doc.font("Helvetica").fontSize(10.5);
  doc.moveDown(0.3);
  doc.text(`Numéro d'attestation : ${number}`);
  doc.text(`Identifiant d'organisation : ${orgSlug}`);
  doc.text(`Date d'émission : ${new Date().toLocaleString("fr-FR")}`);
  doc.moveDown(2);
  doc.fontSize(9).fillColor("#57534e").text("Document généré par la plateforme HESYD ONE — le contenu ci-dessus fait foi sur l'état du registre à la date d'émission.", { align: "center" });
  doc.end();
  await done;

  const stat = await fs.stat(filePath);
  const label = kind === "RESILIATION" ? `Attestation de résiliation — ${orgName}` : `Attestation d'essai — ${orgName}`;
  const invoice = await db.invoice.create({
    data: {
      organizationId,
      number,
      kind: "ATTESTATION",
      label,
      amountCents: 0,
      status: "EMISE",
      filePath: path.relative(process.cwd(), filePath),
      sizeBytes: stat.size,
    },
  });
  return invoice;
}

export { issueAttestation };
