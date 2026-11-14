import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { readDeliverable } from "@/lib/deliverables/generate";
import { signLink, verifyLink } from "@/lib/signed-links";
import { getAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

/**
 * Téléchargement réel du livrable (CDC §7.6 : lien sécurisé à expiration).
 * Deux voies d'accès, toutes deux vérifiées :
 * 1. session authentifiée appartenant à l'organisation du livrable ;
 * 2. lien signé HMAC valide (exp + sig) — partage expirable au sein de
 *    l'organisation, sans session. Les liens expirent réellement.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig") ?? "";

    const deliverable = await db.deliverable.findFirst({ where: { id } });
    if (!deliverable) throw new Error("livrable_introuvable");

    let authorized = false;
    let userId: string | undefined;
    const auth = await getAuth();
    if (auth && auth.organization.id === deliverable.organizationId) {
      authorized = true;
      userId = auth.user.id;
    } else if (exp && sig) {
      authorized = await verifyLink("deliverable", id, deliverable.organizationId, exp, sig);
    }
    if (!authorized) throw new Error("acces_refuse");

    const data = await readDeliverable(deliverable.filePath);
    await logAudit({ organizationId: deliverable.organizationId, userId, action: "LIVRABLE_TELECHARGE", entityType: "Deliverable", entityId: id });
    const ext = deliverable.type === "PDF" ? "pdf" : deliverable.type === "XLSX" ? "xlsx" : "docx";
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": deliverable.type === "PDF" ? "application/pdf" : deliverable.type === "XLSX" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(deliverable.title.replace(/[^a-zA-Z0-9À-ÿ _-]/g, "_"))}_v${deliverable.version}.${ext}"`,
        "Content-Length": String(data.length),
      },
    });
  } catch (e) {
    const { apiError } = await import("@/lib/api");
    const msg = e instanceof Error ? e.message : "erreur";
    return apiError(msg, msg === "livrable_introuvable" ? 404 : 403);
  }
}

/** Génération d'un lien signé (utilisée par la liste et après création). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const auth = await requireAuth();
    const { id } = await ctx.params;
    const deliverable = await db.deliverable.findFirst({ where: { id, organizationId: auth.organization.id } });
    if (!deliverable) throw new Error("livrable_introuvable");
    const link = await signLink("deliverable", id, auth.organization.id, 24 * 3600 * 1000);
    return { downloadUrl: `/api/deliverables/${id}/download?exp=${link.exp}&sig=${link.sig}`, expiresAt: new Date(link.exp) };
  });
}
