"use client";

/**
 * Imports et reprise — référentiel clients/groupes en CSV/XLSX, en deux étapes
 * réelles (CDC §6.6) : analyse sans écriture (dryRun), puis confirmation qui
 * renvoie exactement le même fichier. Historique des lots avec expansion.
 */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { apiGet } from "@/hooks/use-api";
import { toast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/app";
import { EtatErreur } from "@/components/app/etat-erreur";
import { EtatVide } from "@/components/app/etat-vide";
import { Pill } from "@/components/app/pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, FileSpreadsheet, UploadCloud } from "lucide-react";

type ImportReportRow = { line: number; result: string; reason?: string };

type ImportBatch = {
  id: string;
  fileName: string;
  okRows: number;
  rejectedRows: number;
  totalRows: number;
  createdAt: string;
  rows: { lineNo: number; result: string; reason: string | null }[];
};

/** Étape 1 : aperçu sans écriture renvoyé par l'API (dryRun=true). */
type PreviewRow = { line: number; code: string; nom: string; resultat: string; raison?: string };

type PreviewResult = {
  fileName: string;
  totalRows: number;
  valides: number;
  rejetees: number;
  creations: number;
  existants: number;
  preview: PreviewRow[];
  message: string;
};

/** Étape 2 : rapport définitif après écritures réelles. */
type ImportResult = { batchId: string; totalRows: number; okRows: number; rejected: number; report: ImportReportRow[] };

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    // Micro-label de densité volontaire : 10.5px < meta (13px), hors échelle registre assumé
    <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </h3>
  );
}

/** Pastille de résultat — CREATION (vert), EXISTANT (carton), REJETE (croix rouge). */
function resultPill(resultat: string, label: string) {
  switch (resultat) {
    case "CREE":
    case "CREATION":
      return <Pill tone="ruban" shape="dot" label={label} />;
    case "REJETE":
      return <Pill tone="erreur" shape="cross" label={label} />;
    case "EXISTANT":
      return <Pill tone="carton" shape="ring" label={label} />;
    default:
      return <Pill tone="carton" shape="ring" label={label} />;
  }
}

/** Interpolation locale des libellés {cle}. */
function fmt(template: string, params: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}

