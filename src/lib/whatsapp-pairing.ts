import { randomInt } from "crypto";
import { db } from "@/lib/db";

/**
 * Appairage WhatsApp par code à usage unique (CDC §4.8) — réel :
 * 1. l'utilisateur authentifié génère un code valable 15 minutes ;
 * 2. il l'envoie depuis son numéro WhatsApp au numéro de la plateforme ;
 * 3. le webhook appaire numéro → utilisateur → organisation ;
 * 4. seul un numéro appairé dialogue avec l'agent ; tout autre numéro
 *    reçoit une réponse d'accueil standard sans aucune donnée.
 */

const CODE_TTL_MS = 15 * 60 * 1000;

/** Code à 6 chiffres cryptographiquement imprévisible (audit P2 — Math.random interdit pour un secret). */
export function generatePairingCode(): string {
  return String(randomInt(100000, 1000000));
}

export async function createPairing(organizationId: string, userId: string): Promise<{ id: string; code: string; expiresAt: Date }> {
  // Un seul code EN_ATTENTE actif par organisation à la fois (le précédent expire)
  await db.whatsappPairing.updateMany({
    where: { organizationId, status: "EN_ATTENTE", expiresAt: { gt: new Date() } },
    data: { status: "EXPIRE" },
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generatePairingCode();
    // Unicité GLOBALE du code parmi les appairages vivants (toutes organisations) :
    // le webhook résout un code sans contexte d'organisation (audit P2 — ambiguïté inter-organisations).
    const live = await db.whatsappPairing.findFirst({
      where: { code, status: { in: ["EN_ATTENTE", "ACTIF"] }, expiresAt: { gt: new Date() } },
    });
    if (live) continue; // code déjà utilisé par une autre organisation : régénération
    try {
      const pairing = await db.whatsappPairing.create({
        data: { organizationId, userId, code, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
      });
      return { id: pairing.id, code: pairing.code, expiresAt: pairing.expiresAt };
    } catch {
      // collision de code : nouvelle tentative
    }
  }
  throw new Error("generation_code_impossible");
}

/** Tente l'appairage : le message contient-il un code EN_ATTENTE valide ?
 *  MAJEURE-1b (audit) : contrôle explicite AU MOMENT DE L'APPAIRAGE — le rôle
 *  du membership du créateur du code est revérifié ici, car il peut avoir été
 *  rétrogradé LECTEUR (ou perdu son membership) entre la génération du code et
 *  son envoi depuis un numéro. Ainsi un numéro détenu via un code de LECTEUR
 *  ne peut JAMAIS devenir ACTIF, donc jamais déclencher d'outils d'écriture.
 *  En cas de refus, aucun état n'est modifié (le numéro reste non appairé). */
const ROLES_APPAIRAGE_AUTORISES = ["PROPRIETAIRE", "ADMINISTRATEUR", "EMPLOYE"];

export async function tryPairByCode(text: string, phone: string): Promise<{ paired: boolean; organizationId?: string }> {
  const match = text.trim().match(/\b(\d{6})\b/);
  if (!match) return { paired: false };
  const code = match[1];
  const pairing = await db.whatsappPairing.findFirst({
    where: { code, status: "EN_ATTENTE", expiresAt: { gt: new Date() } },
  });
  if (!pairing) return { paired: false };
  const membership = await db.membership.findFirst({
    where: { organizationId: pairing.organizationId, userId: pairing.userId },
    select: { role: true },
  });
  if (!membership || !ROLES_APPAIRAGE_AUTORISES.includes(membership.role)) {
    return { paired: false };
  }
  // Un numéro ne peut être appairé qu'à une seule organisation à la fois
  await db.whatsappPairing.updateMany({ where: { phone, status: "ACTIF" }, data: { status: "REVOQUE" } });
  await db.whatsappPairing.update({
    where: { id: pairing.id },
    data: { status: "ACTIF", phone, pairedAt: new Date() },
  });
  return { paired: true, organizationId: pairing.organizationId };
}

export async function findActivePairingByPhone(phone: string) {
  return db.whatsappPairing.findFirst({
    where: { phone, status: "ACTIF" },
    orderBy: { pairedAt: "desc" },
  });
}

/**
 * Résolution UNIQUE du contexte d'exécution d'un numéro appairé (MAJEURE-1b,
 * audit) : le rôle transmis à l'agent est toujours relu depuis le membership
 * ACTUEL de l'utilisateur lié à l'appairage (détenteur du numéro via le code)
 * dans l'organisation de l'appairage — jamais déduit d'une autre source.
 * Sans membership actif, retour null : l'appelant n'exécute pas l'agent.
 * Si le rôle relu est LECTEUR, l'agent tourne en lecture seule : la garde des
 * outils d'écriture (runner.ts, outil MOYEN → refus) s'applique telle quelle
 * sur ce rôle — elle n'est ni contournée ni dupliquée ici.
 */
export async function resolvePairingRuntime(
  pairing: { userId: string; organizationId: string }
): Promise<{ userId: string; organizationId: string; role: string } | null> {
  const membership = await db.membership.findFirst({
    where: { organizationId: pairing.organizationId, userId: pairing.userId },
    select: { role: true },
  });
  if (!membership) return null;
  return { userId: pairing.userId, organizationId: pairing.organizationId, role: membership.role };
}
