import { getAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { creditBalance } from "@/lib/quota";
import { isPlatformAdminEmail } from "@/lib/platform";
import { db } from "@/lib/db";

export async function GET() {
  return handle(async () => {
    const auth = await getAuth();
    if (!auth) return { authenticated: false };
    const credits = await creditBalance(auth.organization.id);
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
      isPlatformAdmin: isPlatformAdminEmail(auth.user.email),
    };
  });
}
