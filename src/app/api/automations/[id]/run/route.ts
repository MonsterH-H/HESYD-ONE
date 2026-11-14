import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { runAutomationNow } from "@/lib/scheduler";
import { logAudit } from "@/lib/audit";

/** Déclenchement manuel réel : le rapport honnête de l'exécution est retourné. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR", "EMPLOYE"].includes(auth.role)) throw new Error("forbidden");
    const { id } = await ctx.params;
    const run = await runAutomationNow(id, auth.organization.id);
    await logAudit({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: "AUTOMATISATION_EXECUTEE_MANUELLE",
      entityType: "AutomationRun",
      entityId: run?.id ?? undefined,
      after: { status: run?.status, report: run?.report?.slice(0, 300) },
    });
    return { run };
  });
}
