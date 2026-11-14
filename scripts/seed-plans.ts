import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** Catalogue d'offres — valeurs administrables (A_CONFIRMER A5), jamais codées en dur dans les pages. */
async function main() {
  await db.plan.upsert({
    where: { code: "TRIAL" },
    create: {
      code: "TRIAL",
      name: "Essai 14 jours",
      priceMonthlyCents: 0,
      maxUsers: 3,
      maxClients: 10,
      maxGroups: 20,
      monthlyDocuments: 200,
      monthlyCredits: 500,
      maxAutomations: 3,
      minIntervalMinutes: 60,
      groupCollection: false,
      dedicatedNumber: false,
    },
    update: {},
  });
  await db.plan.upsert({
    where: { code: "STANDARD" },
    create: {
      code: "STANDARD",
      name: "Standard",
      priceMonthlyCents: 8900,
      maxUsers: 10,
      maxClients: 50,
      maxGroups: 100,
      monthlyDocuments: 1500,
      monthlyCredits: 3000,
      maxAutomations: 10,
      minIntervalMinutes: 15,
      groupCollection: false,
      dedicatedNumber: false,
    },
    update: {},
  });
  await db.plan.upsert({
    where: { code: "ENTREPRISE" },
    create: {
      code: "ENTREPRISE",
      name: "Entreprise",
      priceMonthlyCents: 29000,
      maxUsers: 50,
      maxClients: 500,
      maxGroups: 1000,
      monthlyDocuments: 10000,
      monthlyCredits: 20000,
      maxAutomations: 50,
      minIntervalMinutes: 5,
      groupCollection: true,
      dedicatedNumber: true,
    },
    update: {},
  });
  console.log("Plans crees : TRIAL / STANDARD / ENTREPRISE");
}

main().finally(() => db.$disconnect());
