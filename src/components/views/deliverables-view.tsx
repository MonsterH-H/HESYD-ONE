"use client";

/**
 * Livrables — registre dense des documents réellement générés.
 * Génération manuelle réelle (PDF/XLSX/DOCX, contrôle avant remise),
 * expansion en ligne (grid-template-rows, jamais de modal), téléchargement réel.
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { apiGet, useApi } from "@/hooks/use-api";
import { useAppStore } from "@/store/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { ChevronDown, Download, FileText, Loader2, Plus, Trash2 } from "lucide-react";

type DeliverableSource = { label: string; fileRef?: string };

type Deliverable = {
  id: string;
  title: string;
  type: string;
  version: number;
  status: string;
  sizeBytes: number;
  qualityCheck: string | null;
  createdAt: string;
  filePath: string;
  sources: DeliverableSource[];
  /** Lien de téléchargement relatif et signé, préfixé par l'identifiant du livrable. */
  downloadUrl: string;
  linkExpiresAt: string;
};

type DraftSection = { heading: string; paragraphs: string; bullets: string; tableHeaders: string; tableRows: string };

const emptySection: DraftSection = { heading: "", paragraphs: "", bullets: "", tableHeaders: "", tableRows: "" };

/** Taille humaine, chiffres tabulaires côté affichage. */
function humanSize(bytes: number) {
  if (bytes <= 0) return "0 o";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

const lines = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function DeliverablesView() {
  const { t } = useI18n();
  const { call, loading } = useApi();
  const setDetailFileId = useAppStore((s) => s.setDetailFileId);
  const setView = useAppStore((s) => s.setView);

  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Brouillon de génération
  const [type, setType] = useState<"PDF" | "XLSX" | "DOCX">("PDF");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [sections, setSections] = useState<DraftSection[]>([{ ...emptySection }]);
  const [sourceFiles, setSourceFiles] = useState<{ id: string; label: string }[]>([]);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());

  const refresh = async () => {
    const data = await apiGet<{ deliverables: Deliverable[] }>("/api/deliverables");
    if (data?.deliverables) setDeliverables(data.deliverables);
  };

  useEffect(() => {
    let vivant = true;
    (async () => {
      const [d, f] = await Promise.all([
        apiGet<{ deliverables: Deliverable[] }>("/api/deliverables"),
        apiGet<{ files: { id: string; originalFilename: string; clientName?: string | null; status: string }[] }>("/api/files?page=1"),
      ]);
      if (!vivant) return;
      if (d?.deliverables) setDeliverables(d.deliverables);
      if (f?.files) {
        setSourceFiles(
          f.files
            .filter((x) => x.status === "ARCHIVE")
            .slice(0, 50)
            .map((x) => ({ id: x.id, label: x.originalFilename + (x.clientName ? ` — ${x.clientName}` : "") }))
        );
      }
    })();
    return () => {
      vivant = false;
    };
  }, []);

  const openSource = (fileRef?: string) => {
    if (!fileRef) return;
    setDetailFileId(fileRef);
    setView("files");
  };

  /** Téléchargement réel via lien relatif signé (exp + sig), renvoyé par l'API. */
  const telecharger = (d: Deliverable) => {
    window.open(`/api/deliverables/${d.downloadUrl}`);
  };

  const toggleSource = (id: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 20) next.add(id);
      return next;
    });
  };

  const updateSection = (i: number, patch: Partial<DraftSection>) => {
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const submit = async () => {
    if (!title.trim() || sections.length === 0) return;
    const payload = {
      type,
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      sections: sections.map((s) => ({
        heading: s.heading.trim() || undefined,
        paragraphs: lines(s.paragraphs).length ? lines(s.paragraphs) : undefined,
        bullets: lines(s.bullets).length ? lines(s.bullets) : undefined,
        table:
          s.tableHeaders.trim() && lines(s.tableRows).length
            ? {
                headers: s.tableHeaders.split(",").map((h) => h.trim()).filter(Boolean),
                rows: lines(s.tableRows).map((r) => r.split(",").map((c) => c.trim())),
              }
            : undefined,
      })),
      sourceFileIds: Array.from(selectedSources),
    };
    const res = await call<{ id: string }>("/api/deliverables", { method: "POST", body: JSON.stringify(payload) });
    if (res) {
      toast({ title: t("deliverables.success"), description: t("deliverables.successDetail") });
      setOpen(false);
      setTitle("");
      setSubtitle("");
      setSections([{ ...emptySection }]);
      setSelectedSources(new Set());
      await refresh();
    }
  };

  return (
    <div className="space-y-4 max-w-[1100px]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">{t("deliverables.subtitle")}</p>
        <Button onClick={() => setOpen(true)} className="shrink-0">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("deliverables.generate")}
        </Button>
      </div>

      <div className="registre border rounded-md bg-card" role="list" aria-label={t("deliverables.title")}>
        {deliverables.length === 0 ? (
          <p className="text-[13px] text-muted-foreground px-4 py-6">{t("deliverables.empty")}</p>
        ) : (
          deliverables.map((d) => {
            const expanded = expandedId === d.id;
            return (
              <li key={d.id} role="listitem" className="list-none">
                <button
                  onClick={() => setExpandedId(expanded ? null : d.id)}
                  aria-expanded={expanded}
                  className="registre-row w-full min-h-[52px] text-left px-3 py-2 flex items-center gap-3"
                >
                  <span className="text-[13.5px] font-medium truncate min-w-0 flex-1">{d.title}</span>
                  <Badge variant="outline" className="text-[10.5px] font-normal shrink-0 px-1.5">{d.type}</Badge>
                  <span className="text-[12px] tnum text-muted-foreground shrink-0">{t("deliverables.version")} v{d.version}</span>
                  <span className="text-[12px] tnum text-muted-foreground shrink-0 hidden sm:inline">{humanSize(d.sizeBytes)}</span>
                  <span className="text-[12px] tnum text-muted-foreground shrink-0 hidden md:inline">{new Date(d.createdAt).toLocaleDateString()}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      telecharger(d);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        telecharger(d);
                      }
                    }}
                    aria-label={t("deliverables.download")}
                    title={t("deliverables.download")}
                    className="inline-flex items-center justify-center h-9 px-2.5 rounded-md border text-[12px] shrink-0 hover:bg-secondary transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only sm:ml-1.5">{t("deliverables.download")}</span>
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                {/* Expansion en ligne — hauteur par grid-template-rows, jamais de modal */}
                <div
                  className="grid transition-[grid-template-rows] duration-300"
                  style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <div className="px-3 pb-4 pt-1 border-b border-border bg-[var(--papier-leve)] space-y-3 text-[12.5px]">
                      {d.qualityCheck && (
                        <div>
                          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("deliverables.quality")}</div>
                          <p className="mt-1 leading-snug text-muted-foreground">{d.qualityCheck}</p>
                        </div>
                      )}
                      <div>
                        <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("deliverables.sources")}</div>
                        {d.sources.length === 0 ? (
                          <p className="mt-1 text-muted-foreground">—</p>
                        ) : (
                          <ul className="mt-1 space-y-0.5">
                            {d.sources.map((s, i) => (
                              <li key={`${s.label}-${i}`}>
                                <button
                                  onClick={() => openSource(s.fileRef)}
                                  className="inline-flex items-center gap-2 min-h-[32px] text-[12px] text-muted-foreground hover:text-foreground underline-offset-4 hover:underline text-left"
                                >
                                  <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
                                  <span className="truncate">{s.label}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="text-[11.5px] tnum text-muted-foreground meta-points">
                        <span>{t("deliverables.created")} {new Date(d.createdAt).toLocaleString()}</span>
                        <span>{t("deliverables.size")} {humanSize(d.sizeBytes)}</span>
                        <span className="break-all">{d.filePath}</span>
                        <span>{t("deliverables.linkValidUntil")} {new Date(d.linkExpiresAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })
        )}
      </div>

      {/* Génération réelle : sections éditables, sources citées du registre, contrôle avant remise */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[640px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{t("deliverables.generateTitle")}</DialogTitle>
            <DialogDescription>{t("deliverables.generateHint")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="liv-type">{t("deliverables.field.type")}</Label>
                <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                  <SelectTrigger id="liv-type" aria-label={t("deliverables.field.type")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PDF">PDF</SelectItem>
                    <SelectItem value="XLSX">Excel</SelectItem>
                    <SelectItem value="DOCX">Word</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="liv-title">{t("deliverables.field.title")}</Label>
                <Input id="liv-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t("deliverables.ph.title")} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="liv-subtitle">{t("deliverables.field.subtitle")}</Label>
              <Input id="liv-subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={200} placeholder={t("deliverables.ph.subtitle")} />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t("deliverables.field.sections")}</Label>
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setSections((p) => (p.length < 8 ? [...p, { ...emptySection }] : p))}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("deliverables.addSection")}
                </Button>
              </div>
              {sections.map((s, i) => (
                <div key={i} className="border rounded-md p-3 space-y-2.5 bg-[var(--papier-leve)]">
                  <div className="flex items-center gap-2">
                    <Input value={s.heading} onChange={(e) => updateSection(i, { heading: e.target.value })} maxLength={120} placeholder={t("deliverables.ph.heading")} aria-label={t("deliverables.ph.heading")} className="h-9" />
                    {sections.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setSections((p) => p.filter((_, idx) => idx !== i))} aria-label={t("deliverables.removeSection")}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  <Textarea value={s.paragraphs} onChange={(e) => updateSection(i, { paragraphs: e.target.value })} rows={2} placeholder={t("deliverables.ph.paragraphs")} aria-label={t("deliverables.ph.paragraphs")} />
                  <Textarea value={s.bullets} onChange={(e) => updateSection(i, { bullets: e.target.value })} rows={2} placeholder={t("deliverables.ph.bullets")} aria-label={t("deliverables.ph.bullets")} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Input value={s.tableHeaders} onChange={(e) => updateSection(i, { tableHeaders: e.target.value })} maxLength={200} placeholder={t("deliverables.ph.tableHeaders")} aria-label={t("deliverables.ph.tableHeaders")} className="h-9" />
                    <Textarea value={s.tableRows} onChange={(e) => updateSection(i, { tableRows: e.target.value })} rows={2} placeholder={t("deliverables.ph.tableRows")} aria-label={t("deliverables.ph.tableRows")} />
                  </div>
                </div>
              ))}
            </div>

            {sourceFiles.length > 0 && (
              <div className="space-y-1.5">
                <Label>{t("deliverables.field.sources")}</Label>
                <div className="border rounded-md max-h-40 overflow-y-auto thin-scroll divide-y">
                  {sourceFiles.map((f) => (
                    <label key={f.id} className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] cursor-pointer hover:bg-secondary/50">
                      <Checkbox checked={selectedSources.has(f.id)} onCheckedChange={() => toggleSource(f.id)} />
                      <span className="truncate">{f.label}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">{t("deliverables.sourcesHint")}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={submit} disabled={loading || !title.trim()}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t("deliverables.generateCta")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
