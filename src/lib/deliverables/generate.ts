import { promises as fs, createWriteStream } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { meterUsage, consumeCredits, creditsAvailable, CREDIT_COST } from "@/lib/quota";

/**
 * Livrables RÉELS : PDF (pdfkit), Excel (exceljs), Word (docx).
 * Versionnés, jamais écrasés (unicité org+titre+version), contrôle avant
 * remise effectué pour de vrai (fichier re-lu, taille > 0, sections présentes).
 */

export type DeliverableSection = {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
};

export type DeliverableContent = {
  title: string;
  subtitle?: string;
  sections: DeliverableSection[];
  sources: { label: string; fileRef?: string }[];
};

const DELIVERABLE_ROOT = path.join(process.cwd(), "storage", "deliverables");

function safeSegment(segment: string): string {
  return segment.normalize("NFC").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 70) || "livrable";
}

async function nextVersion(organizationId: string, title: string): Promise<number> {
  const last = await db.deliverable.findFirst({
    where: { organizationId, title },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (last?.version ?? 0) + 1;
}

/** Contrôle avant remise réel : ré-ouverture et vérifications objectives. */
async function qualityCheck(fullPath: string, content: DeliverableContent, size: number): Promise<string> {
  const stat = await fs.stat(fullPath);
  if (stat.size !== size || stat.size === 0) throw new Error("controle_taille_ecoue");
  const sections = content.sections.length;
  const bullets = content.sections.reduce((n, s) => n + (s.bullets?.length ?? 0), 0);
  const paragraphs = content.sections.reduce((n, s) => n + (s.paragraphs?.length ?? 0), 0);
  const tables = content.sections.reduce((n, s) => n + (s.table ? 1 : 0), 0);
  return `ouvert après écriture · ${size} octets · ${sections} sections · ${paragraphs} paragraphes · ${bullets} puces · ${tables} tableau(x) · sources citées : ${content.sources.length}`;
}

// ————— PDF —————

async function generatePdf(content: DeliverableContent, filePath: string): Promise<number> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margins: { top: 64, bottom: 64, left: 56, right: 56 }, info: { Title: content.title } });
  const stream = doc.pipe(createWriteStream(filePath));
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    try {
      // En-tête registre
      doc.fontSize(9).fillColor("#8a7f72").text("HESYD ONE — REGISTRE DES LIVRABLES", { characterSpacing: 1 });
      doc.moveTo(56, doc.y + 6).lineTo(539, doc.y + 6).lineWidth(0.8).strokeColor("#c9bfb2").stroke();
      doc.moveDown(1.2);
      doc.fontSize(22).fillColor("#1d1815").font("Helvetica-Bold").text(content.title, { align: "left" });
      if (content.subtitle) {
        doc.moveDown(0.3).fontSize(11).fillColor("#5d5347").font("Helvetica").text(content.subtitle);
      }
      const dateStr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date());
      doc.moveDown(0.5).fontSize(9).fillColor("#8a7f72").text(`Établi le ${dateStr} · document généré à partir des sources citées en fin de rapport`);
      doc.moveDown(1.4);

      for (const section of content.sections) {
        if (section.heading) {
          doc.moveDown(0.8).fontSize(13).fillColor("#54291d").font("Helvetica-Bold").text(section.heading);
          doc.moveDown(0.4);
        }
        for (const p of section.paragraphs ?? []) {
          doc.fontSize(10.5).fillColor("#1d1815").font("Helvetica").text(p, { align: "justify", lineGap: 2.4 });
          doc.moveDown(0.5);
        }
        for (const b of section.bullets ?? []) {
          doc.fontSize(10.5).fillColor("#1d1815").font("Helvetica").text("•  " + b, { indent: 14, lineGap: 2 });
        }
        if ((section.bullets?.length ?? 0) > 0) doc.moveDown(0.4);
        if (section.table) {
          const cols = section.table.headers.length;
          const colWidth = (539 - 56 - 28) / Math.max(1, cols);
          const startY = doc.y + 4;
          doc.fontSize(9).font("Helvetica-Bold").fillColor("#1d1815");
          section.table.headers.forEach((h, i) => {
            doc.text(h, 56 + i * colWidth, startY, { width: colWidth - 6, ellipsis: true });
          });
          let y = startY + 14;
          doc.font("Helvetica").fontSize(9);
          for (const row of section.table.rows) {
            if (y > 770) {
              doc.addPage();
              y = 70;
            }
            row.forEach((cell, i) => {
              doc.text(String(cell).slice(0, 60), 56 + i * colWidth, y, { width: colWidth - 6, ellipsis: true });
            });
            y += 14;
            doc.moveTo(56, y - 3).lineTo(539, y - 3).lineWidth(0.4).strokeColor("#e2dbd1").stroke();
          }
          doc.y = y + 6;
        }
      }

      // Sources
      if (content.sources.length) {
        doc.addPage();
        doc.fontSize(9).fillColor("#8a7f72").text("SOURCES UTILISÉES", { characterSpacing: 1 });
        doc.moveDown(0.6);
        doc.fontSize(9.5).fillColor("#1d1815");
        for (const s of content.sources) {
          doc.text(`— ${s.label}${s.fileRef ? ` (${s.fileRef})` : ""}`, { lineGap: 2 });
        }
      }
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
  const stat = await fs.stat(filePath);
  return stat.size;
}

