"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, FileUp } from "lucide-react";
import { useAppStore } from "@/store/app";
import { useI18n } from "@/lib/i18n";
import { apiGet } from "@/hooks/use-api";
import { toast } from "@/hooks/use-toast";
import { Cachet, StatusPill, ChainCustody } from "@/components/app/cachet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const CATEGORIES = [
  "Facture",
  "Contrat",
  "Correspondance",
  "Relevé",
  "Justificatif",
  "Rapport",
  "Photo",
  "Note",
  "Bon de commande",
  "Attestation",
  "NON_CLASSES",
] as const;

const PAGE_SIZE = 50;
const ETAPES_PIPELINE = ["files.upload.progress", "files.upload.parse", "files.upload.classify", "files.upload.archive", "files.upload.index"] as const;

/** Statuts filtrables — alignés sur /api/files (les rejets justifiés restent exclus par défaut). */
const STATUS_FILTRES = [
  "EN_VALIDATION",
  "PRET_A_ARCHIVER",
  "EN_ARCHIVAGE",
  "ARCHIVE",
  "A_VERIFIER",
  "INACCESSIBLE_DANS_DRIVE",
] as const;

type FileRecord = {
  id: string;
  originalFilename: string;
  archivedPath: string | null;
  category: string;
  sizeBytes: number;
  status: string;
  detectedType: string | null;
  detectedTypeConfidence: number | null;
  summary: string | null;
  receivedAt: string | null;
  archivedAt: string | null;
  indexedAt: string | null;
  confirmedByProof: string | null;
  receptionCount: number;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; name: string; code: string } | null;
  group?: { id: string; name: string; code: string } | null;
};

type ExtractionRow = { id: string; field: string; value: string; confidence: number; needsReview: boolean };
type ReceptionRow = { id: string; source: string; receivedAt: string; status: string };
type LogRow = { id: string; step: string; result: string; details: string | null; createdAt: string };

type FileDetail = {
  file: FileRecord;
  extractions: ExtractionRow[];
  receptions: ReceptionRow[];
  logs: LogRow[];
  chunksCount: number;
};

type IngestResult = {
  fileId: string;
  deduped: boolean;
  status: string;
  category: string;
  archivedPath?: string;
  proof?: string;
  indexStatus: string;
  error?: string;
};

type ClientLite = { id: string; name: string; code: string; status: string };
type GroupLite = { id: string; name: string; code: string; clientId: string };

