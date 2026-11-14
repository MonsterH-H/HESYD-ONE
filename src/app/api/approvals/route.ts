import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { safeJsonParse } from "@/lib/helpers";

/** Approbations en attente : aperçu exact de l'action (CDC §7.10). */
export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    const approvals = await db.approval.findMany({
      where: { organizationId: auth.organization.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { approvals: approvals.map((a) => ({ ...a, preview: safeJsonParse(a.previewJson, {}) })) };
  });
}
