"use client";

/**
 * Automatisations — règles réellement exécutées par le scheduler.
 * Création en Sheet (side=right), pastilles de statut, expansion en ligne des exécutions.
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useApi, apiGet } from "@/hooks/use-api";
import { useAppStore } from "@/store/app";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "@/components/app/pill";
import { EtatErreur } from "@/components/app/etat-erreur";
import { ChevronDown, Loader2, PauseCircle, PlayCircle, Plus, Zap } from "lucide-react";

type Run = {
  id: string;
  slotKey: string;
  status: string;
  report: string;
  startedAt: string;
  finishedAt: string | null;
};

type Automation = {
  id: string;
  name: string;
  template: string;
  cronExpr: string;
  status: string;
  createdById: string;
  runs: Run[];
};

const TEMPLATES = ["RAPPORT_HEBDO", "RAPPORT_MENSUEL", "RAPPEL_MANQUANTS", "PERSONNALISEE"] as const;
const CRON_FIELD = /^(\*|\d+(?:-\d+)?(?:\/\d+)?|\*\/\d+)$/;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </h3>
  );
}

/** Raccourci de libellé de pastille d'exécution — la pastille elle-même est le composant partagé Pill. */
function runPill(status: string, label: string) {
  switch (status) {
    case "REUSSI":
      return <Pill tone="ruban" shape="dot" label={label} />;
    case "PARTIEL":
    case "BLOQUE":
    case "EN_COURS":
    case "EN_ATTENTE":
    case "RETRY_PROGRAMME":
      return <Pill tone="carton" shape="ring" label={label} />;
    case "ECHEC":
    case "ECHEC_DEFINITIF":
      return <Pill tone="erreur" shape="cross" label={label} />;
    default:
      return <Pill tone="encre" shape="dot" label={label} />;
  }
}

function validCron(expr: string) {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => CRON_FIELD.test(f));
}

