"use client";

/**
 * Console plateforme — espace exploitant, AU-DESSUS des organisations (CDC §4.9).
 * Vue réelle cross-organisations : totaux, état des services, demandes de
 * résiliation, registre des organisations et gestes commerciaux journalisés.
 * Réservée aux opérateurs déclarés (isPlatformAdmin) — jamais visible d'un
 * gestionnaire d'organisation.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/hooks/use-api";
import { toast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, SlidersHorizontal } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type GesteAction =
  | "PROLONGER_ESSAI"
  | "OCTROYER_CREDITS"
  | "CHANGER_PLAN"
  | "SUSPENDRE"
  | "REACTIVER"
  | "RESILIER"
  | "PURGER";

type OrgOverview = {
  id: string;
  name: string;
  slug: string;
  status: string;
  trialEndsAt: string | null;
  purgeScheduledAt: string | null;
  createdAt: string;
  users: number;
  planCode: string;
  subscriptionStatus: string;
  cancelRequestedAt: string | null;
  cancelReason: string | null;
  documents: number;
  clients: number;
  groups: number;
  deliverables: number;
  conversations: number;
  agentTasks: number;
  storageBytes: number;
  credits: number;
  lastActivityAt: string | null;
};

type ServiceRow = {
  connector: string;
  connectes: number;
  nonConfigures: number;
  erreurs: number;
  totalOrganisations: number;
};

type PlatformPlan = { code: string; name: string; priceMonthlyCents: number };

type PlatformData = {
  /** L'API nomme ce tableau « organisations » (orthographe du CDC). */
  organisations: OrgOverview[];
  services: ServiceRow[];
  cancellations: OrgOverview[];
  totals: {
    organisations: number;
    actives: number;
    expirees: number;
    resiliees: number;
    purgees: number;
    documents: number;
    utilisateurs: number;
    stockageOctets: number;
  };
  plans: PlatformPlan[];
  environnement: {
    polarConfigure: boolean;
    whatsappConfigure: boolean;
    driveConfigure: boolean;
    n8nConfigure: boolean;
    resendConfigure: boolean;
    docAiConfigure: boolean;
    azureConfigure: boolean;
    noteHonnête: string;
  };
};

const PAGE_SIZE = 25;

/** Interpolation locale des libellés {cle}. */
function fmt(template: string, params: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}

/** Taille humaine formatée (o / ko / Mo / Go). */
function formatOctets(bytes: number) {
  if (bytes <= 0) return "0 o";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </h2>
  );
}

/** Pastille de statut d'organisation — forme + libellé, jamais la couleur seule. */
function StatutOrg({ status }: { status: string }) {
  const { t } = useI18n();
  const label = t(`platform.status.${status}`, status);
  if (status === "ACTIF") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium whitespace-nowrap" style={{ color: "var(--ruban)" }}>
        <span className="h-2 w-2 rounded-full" style={{ background: "var(--ruban)" }} aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (status === "ESSAI_EXPIRE") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium whitespace-nowrap" style={{ color: "var(--carton)" }}>
        <span className="h-2 w-2 rounded-full" style={{ background: "var(--carton)" }} aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (status === "SUSPENDU" || status === "RESILIE") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium whitespace-nowrap" style={{ color: "var(--erreur)" }}>
        <span className="relative h-2 w-2" aria-hidden="true">
          <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2" style={{ background: "var(--erreur)" }} />
          <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2" style={{ background: "var(--erreur)" }} />
        </span>
        {label}
      </span>
    );
  }
  if (status === "PURGE") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium whitespace-nowrap opacity-60" style={{ color: "var(--encre-3)" }}>
        <span className="h-2 w-2 rounded-full border-2" style={{ borderColor: "var(--encre-3)" }} aria-hidden="true" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium whitespace-nowrap" style={{ color: "var(--encre-2)" }}>
      <span className="h-2 w-2 rounded-full border-2" style={{ borderColor: "var(--encre-2)" }} aria-hidden="true" />
      {label}
    </span>
  );
}

