import { getAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { creditBalance } from "@/lib/quota";
import { isPlatformAdminEmail } from "@/lib/platform";
import { db } from "@/lib/db";

export async function GET() {
  return handle(async () => {
    const auth = await getAuth();
    if (!auth) return { authenticated: false };
    const [credits, subscription] = await Promise.all([
      creditBalance(auth.organization.id),
      db.subscription.findUnique({ where: { organizationId: auth.organization.id } }),
    ]);
    const plan = await db.plan.findUnique({ where: { code: subscription?.planCode ?? "TRIAL" } });
    const user = await db.user.findUnique({ where: { id: auth.user.id } });
    return {
      authenticated: true,
      user: {
        ...auth.user,
        emailVerified: Boolean(user?.emailVerifiedAt),
        mfaEnabled: Boolean(user?.mfaEnabled),
      },
      organization: auth.organization,
      role: auth.role,
      credits,
      // Quota réel de l'offre — la jauge d'interface ne codera plus le quota
      // d'essai en dur (audit UI P1) ; null si aucun plan actif.
      planMonthlyCredits: plan?.monthlyCredits ?? null,
      isPlatformAdmin: isPlatformAdminEmail(auth.user.email),
    };
  });
}
