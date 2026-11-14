import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";

export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    const notifications = await db.notification.findMany({
      where: { organizationId: auth.organization.id, OR: [{ userId: null }, { userId: auth.user.id }] },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return { notifications, unread: notifications.filter((n) => !n.readAt).length };
  });
}

const markSchema = z.object({ ids: z.array(z.string()).max(50) });

export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    const body = markSchema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    await db.notification.updateMany({
      where: { id: { in: body.data.ids }, organizationId: auth.organization.id },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });
}