export function AutomationsView() {
  const { t } = useI18n();
  const { call } = useApi();
  const role = useAppStore((s) => s.session?.role);
  // POST et PATCH /api/automations sont réservés ADMIN+ côté serveur —
  // l'UI n'affiche plus les actions vouées au 403 (audit UI P2).
  const peutGerer = role === "PROPRIETAIRE" || role === "ADMINISTRATEUR";
  const peutExecuter = role !== "LECTEUR";

  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [erreurChargement, setErreurChargement] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<string>("RAPPORT_HEBDO");
  const [cronExpr, setCronExpr] = useState("0 9 * * 1");
  const [configJson, setConfigJson] = useState("");
  const [cronError, setCronError] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = async () => {
    const data = await apiGet<{ automations: Automation[] }>("/api/automations");
    // apiGet silencieux : null = échec de chargement, jamais une liste vide inventée
    setErreurChargement(!data);
    if (data?.automations) setAutomations(data.automations);
    setLoaded(true);
  };

  useEffect(() => {
    let vivant = true;
    (async () => {
      const data = await apiGet<{ automations: Automation[] }>("/api/automations");
      if (!vivant) return;
      setErreurChargement(!data);
      if (data?.automations) setAutomations(data.automations);
      setLoaded(true);
    })();
    return () => {
      vivant = false;
    };
  }, []);

  const resetForm = () => {
    setName("");
    setTemplate("RAPPORT_HEBDO");
    setCronExpr("0 9 * * 1");
    setConfigJson("");
    setCronError(false);
  };

  const createAutomation = async () => {
    if (name.trim().length < 2 || !validCron(cronExpr)) {
      setCronError(!validCron(cronExpr));
      return;
    }
    if (configJson.trim() && !isValidJson(configJson)) {
      toast({ title: t("common.error"), description: t("automations.configJson"), variant: "destructive" });
      return;
    }
    const result = await call<{ automation: Automation }>("/api/automations", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), template, cronExpr: cronExpr.trim(), configJson: configJson.trim() || undefined }),
    });
    if (result) {
      toast({ title: t("toast.automationCreated"), description: name.trim() });
      setSheetOpen(false);
      resetForm();
      void load();
    }
  };

  const isValidJson = (raw: string) => {
    try {
      JSON.parse(raw);
      return true;
    } catch {
      return false;
    }
  };

  const toggleStatus = async (a: Automation) => {
    setPendingId(a.id);
    const next = a.status === "ACTIVE" ? "PAUSE" : "ACTIVE";
    const result = await call<{ automation: Automation }>("/api/automations", {
      method: "PATCH",
      body: JSON.stringify({ id: a.id, status: next }),
    });
    setPendingId(null);
    if (result) void load();
  };

  const [runningId, setRunningId] = useState<string | null>(null);

  const runNow = async (a: Automation) => {
    setRunningId(a.id);
    const result = await call<{ run: Run }>(`/api/automations/${a.id}/run`, { method: "POST" });
    setRunningId(null);
    if (result?.run) {
      toast({
        title: `${t("automations.runDone")} — ${t(`automations.run.${result.run.status}`)}`,
        description: result.run.report.slice(0, 220),
      });
      void load();
    }
  };

  return (
    <div className="space-y-4 max-w-[1100px]">
      <div className="flex items-center justify-between">
        <SectionTitle>{t("automations.title")}</SectionTitle>
        {/* Bouton primaire unique de l'écran */}
        {peutGerer && (
          <Button className="h-11 px-4" onClick={() => { resetForm(); setSheetOpen(true); }}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("automations.add")}
          </Button>
        )}
      </div>

      <div className="registre border rounded-md bg-card" role="list" aria-label={t("automations.title")}>
        {!loaded ? (
          <div className="space-y-2 p-3" aria-hidden="true">
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        ) : erreurChargement ? (
          <EtatErreur onRetry={() => void load()} />
        ) : automations.length === 0 ? (
          <p className="text-[13px] text-muted-foreground px-4 py-6">{t("automations.empty")}</p>
        ) : (
          automations.map((a) => {
            const expanded = expandedId === a.id;
            return (
              <li key={a.id} role="listitem" className="list-none">
                {/* Deux zones interactives distinctes sur la même ligne : expansion + pause/activation — jamais de bouton imbriqué */}
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : a.id)}
                    aria-expanded={expanded}
                    className="registre-row min-h-[52px] flex-1 min-w-0 text-left px-3 py-2 flex items-center gap-3"
                  >
                    <span className="text-[13.5px] font-medium truncate min-w-0 flex-1">{a.name}</span>
                    <span className="text-[12px] text-muted-foreground truncate hidden md:inline max-w-[220px]">{t(`automations.template.${a.template}`)}</span>
                    <span className="text-[12px] tnum text-muted-foreground shrink-0 hidden sm:inline">{a.cronExpr}</span>
                    {a.status === "ACTIVE" ? <Pill tone="ruban" shape="dot" label={t("automations.status.ACTIVE")} /> : <Pill tone="carton" shape="ring" label={t("automations.status.PAUSE")} />}
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {peutGerer && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleStatus(a);
                      }}
                      aria-label={a.status === "ACTIVE" ? t("automations.pause") : t("automations.resume")}
                      className="inline-flex items-center justify-center gap-1.5 h-9 px-2.5 rounded-md border text-[12px] shrink-0 mr-3 hover:bg-secondary transition-colors min-w-[44px]"
                    >
                      {pendingId === a.id ? (
                        <PauseCircle className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                      ) : a.status === "ACTIVE" ? (
                        <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span className="hidden lg:inline">{a.status === "ACTIVE" ? t("automations.pause") : t("automations.resume")}</span>
                    </button>
                  )}
                </div>
                {/* Expansion en ligne — exécutions réelles */}
                <div className="grid transition-[grid-template-rows] duration-300" style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}>
                  <div className="overflow-hidden">
                    <div className="px-3 pb-4 pt-1 border-b border-border bg-[var(--papier-leve)]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("automations.lastRuns")}</div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0"
                          disabled={!peutExecuter || runningId === a.id || a.status !== "ACTIVE"}
                          onClick={() => void runNow(a)}
                        >
                          {runningId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Zap className="h-3.5 w-3.5" aria-hidden="true" />}
                          {t("automations.runNow")}
                        </Button>
                      </div>
                      {a.runs.length === 0 ? (
                        <p className="text-[12px] text-muted-foreground mt-1.5">—</p>
                      ) : (
                        <ul className="mt-1.5">
                          {a.runs.map((r) => (
                            <li key={r.id} className="py-2 border-b border-border last:border-0">
                              <div className="flex items-baseline gap-3 flex-wrap">
                                <span className="text-[12px] tnum text-muted-foreground shrink-0">{new Date(r.startedAt).toLocaleString()}</span>
                                {runPill(r.status, t(`automations.run.${r.status}`))}
                              </div>
                              {r.report && (
                                <div className="mt-1">
                                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("automations.report")}</span>
                                  <p className="text-[12px] leading-snug text-muted-foreground whitespace-pre-wrap mt-0.5">{r.report}</p>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })
        )}
      </div>

      {/* Sheet création — panneau latéral, jamais de dialog central */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="sm:max-w-sm overflow-y-auto scroll-fin">
          <SheetHeader>
            <SheetTitle className="font-display text-[16px]">{t("automations.add")}</SheetTitle>
            <SheetDescription className="text-[12.5px]">{t("automations.subtitle")}</SheetDescription>
          </SheetHeader>
          <form
            className="px-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void createAutomation();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="automation-name" className="text-[12.5px]">{t("automations.name")}</Label>
              <Input id="automation-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">{t("automations.template")}</Label>
              <Select value={template} onValueChange={setTemplate}>
                <SelectTrigger className="w-full h-11" aria-label={t("automations.template")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATES.map((tpl) => (
                    <SelectItem key={tpl} value={tpl}>{t(`automations.template.${tpl}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="automation-cron" className="text-[12.5px]">{t("automations.cron")}</Label>
              <Input
                id="automation-cron"
                value={cronExpr}
                onChange={(e) => {
                  setCronExpr(e.target.value);
                  setCronError(false);
                }}
                className={`h-11 tnum ${cronError ? "border-[var(--erreur)]" : ""}`}
                aria-invalid={cronError}
              />
              <p className="text-[11.5px] text-muted-foreground leading-snug">{t("automations.cronHelp")}</p>
              {cronError && <p className="text-[11.5px]" style={{ color: "var(--erreur)" }}>{t("automations.cronInvalid")}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="automation-config" className="text-[12.5px]">{t("automations.configJson")}</Label>
              <Textarea id="automation-config" value={configJson} onChange={(e) => setConfigJson(e.target.value)} rows={4} className="tnum text-[12.5px]" placeholder="{}" />
            </div>
            <div className="flex items-center gap-2 pt-2 pb-4">
              <Button type="submit" className="h-11 flex-1">{t("common.create")}</Button>
              <Button type="button" variant="outline" className="h-11" onClick={() => setSheetOpen(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
