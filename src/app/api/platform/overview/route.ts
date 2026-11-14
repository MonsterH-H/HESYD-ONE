import { db } from "@/lib/db";
import { handle } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/platform";
import { creditBalance } from "@/lib/quota";

/**
 * Console opérateur de la plateforme (CDC §4.9) — vue cross-organisations :
 * toutes les organisations, usage réel par organisation, état global des
 * services, demandes de résiliation. Réservée aux opérateurs déclarés dans
 * PLATFORM_ADMIN_EMAILS. Aucune donnée d'une organisation n'est exposée à
 * une autre : cet espace vit au-dessus, côté exploitant de la plateforme.
 */
export async function GET() {
  return handle(async () => {
    await requirePlatformAdmin();

    const orgs = await db.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        subscription: true,
        memberships: { select: { userId: true, role: true } },
        _count: { select: { files: true, clients: true, waGroups: true } },
      },
    });

    type OrgOverview = {
      id: string; name: string; slug: string; status: string;
      trialEndsAt: Date | null; purgeScheduledAt: Date | null; createdAt: Date;
      users: number; planCode: string; subscriptionStatus: string;
      cancelRequestedAt: Date | null; cancelReason: string | null;
      documents: number; clients: number; groups: number;
      deliverables: number; conversations: number; agentTasks: number;
      storageBytes: number; credits: number; lastActivityAt: Date | null;
    };
    const overview: OrgOverview[] = [];
    for (const org of orgs) {
      const [credits, storageAgg, agentTasksAgg, lastActivity, deliverables, conversations] = await Promise.all([
        creditBalance(org.id),
        db.file.aggregate({ where: { organizationId: org.id }, _sum: { sizeBytes: true } }),
        db.agentTask.count({ where: { organizationId: org.id } }),
        db.auditLog.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
        db.deliverable.count({ where: { organizationId: org.id } }),
        db.conversation.count({ where: { organizationId: org.id } }),
      ]);
      overview.push({
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        trialEndsAt: org.trialEndsAt,
        purgeScheduledAt: org.purgeScheduledAt,
        createdAt: org.createdAt,
        users: org.memberships.length,
        planCode: org.subscription?.planCode ?? "TRIAL",
        subscriptionStatus: org.subscription?.status ?? "—",
        cancelRequestedAt: org.subscription?.cancelRequestedAt ?? null,
        cancelReason: org.subscription?.cancelReason ?? null,
        documents: org._count.files,
        clients: org._count.clients,
        groups: org._count.waGroups,
        deliverables,
        conversations,
        agentTasks: agentTasksAgg,
        storageBytes: storageAgg._sum.sizeBytes ?? 0,
        credits,
        lastActivityAt: lastActivity?.createdAt ?? null,
      });
    }

    // État global réel des services : combien d'organisations ont chaque connecteur configuré
    const connections = await db.integrationConnection.findMany({
      select: { connector: true, status: true, organizationId: true },
    });
    const services = ["STORAGE_LOCAL", "GOOGLE_DRIVE", "WHATSAPP_CLOUD", "POLAR", "N8N"].map((connector) => ({
      connector,
      connectes: connections.filter((c) => c.connector === connector && c.status === "CONNECTE").length,
      nonConfigures: connections.filter((c) => c.connector === connector && c.status === "NON_CONFIGURE").length,
      erreurs: connections.filter((c) => c.connector === connector && c.status === "ERREUR").length,
      totalOrganisations: new Set(connections.filter((c) => c.connector === connector).map((c) => c.organizationId)).size,
    }));

    // File des demandes de résiliation en attente de traitement opérateur
    const cancellations = overview.filter((o) => o.cancelRequestedAt && o.subscriptionStatus !== "RESILIE");

    const totals = {
      organisations: overview.length,
      actives: overview.filter((o) => ["TRIAL", "ACTIF", "GRACE"].includes(o.status)).length,
      expirees: overview.filter((o) => o.status === "ESSAI_EXPIRE").length,
      resiliees: overview.filter((o) => o.status === "RESILIE" || o.subscriptionStatus === "RESILIE").length,
      purgees: overview.filter((o) => o.status === "PURGE").length,
      documents: overview.reduce((n, o) => n + o.documents, 0),
      utilisateurs: overview.reduce((n, o) => n + o.users, 0),
      stockageOctets: overview.reduce((n, o) => n + o.storageBytes, 0),
    };

    return {
      organisations: overview,
      services,
      cancellations,
      totals,
      plans: await db.plan.findMany({ where: { active: true }, orderBy: { priceMonthlyCents: "asc" } }),
      environnement: {
        polarConfigure: Boolean(process.env.POLAR_ACCESS_TOKEN && process.env.POLAR_WEBHOOK_SECRET),
        whatsappConfigure: Boolean(process.env.WHATSAPP_TOKEN),
        driveConfigure: Boolean(process.env.GOOGLE_CLIENT_ID),
        n8nConfigure: Boolean(process.env.N8N_BASE_URL),
        smtpConfigure: Boolean(process.env.SMTP_URL),
        noteHonnête:
          "Les états « non configuré » sont des blocages externes réels (E1-E5) : aucune fonctionnalité n'est simulée à leur place.",
      },
    };
  });
}
