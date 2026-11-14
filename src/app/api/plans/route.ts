import { db } from "@/lib/db";
import { handle } from "@/lib/api";

/**
 * Offres publiques — route SANS authentification : seules les données PUBLIQUES
 * des plans actifs sont exposées (code, nom, prix, jauges contractuelles).
 * Alimente la page d'accueil : les prix affichés sont réels et jamais codés en
 * dur côté client. Aucune donnée d'organisation ni de secret ici.
 */
export async function GET() {
  return handle(async () => {
    const plans = await db.plan.findMany({
      where: { active: true },
      orderBy: { priceMonthlyCents: "asc" },
      select: {
        code: true,
        name: true,
        priceMonthlyCents: true,
        currency: true,
        maxUsers: true,
        monthlyDocuments: true,
        monthlyCredits: true,
      },
    });
    return { plans };
  });
}
