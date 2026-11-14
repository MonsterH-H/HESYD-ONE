import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { retryReception } from "@/lib/pipeline/ingest";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const schema = z.object({ receptionId: z.string().min(1) });

/** Reprise réelle d'une réception en erreur, à partir de la matière première conservée. */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR", "EMPLOYE"].includes(auth.role)) throw new Error("forbidden");
    const body = schema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    const result = await retryReception(body.data.receptionId, auth.organization.id);
    await logAudit({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: "REPRISE_RECEPTION",
      entityType: "FileReception",
      entityId: body.data.receptionId,
      after: { status: result.status, proof: result.proof },
    });
    return result;
  });
}
