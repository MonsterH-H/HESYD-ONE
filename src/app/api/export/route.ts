import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { NextResponse } from "next/server";

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.join(";"), ...rows.map((r) => r.map(csvEscape).join(";"))];
  // BOM UTF-8 : ouverture correcte dans Excel
  return "\uFEFF" + lines.join("\r\n");
}

/**
 * Export complet (CDC §9.8) — CSV réels, générés à la demande depuis les
 * registres de l'organisation uniquement. Propriétaire ou administrateur.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const entity = new URL(req.url).searchParams.get("entity") ?? "referentiel";
    const orgId = auth.organization.id;
    const stamp = new Date().toISOString().slice(0, 10);

    let csv = "";
    let filename = "";

    if (entity === "referentiel") {
      const clients = await db.client.findMany({ where: { organizationId: orgId }, include: { groups: true }, orderBy: { code: "asc" } });
      csv = toCsv(
        ["code_client", "nom_client", "contact", "statut", "code_groupe", "nom_groupe", "type_source", "statut_groupe"],
        clients.flatMap((c) =>
          c.groups.length
            ? c.groups.map((g) => [c.code, c.name, c.contact ?? "", c.status, g.code, g.name, g.sourceType, g.status])
            : [[c.code, c.name, c.contact ?? "", c.status, "", "", "", ""]]
        )
      );
      filename = `referentiel_${stamp}.csv`;
    } else if (entity === "documents") {
      const files = await db.file.findMany({ where: { organizationId: orgId }, include: { client: true, group: true }, orderBy: { createdAt: "desc" } });
      csv = toCsv(
        ["nom_original", "categorie", "type_detecte", "client", "groupe", "source", "statut", "taille_octets", "sha256", "chemin_archive", "recu_le"],
        files.map((f) => [f.originalFilename, f.category, f.detectedType ?? "", f.client?.name ?? "", f.group?.name ?? "", f.source, f.status, f.sizeBytes, f.sha256.slice(0, 16), f.archivedPath ?? "", f.receivedAt?.toISOString() ?? ""])
      );
      filename = `documents_${stamp}.csv`;
    } else if (entity === "receptions") {
      const receptions = await db.fileReception.findMany({ where: { organizationId: orgId }, orderBy: { receivedAt: "desc" } });
      csv = toCsv(
        ["recue_le", "source", "statut", "expediteur", "legende", "fichier_id"],
        receptions.map((r) => [r.receivedAt.toISOString(), r.source, r.status, r.senderId ?? "", r.caption ?? "", r.fileId ?? ""])
      );
      filename = `receptions_${stamp}.csv`;
    } else if (entity === "livrables") {
      const deliverables = await db.deliverable.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" } });
      csv = toCsv(
        ["titre", "type", "version", "statut", "taille_octets", "cree_le", "controle_qualite"],
        deliverables.map((d) => [d.title, d.type, d.version, d.status, d.sizeBytes, d.createdAt.toISOString(), d.qualityCheck ?? ""])
      );
      filename = `livrables_${stamp}.csv`;
    } else {
      throw new Error("entite_inconnue");
    }

    await logAudit({ organizationId: orgId, userId: auth.user.id, action: "EXPORT_CSV", entityType: entity, after: { taille: csv.length } });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}
