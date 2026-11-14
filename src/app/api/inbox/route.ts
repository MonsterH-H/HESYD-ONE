import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";

/** File « À traiter » : motifs réels issus des données, jamais déclarés. */
export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    const orgId = auth.organization.id;

    const [aVerifier, receptionsErreur, faibleConfiance, nonClasses] = await Promise.all([
      db.file.findMany({
        where: { organizationId: orgId, status: "A_VERIFIER" },
        include: { client: true, group: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.fileReception.findMany({
        where: { organizationId: orgId, status: { in: ["ERREUR_REPRENABLE", "ERREUR_DEFINITIVE"] } },
        orderBy: { receivedAt: "desc" },
        take: 50,
      }),
      db.file.findMany({
        where: { organizationId: orgId, detectedTypeConfidence: { lt: 0.6 }, status: { not: "EN_VALIDATION" } },
        include: { client: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      db.file.findMany({
        where: { organizationId: orgId, category: "NON_CLASSES", status: { in: ["PRET_A_ARCHIVER", "ARCHIVE"] } },
        include: { client: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);

    return {
      motif1_verifications: aVerifier.map((f) => ({ ...f, motif: "verification_requise" })),
      motif2_receptions: receptionsErreur.map((r) => ({ ...r, motif: "reprise_possible" })),
      motif3_faibleConfiance: faibleConfiance.map((f) => ({ ...f, motif: "confiance_classification_faible" })),
      motif4_nonClasses: nonClasses.map((f) => ({ ...f, motif: "classification_absente" })),
      total:
        aVerifier.length + receptionsErreur.length + faibleConfiance.length + nonClasses.length,
    };
  });
}
