import { z } from "zod";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { consumeAuthToken } from "@/lib/auth-tokens";
import { encryptSecret, resolveSecret, verifyTotpStep, VAULT_PREFIX } from "@/lib/crypto-vault";
import { lockRemaining, registerFailure, clearFailures, clientIp } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

const schema = z.object({ email: z.string().email(), mfaToken: z.string().min(1), code: z.string().min(6).max(6) });

/**
 * Deuxième étape de connexion : code TOTP à 6 chiffres (CDC §4).
 * Comparaison en temps constant et garde anti-rejeu (audit P1) : un pas de
 * temps déjà consommé (User.mfaLastUsedStep) est refusé ; l'ancien secret
 * stocké en clair est re-chiffré au repos à la première connexion réussie.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    const email = body.data.email.toLowerCase().trim();
    const ip = clientIp(req);

    const remaining = await lockRemaining(email, ip);
    if (remaining > 0) {
      return Response.json({ error: "trop_de_tentatives", code: "trop_de_tentatives", retryAfterSeconds: remaining }, { status: 429 });
    }

    const userId = await consumeAuthToken(body.data.mfaToken, "CONNEXION_MFA");
    if (!userId) throw new Error("etape_mfa_expiree");
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.email.toLowerCase() !== email || !user.mfaSecret) throw new Error("etape_mfa_invalide");

    const secret = resolveSecret(user.mfaSecret);
    const step = verifyTotpStep(secret, body.data.code);
    if (step === null) {
      registerFailure(email, ip);
      throw new Error("code_mfa_invalide");
    }
    // Garde anti-rejeu : un pas déjà consommé (ou antérieur) est refusé.
    if (user.mfaLastUsedStep !== null && step <= user.mfaLastUsedStep) {
      registerFailure(email, ip);
      throw new Error("code_mfa_deja_utilise");
    }

    const data: { lastLoginAt: Date; mfaLastUsedStep: number; mfaSecret?: string } = {
      lastLoginAt: new Date(),
      mfaLastUsedStep: step,
    };
    // Compatibilité : un ancien secret en clair est re-chiffré au repos ici.
    if (!user.mfaSecret.startsWith(VAULT_PREFIX)) data.mfaSecret = encryptSecret(secret);

    clearFailures(email, ip);
    await db.user.update({ where: { id: user.id }, data });
    await createSession(user.id);
    // Journal d'audit (audit §2 — succès de connexion MFA tracé)
    await logAudit({ userId: user.id, action: "CONNEXION", entityType: "User", entityId: user.id, after: { ip, mfa: true } });
    return { ok: true, user: { id: user.id, name: user.name, email: user.email } };
  });
}
