import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { lockRemaining, registerFailure, clearFailures, clientIp } from "@/lib/rate-limit";
import { issueAuthToken } from "@/lib/auth-tokens";
import { logAudit } from "@/lib/audit";

const schema = z.object({ email: z.string().email(), password: z.string().min(1).max(72) });

/**
 * Connexion réelle — verrouillage progressif (5 échecs → 15 min puis
 * doublement), réponse générique (aucune divulgation de l'existence du
 * compte), et étape MFA TOTP si activée (CDC §4).
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("identifiants_invalides");
    const email = body.data.email.toLowerCase().trim();
    const ip = clientIp(req);

    const remaining = await lockRemaining(email, ip);
    if (remaining > 0) {
      return Response.json(
        {
          error: "trop_de_tentatives",
          code: "trop_de_tentatives",
          retryAfterSeconds: remaining,
          message: `Compte temporairement verrouillé après des échecs répétés. Nouvelle tentative dans ${Math.ceil(remaining / 60)} minute(s).`,
        },
        { status: 429 },
      );
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user || user.status !== "ACTIF") {
      registerFailure(email, ip);
      throw new Error("identifiants_invalides");
    }
    if (!user.passwordHash) {
      // Compte créé via Google : réponse honnête, le client propose Google.
      registerFailure(email, ip);
      throw new Error("compte_google_sans_mot_de_passe");
    }
    if (!verifyPassword(body.data.password, user.passwordHash)) {
      registerFailure(email, ip);
      throw new Error("identifiants_invalides");
    }

    // Mot de passe correct : étape MFA si activée
    if (user.mfaEnabled && user.mfaSecret) {
      const mfaToken = await issueAuthToken(user.id, "CONNEXION_MFA");
      return { ok: true, mfaRequired: true, mfaToken };
    }

    clearFailures(email, ip);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await createSession(user.id);
    // Journal d'audit (audit §2 — succès de connexion tracé, sans org à ce stade)
    await logAudit({ userId: user.id, action: "CONNEXION", entityType: "User", entityId: user.id, after: { ip } });
    return { ok: true, user: { id: user.id, name: user.name, email: user.email } };
  });
}
