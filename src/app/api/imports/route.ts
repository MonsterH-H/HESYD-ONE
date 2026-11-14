import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { handle } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import Papa from "papaparse";
import { NextResponse } from "next/server";

/**
 * Import réel CSV/XLSX du référentiel — deux phases (CDC §6.6 étapes 6-7) :
 * 1. `dryRun=true` : analyse SANS écriture, rapport ligne par ligne ;
 * 2. confirmation : mêmes données, écritures réelles + rapport définitif.
 * `GET?template=csv|xlsx` fournit le modèle téléchargeable.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const auth = await requireAuth();
    if (!["PROPRIETAIRE", "ADMINISTRATEUR"].includes(auth.role)) throw new Error("forbidden");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("fichier_absent");
    // Borne réelle de taille et de volumétrie (audit P3 — ExcelJS charge tout
    // en mémoire : un fichier importé ne doit pas pouvoir saturer le serveur).
    if (file.size > 10 * 1024 * 1024) throw new Error("fichier_trop_volumineux");
    const dryRun = String(form.get("dryRun") ?? "") === "true";

    let rows: Record<string, string>[] = [];
    if (file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv") {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      rows = parsed.data.slice(0, 5000); // plafond de lignes par import
    } else if (file.name.toLowerCase().endsWith(".xlsx")) {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      const headers: string[] = [];
      ws.getRow(1).eachCell((cell) => headers.push(String(cell.value ?? "").trim()));
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const obj: Record<string, string> = {};
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          obj[headers[col - 1] ?? `col${col}`] = String(cell.value ?? "").trim();
        });
        rows.push(obj);
      });
      // MINEURE-1 (audit) : même plafond de lignes que la branche CSV —
      // ExcelJS charge tout en mémoire, un classeur importé ne doit pas
      // pouvoir saturer le serveur.
      rows = rows.slice(0, 5000);
    } else {
      throw new Error("format_refuse_utiliser_csv_ou_xlsx");
    }

    // ————— Phase 1 : aperçu sans écriture (CDC §6.6) —————
    if (dryRun) {
      const preview: { line: number; code: string; nom: string; resultat: string; raison?: string }[] = [];
      let valides = 0;
      let rejetees = 0;
      let creations = 0;
      let existants = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const code = (r.code ?? r.Code ?? "").toUpperCase().trim().replace(/\s+/g, "_");
        const name = (r.nom ?? r.name ?? r.Nom ?? "").trim();
        const clientCode = (r.code_client ?? r.client_code ?? r.ClientCode ?? "").toUpperCase().trim().replace(/\s+/g, "_");
        const clientName = (r.nom_client ?? r.client_name ?? r.ClientName ?? "").trim();
        const groupName = (r.nom_groupe ?? r.group_name ?? r.Groupe ?? "").trim();
        const targetCode = code || clientCode;
        const display = name || clientName;
        if (!targetCode || !display) {
          rejetees++;
          preview.push({ line: i + 2, code: targetCode, nom: display, resultat: "REJETE", raison: "colonnes_requises_absentes" });
          continue;
        }
        const existing = await db.client.findUnique({ where: { organizationId_code: { organizationId: auth.organization.id, code: targetCode } } });
        if (existing) {
          existants++;
          preview.push({ line: i + 2, code: targetCode, nom: display, resultat: "EXISTANT", raison: groupName ? `groupe « ${groupName} » à lier` : "client déjà présent" });
        } else {
          creations++;
          preview.push({ line: i + 2, code: targetCode, nom: display, resultat: "CREATION", raison: groupName ? `avec groupe « ${groupName} »` : undefined });
        }
        valides++;
      }
      return {
        dryRun: true,
        fileName: file.name,
        totalRows: rows.length,
        valides,
        rejetees,
        creations,
        existants,
        preview: preview.slice(0, 300),
        message: "Aperçu sans écriture. Vérifiez le rapport puis confirmez l'import pour appliquer réellement.",
      };
    }

    // ————— Phase 2 : confirmation, écritures réelles —————
    const batch = await db.importBatch.create({
      data: {
        organizationId: auth.organization.id,
        kind: "CLIENTS_GROUPES",
        fileName: file.name,
        requestedById: auth.user.id,
        status: "TERMINE",
        totalRows: rows.length,
      },
    });

    let okRows = 0;
    let rejected = 0;
    const report: { line: number; result: string; reason?: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const code = (r.code ?? r.Code ?? "").toUpperCase().trim().replace(/\s+/g, "_");
      const name = (r.nom ?? r.name ?? r.Nom ?? "").trim();
      const clientCode = (r.code_client ?? r.client_code ?? r.ClientCode ?? "").toUpperCase().trim().replace(/\s+/g, "_");
      const clientName = (r.nom_client ?? r.client_name ?? r.ClientName ?? "").trim();
      const groupName = (r.nom_groupe ?? r.group_name ?? r.Groupe ?? "").trim();

      try {
        const targetCode = code || clientCode;
        if (!targetCode || !name) throw new Error("colonnes_requises_absentes");
        let client = await db.client.findUnique({ where: { organizationId_code: { organizationId: auth.organization.id, code: targetCode } } });
        if (!client) {
          client = await db.client.create({ data: { organizationId: auth.organization.id, code: targetCode, name } });
        }
        if (groupName) {
          const groupCode = (r.code_groupe ?? r.group_code ?? `${targetCode}_G${i + 1}`).toUpperCase().trim().replace(/\s+/g, "_");
          const existingGroup = await db.waGroup.findFirst({ where: { organizationId: auth.organization.id, code: groupCode } });
          if (!existingGroup) {
            await db.waGroup.create({
              data: {
                organizationId: auth.organization.id,
                clientId: client.id,
                code: groupCode,
                name: groupName,
                sourceType: (r.source ?? "DEPOT_WEB").toUpperCase() === "WHATSAPP_DIRECT" ? "WHATSAPP_DIRECT" : "DEPOT_WEB",
                collectionStatus: "A_CONFIGURER",
              },
            });
          }
        }
        okRows++;
        await db.importRow.create({ data: { batchId: batch.id, lineNo: i + 2, valuesJson: JSON.stringify(r), result: "CREE" } });
        report.push({ line: i + 2, result: "CREE" });
      } catch (e) {
        rejected++;
        const reason = e instanceof Error ? e.message : "erreur";
        await db.importRow.create({ data: { batchId: batch.id, lineNo: i + 2, valuesJson: JSON.stringify(r), result: "REJETE", reason } });
        report.push({ line: i + 2, result: "REJETE", reason });
      }
    }

    await db.importBatch.update({ where: { id: batch.id }, data: { okRows, rejectedRows: rejected } });
    await logAudit({ organizationId: auth.organization.id, userId: auth.user.id, action: "IMPORT_REFERENTIEL", entityType: "ImportBatch", entityId: batch.id, after: { okRows, rejected } });
    return { batchId: batch.id, totalRows: rows.length, okRows, rejected, report: report.slice(0, 200) };
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const template = url.searchParams.get("template");
  if (template === "csv" || template === "xlsx") {
    // Modèle téléchargeable : authentifié comme le reste de la route
    // (audit P3 — cohérence des gardes ; contenu statique mais cohérence).
    try {
      await requireAuth();
    } catch {
      return NextResponse.json({ error: "auth_required" }, { status: 401 });
    }
  }
  if (template === "csv") {
    const csv = "\uFEFFcode;nom;contact;code_groupe;nom_groupe;source\nDEMOCLI;Client démo;contact@demo.fr;DEMOGROUPE;Dépôt démo;DEPOT_WEB\n";
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="modele_import_referentiel.csv"' },
    });
  }
  if (template === "xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Référentiel");
    ws.columns = [
      { header: "code", key: "code", width: 18 },
      { header: "nom", key: "nom", width: 34 },
      { header: "contact", key: "contact", width: 26 },
      { header: "code_groupe", key: "code_groupe", width: 18 },
      { header: "nom_groupe", key: "nom_groupe", width: 26 },
      { header: "source", key: "source", width: 16 },
    ];
    ws.addRow({ code: "DEMOCLI", nom: "Client démo", contact: "contact@demo.fr", code_groupe: "DEMOGROUPE", nom_groupe: "Dépôt démo", source: "DEPOT_WEB" });
    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="modele_import_referentiel.xlsx"' },
    });
  }
  return handle(async () => {
    const auth = await requireAuth();
    const batches = await db.importBatch.findMany({ where: { organizationId: auth.organization.id }, orderBy: { createdAt: "desc" }, take: 20, include: { rows: { take: 100 } } });
    return { batches };
  });
}
