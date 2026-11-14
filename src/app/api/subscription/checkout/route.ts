import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { polarConfigured, createCheckoutSession } from "@/lib/connectors/polar";

/** Checkout réel via page hébergée Polar — dormant honnête sans identifiants. */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE"].includes(auth.role)) throw new Error("forbidden");
    if (!polarConfigured()) throw new Error("polar_non_configure_ajoutez_POLAR_ACCESS_TOKEN_et_POLAR_WEBHOOK_SECRET");

    const body = (await req.json().catch(() => ({}))) as { planCode?: string };
    const planCode = body.planCode ?? "STANDARD";
    const plan = await db.plan.findUnique({ where: { code: planCode } });
    if (!plan || plan.priceMonthlyCents <= 0) throw new Error("offre_inconnue");

    const base = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
    const result = await createCheckoutSession({
      planCode: plan.code,
      organizationId: auth.organization.id,
      organizationName: auth.organization.name,
      customerEmail: auth.user.email,
      successUrl: `${base}/?abonnement=actif`,
    });
    return { checkoutUrl: result.url };
  });
}
