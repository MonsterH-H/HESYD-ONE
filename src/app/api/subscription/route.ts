import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { polarConfigured } from "@/lib/connectors/polar";
import { creditBalance, monthlyUsageCount } from "@/lib/quota";

/** Abonnement + usage réel : consommation par dimension, solde de crédits. */
export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    const [subscription, plans, credits, docsMonth, agentMonth, deliverablesMonth] = await Promise.all([
      db.subscription.findUnique({ where: { organizationId: auth.organization.id } }),
      db.plan.findMany({ where: { active: true }, orderBy: { priceMonthlyCents: "asc" } }),
      creditBalance(auth.organization.id),
      monthlyUsageCount(auth.organization.id, "DOCUMENT_TRAITE"),
      monthlyUsageCount(auth.organization.id, "QUESTION_AGENT"),
      monthlyUsageCount(auth.organization.id, "LIVRABLE"),
    ]);
    const plan = plans.find((p) => p.code === subscription?.planCode);
    return {
      subscription,
      plan: plan ?? null,
      plans,
      usage: { docsMonth, agentMonth, deliverablesMonth, credits },
      polarConfigured: polarConfigured(),
    };
  });
}