export function ImportsView() {
  const { t } = useI18n();
  const role = useAppStore((s) => s.session?.role);

  // L'import du référentiel est réservé au propriétaire et aux administrateurs (API réelle).
  const peutImporter = role === "PROPRIETAIRE" || role === "ADMINISTRATEUR";

  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [erreur, setErreur] = useState(false);
  const [report, setReport] = useState<ImportReportRow[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Deux étapes : le fichier analysé est conservé tel quel pour la confirmation.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    const data = await apiGet<{ batches: ImportBatch[] }>("/api/imports");
    if (data?.batches) {
      setBatches(data.batches);
      setErreur(false);
    } else {
      setErreur(true);
    }
  };

  useEffect(() => {
    let vivant = true;
    (async () => {
      const data = await apiGet<{ batches: ImportBatch[] }>("/api/imports");
      if (!vivant) return;
      if (data?.batches) {
        setBatches(data.batches);
        setErreur(false);
      } else {
        setErreur(true);
      }
    })();
    return () => {
      vivant = false;
    };
  }, []);

  /** Message honnête et actionnable pour un échec d'envoi (codes réels de l'API). */
  const messageErreur = (code: string | undefined) => {
    if (code === "format_refuse_utiliser_csv_ou_xlsx") return t("imports.error.format");
    if (code === "forbidden") return t("imports.forbidden");
    if (code === "erreur_reseau") return t("common.errorNetwork");
    return t("imports.error.generic");
  };

  /** Étape 1 — analyse sans écriture (dryRun=true). */
  const analyserFichier = async (file: File) => {
    setAnalysing(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("dryRun", "true");
      const res = await fetch("/api/imports", { method: "POST", body: form });
      if (res.ok) {
        const result = (await res.json()) as PreviewResult;
        setPendingFile(file);
        setPreview(result);
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: t("common.error"), description: messageErreur(data?.error), variant: "destructive" });
      }
    } catch {
      toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
    } finally {
      setAnalysing(false);
    }
  };

  /** Étape 2 — confirmation : le même fichier est renvoyé, écritures réelles cette fois. */
  const confirmerImport = async () => {
    if (!pendingFile || confirming) return;
    setConfirming(true);
    try {
      const form = new FormData();
      form.append("file", pendingFile);
      const res = await fetch("/api/imports", { method: "POST", body: form });
      if (res.ok) {
        const result = (await res.json()) as ImportResult;
        toast({
          title: fmt(t("toast.imported"), { ok: result.okRows, ko: result.rejected }),
          description: pendingFile.name,
        });
        setReport(result.report ?? []);
        setPreview(null);
        setPendingFile(null);
        void load();
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast({ title: t("common.error"), description: messageErreur(data?.error), variant: "destructive" });
      }
    } catch {
      toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  };

  const abandonnerApercu = () => {
    setPreview(null);
    setPendingFile(null);
  };

  const compteurs: { key: string; value: number }[] = preview
    ? [
        { key: "imports.preview.totalRows", value: preview.totalRows },
        { key: "imports.preview.valides", value: preview.valides },
        { key: "imports.preview.creations", value: preview.creations },
        { key: "imports.preview.existants", value: preview.existants },
        { key: "imports.preview.rejetees", value: preview.rejetees },
      ]
    : [];

  return (
    <div className="space-y-5 max-w-[1100px]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-[12.5px] leading-snug px-3 py-2.5 rounded-md max-w-[560px]" style={{ background: "var(--carton-fond)", color: "var(--carton)" }}>
          {t("imports.expectedCols")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-11"
            onClick={() => window.open("/api/imports?template=csv")}
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            {t("imports.modelCsv")}
          </Button>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => window.open("/api/imports?template=xlsx")}
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            {t("imports.modelXlsx")}
          </Button>
          {peutImporter ? (
            <Button className="h-11 px-4" disabled={analysing} onClick={() => fileInputRef.current?.click()}>
              <UploadCloud className="h-4 w-4" aria-hidden="true" />
              {analysing ? t("imports.analyzing") : t("imports.analyze")}
            </Button>
          ) : null}
        </div>
        {peutImporter && (
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void analyserFichier(file);
            }}
          />
        )}
      </div>

      {!peutImporter && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground max-w-[640px]">{t("imports.forbidden")}</p>
      )}

      {/* Étape 1 — aperçu sans écriture, fichier conservé pour la confirmation */}
      {preview && (
        <div className="border rounded-md bg-card p-4 space-y-4" role="region" aria-label={t("imports.preview.title")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>{t("imports.preview.title")}</SectionTitle>
            <span className="text-[12.5px] font-medium truncate max-w-[280px]" title={preview.fileName}>
              {preview.fileName}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {compteurs.map((c) => (
              <div key={c.key} className="rounded-md border px-3 py-2.5" style={{ borderColor: "var(--bordure)", background: "var(--papier-leve)" }}>
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t(c.key)}</div>
                <div className="mt-1 font-display text-section font-semibold tnum">{c.value}</div>
              </div>
            ))}
          </div>

          <p className="text-[12px] leading-relaxed text-muted-foreground">{preview.message}</p>

          <div className="registre border rounded-md max-h-96 overflow-y-auto scroll-fin" role="table" aria-label={t("imports.preview.title")}>
            {/* En-têtes : micro-labels de densité volontaires (10.5px < meta 13px), hors échelle assumé */}
            <div role="row" className="flex items-center gap-3 px-3 py-1.5 border-b border-border text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sticky top-0 bg-card">
              <span className="w-14 shrink-0" role="columnheader">{t("imports.line")}</span>
              <span className="w-28 shrink-0" role="columnheader">{t("imports.preview.code")}</span>
              <span className="min-w-0 flex-1" role="columnheader">{t("imports.preview.nom")}</span>
              <span className="w-28 shrink-0" role="columnheader">{t("imports.result")}</span>
              <span className="w-40 lg:w-64 shrink-0 lg:flex-[0_1_240px]" role="columnheader">{t("imports.reason")}</span>
            </div>
            {preview.preview.map((r, i) => (
              <div key={`${r.line}-${i}`} role="row" className="registre-row flex items-center gap-3 px-3 py-2 min-h-[44px] text-[12.5px]">
                <span className="w-14 shrink-0 tnum" role="cell">{r.line}</span>
                <span className="w-28 shrink-0 tnum truncate" role="cell">{r.code || "—"}</span>
                <span className="min-w-0 flex-1 truncate font-medium" role="cell">{r.nom || "—"}</span>
                <span className="w-28 shrink-0" role="cell">{resultPill(r.resultat, t(`imports.result.${r.resultat}`, r.resultat))}</span>
                <span className="w-40 lg:w-64 shrink-0 lg:flex-[0_1_240px] text-muted-foreground truncate" role="cell">{r.raison ?? "—"}</span>
              </div>
            ))}
          </div>

          <p className="text-meta leading-snug text-muted-foreground">{t("imports.preview.note")}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button className="h-11 px-4" disabled={confirming} onClick={() => void confirmerImport()}>
              {confirming ? t("imports.confirming") : t("imports.confirm")}
            </Button>
            <Button variant="outline" className="h-11 px-4" disabled={confirming} onClick={abandonnerApercu}>
              {t("imports.discard")}
            </Button>
          </div>
        </div>
      )}

      {/* Rapport définitif du dernier import réel */}
      {report && report.length > 0 && (
        <div>
          <SectionTitle>{t("imports.report")}</SectionTitle>
          <div className="registre border rounded-md bg-card mt-1.5" role="table" aria-label={t("imports.report")}>
            <div role="row" className="flex items-center gap-3 px-3 py-1.5 border-b border-border text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <span className="w-16 shrink-0" role="columnheader">{t("imports.line")}</span>
              <span className="w-28 shrink-0" role="columnheader">{t("imports.result")}</span>
              <span className="min-w-0 flex-1" role="columnheader">{t("imports.reason")}</span>
            </div>
            {report.map((r, i) => (
              <div key={`${r.line}-${i}`} role="row" className="registre-row flex items-center gap-3 px-3 py-2 min-h-[44px] text-[12.5px]">
                <span className="w-16 shrink-0 tnum" role="cell">{r.line}</span>
                <span className="w-28 shrink-0" role="cell">{resultPill(r.result, t(`imports.result.${r.result}`, r.result))}</span>
                <span className="min-w-0 flex-1 text-muted-foreground truncate" role="cell">{r.reason ?? "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historique réel des lots */}
      <div>
        <SectionTitle>{t("imports.history")}</SectionTitle>
        <div className="registre border rounded-md bg-card mt-1.5" role="list" aria-label={t("imports.history")}>
          {batches === null && erreur ? (
            <EtatErreur
              onRetry={() => {
                setErreur(false);
                void load();
              }}
            />
          ) : batches === null ? (
            <div className="space-y-px" aria-hidden="true">
              {/* Gabarit réel des lignes du registre : en-tête + deux lignes, mêmes colonnes (ligne/code/nom/résultat/motif) */}
              <div className="flex items-center gap-3 px-3 py-1.5 border-b border-[var(--bordure)]">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-40 lg:w-64" />
              </div>
              {[0, 1].map((row) => (
                <div key={row} className="registre-row flex items-center gap-3 px-3 py-2 min-h-[44px] text-[12.5px]">
                  <Skeleton className="h-3.5 w-14 shrink-0" />
                  <Skeleton className="h-3.5 w-28 shrink-0" />
                  <Skeleton className="h-3.5 flex-1 min-w-0" />
                  <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
                  <Skeleton className="h-3.5 w-40 lg:w-64 shrink-0" />
                </div>
              ))}
            </div>
          ) : batches.length === 0 ? (
            <EtatVide icon={UploadCloud} title={t("imports.empty")} compact />
          ) : (
            batches.map((b) => {
              const expanded = expandedId === b.id;
              return (
                <li key={b.id} role="listitem" className="list-none">
                  <button
                    onClick={() => setExpandedId(expanded ? null : b.id)}
                    aria-expanded={expanded}
                    className="registre-row w-full min-h-[52px] text-left px-3 py-2 flex items-center gap-3"
                  >
                    <span className="text-meta font-medium truncate min-w-0 flex-1">{b.fileName}</span>
                    <span className="text-[12px] tnum shrink-0" style={{ color: "var(--ruban)" }}>{b.okRows} {t("imports.ok")}</span>
                    <span className="text-[12px] tnum shrink-0" style={{ color: "var(--erreur)" }}>{b.rejectedRows} {t("imports.rejected")}</span>
                    <span className="text-[12px] tnum text-muted-foreground shrink-0 hidden sm:inline">{b.totalRows} {t("imports.total")}</span>
                    <span className="text-[12px] tnum text-muted-foreground shrink-0 hidden md:inline">{new Date(b.createdAt).toLocaleDateString()}</span>
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {/* Expansion en ligne : rapport réel du lot */}
                  <div className="grid transition-[grid-template-rows] duration-300" style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}>
                    <div className="overflow-hidden">
                      <div className="px-3 pb-4 pt-1 border-b border-border bg-[var(--papier-leve)]">
                        <ul>
                          {b.rows.map((r, i) => (
                            <li key={`${r.lineNo}-${i}`} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0 text-[12px]">
                              <span className="w-14 shrink-0 tnum text-muted-foreground">{t("imports.line")} {r.lineNo}</span>
                              <span className="w-28 shrink-0">{resultPill(r.result, t(`imports.result.${r.result}`, r.result))}</span>
                              <span className="min-w-0 flex-1 text-muted-foreground truncate">{r.reason ?? "—"}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