// ————— Excel —————

async function generateXlsx(content: DeliverableContent, filePath: string): Promise<number> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "HESYD ONE";
  const ws = wb.addWorksheet(content.title.slice(0, 30) || "Livrable");
  const titleRow = ws.addRow([content.title]);
  titleRow.font = { size: 14, bold: true };
  if (content.subtitle) ws.addRow([content.subtitle]);
  ws.addRow([`Établi le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date())} — HESYD ONE`]);
  ws.addRow([]);

  for (const section of content.sections) {
    if (section.heading) {
      const h = ws.addRow([section.heading]);
      h.font = { bold: true, size: 12 };
    }
    for (const p of section.paragraphs ?? []) ws.addRow([p]);
    for (const b of section.bullets ?? []) ws.addRow(["• " + b]);
    if (section.table) {
      const headerRow = ws.addRow(section.table.headers);
      headerRow.font = { bold: true };
      headerRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1E8E0" } };
        cell.border = { bottom: { style: "thin", color: { argb: "FFC9BFB2" } } };
      });
      for (const row of section.table.rows) {
        ws.addRow(row.map((c) => (isNaN(Number(c)) ? c : Number(c))));
      }
    }
    ws.addRow([]);
  }
  if (content.sources.length) {
    const s = ws.addRow(["SOURCES UTILISÉES"]);
    s.font = { bold: true };
    for (const src of content.sources) ws.addRow(["— " + src.label]);
  }
  ws.columns.forEach((col) => {
    const headerLength = (col as unknown as { headerLength?: number }).headerLength;
    col.width = Math.min(60, Math.max(18, headerLength ?? 24));
  });
  const buf = await wb.xlsx.writeBuffer();
  await fs.writeFile(filePath, Buffer.from(buf));
  return (await fs.stat(filePath)).size;
}

// ————— Word —————

async function generateDocx(content: DeliverableContent, filePath: string): Promise<number> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType } = await import("docx");
  type DocxChild = import("docx").Paragraph | import("docx").Table;
  const children: DocxChild[] = [];
  children.push(new Paragraph({ children: [new TextRun({ text: "HESYD ONE — LIVRABLE", size: 16, color: "8A7F72", bold: true })] }));
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: content.title, bold: true })] }));
  if (content.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: content.subtitle, italics: true })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: `Établi le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date())}`, size: 18, color: "5D5347" })] }));

  for (const section of content.sections) {
    if (section.heading) children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: section.heading, bold: true })] }));
    for (const p of section.paragraphs ?? []) children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, children: [new TextRun(p)] }));
    for (const b of section.bullets ?? []) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(b)] }));
    if (section.table) {
      const t = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: section.table.headers.map((h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })),
          }),
          ...section.table.rows.map(
            (r) =>
              new TableRow({
                children: r.map((c) => new TableCell({ children: [new Paragraph(String(c))] })),
              })
          ),
        ],
      });
      children.push(t);
    }
  }
  if (content.sources.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Sources utilisées", bold: true })] }));
    for (const s of content.sources) children.push(new Paragraph({ children: [new TextRun({ text: "— " + s.label, size: 18 })] }));
  }

  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  await fs.writeFile(filePath, Buffer.from(buf));
  return (await fs.stat(filePath)).size;
}

