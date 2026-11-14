"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  FileText,
  MessageCircle,
  Pencil,
  PencilLine,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useAppStore } from "@/store/app";
import { useI18n } from "@/lib/i18n";
import { useApi, apiGet } from "@/hooks/use-api";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const PAGE_SIZE = 50;
const STATUTS_FILTRES = ["EXTRAITE", "A_VERIFIER", "VALIDE", "REJETEE"] as const;
const CARTES_RESUME = ["VALIDE", "A_VERIFIER", "EXTRAITE"] as const;
const CHAMPS_CORRECTION = ["label", "amountCents", "currency", "operationDate", "status"] as const;

type ClientLite = { id: string; name: string; code: string; status: string };
type GroupLite = { id: string; name: string; code: string; clientId: string };

type OperationFinanciere = {
  id: string;
  clientId: string | null;
  groupId: string | null;
  sourceType: string;
  sourceReceptionId: string | null;
  sourceFileId: string | null;
  sourceWebhookEventId: string | null;
  sourceKey: string;
  label: string;
  amountCents: number | null;
  currency: string;
  operationDate: string | null;
  status: string;
  confidence: number;
  needsReview: boolean;
  justificationFileId: string | null;
  validatedById: string | null;
  validatedAt: string | null;
  rejectedById: string | null;
  rejectionReason: string | null;
  historyJson: string;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  client: { id: string; code: string; name: string } | null;
  group: { id: string; code: string; name: string; clientId: string } | null;
};

type Resume = {
  counts: Record<string, number>;
  totals: Record<string, Record<string, number>>;
};

type EntreeHistorique = {
  at: string;
  byId: string | null;
  action: string;
  from: Record<string, unknown> | null;
  to: Record<string, unknown> | null;
  note: string | null;
};

const formCreationVide = { label: "", montant: "", currency: "EUR", date: "", clientId: "", groupId: "", confirmer: false };
const formCorrectionVide = { label: "", montant: "", currency: "", date: "", note: "" };

const ICONES_SOURCE: Record<string, React.ComponentType<{ className?: string }>> = {
  WHATSAPP: MessageCircle,
  DOCUMENT: FileText,
  MANUEL: PencilLine,
  AGENT: Sparkles,
};

/** Montant en devise réelle — Intl.NumberFormat ; devise hors ISO affichée telle quelle, jamais inventée. */
function formatMontant(cents: number, devise: string, locale: string): string {
  const code = devise.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(cents / 100);
    } catch {
      // code bien formé mais inconnu d'ICU — affichage brut honnête
    }
  }
  return `${(cents / 100).toFixed(2)} ${code || "???"}`;
}

/** Montant saisi (unité principale, virgule ou point) → centimes entiers ; null si irrecevable. */
function parseMontantCentimes(valeur: string): number | null {
  const normalise = valeur.trim().replace(",", ".");
  if (!normalise || !/^\d+(\.\d{1,2})?$/.test(normalise)) return null;
  const centimes = Math.round(parseFloat(normalise) * 100);
  return centimes > 0 ? centimes : null;
}

/** historyJson parsé réellement — un JSON absent ou invalide rend une liste vide, jamais une donnée fabriquée. */
function historiqueParses(json: string): EntreeHistorique[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    const entrees: EntreeHistorique[] = [];
    for (const e of parsed) {
      if (typeof e !== "object" || e === null || !("action" in e)) continue;
      const obj = e as Record<string, unknown>;
      entrees.push({
        at: typeof obj.at === "string" ? obj.at : "",
        byId: typeof obj.byId === "string" ? obj.byId : null,
        action: String(obj.action),
        from: typeof obj.from === "object" && obj.from !== null ? (obj.from as Record<string, unknown>) : null,
        to: typeof obj.to === "object" && obj.to !== null ? (obj.to as Record<string, unknown>) : null,
        note: typeof obj.note === "string" ? obj.note : null,
      });
    }
    return entrees;
  } catch {
    return [];
  }
}

/** Valeur brute d'un champ d'historique, normalisée pour comparaison avant/après. */
function valeurChamp(entree: Record<string, unknown> | null, champ: string): string {
  if (!entree) return "";
  const v = entree[champ];
  if (champ === "operationDate") {
    if (typeof v !== "string" || !v) return "";
    return v.slice(0, 10);
  }
  if (v === null || v === undefined) return "";
  return String(v);
}

