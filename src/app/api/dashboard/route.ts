import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { creditBalance, monthlyUsageCount } from "@/lib/quota";
import { driveConfigured } from "@/lib/storage/drive";
import { whatsappConfigured } from "@/lib/connectors/whatsapp";
import { polarConfigured } from "@/lib/connectors/polar";
import { n8nConfigured } from "@/lib/connectors/n8n";
import { safeIntegrationConfig } from "@/lib/helpers";

/** Vue d'ensemble : indicateurs réels, activité réelle, états d'intégrations honnêtes. */
export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    const orgId = auth.organization.id;

    const [archiveCount, aVerifierCount, clientsCount, groupsCount, credits, docsThisMonth, recentFiles, recentLogs, onboarding, connections, pendingApprovals] = await Promise.all([
      db.file.count({ where: { organizationId: orgId, status: "ARCHIVE" } }),
      db.file.count({ where: { organizationId: orgId, status: "A_VERIFIER" } }),
      db.client.count({ where: { organizationId: orgId, status: { not: "ARCHIVE" } } }),
      db.waGroup.count({ where: { organizationId: orgId, status: { not: "ARCHIVE" } } }),
      creditBalance(orgId),
      monthlyUsageCount(orgId, "DOCUMENT_TRAITE"),
      db.file.findMany({ where: { organizationId: orgId }, include: { client: true, group: true }, orderBy: { createdAt: "desc" }, take: 12 }),
      db.processingLog.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 12 }),
      db.onboardingProgress.findUnique({ where: { organizationId: orgId } }),
      db.integrationConnection.findMany({ where: { organizationId: orgId } }),
      db.approval.count({ where: { organizationId: orgId, status: "EN_ATTENTE" } }),
    ]);

    const plan = await db.plan.findUnique({ where: { code: (await db.subscription.findUnique({ where: { organizationId: orgId } }))?.planCode ?? "TRIAL" } });

    // Le stockage local réel est un stockage connecté : l'étape onboarding en tient compte honnêtement
    const storageConnected =
      onboarding?.storageConnected === true || connections.some((c) => c.connector === "STORAGE_LOCAL" && c.status === "CONNECTE");
    const onboardingComplet = onboarding ? { ...onboarding, storageConnected } : null;

    const envStates = {
      GOOGLE_DRIVE: driveConfigured(),
      WHATSAPP_CLOUD: whatsappConfigured(),
      POLAR: polarConfigured(),
      N8N: n8nConfigured(),
    };

    return {
      counters: { archiveCount, aVerifierCount, clientsCount, groupsCount, credits, docsThisMonth },
      plan: plan ?? null,
      recentFiles,
      recentLogs: recentLogs.map((l) => ({ step: l.step, result: l.result, details: l.details, at: l.createdAt })),
      onboarding: onboardingComplet,
      integrations: connections.map((c) => ({
        connector: c.connector,
        status: c.status,
        envReady: envStates[c.connector as keyof typeof envStates] ?? true,
        // Masquage des secrets du configJson (audit P1) : jamais refreshTokenEnc,
        // state ou tout autre champ sensible — statuts seuls, preuves à l'appui.
        config: safeIntegrationConfig(c.connector, c.configJson),
      })),
      pendingApprovals,
    };
  });
}
