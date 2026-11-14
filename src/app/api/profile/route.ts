import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, hashPassword, verifyPassword } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  locale: z.enum(["fr", "en"]).optional(),
  currentPassword: z.string().max(72).optional(),
  newPassword: z.string().min(8).max(72).optional(),
});

export async function PATCH(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    const body = patchSchema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");

    const user = await db.user.findUnique({ where: { id: auth.user.id } });
    if (!user) throw new Error("utilisateur_introuvable");

    const data: { name?: string; locale?: string; passwordHash?: string } = {};
    if (body.data.name !== undefined) data.name = body.data.name.trim();
    if (body.data.locale !== undefined) data.locale = body.data.locale;

    if (body.data.newPassword !== undefined) {
      if (user.passwordHash) {
        // Compte à mot de passe : le mot de passe actuel est exigé et vérifié en temps constant.
        if (!body.data.currentPassword) throw new Error("mot_de_passe_actuel_requis");
        const ok = verifyPassword(body.data.currentPassword, user.passwordHash);
        if (!ok) throw new Error("mot_de_passe_actuel_incorrect");
      }
      // Compte Google sans mot de passe : définition directe autorisée (première création).
      data.passwordHash = hashPassword(body.data.newPassword);
    }

    const saved = await db.user.update({
      where: { id: user.id },
      data,
      select: { id: true, name: true, locale: true, passwordHash: true },
    });

    if (data.passwordHash) {
      // Changement de mot de passe : toutes les autres sessions sont révoquées.
      await db.session.deleteMany({ where: { userId: user.id, id: { not: auth.session.id } } });
    }

    await logAudit({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: data.passwordHash ? "PROFIL_MOT_DE_PASSE_MODIFIE" : "PROFIL_MODIFIE",
      entityType: "User",
      entityId: user.id,
      after: { name: saved.name, locale: saved.locale },
    });

    return {
      user: {
        id: saved.id,
        name: saved.name,
        locale: saved.locale,
        email: user.email,
        hasPassword: Boolean(saved.passwordHash),
      },
    };
  });
}
