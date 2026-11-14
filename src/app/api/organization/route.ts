import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  timezone: z.string().max(64).optional(),
  locale: z.enum(["fr", "en"]).optional(),
});

/** Fuseau horaire valide : testé par Intl, jamais accepté aveuglément. */
function fuseauValide(tz: string) {
  try {
    new Intl.DateTimeFormat("fr", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const body = patchSchema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");

    const org = await db.organization.findUnique({ where: { id: auth.organization.id } });
    if (!org) throw new Error("organisation_introuvable");

    const data: { name?: string; timezone?: string; locale?: string } = {};
    if (body.data.name !== undefined) data.name = body.data.name.trim();
    if (body.data.timezone !== undefined) {
      const tz = body.data.timezone.trim();
      if (!fuseauValide(tz)) throw new Error("fuseau_invalide");
      data.timezone = tz;
    }
    if (body.data.locale !== undefined) data.locale = body.data.locale;

    const updated = await db.organization.update({ where: { id: org.id }, data });
    await logAudit({
      organizationId: org.id,
      userId: auth.user.id,
      action: "ORGANISATION_MODIFIEE",
      entityType: "Organization",
      entityId: org.id,
      before: { name: org.name, timezone: org.timezone, locale: org.locale },
      after: { name: updated.name, timezone: updated.timezone, locale: updated.locale },
    });
    return { organization: { id: updated.id, name: updated.name, timezone: updated.timezone, locale: updated.locale } };
  });
}