export function PlatformView() {
  const { t } = useI18n();
  const { call } = useApi();
  const isPlatformAdmin = useAppStore((s) => s.session?.isPlatformAdmin === true);

  const [data, setData] = useState<PlatformData | null>(null);
  const [etat, setEtat] = useState<"loading" | "ready" | "error">("loading");

  const [recherche, setRecherche] = useState("");
  const [page, setPage] = useState(1);

  // Geste commercial en cours
  const [geste, setGeste] = useState<{ org: OrgOverview; action: GesteAction } | null>(null);
  const [jours, setJours] = useState("");
  const [credits, setCredits] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [motif, setMotif] = useState("");
  const [gesteBusy, setGesteBusy] = useState(false);

  // Double confirmation de purge
  const [purgeStep, setPurgeStep] = useState<1 | 2>(1);
  const [purgeName, setPurgeName] = useState("");

  const load = useCallback(async () => {
    setEtat("loading");
    try {
      const res = await fetch("/api/platform/overview", { cache: "no-store" });
      if (!res.ok) throw new Error("erreur");
      const d = (await res.json()) as PlatformData;
      setData(d);
      setEtat("ready");
    } catch {
      setEtat("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Nouvelle recherche : retour à la première page
  useEffect(() => {
    setPage(1);
  }, [recherche]);

  const orgsFiltrees = useMemo(() => {
    if (!data) return [];
    const q = recherche.trim().toLowerCase();
    if (!q) return data.organisations;
    return data.organisations.filter(
      (o) => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q),
    );
  }, [data, recherche]);

  const totalPages = Math.max(1, Math.ceil(orgsFiltrees.length / PAGE_SIZE));
  const pageSure = Math.min(page, totalPages);
  const orgsPage = orgsFiltrees.slice((pageSure - 1) * PAGE_SIZE, pageSure * PAGE_SIZE);

  function ouvrirGeste(org: OrgOverview, action: GesteAction) {
    setGeste({ org, action });
    setJours("");
    setCredits("");
    setPlanCode("");
    setMotif("");
    setPurgeStep(1);
    setPurgeName("");
  }

  function fermerGeste() {
    setGeste(null);
    setJours("");
    setCredits("");
    setPlanCode("");
    setMotif("");
    setPurgeStep(1);
    setPurgeName("");
  }

  const champValide = () => {
    if (!geste) return false;
    switch (geste.action) {
      case "PROLONGER_ESSAI": {
        const n = Number(jours);
        return Number.isInteger(n) && n >= 1 && n <= 90;
      }
      case "OCTROYER_CREDITS": {
        const n = Number(credits);
        return Number.isInteger(n) && n >= 1 && n <= 100000;
      }
      case "CHANGER_PLAN":
        return planCode.length > 0;
      default:
        return true;
    }
  };

  async function appliquerGeste() {
    if (!geste || gesteBusy) return;
    setGesteBusy(true);
    const payload: Record<string, unknown> = { organizationId: geste.org.id, action: geste.action };
    if (geste.action === "PROLONGER_ESSAI") payload.jours = Number(jours);
    if (geste.action === "OCTROYER_CREDITS") payload.credits = Number(credits);
    if (geste.action === "CHANGER_PLAN") payload.planCode = planCode;
    if ((geste.action === "SUSPENDRE" || geste.action === "RESILIER" || geste.action === "PURGER") && motif.trim()) {
      payload.motif = motif.trim();
    }
    const result = await call<{ ok: boolean }>("/api/platform/geste", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setGesteBusy(false);
    if (result) {
      toast({ title: t("platform.geste.done"), description: geste.org.name });
      fermerGeste();
      void load();
    }
  }

  // Garde d'accès : un gestionnaire d'organisation ne voit jamais cet écran.
  if (!isPlatformAdmin) return null;

  const envEntries: { key: string; ok: boolean }[] = data
    ? [
        { key: "platform.env.polar", ok: data.environnement.polarConfigure },
        { key: "platform.env.whatsapp", ok: data.environnement.whatsappConfigure },
        { key: "platform.env.drive", ok: data.environnement.driveConfigure },
        { key: "platform.env.n8n", ok: data.environnement.n8nConfigure },
        { key: "platform.env.smtp", ok: data.environnement.resendConfigure },
        { key: "platform.env.docai", ok: data.environnement.docAiConfigure },
        { key: "platform.env.azure", ok: data.environnement.azureConfigure },
      ]
    : [];

  const totaux: { key: string; value: string }[] = data
    ? [
        { key: "platform.totals.organisations", value: String(data.totals.organisations) },
        { key: "platform.totals.actives", value: String(data.totals.actives) },
        { key: "platform.totals.expirees", value: String(data.totals.expirees) },
        { key: "platform.totals.resiliees", value: String(data.totals.resiliees) },
        { key: "platform.totals.purgees", value: String(data.totals.purgees) },
        { key: "platform.totals.documents", value: String(data.totals.documents) },
        { key: "platform.totals.utilisateurs", value: String(data.totals.utilisateurs) },
        { key: "platform.totals.stockage", value: formatOctets(data.totals.stockageOctets) },
      ]
    : [];

  const gestesMenu: { action: GesteAction; key: string; destructive?: boolean }[] = [
    { action: "PROLONGER_ESSAI", key: "platform.geste.prolonger" },
    { action: "OCTROYER_CREDITS", key: "platform.geste.crediter" },
    { action: "CHANGER_PLAN", key: "platform.geste.plan" },
    { action: "SUSPENDRE", key: "platform.geste.suspendre" },
    { action: "REACTIVER", key: "platform.geste.reactiver" },
    { action: "RESILIER", key: "platform.geste.resilier", destructive: true },
    { action: "PURGER", key: "platform.geste.purger", destructive: true },
  ];

  return (
    <div className="space-y-8 max-w-[1300px]">
      {/* En-tête exploitant — même charte, ton légèrement distinct */}
      <div className="rounded-md border p-5 space-y-2" style={{ background: "var(--papier-leve)", borderColor: "var(--bordure)" }}>
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-display text-[22px] font-semibold">{t("platform.title")}</h2>
          <Badge className="text-[10.5px] uppercase tracking-[0.08em]" style={{ background: "var(--cachet-fond)", color: "var(--cachet)" }}>
            {t("platform.badge")}
          </Badge>
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground max-w-[80ch]">{t("platform.subtitle")}</p>
      </div>

      {etat === "error" && (
        <div className="border rounded-md px-4 py-6 space-y-3" style={{ background: "var(--erreur-fond)", borderColor: "var(--bordure)" }} role="alert">
          <p className="text-[13.5px]" style={{ color: "var(--erreur)" }}>{t("common.errorNetwork")}</p>
          <Button variant="outline" className="h-11" onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      {etat === "loading" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-md" />
          ))}
        </div>
      )}

      {etat === "ready" && data && (
        <>
          {/* Cartes de totaux réels */}
          <section aria-label={t("platform.title")} className="space-y-3">
            <SectionTitle>{t("platform.totals.organisations")}</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {totaux.map((c) => (
                <div key={c.key} className="border rounded-md bg-card px-3.5 py-3">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t(c.key)}</div>
                  <div className="mt-1 font-display text-[22px] font-semibold tnum leading-none">{c.value}</div>
                </div>
              ))}
            </div>
          </section>

          {/* État des services + environnement — badges honnêtes */}
          <section aria-label={t("platform.services.title")} className="space-y-3">
            <SectionTitle>{t("platform.services.title")}</SectionTitle>
            <div className="registre border rounded-md bg-card" role="table">
              <div role="row" className="hidden md:flex items-center gap-4 px-3 py-2 border-b border-border text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <span className="min-w-0 flex-1" role="columnheader">{t("platform.services.connector")}</span>
                <span className="w-24 shrink-0 text-right" role="columnheader">{t("platform.services.connectes")}</span>
                <span className="w-24 shrink-0 text-right" role="columnheader">{t("platform.services.nonConfigures")}</span>
                <span className="w-24 shrink-0 text-right" role="columnheader">{t("platform.services.erreurs")}</span>
                <span className="w-28 shrink-0 text-right" role="columnheader">{t("platform.services.orgs")}</span>
              </div>
              {data.services.map((s) => (
                <div key={s.connector} role="row" className="registre-row flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 min-h-[52px]">
                  <span className="min-w-0 flex-1 text-[13.5px] font-medium truncate">
                    {s.connector === "STORAGE_LOCAL" ? t("platform.service.STORAGE_LOCAL") : t(`admin.integrations.${s.connector}`, s.connector)}
                  </span>
                  <span className="w-24 shrink-0 text-right text-[13px] tnum" style={{ color: "var(--ruban)" }}>{s.connectes}</span>
                  <span className="w-24 shrink-0 text-right text-[13px] tnum text-muted-foreground">{s.nonConfigures}</span>
                  <span className="w-24 shrink-0 text-right text-[13px] tnum" style={s.erreurs > 0 ? { color: "var(--erreur)" } : undefined}>{s.erreurs}</span>
                  <span className="w-28 shrink-0 text-right text-[12.5px] tnum text-muted-foreground">{s.totalOrganisations}</span>
                </div>
              ))}
            </div>

            <div className="border rounded-md bg-card p-4 space-y-3">
              <SectionTitle>{t("platform.env.title")}</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {envEntries.map((e) => (
                  <span key={e.key} className="inline-flex items-center gap-2 border rounded-md px-2.5 py-1.5" style={{ borderColor: "var(--bordure)" }}>
                    <span className="text-[12.5px]">{t(e.key)}</span>
                    {e.ok ? (
                      <Badge className="text-[10.5px]" style={{ background: "var(--ruban-fond)", color: "var(--ruban)" }}>
                        {t("platform.env.configured")}
                      </Badge>
                    ) : (
                      <Badge className="text-[10.5px]" style={{ background: "var(--carton-fond)", color: "var(--carton)" }}>
                        {t("platform.env.notConfigured")}
                      </Badge>
                    )}
                  </span>
                ))}
              </div>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">{data.environnement.noteHonnête}</p>
            </div>
          </section>

          {/* Demandes de résiliation en attente de traitement */}
          <section aria-label={t("platform.cancellations.title")} className="space-y-3">
            <SectionTitle>{t("platform.cancellations.title")}</SectionTitle>
            {data.cancellations.length === 0 ? (
              <p className="text-[13px] text-muted-foreground border rounded-md bg-card px-4 py-5">{t("platform.cancellations.empty")}</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {data.cancellations.map((o) => (
                  <div key={o.id} className="border rounded-md bg-card p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-display text-[15px] font-semibold truncate">{o.name}</span>
                      <StatutOrg status={o.status} />
                    </div>
                    <div className="text-[12px] tnum text-muted-foreground">
                      {t("platform.cancellations.requestedAt")} {o.cancelRequestedAt ? new Date(o.cancelRequestedAt).toLocaleString() : "—"}
                    </div>
                    <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">{t("platform.cancellations.reason")} : </span>
                      {o.cancelReason || t("platform.cancellations.noReason")}
                    </p>
                    <Button variant="outline" className="h-11" onClick={() => ouvrirGeste(o, "RESILIER")}>
                      {t("platform.cancellations.process")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Registre des organisations — recherche, 25 par page */}
          <section aria-label={t("platform.orgs.title")} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionTitle>{t("platform.orgs.title")}</SectionTitle>
              <div className="relative min-w-[220px] max-w-[320px] flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  placeholder={t("platform.orgs.search")}
                  aria-label={t("platform.orgs.search")}
                  className="h-11 pl-8 bg-[var(--papier-creuse)]"
                />
              </div>
            </div>

            <div className="registre border rounded-md bg-card" role="table" aria-label={t("platform.orgs.title")}>
              <div role="row" className="hidden lg:flex items-center gap-4 px-3 py-2 border-b border-border text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <span className="min-w-0 flex-1" role="columnheader">{t("platform.orgs.title")}</span>
                <span className="w-32 shrink-0" role="columnheader">{t("admin.subscription.plan")}</span>
                <span className="w-20 shrink-0 text-right" role="columnheader">{t("platform.orgs.users")}</span>
                <span className="w-24 shrink-0 text-right" role="columnheader">{t("platform.orgs.documents")}</span>
                <span className="w-24 shrink-0 text-right" role="columnheader">{t("platform.orgs.storage")}</span>
                <span className="w-20 shrink-0 text-right" role="columnheader">{t("platform.orgs.credits")}</span>
                <span className="w-28 shrink-0 text-right" role="columnheader">{t("platform.orgs.lastActivity")}</span>
                <span className="w-14 shrink-0" role="columnheader"><span className="sr-only">{t("platform.orgs.actions")}</span></span>
              </div>

              {orgsPage.length === 0 && (
                <p className="text-[13px] text-muted-foreground px-4 py-6">{t("platform.orgs.empty")}</p>
              )}

              {orgsPage.map((o) => (
                <div key={o.id} role="row" className="registre-row flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5 min-h-[60px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium truncate flex items-center gap-2">
                      <span className="truncate">{o.name}</span>
                      <StatutOrg status={o.status} />
                    </div>
                    <div className="text-[11px] tnum text-muted-foreground truncate meta-points">
                      <span>{o.slug}</span>
                      {o.status === "TRIAL" && o.trialEndsAt && (
                        <span>{fmt(t("platform.orgs.trialUntil"), { date: new Date(o.trialEndsAt).toLocaleDateString() })}</span>
                      )}
                      {o.purgeScheduledAt && (
                        <span>{fmt(t("platform.orgs.purgeAt"), { date: new Date(o.purgeScheduledAt).toLocaleDateString() })}</span>
                      )}
                    </div>
                  </div>
                  <span className="w-32 shrink-0 text-[12.5px] tnum truncate">{o.planCode}</span>
                  <span className="w-20 shrink-0 text-right text-[13px] tnum">{o.users}</span>
                  <span className="w-24 shrink-0 text-right text-[13px] tnum">{o.documents}</span>
                  <span className="w-24 shrink-0 text-right text-[12.5px] tnum">{formatOctets(o.storageBytes)}</span>
                  <span className="w-20 shrink-0 text-right text-[13px] tnum">{o.credits}</span>
                  <span className="w-28 shrink-0 text-right text-[11.5px] tnum text-muted-foreground">
                    {o.lastActivityAt ? new Date(o.lastActivityAt).toLocaleDateString() : "—"}
                  </span>
                  <span className="w-14 shrink-0 flex justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11"
                          aria-label={fmt(t("platform.geste.description"), { name: o.name })}
                          title={t("platform.geste.title")}
                        >
                          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="text-[11px]">{o.name}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {gestesMenu.map((g) => (
                          <DropdownMenuItem
                            key={g.action}
                            className="min-h-11 cursor-pointer"
                            style={g.destructive ? { color: "var(--erreur)" } : undefined}
                            onClick={() => ouvrirGeste(o, g.action)}
                          >
                            {t(g.key)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-1">
                <Button variant="outline" className="h-9 text-[12px]" disabled={pageSure <= 1} onClick={() => setPage((p) => Math.max(1, Math.min(totalPages, p - 1)))}>
                  {t("common.prev")}
                </Button>
                <span className="text-[11.5px] tnum text-muted-foreground">{pageSure} / {totalPages}</span>
                <Button variant="outline" className="h-9 text-[12px]" disabled={pageSure >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  {t("common.next")}
                </Button>
              </div>
            )}
          </section>
        </>
      )}

      {/* Geste commercial — panneau latéral paramétré par l'action choisie */}
      <Sheet open={!!geste && geste.action !== "PURGER"} onOpenChange={(v) => !v && fermerGeste()}>
        <SheetContent side="right" className="sm:max-w-lg overflow-y-auto scroll-fin">
          <SheetHeader>
            <SheetTitle className="font-display text-[17px]">{t("platform.geste.title")}</SheetTitle>
            <SheetDescription className="text-[12.5px]">
              {geste ? fmt(t("platform.geste.description"), { name: geste.org.name }) : ""}
            </SheetDescription>
          </SheetHeader>

          {geste && (
            <>
            <div className="grid flex-1 gap-4 px-4">
              <div className="rounded-md border px-3 py-2.5 flex items-center justify-between gap-3" style={{ background: "var(--papier-leve)", borderColor: "var(--bordure)" }}>
                <span className="text-[13.5px] font-medium truncate">{geste.org.name}</span>
                <StatutOrg status={geste.org.status} />
              </div>

              <div className="text-[13px] font-medium">{t(`platform.geste.${gesteLibelle(geste.action)}`)}</div>

              {geste.action === "PROLONGER_ESSAI" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="geste-jours" className="text-[12.5px]">{t("platform.geste.prolonger.days")}</Label>
                  <Input
                    id="geste-jours"
                    type="number"
                    min={1}
                    max={90}
                    value={jours}
                    onChange={(e) => setJours(e.target.value)}
                    className="h-11 tnum"
                  />
                </div>
              )}

              {geste.action === "OCTROYER_CREDITS" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="geste-credits" className="text-[12.5px]">{t("platform.geste.crediter.amount")}</Label>
                  <Input
                    id="geste-credits"
                    type="number"
                    min={1}
                    max={100000}
                    value={credits}
                    onChange={(e) => setCredits(e.target.value)}
                    className="h-11 tnum"
                  />
                </div>
              )}

              {geste.action === "CHANGER_PLAN" && (
                <div className="grid gap-1.5">
                  <Label className="text-[12.5px]">{t("platform.geste.plan.select")}</Label>
                  <Select value={planCode || undefined} onValueChange={setPlanCode}>
                    <SelectTrigger className="w-full h-11" aria-label={t("platform.geste.plan.select")}>
                      <SelectValue placeholder={t("platform.geste.plan.select")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(data?.plans ?? []).map((p) => (
                        <SelectItem key={p.code} value={p.code}>
                          {p.name} ({(p.priceMonthlyCents / 100).toFixed(2)} {p.priceMonthlyCents > 0 ? "€" : ""})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {geste.action === "RESILIER" && (
                <p className="text-[12.5px] leading-relaxed rounded-md px-3 py-2.5" style={{ background: "var(--erreur-fond)", color: "var(--erreur)" }} role="alert">
                  {t("platform.geste.resilier.confirm")}
                </p>
              )}

              {geste.action === "SUSPENDRE" && (
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t("platform.geste.suspendedNote")}</p>
              )}

              {(geste.action === "SUSPENDRE" || geste.action === "RESILIER") && (
                <div className="grid gap-1.5">
                  <Label htmlFor="geste-motif" className="text-[12.5px]">{t("platform.geste.motif")}</Label>
                  <Textarea
                    id="geste-motif"
                    value={motif}
                    onChange={(e) => setMotif(e.target.value)}
                    rows={3}
                    maxLength={300}
                  />
                </div>
              )}
            </div>

            <SheetFooter className="flex-row gap-2">
              <Button type="button" variant="outline" className="h-11 flex-1" onClick={fermerGeste}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                className="h-11 flex-1 text-primary-foreground"
                disabled={gesteBusy || !champValide()}
                style={
                  geste.action === "RESILIER"
                    ? { background: "var(--erreur)" }
                    : undefined
                }
                onClick={() => void appliquerGeste()}
              >
                {gesteBusy ? t("common.loading") : t("platform.geste.confirm")}
              </Button>
            </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Purge — AlertDialog rouge, double confirmation par saisie du nom exact */}
      <AlertDialog open={!!geste && geste.action === "PURGER"} onOpenChange={(v) => !v && fermerGeste()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display" style={{ color: "var(--erreur)" }}>
              {purgeStep === 1 ? t("platform.geste.purger.title") : t("platform.geste.purger.step2")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {geste ? t("platform.geste.purger.description") : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {purgeStep === 2 && geste && (
            <div className="grid gap-1.5 py-1">
              <Label htmlFor="purge-name" className="text-[12.5px]">
                {fmt(t("platform.geste.purger.typeName"), { name: geste.org.name })}
              </Label>
              <Input
                id="purge-name"
                value={purgeName}
                onChange={(e) => setPurgeName(e.target.value)}
                className="h-11"
                autoComplete="off"
              />
            </div>
          )}

          {purgeStep === 1 && (
            <div className="grid gap-1.5 py-1">
              <Label htmlFor="purge-motif" className="text-[12.5px]">{t("platform.geste.motif")}</Label>
              <Textarea
                id="purge-motif"
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                rows={2}
                maxLength={300}
              />
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("common.cancel")}</AlertDialogCancel>
            {purgeStep === 1 ? (
              <AlertDialogAction className="h-11" onClick={(e) => { e.preventDefault(); setPurgeStep(2); }}>
                {t("common.next")}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                className="h-11 text-primary-foreground"
                style={{ background: "var(--erreur)" }}
                disabled={!geste || purgeName.trim() !== geste.org.name || gesteBusy}
                onClick={(e) => {
                  e.preventDefault();
                  void appliquerGeste();
                }}
              >
                {t("platform.geste.purger.confirm")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Clé i18n de libellé pour chaque geste. */
function gesteLibelle(action: GesteAction): string {
  switch (action) {
    case "PROLONGER_ESSAI":
      return "prolonger";
    case "OCTROYER_CREDITS":
      return "crediter";
    case "CHANGER_PLAN":
      return "plan";
    case "SUSPENDRE":
      return "suspendre";
    case "REACTIVER":
      return "reactiver";
    case "RESILIER":
      return "resilier";
    case "PURGER":
      return "purger";
  }
}
