import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  token: z.string().min(10),
  name: z.string().min(2).max(80),
  password: z.string().min(8).max(72),
});

/** Acceptation d'invitation réelle : compte créé + membership. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    const invite = await db.invite.findUnique({ where: { token: body.data.token } });
    // Seule une invitation EN_ATTENTE et non expirée est valide — les statuts ACCEPTEE,
    // EXPIREE et REVOQUEE (révocation par un administrateur) refusent le jeton.
    if (!invite || invite.status !== "EN_ATTENTE" || invite.expiresAt < new Date()) throw new Error("invitation_invalide_ou_expirée");

    const email = invite.email;
    let user = await db.user.findUnique({ where: { email } });
    if (!user) {
      user = await db.user.create({ data: { email, name: body.data.name.trim(), passwordHash: hashPassword(body.data.password) } });
    }
    const already = await db.membership.findFirst({ where: { organizationId: invite.organizationId, userId: user.id } });
    if (!already) {
      await db.membership.create({ data: { organizationId: invite.organizationId, userId: user.id, role: invite.role } });
    }
    await db.invite.update({ where: { id: invite.id }, data: { status: "ACCEPTEE" } });
    await logAudit({ organizationId: invite.organizationId, userId: user.id, action: "INVITATION_ACCEPTEE", entityType: "User", entityId: user.id });
    await createSession(user.id);
    return { ok: true };
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const { token } = await ctx.params;
    const invite = await db.invite.findUnique({ where: { token } });
    // Idem POST : ACCEPTEE, EXPIREE et REVOQUEE refusent le jeton — seule EN_ATTENTE passe.
    if (!invite || invite.status !== "EN_ATTENTE" || invite.expiresAt < new Date()) throw new Error("invitation_invalide_ou_expirée");
    const org = await db.organization.findUnique({ where: { id: invite.organizationId } });
    return { email: invite.email, role: invite.role, organization: org?.name, expiresAt: invite.expiresAt };
  });
}