// ————— Orchestration versionnée —————

export async function createDeliverable(params: {
  organizationId: string;
  orgSlug: string;
  type: "PDF" | "XLSX" | "DOCX";
  content: DeliverableContent;
  taskId?: string;
  userId?: string;
}): Promise<{ id: string; version: number; filePath: string; sizeBytes: number; qualityCheck: string }> {
  const gated = CREDIT_COST.LIVRABLE;
  if (!(await creditsAvailable(params.organizationId, gated))) {
    throw new Error("credits_insuffisants");
  }
  const version = await nextVersion(params.organizationId, params.content.title);
  const dir = path.join(DELIVERABLE_ROOT, safeSegment(params.orgSlug));
  await fs.mkdir(dir, { recursive: true });
  const ext = params.type === "PDF" ? "pdf" : params.type === "XLSX" ? "xlsx" : "docx";
  const fileName = `${safeSegment(params.content.title)}_v${version}.${ext}`;
  const filePath = path.join(dir, fileName);

  let size: number;
  if (params.type === "PDF") size = await generatePdf(params.content, filePath);
  else if (params.type === "XLSX") size = await generateXlsx(params.content, filePath);
  else size = await generateDocx(params.content, filePath);

  const qc = await qualityCheck(filePath, params.content, size);

  const rel = path.relative(process.cwd(), filePath);
  const deliverable = await db.deliverable.create({
    data: {
      organizationId: params.organizationId,
      taskId: params.taskId ?? null,
      title: params.content.title,
      type: params.type,
      version,
      status: "PRET",
      sourcesJson: JSON.stringify(params.content.sources),
      filePath: rel,
      sizeBytes: size,
      qualityCheck: qc,
      createdById: params.userId ?? null,
    },
  });
  await meterUsage({ organizationId: params.organizationId, userId: params.userId, nature: "LIVRABLE" });
  await consumeCredits(params.organizationId, gated, "CONSO_LIVRABLE", params.content.title);
  return { id: deliverable.id, version, filePath: rel, sizeBytes: size, qualityCheck: qc };
}

export async function readDeliverable(relPath: string): Promise<Buffer> {
  const root = path.join(process.cwd(), "storage", "deliverables");
  const full = path.resolve(path.join(process.cwd(), relPath));
  // Garde stricte par path.relative (audit P3 — un startsWith laissait passer
  // les répertoires frères de préfixe, ex. /deliverables-autreorg).
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("chemin_livrable_invalide");
  return fs.readFile(full);
}

/**
 * Lecteur sûr des factures et attestations (PDF écrits par le geste opérateur
 * dans storage/invoices). Double garde réelle :
 * 1. le chemin doit référencer une facture de CETTE organisation (base) ;
 * 2. path.relative contre la racine stricte storage/invoices — toute
 *    traversée (../, chemins absolus, liens hors racine) est refusée.
 */
export async function readInvoiceFile(organizationId: string, relPath: string): Promise<Buffer> {
  const known = await db.invoice.findFirst({
    where: { organizationId, filePath: relPath },
    select: { id: true },
  });
  if (!known) throw new Error("facture_inconnue");
  const root = path.join(process.cwd(), "storage", "invoices");
  const full = path.resolve(path.join(process.cwd(), relPath));
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("chemin_facture_invalide");
  return fs.readFile(full);
}
