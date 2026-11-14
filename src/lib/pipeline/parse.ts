import ZAI from "z-ai-web-dev-sdk";
import { isImage, isAudio } from "@/lib/helpers";
import { docAiConfigured, processDocument } from "@/lib/connectors/document-ai";

/**
 * Extraction de texte RÉELLE par type de fichier :
 * - PDF : pdf-parse (texte natif) ; PDF scanné (sans texte natif) → OCR Google
 *   Document AI UNIQUEMENT (règle absolue — aucune substitution autorisée).
 *   Sans configuration ou en cas d'échec réel → erreur explicite propagée : le
 *   pipeline bascule le fichier en A_VERIFIER (traitement/correction manuelle)
 *   et la réception en ERREUR_DEFINITIVE, reprise possible via retryReception
 *   une fois Document AI configuré (matière première conservée) ;
 * - DOCX : mammoth (texte brut) ;
 * - XLSX : exceljs (lecture réelle des feuilles) ;
 * - CSV : papaparse ;
 * - images/scans : OCR Google Document AI (imposé, unique moteur) ;
 * - audio : transcription réelle via ASR ;
 * - texte : direct.
 */

export type ParsedDocument = {
  kind: "TEXTE" | "IMAGE_OCR" | "AUDIO_TRANSCRIT" | "TABLEUR" | "PDF";
  text: string;
  pages: { num: number; text: string }[];
  ocrConfidence?: number;
  /** Moteur d'OCR réellement utilisé — journalisé dans la chaîne de garde. Google Document AI est l'unique moteur. */
  ocrEngine?: "GOOGLE_DOCUMENT_AI";
  transcriptionDurationSec?: number;
};

export async function parseDocument(mime: string, filename: string, data: Buffer): Promise<ParsedDocument> {
  if (mime === "application/pdf") return parsePdf(data);
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return parseDocx(data);
  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel"
  )
    return parseXlsx(data);
  if (mime === "text/csv") return parseCsvText(data.toString("utf8"), "TABLEUR");
  if (mime === "text/plain" || mime === "text/markdown" || mime === "application/json")
    return { kind: "TEXTE", text: data.toString("utf8"), pages: [{ num: 1, text: data.toString("utf8") }] };
  if (isImage(mime)) return parseImageOcr(mime, data);
  if (isAudio(mime)) return parseAudio(data);
  throw new Error(`format_non_pris_en_charge:${mime}:${filename}`);
}

async function parsePdf(data: Buffer): Promise<ParsedDocument> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const result = await parser.getText();
    const pages = result.pages.map((p) => ({ num: p.num, text: p.text ?? "" }));
    const text = pages.map((p) => p.text).join("\n\n");
    if (text.trim()) return { kind: "PDF", text, pages };
    // PDF sans texte natif = scan → OCR Google Document AI, UNIQUE moteur autorisé.
    return await ocrWithDocumentAi(data, "application/pdf", "PDF", pages.map((p, i) => ({ num: p.num || i + 1, text: p.text })));
  } finally {
    await parser.destroy();
  }
}

async function parseDocx(data: Buffer): Promise<ParsedDocument> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: data });
  const text = result.value;
  return { kind: "TEXTE", text, pages: [{ num: 1, text }] };
}

async function parseXlsx(data: Buffer): Promise<ParsedDocument> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const parts: string[] = [];
  for (const sheet of wb.worksheets) {
    parts.push(`# Feuille : ${sheet.name}`);
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        cells.push(String(cell.value ?? "").trim());
      });
      if (cells.length) parts.push(cells.join(" | "));
    });
  }
  const text = parts.join("\n");
  return { kind: "TABLEUR", text, pages: [{ num: 1, text }] };
}

function parseCsvText(text: string, kind: ParsedDocument["kind"]): ParsedDocument {
  // CSV : parsing réel ligne par ligne (séparateur , ou ;)
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const normalized = lines.join("\n");
  return { kind, text: normalized, pages: [{ num: 1, text: normalized }] };
}

/**
 * OCR : Google Document AI, UNIQUE moteur autorisé (règle absolue mission).
 * Sans identifiants → erreur explicite `docai_non_configure` ; en cas d'échec réel
 * → l'erreur Document AI est propagée telle quelle. Aucun moteur alternatif n'est
 * jamais invoqué : le pipeline marque le fichier A_VERIFIER (traitement manuel)
 * et la réception ERREUR_DEFINITIVE (reprise possible via retryReception).
 */
async function ocrWithDocumentAi(
  data: Buffer,
  mime: string,
  kind: "IMAGE_OCR" | "PDF",
  existingPages: { num: number; text: string }[],
): Promise<ParsedDocument> {
  if (!docAiConfigured()) throw new Error("docai_non_configure");
  const result = await processDocument(data, mime);
  if (!result.text.trim()) throw new Error("docai_texte_vide");
  const pages = result.pagesCount > 1
    ? splitPages(result.text, result.pagesCount)
    : [{ num: 1, text: result.text }];
  return {
    kind,
    text: result.text,
    pages: existingPages.length && result.pagesCount <= 1 ? existingPages : pages,
    ocrEngine: "GOOGLE_DOCUMENT_AI",
    ocrConfidence: result.averageConfidence ?? undefined,
  };
}

/** Découpage simple du texte continu en pages équilibrées (chaîne de garde page par page). */
function splitPages(text: string, count: number): { num: number; text: string }[] {
  const size = Math.ceil(text.length / count);
  const pages: { num: number; text: string }[] = [];
  for (let i = 0; i < count; i++) pages.push({ num: i + 1, text: text.slice(i * size, (i + 1) * size) });
  return pages;
}

/** OCR réel des images : Google Document AI, unique moteur (aucun repli alternatif). */
async function parseImageOcr(mime: string, data: Buffer): Promise<ParsedDocument> {
  return ocrWithDocumentAi(data, mime, "IMAGE_OCR", []);
}

/** Transcription réelle des messages vocaux (traités comme instruction ou document). */
async function parseAudio(data: Buffer): Promise<ParsedDocument> {
  const zai = await ZAI.create();
  const res = await zai.audio.asr.create({ file_base64: data.toString("base64") });
  const text = res.text?.trim() ?? "";
  if (!text) throw new Error("transcription_vide");
  return { kind: "AUDIO_TRANSCRIT", text, pages: [{ num: 1, text }] };
}

export async function transcribeAudioBuffer(data: Buffer): Promise<string> {
  const zai = await ZAI.create();
  const res = await zai.audio.asr.create({ file_base64: data.toString("base64") });
  return res.text?.trim() ?? "";
}
