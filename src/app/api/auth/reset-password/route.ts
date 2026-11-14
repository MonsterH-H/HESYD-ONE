import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, sha256Hex } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { consumeAuthToken } from "@/lib/auth-tokens";

const schema = z.object({ token: z.string().min(1), password: z.string().min(8).max(72) });

/**
 * Réinitialisation réelle : token à usage unique (≤ 1 h), nouveau hash
 * scrypt, et révocation de TOUTES les sessions existantes du compte.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");

    const userId = await consumeAuthToken(body.data.token, "REINITIALISATION_MDP");
    if (!userId) throw new Error("lien_invalide_ou_expire");

    await db.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(body.data.password) } });
    await db.session.deleteMany({ where: { userId } }); // révocation totale des sessions
    return { ok: true, message: "Mot de passe réinitialisé. Toutes les sessions ouvertes ont été fermées ; reconnectez-vous." };
  });
}
