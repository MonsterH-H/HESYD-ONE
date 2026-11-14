import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { signLink } from "@/lib/signed-links";
import { readInvoiceFile } from "@/lib/deliverables/generate";
import { verifyLink } from "@/lib/signed-links";
import { NextResponse } from "next/server";

/** Liste des factures et attestations de l'organisation. */
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    const url = new URL(req.url);
    const downloadId = url.searchParams.get("download");

    if (downloadId) {
      // Téléchargement d'une facture/attestation (lien signé à expiration)
      const exp = Number(url.searchParams.get("exp"));
      const sig = url.searchParams.get("sig") ?? "";
      const invoice = await db.invoice.findFirst({ where: { id: downloadId, organizationId: auth.organization.id } });
      if (!invoice) throw new Error("facture_introuvable");
      if (!invoice.filePath) throw new Error("fichier_absent");
      const valid = await verifyLink("invoice", invoice.id, auth.organization.id, exp, sig);
      if (!valid) throw new Error("lien_expire_ou_invalide");
      // Lecteur sûr dédié aux factures/attestations : racine stricte storage/invoices
      // + vérification que le fichier appartient bien à cette organisation.
      const data = await readInvoiceFile(auth.organization.id, invoice.filePath);
      return new NextResponse(new Uint8Array(data), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${invoice.number}.pdf"`,
          "Content-Length": String(data.length),
        },
      });
    }

    const invoices = await db.invoice.findMany({
      where: { organizationId: auth.organization.id },
      orderBy: { issuedAt: "desc" },
      take: 50,
    });
    return {
      invoices: await Promise.all(
        invoices.map(async (i) => ({
          id: i.id,
          number: i.number,
          kind: i.kind,
          label: i.label,
          amountCents: i.amountCents,
          currency: i.currency,
          status: i.status,
          issuedAt: i.issuedAt,
          hasFile: Boolean(i.filePath),
          downloadUrl: i.filePath
            ? `/api/subscription/attestation?download=${i.id}&${new URLSearchParams(await toQuery(i.id, auth.organization.id)).toString()}`
            : null,
        }))
      ),
    };
  });
}

async function toQuery(invoiceId: string, organizationId: string): Promise<Record<string, string>> {
  const link = await signLink("invoice", invoiceId, organizationId, 24 * 3600 * 1000);
  return { exp: String(link.exp), sig: link.sig };
}
