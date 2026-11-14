import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  name: z.string().min(2).max(80),
  template: z.enum(["RAPPORT_HEBDO", "RAPPORT_MENSUEL", "RAPPEL_MANQUANTS", "PERSONNALISEE"]),
  cronExpr: z.string().min(9).max(40),
  configJson: z.string().max(4000).optional(),
});

const PATCH_SCHEMA = z.object({ status: z.enum(["ACTIVE", "PAUSE"]) });

export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    const automations = await db.automation.findMany({
      where: { organizationId: auth.organization.id },
      include: { runs: { orderBy: { startedAt: "desc" }, take: 8 } },
      orderBy: { createdAt: "desc" },
    });
    return { automations };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const body = createSchema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");

    // plafond d'offre réel
    const plan = await db.plan.findUnique({ where: { code: (await db.subscription.findUnique({ where: { organizationId: auth.organization.id } }))?.planCode ?? "TRIAL" } });
    const count = await db.automation.count({ where: { organizationId: auth.organization.id, status: "ACTIVE" } });
    if (plan && count >= plan.maxAutomations) throw new Error("limite_automatisations_atteinte");

    // validation cron réelle (5 champs) + intervalle minimal de l'offre (Plan.minIntervalMinutes — appliqué, audit données)
    const fields = body.data.cronExpr.trim().split(/\s+/);
    if (fields.length !== 5 || fields.some((f) => !/^(\*|\d+(?:-\d+)?(?:\/\d+)?|\*\/\d+)$/.test(f))) {
      throw new Error("expression_cron_invalide");
    }
    if (plan) {
      const [min, hour] = fields;
      let intervalMin: number;
      if (min.startsWith("*/")) intervalMin = Math.max(1, parseInt(min.slice(2), 10) || 1);
      else if (min === "*") intervalMin = 1;
      else intervalMin = hour === "*" ? 60 : 1440; // minute fixe : horaire ou quotidien au minimum
      if (intervalMin < plan.minIntervalMinutes) throw new Error("intervalle_cron_trop_court");
    }

    const automation = await db.automation.create({
      data: {
        organizationId: auth.organization.id,
        name: body.data.name.trim(),
        template: body.data.template,
        cronExpr: body.data.cronExpr.trim(),
        configJson: body.data.configJson ?? "{}",
        createdById: auth.user.id,
      },
    });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "AUTOMATISATION_CREEE", entityType: "Automation", entityId: automation.id, after: { name: automation.name, cron: automation.cronExpr } });
    return { automation };
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    // Garde de rôle réelle (audit P2) : (ré)activer une automatisation consomme
    // des crédits — réservé aux administrateurs, comme POST.
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const body = PATCH_SCHEMA.and(z.object({ id: z.string() })).safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    const automation = await db.automation.findFirst({ where: { id: body.data.id, organizationId: auth.organization.id } });
    if (!automation) throw new Error("automatisation_introuvable");
    const updated = await db.automation.update({ where: { id: automation.id }, data: { status: body.data.status } });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: body.data.status === "ACTIVE" ? "AUTOMATISATION_ACTIVEE" : "AUTOMATISATION_SUSPENDUE", entityType: "Automation", entityId: automation.id });
    return { automation: updated };
  });
}