/** Pastille de statut — couleurs sémantiques issues des tokens OKLCH du thème. */
function BadgeStatut({ status }: { status: string }) {
  const { t } = useI18n();
  const label = t(`finances.status.${status}`, status);
  if (status === "VALIDE") {
    return (
      <Badge className="border-transparent" style={{ background: "var(--ruban-fond)", color: "var(--ruban)" }}>
        {label}
      </Badge>
    );
  }
  if (status === "A_VERIFIER") {
    return (
      <Badge className="border-transparent" style={{ background: "var(--carton-fond)", color: "var(--carton)" }}>
        {label}
      </Badge>
    );
  }
  if (status === "REJETEE") return <Badge variant="destructive">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
}

/** Source de l'opération — icône + libellé i18n. */
function LibelleSource({ sourceType }: { sourceType: string }) {
  const { t } = useI18n();
  const Icone = ICONES_SOURCE[sourceType] ?? PencilLine;
  return (
    <span className="inline-flex max-w-[140px] items-center gap-1.5 text-[12.5px] text-muted-foreground">
      <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{t(`finances.source.${sourceType}`, sourceType)}</span>
    </span>
  );
}

/** Vue Finances — registre des opérations financières : traçabilité Organisation → Client → Groupe → Événement source → Opération. Une information extraite n'est jamais un encaissement confirmé : seul un humain (ADMIN+) pose VALIDE. Les corrections n'effacent jamais l'historique. */
export function FinancesView() {
  const { t, lang } = useI18n();
  const { call } = useApi();
  const role = useAppStore((s) => s.session?.role);

  // Rôles : Valider/Rejeter réservés à PROPRIETAIRE/ADMINISTRATEUR ; Corriger et créer accessibles à EMPLOYE+
  const peutValiderRole = role === "PROPRIETAIRE" || role === "ADMINISTRATEUR";
  const peutCorriger = role === "PROPRIETAIRE" || role === "ADMINISTRATEUR" || role === "EMPLOYE";

  // — Registre réel —
  const [operations, setOperations] = useState<OperationFinanciere[] | null>(null);
  const [summary, setSummary] = useState<Resume | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [erreur, setErreur] = useState(false);
  const [tick, setTick] = useState(0);

  // — Filtres réels —
  const [q, setQ] = useState("");
  const [qDebounce, setQDebounce] = useState("");
  const [filtreStatut, setFiltreStatut] = useState("");
  const [filtreClient, setFiltreClient] = useState("");

  // — Référentiels réels pour les filtres et la saisie —
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [groups, setGroups] = useState<GroupLite[]>([]);

  // — Création manuelle —
  const [creationOpen, setCreationOpen] = useState(false);
  const [form, setForm] = useState(formCreationVide);
  const [envoi, setEnvoi] = useState(false);

  // — Correction (Dialog + note obligatoire) —
  const [correction, setCorrection] = useState<OperationFinanciere | null>(null);
  const [formCorrection, setFormCorrection] = useState(formCorrectionVide);

  // — Décisions humaines —
  const [aValider, setAValider] = useState<OperationFinanciere | null>(null);
  const [aRejeter, setARejeter] = useState<OperationFinanciere | null>(null);
  const [motifRejet, setMotifRejet] = useState("");

  // — Détail —
  const [detail, setDetail] = useState<OperationFinanciere | null>(null);

  const locale = lang === "en" ? "en" : "fr";
  const recharger = useCallback(() => setTick((v) => v + 1), []);

  // Recherche réelle avec temporisation légère 400 ms
  useEffect(() => {
    const id = setTimeout(() => {
      setQDebounce(q);
      setPage(1);
    }, 400);
    return () => clearTimeout(id);
  }, [q]);

  // Registre réel : rechargé à chaque changement de recherche/filtre/page (callback asynchrone, jamais de setState synchrone)
  useEffect(() => {
    let vivant = true;
    const params = new URLSearchParams();
    if (qDebounce) params.set("q", qDebounce);
    if (filtreClient) params.set("clientId", filtreClient);
    if (filtreStatut) params.set("status", filtreStatut);
    params.set("page", String(page));
    apiGet<{ total: number; page: number; operations: OperationFinanciere[]; summary: Resume }>(
      `/api/finances?${params.toString()}`,
    ).then((d) => {
      if (!vivant) return;
      if (d) {
        setOperations(d.operations);
        setSummary(d.summary);
        setTotal(d.total);
        setErreur(false);
      } else {
        setErreur(true);
      }
    });
    return () => {
      vivant = false;
    };
  }, [qDebounce, filtreClient, filtreStatut, page, tick]);

  // Référentiels réels (clients pour le filtre, groupes pour la saisie)
  useEffect(() => {
    let vivant = true;
    apiGet<{ clients: ClientLite[] }>("/api/clients").then((d) => {
      if (vivant && d) setClients(d.clients);
    });
    apiGet<{ groups: GroupLite[] }>("/api/groups").then((d) => {
      if (vivant && d) setGroups(d.groups);
    });
    return () => {
      vivant = false;
    };
  }, []);

  const filtresActifs = qDebounce !== "" || filtreStatut !== "" || filtreClient !== "";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const lignesDevise = (totaux: Record<string, number> | undefined): { devise: string; cents: number }[] =>
    Object.entries(totaux ?? {}).map(([devise, cents]) => ({ devise, cents }));

  const couleurResume = (statut: string): string => {
    if (statut === "VALIDE") return "var(--ruban)";
    if (statut === "A_VERIFIER") return "var(--carton)";
    return "var(--encre-3)";
  };

  // — Création manuelle —
  const ouvrirCreation = () => {
    setForm(formCreationVide);
    setCreationOpen(true);
  };

  const fermerCreation = (v: boolean) => {
    setCreationOpen(v);
    if (!v) setForm(formCreationVide);
  };

  const creer = async () => {
    const centimes = parseMontantCentimes(form.montant);
    const devise = form.currency.trim().toUpperCase();
    if (!form.label.trim() || centimes == null || !/^[A-Z]{3}$/.test(devise)) return;
    setEnvoi(true);
    const res = await call<{ operation: OperationFinanciere }>("/api/finances", {
      method: "POST",
      body: JSON.stringify({
        label: form.label.trim(),
        amountCents: centimes,
        currency: devise,
        ...(form.date ? { operationDate: form.date } : {}),
        ...(form.clientId ? { clientId: form.clientId } : {}),
        ...(form.groupId ? { groupId: form.groupId } : {}),
        ...(form.confirmer && peutValiderRole ? { confirmer: true } : {}),
      }),
    });
    setEnvoi(false);
    if (res) {
      toast({ description: t("toast.financeCreated") });
      fermerCreation(false);
      setPage(1);
      recharger();
    }
  };

  // — Correction : au moins un champ réellement modifié + note —
  const ouvrirCorrection = (op: OperationFinanciere) => {
    setFormCorrection({
      label: op.label,
      montant: op.amountCents != null ? (op.amountCents / 100).toFixed(2) : "",
      currency: op.currency,
      date: op.operationDate ? op.operationDate.slice(0, 10) : "",
      note: "",
    });
    setCorrection(op);
  };

  const correctionChangee = useMemo(() => {
    if (!correction) return false;
    if (formCorrection.label.trim() && formCorrection.label.trim() !== correction.label) return true;
    const centimes = parseMontantCentimes(formCorrection.montant);
    if (centimes != null && centimes !== correction.amountCents) return true;
    const devise = formCorrection.currency.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(devise) && devise !== correction.currency.toUpperCase()) return true;
    if (formCorrection.date && formCorrection.date !== (correction.operationDate ? correction.operationDate.slice(0, 10) : "")) return true;
    return false;
  }, [correction, formCorrection]);

  const corriger = async () => {
    const op = correction;
    if (!op) return;
    const note = formCorrection.note.trim();
    if (!note || !correctionChangee) return;
    const corps: Record<string, unknown> = { note };
    if (formCorrection.label.trim() && formCorrection.label.trim() !== op.label) corps.label = formCorrection.label.trim();
    const centimes = parseMontantCentimes(formCorrection.montant);
    if (centimes != null && centimes !== op.amountCents) corps.amountCents = centimes;
    const devise = formCorrection.currency.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(devise) && devise !== op.currency.toUpperCase()) corps.currency = devise;
    if (formCorrection.date && formCorrection.date !== (op.operationDate ? op.operationDate.slice(0, 10) : "")) {
      corps.operationDate = formCorrection.date;
    }
    setEnvoi(true);
    const res = await call<{ operation: OperationFinanciere }>(`/api/finances/${op.id}`, {
      method: "PATCH",
      body: JSON.stringify(corps),
    });
    setEnvoi(false);
    if (res) {
      toast({ description: t("toast.financeCorrected") });
      setCorrection(null);
      recharger();
    }
  };

  // — Décisions humaines réelles —
  const valider = async () => {
    if (!aValider) return;
    const res = await call<{ operation: OperationFinanciere }>(`/api/finances/${aValider.id}/validate`, {
      method: "POST",
      body: JSON.stringify({ action: "VALIDER" }),
    });
    if (res) {
      toast({ description: t("toast.financeValidated") });
      setAValider(null);
      recharger();
    }
  };

  const rejeter = async () => {
    if (!aRejeter) return;
    const note = motifRejet.trim();
    if (!note) return;
    const res = await call<{ operation: OperationFinanciere }>(`/api/finances/${aRejeter.id}/validate`, {
      method: "POST",
      body: JSON.stringify({ action: "REJETER", note }),
    });
    if (res) {
      toast({ description: t("toast.financeRejected") });
      setARejeter(null);
      setMotifRejet("");
      recharger();
    }
  };

  // Groupes réellement rattachables au client choisi (D15 : jamais de couple incohérent)
  const groupesRattachables = form.clientId ? groups.filter((g) => g.clientId === form.clientId) : groups;

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* En-tête — un seul bouton primaire par écran */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[20px] font-semibold">{t("finances.title")}</h2>
          <p className="mt-1 max-w-[680px] text-[13px] text-muted-foreground">{t("finances.subtitle")}</p>
        </div>
        {peutCorriger && <Button onClick={ouvrirCreation}>{t("finances.add")}</Button>}
      </div>

      {/* Cartes résumé réelles — montants groupés par devise réelle */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CARTES_RESUME.map((statut) => (
          <section
            key={statut}
            className="rounded-lg border border-[var(--bordure)] bg-[var(--papier-leve)] px-5 py-4"
            aria-label={t(`finances.summary.${statut}`)}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">{t(`finances.summary.${statut}`)}</p>
              <span className="h-2 w-2 rounded-full" style={{ background: couleurResume(statut) }} aria-hidden="true" />
            </div>
            {summary === null ? (
              <Skeleton className="mt-2 h-7 w-28 rounded-md" />
            ) : lignesDevise(summary.totals[statut]).length === 0 ? (
              <p className="mt-1.5 font-display text-[20px] leading-tight text-muted-foreground">—</p>
            ) : (
              <div className="mt-1.5">
                {lignesDevise(summary.totals[statut]).map((l) => (
                  <p key={l.devise} className="font-display tnum text-[20px] leading-tight">
                    {formatMontant(l.cents, l.devise, locale)}
                  </p>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11.5px] tnum text-muted-foreground">
              {t("finances.summary.count").replace("{n}", String(summary?.counts[statut] ?? 0))}
            </p>
          </section>
        ))}
      </div>

      {/* Filtres réels : recherche (temporisée), statut, client */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("finances.search")}
            aria-label={t("finances.search")}
            className="h-10 pl-8 bg-[var(--papier-creuse)]"
          />
        </div>
        <Select
          value={filtreStatut || "all"}
          onValueChange={(v) => {
            setFiltreStatut(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-10 w-[170px] bg-[var(--papier-creuse)]" aria-label={t("finances.filter.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("finances.filter.all")}</SelectItem>
            {STATUTS_FILTRES.map((st) => (
              <SelectItem key={st} value={st}>
                {t(`finances.status.${st}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filtreClient || "all"}
          onValueChange={(v) => {
            setFiltreClient(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-10 w-[190px] bg-[var(--papier-creuse)]" aria-label={t("finances.filter.client")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("finances.filter.all")}</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtresActifs && (
          <Button
            variant="ghost"
            className="h-10 text-[12px] text-muted-foreground"
            onClick={() => {
              setQ("");
              setFiltreStatut("");
              setFiltreClient("");
              setPage(1);
            }}
          >
            {t("common.resetFilters")}
          </Button>
        )}
      </div>

      {/* État de chargement réel */}
      {operations === null && !erreur && (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
        </div>
      )}

      {/* État d'erreur réel — bouton Réessayer */}
      {erreur && operations === null && (
        <div className="mt-4 rounded-lg border border-[var(--bordure)] bg-[var(--papier-leve)] px-6 py-10 text-center">
          <p className="text-[13.5px] text-muted-foreground">{t("finances.error")}</p>
          <Button variant="outline" className="mt-4 h-11" onClick={recharger}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {/* État vide réel — message clair + action */}
      {operations !== null && operations.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--bordure-forte)] px-6 py-10 text-center">
          <p className="text-[13.5px] text-muted-foreground">{filtresActifs ? t("common.noResults") : t("finances.empty")}</p>
          {!filtresActifs && peutCorriger && (
            <Button variant="outline" className="mt-4 h-11" onClick={ouvrirCreation}>
              {t("finances.add")}
            </Button>
          )}
        </div>
      )}

      {/* Registre réel — table shadcn, défilement vertical borné et horizontal sur mobile */}
      {operations !== null && operations.length > 0 && (
        <div className="scroll-fin mt-4 max-h-96 overflow-y-auto rounded-lg border border-[var(--bordure)] bg-[var(--papier-leve)]">
          <Table aria-label={t("finances.title")}>
            <TableHeader className="sticky top-0 z-10 bg-[var(--papier-leve)]">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("finances.col.date")}</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("finances.col.label")}</TableHead>
                <TableHead className="h-9 text-right text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("finances.col.amount")}</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("finances.col.status")}</TableHead>
                <TableHead className="h-9 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("finances.col.source")}</TableHead>
                <TableHead className="hidden h-9 text-[11px] uppercase tracking-[0.06em] text-muted-foreground sm:table-cell">{t("finances.col.clientGroup")}</TableHead>
                <TableHead className="h-9 text-right text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operations.map((op) => (
                <TableRow
                  key={op.id}
                  tabIndex={0}
                  onClick={() => setDetail(op)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetail(op);
                    }
                  }}
                  className="cursor-pointer"
                  aria-label={op.label}
                >
                  <TableCell className="tnum whitespace-nowrap text-[12.5px] text-muted-foreground">
                    {op.operationDate ? new Date(op.operationDate).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate text-[13.5px] font-medium" title={op.label}>
                    {op.label}
                  </TableCell>
                  <TableCell className="tnum whitespace-nowrap text-right text-[13px]">
                    {op.amountCents != null ? formatMontant(op.amountCents, op.currency, locale) : "—"}
                  </TableCell>
                  <TableCell>
                    <BadgeStatut status={op.status} />
                  </TableCell>
                  <TableCell>
                    <LibelleSource sourceType={op.sourceType} />
                  </TableCell>
                  <TableCell className="hidden max-w-[180px] sm:table-cell">
                    <div className="truncate text-[12.5px]" title={op.client?.name ?? undefined}>
                      {op.client?.name ?? "—"}
                    </div>
                    {op.group && (
                      <div className="truncate text-[11.5px] text-muted-foreground" title={op.group.name}>
                        {op.group.name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-1">
                      {peutValiderRole && (op.status === "EXTRAITE" || op.status === "A_VERIFIER") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
                          aria-label={t("finances.actions.validate")}
                          title={t("finances.actions.validate")}
                          onClick={() => setAValider(op)}
                        >
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                      {peutValiderRole && op.status !== "VALIDE" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
                          aria-label={t("finances.actions.reject")}
                          title={t("finances.actions.reject")}
                          onClick={() => {
                            setMotifRejet("");
                            setARejeter(op);
                          }}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                      {peutCorriger && op.status !== "REJETEE" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
                          aria-label={t("finances.actions.correct")}
                          title={t("finances.actions.correct")}
                          onClick={() => ouvrirCorrection(op)}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination réelle */}
      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-[12.5px] tnum text-muted-foreground">
            {t("common.page")} {page} / {totalPages} · {total} {t("common.results")}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="h-11" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              {t("common.prev")}
            </Button>
            <Button variant="outline" className="h-11" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              {t("common.next")}
            </Button>
          </div>
        </div>
      )}

      {/* ——— Détail réel : identité, source, confiance, historique chronologique ——— */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="scroll-fin max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6 font-display text-[18px] leading-snug">{detail.label}</DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-2">
                  <BadgeStatut status={detail.status} />
                  <span className="tnum">
                    {detail.amountCents != null ? formatMontant(detail.amountCents, detail.currency, locale) : "—"}
                  </span>
                </DialogDescription>
              </DialogHeader>

              <dl className="space-y-2 text-[13px]">
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted-foreground">{t("finances.col.date")}</dt>
                  <dd className="tnum text-right">
                    {detail.operationDate ? new Date(detail.operationDate).toLocaleDateString() : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted-foreground">{t("finances.col.source")}</dt>
                  <dd className="text-right">
                    <LibelleSource sourceType={detail.sourceType} />
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted-foreground">{t("finances.col.clientGroup")}</dt>
                  <dd className="min-w-0 text-right">
                    {detail.client?.name ?? "—"}
                    {detail.group ? ` · ${detail.group.name}` : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted-foreground">{t("finances.detail.confidence")}</dt>
                  <dd className="tnum text-right">{Math.round(detail.confidence * 100)}%</dd>
                </div>
                {detail.needsReview && (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-muted-foreground">{t("finances.detail.needsReview")}</dt>
                    <dd>
                      <Badge className="border-transparent" style={{ background: "var(--carton-fond)", color: "var(--carton)" }}>
                        {t("finances.status.A_VERIFIER")}
                      </Badge>
                    </dd>
                  </div>
                )}
                {detail.validatedAt && (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-muted-foreground">{t("finances.detail.validatedBy")}</dt>
                    <dd className="tnum text-right">{new Date(detail.validatedAt).toLocaleString()}</dd>
                  </div>
                )}
                {detail.rejectionReason && (
                  <div className="flex justify-between gap-4">
                    <dt className="shrink-0 text-muted-foreground">{t("finances.detail.rejectedReason")}</dt>
                    <dd className="min-w-0 text-right">{detail.rejectionReason}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-muted-foreground">{t("finances.detail.createdBy")}</dt>
                  <dd className="tnum text-right">{new Date(detail.createdAt).toLocaleString()}</dd>
                </div>
              </dl>

              {/* Traçabilité réelle vers l'événement source (identifiants bruts, jamais inventés) */}
              {(detail.sourceFileId || detail.sourceReceptionId || detail.sourceWebhookEventId || detail.sourceKey) && (
                <div className="rounded-md border border-[var(--bordure)] bg-[var(--papier-creuse)] p-3">
                  <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("finances.detail.sourceTrace")}</p>
                  <ul className="mt-1.5 space-y-1 text-[12px] tnum">
                    {detail.sourceFileId && (
                      <li className="flex flex-wrap justify-between gap-x-3">
                        <span className="text-muted-foreground">{t("finances.detail.sourceFile")}</span>
                        <span className="min-w-0 break-all text-right">{detail.sourceFileId}</span>
                      </li>
                    )}
                    {detail.sourceReceptionId && (
                      <li className="flex flex-wrap justify-between gap-x-3">
                        <span className="text-muted-foreground">{t("finances.detail.sourceReception")}</span>
                        <span className="min-w-0 break-all text-right">{detail.sourceReceptionId}</span>
                      </li>
                    )}
                    {detail.sourceWebhookEventId && (
                      <li className="flex flex-wrap justify-between gap-x-3">
                        <span className="text-muted-foreground">{t("finances.detail.sourceWebhook")}</span>
                        <span className="min-w-0 break-all text-right">{detail.sourceWebhookEventId}</span>
                      </li>
                    )}
                    <li className="flex flex-wrap justify-between gap-x-3">
                      <span className="text-muted-foreground">{t("finances.detail.sourceKey")}</span>
                      <span className="min-w-0 break-all text-right">{detail.sourceKey}</span>
                    </li>
                  </ul>
                </div>
              )}

              {/* Historique chronologique — corrections montrées avant/après, jamais d'effacement */}
              <div>
                <p className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{t("finances.detail.history")}</p>
                {historiqueParses(detail.historyJson).length === 0 ? (
                  <p className="mt-2 text-[12.5px] text-muted-foreground">{t("finances.detail.historyEmpty")}</p>
                ) : (
                  <ul className="mt-2 border-t border-[var(--bordure)]">
                    {historiqueParses(detail.historyJson).map((h, i) => {
                      const deviseEntree =
                        typeof h.to?.currency === "string"
                          ? h.to.currency
                          : typeof h.from?.currency === "string"
                            ? h.from.currency
                            : detail.currency;
                      return (
                        <li key={i} className="border-b border-[var(--bordure)] py-2.5">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-[12.5px] font-medium">{t(`finances.history.${h.action}`, h.action)}</span>
                            {h.action !== "CORRECTION" && typeof h.from?.status === "string" && typeof h.to?.status === "string" && (
                              <span className="text-[12px] tnum text-muted-foreground">
                                {t(`finances.status.${h.from.status}`, h.from.status)} →{" "}
                                {t(`finances.status.${h.to.status}`, h.to.status)}
                              </span>
                            )}
                            <time className="ml-auto text-[11px] tnum text-muted-foreground">
                              {h.at ? new Date(h.at).toLocaleString() : "—"}
                            </time>
                          </div>
                          {h.action === "CORRECTION" && h.from && h.to && (
                            <ul className="mt-1.5 space-y-1 rounded-md border border-[var(--bordure)] bg-[var(--papier-creuse)] p-2">
                              {CHAMPS_CORRECTION.filter((champ) => valeurChamp(h.from, champ) !== valeurChamp(h.to, champ)).map((champ) => {
                                const affiche = (entree: Record<string, unknown> | null): string => {
                                  const brut = valeurChamp(entree, champ);
                                  if (!brut) return "—";
                                  if (champ === "amountCents") {
                                    const n = Number(brut);
                                    return Number.isFinite(n) ? formatMontant(n, deviseEntree, locale) : brut;
                                  }
                                  if (champ === "operationDate") return new Date(brut).toLocaleDateString();
                                  if (champ === "status") return t(`finances.status.${brut}`, brut);
                                  return brut;
                                };
                                return (
                                  <li key={champ} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                                    <span className="text-muted-foreground">{t(`finances.field.${champ}`)}</span>
                                    <span className="tnum line-through decoration-[var(--bordure-forte)]">{affiche(h.from)}</span>
                                    <span aria-hidden="true">→</span>
                                    <span className="tnum font-medium">{affiche(h.to)}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {h.note && <p className="mt-1 text-[12px] text-muted-foreground">{h.note}</p>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" className="h-11" onClick={() => setDetail(null)}>
                  {t("common.close")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ——— Création manuelle ——— */}
      <Sheet open={creationOpen} onOpenChange={fermerCreation}>
        <SheetContent side="right" className="w-[420px] sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle className="font-display text-[18px]">{t("finances.add")}</SheetTitle>
            <SheetDescription>{t("finances.form.description")}</SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-1 flex-col gap-4 px-4"
            onSubmit={(e) => {
              e.preventDefault();
              creer();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="fin-label">{t("finances.form.label")}</Label>
              <Input
                id="fin-label"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                className="h-11 bg-[var(--papier-creuse)]"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fin-montant">{t("finances.form.amount")}</Label>
                <Input
                  id="fin-montant"
                  inputMode="decimal"
                  value={form.montant}
                  onChange={(e) => setForm({ ...form, montant: e.target.value })}
                  className="h-11 bg-[var(--papier-creuse)] tnum"
                  placeholder="150,00"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fin-devise">{t("finances.form.currency")}</Label>
                <Input
                  id="fin-devise"
                  maxLength={3}
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                  className="h-11 bg-[var(--papier-creuse)] uppercase"
                  placeholder="EUR"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fin-date">{t("finances.form.date")}</Label>
              <Input
                id="fin-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="h-11 bg-[var(--papier-creuse)]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fin-client">{t("finances.form.client")}</Label>
              <Select
                value={form.clientId || "none"}
                onValueChange={(v) => {
                  const id = v === "none" ? "" : v;
                  setForm((f) => ({
                    ...f,
                    clientId: id,
                    groupId: id && f.groupId && !groups.some((g) => g.id === f.groupId && g.clientId === id) ? "" : f.groupId,
                  }));
                }}
              >
                <SelectTrigger id="fin-client" className="h-11 w-full bg-[var(--papier-creuse)]">
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
              <Label htmlFor="fin-groupe">{t("finances.form.group")}</Label>
              <Select
                value={form.groupId || "none"}
                onValueChange={(v) => {
                  const id = v === "none" ? "" : v;
                  // D15 réel : choisir un groupe détermine son client — jamais de couple incohérent
                  const groupe = groups.find((g) => g.id === id);
                  setForm((f) => ({ ...f, groupId: id, clientId: groupe ? groupe.clientId : f.clientId }));
                }}
              >
                <SelectTrigger id="fin-groupe" className="h-11 w-full bg-[var(--papier-creuse)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("common.none")}</SelectItem>
                  {groupesRattachables.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} ({g.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {peutValiderRole && (
              <div className="rounded-md border border-[var(--bordure)] bg-[var(--papier-creuse)] p-3">
                <label className="flex items-start gap-2.5" htmlFor="fin-confirmer">
                  <Checkbox
                    id="fin-confirmer"
                    checked={form.confirmer}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, confirmer: v === true }))}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-[13px] font-medium">{t("finances.form.confirmer")}</span>
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{t("finances.form.confirmerHint")}</span>
                  </span>
                </label>
              </div>
            )}
            <SheetFooter className="mt-auto flex-row justify-between">
              <Button type="button" variant="ghost" className="h-11" onClick={() => fermerCreation(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" className="h-11" disabled={envoi || !form.label.trim() || parseMontantCentimes(form.montant) == null}>
                {t("finances.form.submit")}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* ——— Correction réelle — note consignée dans l'historique ——— */}
      <Dialog
        open={!!correction}
        onOpenChange={(v) => {
          if (!v) {
            setCorrection(null);
            setFormCorrection(formCorrectionVide);
          }
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          {correction && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-[18px]">{t("finances.actions.correct")}</DialogTitle>
                <DialogDescription className="truncate">{correction.label}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="fin-corr-label">{t("finances.form.label")}</Label>
                  <Input
                    id="fin-corr-label"
                    value={formCorrection.label}
                    onChange={(e) => setFormCorrection({ ...formCorrection, label: e.target.value })}
                    className="h-10 bg-[var(--papier-creuse)]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="fin-corr-montant">{t("finances.form.amount")}</Label>
                    <Input
                      id="fin-corr-montant"
                      inputMode="decimal"
                      value={formCorrection.montant}
                      onChange={(e) => setFormCorrection({ ...formCorrection, montant: e.target.value })}
                      className="h-10 bg-[var(--papier-creuse)] tnum"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fin-corr-devise">{t("finances.form.currency")}</Label>
                    <Input
                      id="fin-corr-devise"
                      maxLength={3}
                      value={formCorrection.currency}
                      onChange={(e) => setFormCorrection({ ...formCorrection, currency: e.target.value.toUpperCase() })}
                      className="h-10 bg-[var(--papier-creuse)] uppercase"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fin-corr-date">{t("finances.form.date")}</Label>
                  <Input
                    id="fin-corr-date"
                    type="date"
                    value={formCorrection.date}
                    onChange={(e) => setFormCorrection({ ...formCorrection, date: e.target.value })}
                    className="h-10 bg-[var(--papier-creuse)]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fin-corr-note">{t("finances.form.note")}</Label>
                  <Textarea
                    id="fin-corr-note"
                    rows={3}
                    value={formCorrection.note}
                    onChange={(e) => setFormCorrection({ ...formCorrection, note: e.target.value })}
                    className="bg-[var(--papier-creuse)]"
                    required
                  />
                </div>
                {correction.status === "VALIDE" && (
                  <p className="text-[11.5px] text-muted-foreground">{t("finances.form.correctionNote")}</p>
                )}
              </div>
              <DialogFooter className="flex-row justify-between sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11"
                  onClick={() => {
                    setCorrection(null);
                    setFormCorrection(formCorrectionVide);
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button className="h-11" disabled={envoi || !formCorrection.note.trim() || !correctionChangee} onClick={corriger}>
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ——— Validation humaine (ADMIN+) ——— */}
      <AlertDialog open={!!aValider} onOpenChange={(v) => !v && setAValider(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{t("finances.confirm.validateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("finances.confirm.validateDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11" onClick={valider}>
              {t("finances.actions.validate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ——— Rejet humain (ADMIN+) — motif obligatoire ——— */}
      <AlertDialog open={!!aRejeter} onOpenChange={(v) => !v && setARejeter(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{t("finances.confirm.rejectTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("finances.confirm.rejectDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="fin-rejet-note">{t("finances.reject.note")}</Label>
            <Textarea
              id="fin-rejet-note"
              rows={3}
              value={motifRejet}
              onChange={(e) => setMotifRejet(e.target.value)}
              className="bg-[var(--papier-creuse)]"
            />
            {!motifRejet.trim() && <p className="text-[11.5px] text-muted-foreground">{t("finances.reject.noteRequired")}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11" disabled={!motifRejet.trim()} onClick={rejeter}>
              {t("finances.actions.reject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
