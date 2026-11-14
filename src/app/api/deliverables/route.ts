import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle, readJson } from "@/lib/api";
import { safeJsonParse } from "@/lib/helpers";
import { createDeliverable } from "@/lib/deliverables/generate";
import { signLink } from "@/lib/signed-links";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export async function GET() {
  return handle(async () => {
    const auth = await requireAuth();
    const deliverables = await db.deliverable.findMany({
      where: { organizationId: auth.organization.id },
      orderBy: { createdAt: "desc" },
      take: 60,
    });
    return {
      deliverables: await Promise.all(
        deliverables.map(async (d) => {
          const link = await signLink("deliverable", d.id, auth.organization.id, 24 * 3600 * 1000);
          return {
            ...d,
            sources: safeJsonParse<{ label: string; fileRef?: string }[]>(d.sourcesJson, []),
            sourcesJson: undefined,
            downloadUrl: `${d.id}/download?exp=${link.exp}&sig=${link.sig}`,
            linkExpiresAt: new Date(link.exp),
          };
        })
      ),
    };
  });
}

const sectionSchema = z.object({
  heading: z.string().max(120).optional(),
  paragraphs: z.array(z.string().max(2000)).max(12).optional(),
  bullets: z.array(z.string().max(500)).max(20).optional(),
  table: z
    .object({
      headers: z.array(z.string().max(60)).min(1).max(8),
      rows: z.array(z.array(z.string().max(120)).max(8)).max(40),
    })
    .optional(),
});

const createSchema = z.object({
  type: z.enum(["PDF", "XLSX", "DOCX"]),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(200).optional(),
  sections: z.array(sectionSchema).min(1).max(8),
  sourceFileIds: z.array(z.string().max(64)).max(20).optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR", "EMPLOYE"].includes(auth.role)) throw new Error("forbidden");
    const body = createSchema.safeParse(await readJson<unknown>(req));
    if (!body.success) throw new Error("donnees_incompletes");
    const d = body.data;

    // Sources réelles : seuls des documents du registre de l'organisation peuvent être cités
    const sources: { label: string; fileRef?: string }[] = [];
    for (const fid of d.sourceFileIds ?? []) {
      const file = await db.file.findFirst({ where: { id: fid, organizationId: auth.organization.id }, include: { client: true } });
      if (file) sources.push({ label: `${file.originalFilename}${file.client ? ` — ${file.client.name}` : ""}`, fileRef: file.id });
    }

    const result = await createDeliverable({
      organizationId: auth.organization.id,
      orgSlug: auth.organization.slug,
      type: d.type,
      userId: auth.user.id,
      content: {
        title: d.title,
        subtitle: d.subtitle,
        sections: d.sections,
        sources,
      },
    });
    // Journal d'audit (audit §2 — génération de livrable + consommation de crédits)
    await logAudit({
      organizationId: auth.organization.id,
      userId: auth.user.id,
      action: "LIVRABLE_GENERE",
      entityType: "Deliverable",
      entityId: result.id,
      after: { type: d.type, title: d.title, version: result.version, sizeBytes: result.sizeBytes, sources: sources.length },
    });
    return result;
  });
}