/** Taille humaine en octets — unités du registre (Ko/Mo/Go), chiffres tabulaires. */
function tailleHumaine(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} Go`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} Mo`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} Ko`;
  return `${n} o`;
}

/** Résultat du journal coloré sémantiquement. */
function couleurResultat(result: string): string {
  if (/REUSS|OK|CONFIRME|TERMINE|TRAITEE|CREE/i.test(result)) return "var(--ruban)";
  if (/ECHEC|ERREUR|BLOQUE|REJET|REFUSE|FAIL/i.test(result)) return "var(--erreur)";
  return "var(--encre-2)";
}

function libelleCategorie(cat: string, t: (k: string) => string): string {
  return cat === "NON_CLASSES" ? t("category.NON_CLASSES") : cat;
}

/** Vue Fichiers — le registre documentaire : recherche réelle, fiche complète, dépôt et cachet. */
export function FilesView() {
  const { t } = useI18n();
  const detailFileId = useAppStore((s) => s.detailFileId);
  const setDetailFileId = useAppStore((s) => s.setDetailFileId);

  // — Liste —
  const [files, setFiles] = useState<FileRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [qDebounce, setQDebounce] = useState("");
  const [filtreClient, setFiltreClient] = useState("");
  const [filtreCategorie, setFiltreCategorie] = useState("");
  const [filtreStatut, setFiltreStatut] = useState("");

  // — Référentiels pour filtres et dépôt —
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [groups, setGroups] = useState<GroupLite[]>([]);

  // — Détail —
  const [detail, setDetail] = useState<FileDetail | null>(null);

  // — Dépôt —
  const [uploadOpen, setUploadOpen] = useState(false);
  const [fichier, setFichier] = useState<File | null>(null);
  const [uploadClient, setUploadClient] = useState("");
  const [uploadGroup, setUploadGroup] = useState("");
  const [caption, setCaption] = useState("");
  const [uploadEnCours, setUploadEnCours] = useState(false);
  const [etape, setEtape] = useState(0);
  const [resultat, setResultat] = useState<IngestResult | null>(null);
  const inputFichierRef = useRef<HTMLInputElement>(null);
  const minuteurRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Recherche réelle avec temporisation 400 ms
  useEffect(() => {
    const id = setTimeout(() => {
      setQDebounce(q);
      setPage(1);
    }, 400);
    return () => clearTimeout(id);
  }, [q]);

  const refetch = useCallback(async () => {
    const params = new URLSearchParams();
    if (qDebounce) params.set("q", qDebounce);
    if (filtreClient) params.set("clientId", filtreClient);
    if (filtreCategorie) params.set("category", filtreCategorie);
    if (filtreStatut) params.set("status", filtreStatut);
    params.set("page", String(page));
    const d = await apiGet<{ total: number; page: number; files: FileRecord[] }>(`/api/files?${params.toString()}`);
    if (d) {
      setFiles(d.files);
      setTotal(d.total);
    }
  }, [qDebounce, filtreClient, filtreCategorie, filtreStatut, page]);

  // Registre réel — rechargé à chaque changement de recherche/filtre/page (callback asynchrone)
  useEffect(() => {
    let vivant = true;
    const params = new URLSearchParams();
    if (qDebounce) params.set("q", qDebounce);
    if (filtreClient) params.set("clientId", filtreClient);
    if (filtreCategorie) params.set("category", filtreCategorie);
    if (filtreStatut) params.set("status", filtreStatut);
    params.set("page", String(page));
    apiGet<{ total: number; page: number; files: FileRecord[] }>(`/api/files?${params.toString()}`).then((d) => {
      if (vivant && d) {
        setFiles(d.files);
        setTotal(d.total);
      }
    });
    return () => {
      vivant = false;
    };
  }, [qDebounce, filtreClient, filtreCategorie, filtreStatut, page]);

  useEffect(() => {
    apiGet<{ clients: ClientLite[] }>("/api/clients").then((d) => {
      if (d) setClients(d.clients);
    });
    apiGet<{ groups: GroupLite[] }>("/api/groups").then((d) => {
      if (d) setGroups(d.groups);
    });
  }, []);

  // Fiche documentaire réelle pilotée par le store
  useEffect(() => {
    if (!detailFileId) return;
    let vivant = true;
    apiGet<FileDetail>(`/api/files/${detailFileId}`).then((d) => {
      if (!vivant) return;
      if (d) setDetail(d);
      else setDetailFileId(null);
    });
    return () => {
      vivant = false;
    };
  }, [detailFileId, setDetailFileId]);

  useEffect(() => {
    return () => {
      if (minuteurRef.current) clearInterval(minuteurRef.current);
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Chargement dérivé : la fiche demandée n'est pas encore celle chargée
  const detailChargement = !!detailFileId && (!detail || detail.file.id !== detailFileId);

  const fermerDetail = () => {
    setDetail(null);
    setDetailFileId(null);
  };

  const copierPreuve = async (texte: string) => {
    try {
      await navigator.clipboard.writeText(texte);
      toast({ description: t("common.copied") });
    } catch {
      toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
    }
  };

  // — Dépôt : progression présentée, réussite confirmée par le serveur seul —
  const demarrerMinuteur = () => {
    setEtape(0);
    if (minuteurRef.current) clearInterval(minuteurRef.current);
    minuteurRef.current = setInterval(() => {
      setEtape((e) => Math.min(ETAPES_PIPELINE.length - 1, e + 1));
    }, 1400);
  };

  const arreterMinuteur = () => {
    if (minuteurRef.current) {
      clearInterval(minuteurRef.current);
      minuteurRef.current = null;
    }
  };

  const deposer = async () => {
    if (!fichier) return;
    setUploadEnCours(true);
    setResultat(null);
    demarrerMinuteur();

    const fd = new FormData();
    fd.append("file", fichier);
    if (uploadClient) fd.append("clientId", uploadClient);
    if (uploadGroup) fd.append("groupId", uploadGroup);
    if (caption.trim()) fd.append("caption", caption.trim());

    try {
      const res = await fetch("/api/files/upload", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as IngestResult & { error?: string };
      arreterMinuteur();
      if (!res.ok) {
        const cause = data.error ?? t("common.errorNetwork");
        toast({
          title: t("common.error"),
          description: t("toast.uploadError").replace("{cause}", cause),
          variant: "destructive",
        });
      } else {
        setEtape(ETAPES_PIPELINE.length);
        if (data.deduped) toast({ description: t("toast.dedup") });
        if (data.status === "ARCHIVE") setResultat(data);
        else if (data.error) {
          toast({
            title: t("common.error"),
            description: t("toast.uploadError").replace("{cause}", data.error),
            variant: "destructive",
          });
        }
        refetch();
      }
    } catch {
      arreterMinuteur();
      toast({
        title: t("common.error"),
        description: t("toast.uploadError").replace("{cause}", t("common.errorNetwork")),
        variant: "destructive",
      });
    } finally {
      setUploadEnCours(false);
    }
  };

  const fermerUpload = (v: boolean) => {
    setUploadOpen(v);
    if (!v) {
      setFichier(null);
      setUploadClient("");
      setUploadGroup("");
      setCaption("");
      setUploadEnCours(false);
      setEtape(0);
      setResultat(null);
      arreterMinuteur();
    }
  };

  const groupesFiltres = uploadClient ? groups.filter((g) => g.clientId === uploadClient) : groups;

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* En-tête */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[20px] font-semibold">{t("files.title")}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{t("files.subtitle")}</p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>{t("files.upload")}</Button>
      </div>

      {/* Recherche + filtres */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("files.search")}
          aria-label={t("files.search")}
          className="h-11 min-w-[220px] flex-1 bg-[var(--papier-creuse)]"
        />
        <Select
          value={filtreClient || "all"}
          onValueChange={(v) => {
            setFiltreClient(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label={t("files.filter.client")} className="h-11 w-[180px] bg-[var(--papier-creuse)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("files.filter.all")}</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filtreCategorie || "all"}
          onValueChange={(v) => {
            setFiltreCategorie(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label={t("files.filter.category")} className="h-11 w-[180px] bg-[var(--papier-creuse)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("files.filter.all")}</SelectItem>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {libelleCategorie(cat, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filtreStatut || "all"}
          onValueChange={(v) => {
            setFiltreStatut(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label={t("clients.status")} className="h-11 w-[190px] bg-[var(--papier-creuse)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("files.filter.all")}</SelectItem>
            {STATUS_FILTRES.map((st) => (
              <SelectItem key={st} value={st}>
                {t(`status.${st}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Registre documentaire */}
      <div className="registre mt-4 border-t border-[var(--bordure)]" role="table" aria-label={t("files.title")}>
        <div className="hidden h-9 items-center gap-4 px-2 text-[11px] uppercase tracking-[0.06em] text-muted-foreground md:flex">
          <span className="min-w-0 flex-1">{t("files.detail.original")}</span>
          <span className="hidden w-44 shrink-0 lg:block">{t("files.filter.client")}</span>
          <span className="hidden w-32 shrink-0 sm:block">{t("files.filter.category")}</span>
          <span className="hidden w-20 shrink-0 text-right sm:block">{t("deliverables.size")}</span>
          <span className="w-36 shrink-0">{t("clients.status")}</span>
          <span className="hidden w-24 shrink-0 xl:block">{t("files.detail.received")}</span>
          <span className="w-24 shrink-0 text-right">{t("common.date")}</span>
        </div>

        {files === null && (
          <>
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="mt-2 h-12 w-full rounded-md" />
            <Skeleton className="mt-2 h-12 w-full rounded-md" />
          </>
        )}

        {files !== null && files.length === 0 && (
          <p className="px-2 py-10 text-center text-[13.5px] text-muted-foreground">{t("files.empty")}</p>
        )}

        {files?.map((f) => (
          <div
            key={f.id}
            role="button"
            tabIndex={0}
            onClick={() => setDetailFileId(f.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setDetailFileId(f.id);
              }
            }}
            className="registre-row flex min-h-12 cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-2 py-2 md:flex-nowrap"
            aria-label={f.originalFilename}
          >
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium" title={f.originalFilename}>
              {f.originalFilename}
            </span>
            <span className="meta-points hidden max-w-[176px] shrink-0 items-center text-[12px] text-muted-foreground lg:flex">
              {f.client && <span className="truncate">{f.client.name}</span>}
              {f.group && <span className="truncate">{f.group.name}</span>}
            </span>
            <span className="hidden w-32 shrink-0 truncate text-[12.5px] sm:block">
              {libelleCategorie(f.category, t)}
            </span>
            <span className="hidden w-20 shrink-0 text-right text-[12px] tnum text-muted-foreground sm:block">
              {tailleHumaine(f.sizeBytes)}
            </span>
            <span className="w-36 shrink-0">
              <StatusPill status={f.status} label={t(`status.${f.status}`)} />
            </span>
            <span className="hidden w-24 shrink-0 text-[11px] xl:block" title={t("files.detail.duplication")}>
              {f.receptionCount > 1 && (
                <span className="tnum" style={{ color: "var(--carton)" }}>
                  {t("files.detail.receivedTimes").replace("{n}", String(f.receptionCount))}
                </span>
              )}
            </span>
            <time className="w-24 shrink-0 text-right text-[12px] tnum text-muted-foreground" dateTime={f.createdAt}>
              {new Date(f.createdAt).toLocaleDateString()}
            </time>
          </div>
        ))}
      </div>

      {/* Pagination simple */}
      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-[12.5px] tnum text-muted-foreground">
            {t("common.page")} {page} / {totalPages} · {total} {t("common.results")}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="h-11" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              {t("common.prev")}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              {t("common.next")}
            </Button>
          </div>
        </div>
      )}

      {/* ——— Fiche documentaire ——— */}
      <Sheet open={!!detailFileId} onOpenChange={(v) => !v && fermerDetail()}>
        <SheetContent side="right" className="w-[560px] sm:max-w-[560px]">
          {detailChargement && (
            <div className="space-y-3 px-4" aria-busy="true">
              <Skeleton className="h-8 w-3/4 rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
              <Skeleton className="h-16 w-full rounded-md" />
              <Skeleton className="h-16 w-full rounded-md" />
            </div>
          )}
          {detail && (
            <>
              <SheetHeader className="pr-10">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <SheetTitle className="font-display text-[18px] leading-snug" title={detail.file.originalFilename}>
                      {detail.file.originalFilename}
                    </SheetTitle>
                    <SheetDescription className="mt-1">
                      {detail.file.client?.name ?? "—"}
                      {detail.file.group ? ` · ${detail.file.group.name}` : ""}
                    </SheetDescription>
                  </div>
                  {detail.file.status === "ARCHIVE" && detail.file.confirmedByProof ? (
                    <Cachet size={110} animated={true} />
                  ) : (
                    <StatusPill status={detail.file.status} label={t(`status.${detail.file.status}`)} />
                  )}
                </div>
              </SheetHeader>

              <div className="scroll-fin flex-1 overflow-y-auto px-4 pb-4">
                {/* Identité */}
                <dl className="space-y-2 text-[13px]">
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-muted-foreground">{t("files.detail.type")}</dt>
                    <dd className="min-w-0 text-right">
                      {detail.file.detectedType ?? "—"}
                      {detail.file.detectedTypeConfidence != null && (
                        <span className="tnum text-muted-foreground">
                          {" "}
                          · {t("files.detail.confidence")} {Math.round(detail.file.detectedTypeConfidence * 100)}%
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-muted-foreground">{t("files.detail.category")}</dt>
                    <dd className="text-right">{libelleCategorie(detail.file.category, t)}</dd>
                  </div>
                </dl>
                {detail.file.summary && (
                  <div className="mt-3">
                    <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("files.detail.summary")}</p>
                    <p className="mt-1 text-[13px] leading-relaxed">{detail.file.summary}</p>
                  </div>
                )}

                {/* Chaîne de garde */}
                <div className="mt-5">
                  <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("files.detail.chain")}</p>
                  <div className="mt-2">
                    <ChainCustody
                      receivedAt={detail.file.receivedAt}
                      classifiedAt={detail.file.detectedType ? detail.file.updatedAt ?? detail.file.receivedAt : null}
                      archivedAt={detail.file.archivedAt}
                      indexedAt={detail.file.indexedAt}
                      labels={{
                        received: t("files.detail.received"),
                        classified: t("files.detail.classified"),
                        archived: t("files.detail.archived"),
                        indexed: t("files.detail.indexed"),
                        pending: t("files.detail.notYet"),
                      }}
                    />
                  </div>
                </div>

                {/* Preuve réelle */}
                <div className="mt-5 rounded-md border border-[var(--bordure)] bg-[var(--papier-creuse)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("files.detail.proof")}</p>
                    {detail.file.confirmedByProof && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-11 gap-1.5 text-[12px]"
                        onClick={() => copierPreuve(detail.file.confirmedByProof as string)}
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("common.copy")}
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 break-words text-[12px] leading-relaxed tnum">
                    {detail.file.confirmedByProof ?? t("files.detail.notYet")}
                  </p>
                </div>

                {/* Emplacement archivé */}
                <div className="mt-3 flex justify-between gap-4 text-[12.5px]">
                  <span className="shrink-0 text-muted-foreground">{t("files.detail.path")}</span>
                  <span className="min-w-0 break-all text-right tnum">{detail.file.archivedPath ?? "—"}</span>
                </div>

                {/* Champs extraits */}
                {detail.extractions.length > 0 && (
                  <div className="mt-5">
                    <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("files.detail.extractions")}</p>
                    <ul className="mt-2 border-t border-[var(--bordure)]">
                      {detail.extractions.map((ex) => (
                        <li key={ex.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--bordure)] py-1.5">
                          <span className="w-28 shrink-0 truncate text-[12.5px] font-medium tnum">{ex.field}</span>
                          <span className="min-w-0 flex-1 break-words text-[13px]">{ex.value}</span>
                          <span className="shrink-0 text-[11.5px] tnum text-muted-foreground">
                            {Math.round(ex.confidence * 100)}%
                          </span>
                          {ex.needsReview && (
                            <span
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]"
                              style={{ background: "var(--carton-fond)", color: "var(--carton)" }}
                            >
                              <span className="h-1.5 w-1.5 rounded-full border-2" style={{ borderColor: "var(--carton)" }} aria-hidden="true" />
                              {t("status.A_VERIFIER")}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Réceptions réelles */}
                {detail.receptions.length > 0 && (
                  <div className="mt-5">
                    <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("files.detail.receptions")}</p>
                    <ul className="mt-2 border-t border-[var(--bordure)]">
                      {detail.receptions.map((r) => (
                        <li key={r.id} className="flex h-11 items-center gap-3 border-b border-[var(--bordure)]">
                          <span className="w-32 shrink-0 truncate text-[12.5px] tnum">{r.source}</span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground tnum">{r.status}</span>
                          <time className="shrink-0 text-[11.5px] tnum text-muted-foreground" dateTime={r.receivedAt}>
                            {new Date(r.receivedAt).toLocaleString()}
                          </time>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Journal de traitement */}
                {detail.logs.length > 0 && (
                  <div className="mt-5">
                    <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("files.detail.logs")}</p>
                    <ul className="mt-2 border-t border-[var(--bordure)]">
                      {detail.logs.map((l) => (
                        <li key={l.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--bordure)] py-1.5">
                          <span className="w-28 shrink-0 truncate text-[12.5px] font-medium tnum">{l.step}</span>
                          <span className="w-28 shrink-0 truncate text-[12px] tnum" style={{ color: couleurResultat(l.result) }}>
                            {l.result}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground" title={l.details ?? undefined}>
                            {l.details ?? ""}
                          </span>
                          <time className="hidden shrink-0 text-[11px] tnum text-muted-foreground sm:block" dateTime={l.createdAt}>
                            {new Date(l.createdAt).toLocaleString()}
                          </time>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <SheetFooter className="px-0 pt-5">
                  <Button variant="outline" className="h-11" onClick={fermerDetail}>
                    {t("files.close")}
                  </Button>
                </SheetFooter>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ——— Dépôt d'un document ——— */}
      <Sheet open={uploadOpen} onOpenChange={fermerUpload}>
        <SheetContent side="right" className="w-[440px] sm:max-w-[440px]">
          <SheetHeader className="pr-10">
            <SheetTitle className="font-display text-[18px]">{t("files.upload")}</SheetTitle>
            <SheetDescription>{t("files.subtitle")}</SheetDescription>
          </SheetHeader>

          <div className="scroll-fin flex-1 overflow-y-auto px-4 pb-6">
            {/* Zone de dépôt réelle */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputFichierRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inputFichierRef.current?.click();
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) setFichier(f);
              }}
              className="mt-1 flex min-h-11 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--bordure-forte)] px-4 py-6 text-center transition-colors hover:bg-[var(--papier-creuse)]"
            >
              <FileUp className="h-5 w-5 text-[var(--encre-3)]" aria-hidden="true" />
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t("files.upload.dropzone")}</p>
              {fichier && (
                <p className="text-[12.5px] font-medium tnum">
                  {fichier.name} · {tailleHumaine(fichier.size)}
                </p>
              )}
              <input
                ref={inputFichierRef}
                type="file"
                className="sr-only"
                aria-label={t("files.upload.dropzone")}
                onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
              />
            </div>

            {/* Étapes réelles du pipeline — la réussite finale vient du serveur */}
            {uploadEnCours && (
              <div className="mt-4 rounded-md border border-[var(--bordure)] p-3" aria-busy="true">
                <ul className="space-y-2">
                  {ETAPES_PIPELINE.map((k, i) => {
                    const fait = i < etape;
                    const actif = i === etape;
                    return (
                      <li key={k} className="flex items-center gap-2.5 text-[12.5px]">
                        <span
                          className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full"
                          style={
                            fait
                              ? { background: "var(--ruban)", color: "var(--ruban-fond)" }
                              : actif
                                ? { border: "2px solid var(--cachet)" }
                                : { border: "2px solid var(--bordure-forte)" }
                          }
                          aria-hidden="true"
                        >
                          {fait && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <span className={actif ? "font-medium" : "text-muted-foreground"}>
                          {t(k)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Réponse réelle du serveur : cachet apposé si archivage confirmé */}
            {resultat && (
              <div className="mt-4 flex flex-col items-center gap-2 rounded-md border border-[var(--bordure)] px-4 py-5" style={{ background: "var(--ruban-fond)" }}>
                <Cachet size={110} animated={true} />
                <p className="text-[13px] font-medium">{t("files.upload.done")}</p>
                {resultat.proof && (
                  <p className="max-w-full break-words text-center text-[11px] leading-relaxed tnum text-muted-foreground">
                    {resultat.proof}
                  </p>
                )}
              </div>
            )}

            {/* Rattachement réel */}
            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="upload-client">{t("files.upload.toClient")}</Label>
                <Select
                  value={uploadClient || "none"}
                  onValueChange={(v) => {
                    const id = v === "none" ? "" : v;
                    setUploadClient(id);
                    if (id && uploadGroup && !groups.some((g) => g.id === uploadGroup && g.clientId === id)) {
                      setUploadGroup("");
                    }
                  }}
                >
                  <SelectTrigger id="upload-client" className="h-11 w-full bg-[var(--papier-creuse)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("common.none")}</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="upload-group">{t("files.upload.toGroup")}</Label>
                <Select
                  value={uploadGroup || "none"}
                  onValueChange={(v) => setUploadGroup(v === "none" ? "" : v)}
                >
                  <SelectTrigger id="upload-group" className="h-11 w-full bg-[var(--papier-creuse)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("common.none")}</SelectItem>
                    {groupesFiltres.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name} ({g.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="upload-caption">{t("files.upload.caption")}</Label>
                <Input
                  id="upload-caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  className="h-11 bg-[var(--papier-creuse)]"
                />
              </div>
            </div>

            <div className="mt-5">
              <Button
                className="h-11 w-full"
                disabled={!fichier || uploadEnCours}
                onClick={deposer}
              >
                {t("files.upload.submit")}
              </Button>
              <Button variant="ghost" className="mt-2 h-11 w-full" onClick={() => fermerUpload(false)}>
                {t("files.close")}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
