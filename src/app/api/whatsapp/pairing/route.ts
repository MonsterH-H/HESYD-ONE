import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { createPairing } from "@/lib/whatsapp-pairing";
import { logAudit } from "@/lib/audit";

/** Liste des appairages WhatsApp de l'organisation (états réels).
 *  MAJEURE-1a (audit) : le code EN_ATTENTE n'est retourné qu'aux rôles en
 *  écriture (PROPRIETAIRE, ADMINISTRATEUR, EMPLOYE — même garde que POST).
 *  Un LECTEUR ne doit jamais lire un code d'appairage : il pourrait l'envoyer
 *  depuis son propre numéro et activer l'appairage à la place du créateur.
 *  Les autres champs de la ligne restent visibles (code: null). */
export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    const codeVisible = ["PROPRIETAIRE", "ADMINISTRATEUR", "EMPLOYE"].includes(auth.role);
    const pairings = await db.whatsappPairing.findMany({
      where: { organizationId: auth.organization.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const userIds = [...new Set(pairings.map((p) => p.userId))];
    const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const names = new Map(users.map((u) => [u.id, u.name]));
    // Expiration paresseuse honnête : les codes dépassés sont marqués
    const now = new Date();
    const visible = pairings.map((p) => {
      const effectiveStatus = p.status === "EN_ATTENTE" && p.expiresAt < now ? "EXPIRE" : p.status;
      return {
        id: p.id,
        code: codeVisible && p.status === "EN_ATTENTE" && p.expiresAt > now ? p.code : null,
        status: effectiveStatus,
        phone: p.status === "ACTIF" ? p.phone : null,
        expiresAt: p.expiresAt,
        pairedAt: p.pairedAt,
        createdAt: p.createdAt,
        createdBy: names.get(p.userId) ?? "—",
      };
    });
    return { pairings: visible, whatsappConfigured: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) };
  });
}

/** Génère un code d'appairage à usage unique valable 15 minutes (CDC §4.8). */
export async function POST() {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR", "EMPLOYE"].includes(auth.role)) throw new Error("forbidden");
    const pairing = await createPairing(auth.organization.id, auth.user.id);
    await logAudit({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: "APPARIEMENT_WHATSAPP_CREE",
      entityType: "WhatsappPairing",
      entityId: pairing.id,
      after: { expiresAt: pairing.expiresAt },
    });
    return {
      ...pairing,
      instructions:
        "Envoyez ce code depuis votre numéro WhatsApp au numéro de la plateforme. Votre numéro sera appairé à cet espace pendant la durée de vie de l'organisation. Le code expire dans 15 minutes et ne sert qu'une fois.",
    };
  });
}
