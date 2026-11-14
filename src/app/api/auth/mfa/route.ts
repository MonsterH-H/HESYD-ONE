import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth, verifyPassword } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { generateTotpSecret, otpauthUri } from "@/lib/totp";
import { encryptSecret, resolveSecret, verifyTotpStep } from "@/lib/crypto-vault";

const schema = z.object({
  action: z.enum(["setup", "enable", "disable"]),
  code: z.string().min(6).max(6).optional(),
  password: z.string().min(1).max(72).optional(),
});

/**
 * MFA TOTP réelle (RFC 6238) — setup génère un secret (jamais activé tant
 * qu'un code valide n'a pas été fourni), enable le confirme puis le stocke
 * chiffré au repos (« v1:iv:tag:cipher », AES-256-GCM), disable exige mot de
 * passe + code. Comparaison des codes en temps constant et garde anti-rejeu
 * persistée : un pas de temps déjà consommé (User.mfaLastUsedStep) est
 * refusé. Les anciens secrets stockés en clair restent lisibles (compatibilité)
 * et sont re-chiffrés à la première occasion.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    const user = await db.user.findUnique({ where: { id: auth.user.id } });
    if (!user) throw new Error("utilisateur_introuvable");

    if (body.data.action === "setup") {
      if (user.mfaEnabled) throw new Error("mfa_deja_active");
      const secret = generateTotpSecret();
      // Stocké non activé : tant qu'aucun code valide n'est fourni, la connexion
      // reste en une étape. Le secret est chiffré au repos dès la génération —
      // jamais en clair en base (audit P1).
      await db.user.update({
        where: { id: user.id },
        data: { mfaSecret: encryptSecret(secret), mfaEnabled: false, mfaLastUsedStep: null },
      });
      return {
        ok: true,
        secret,
        otpauth: otpauthUri(secret, user.email),
        instructions: "Ajoutez cette clé dans votre application d'authentification (Google Authenticator, Aegis, 1Password…), puis confirmez avec le code à 6 chiffres.",
      };
    }

    if (body.data.action === "enable") {
      if (!user.mfaSecret) throw new Error("setup_requis");
      const secret = resolveSecret(user.mfaSecret);
      // Vérification du code en temps constant, avec le pas accepté retenu.
      const step = verifyTotpStep(secret, body.data.code ?? "");
      if (step === null) throw new Error("code_mfa_invalide");
      if (user.mfaLastUsedStep !== null && step <= user.mfaLastUsedStep) throw new Error("code_mfa_deja_utilise");
      await db.user.update({
        where: { id: user.id },
        data: { mfaEnabled: true, mfaSecret: encryptSecret(secret), mfaLastUsedStep: step },
      });
      return { ok: true, mfaEnabled: true };
    }

    // disable
    if (!body.data.password || !user.passwordHash || !verifyPassword(body.data.password, user.passwordHash)) {
      throw new Error("mot_de_passe_invalide");
    }
    if (!user.mfaEnabled) throw new Error("mfa_non_active");
    if (!user.mfaSecret) throw new Error("code_mfa_invalide");
    const secret = resolveSecret(user.mfaSecret);
    const step = verifyTotpStep(secret, body.data.code ?? "");
    if (step === null) throw new Error("code_mfa_invalide");
    if (user.mfaLastUsedStep !== null && step <= user.mfaLastUsedStep) throw new Error("code_mfa_deja_utilise");
    // Désactivation : secret et garde anti-rejeu effacés — le re-chiffrement
    // de l'ancien format est ici sans objet (la valeur est supprimée).
    await db.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null, mfaLastUsedStep: null } });
    return { ok: true, mfaEnabled: false };
  });
}
