"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/store/app";
import { useI18n } from "@/lib/i18n";
import { apiGet } from "@/hooks/use-api";
import { StatusPill, QuotaBar } from "@/components/app/cachet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type FileRow = {
  id: string;
  originalFilename: string;
  status: string;
  category: string;
  createdAt: string;
  client?: { id: string; name: string } | null;
  group?: { id: string; name: string } | null;
};

type DashboardData = {
  counters: { archiveCount: number; aVerifierCount: number; clientsCount: number; groupsCount: number; credits: number; docsThisMonth: number };
  /** Plan réel renvoyé par /api/dashboard — source de vérité de la jauge de crédits. */
  plan: { code: string; name: string; monthlyCredits: number } | null;
  recentFiles: FileRow[];
  recentLogs: { step: string; result: string; details: string | null; at: string }[];
  onboarding: { clientCreated: boolean; groupCreated: boolean; storageConnected: boolean; teamInvited: boolean; firstDocArchived: boolean } | null;
  integrations: { connector: string; status: string; envReady: boolean; config: Record<string, unknown> }[];
  pendingApprovals: number;
};

const CONNECTEURS: Record<string, string> = {
  GOOGLE_DRIVE: "Google Drive",
  WHATSAPP_CLOUD: "WhatsApp Cloud",
  POLAR: "Polar",
  N8N: "n8n",
};

/** Résultat de journal coloré sémantiquement : réussi = ruban, échec = erreur, sinon neutre. */
function couleurResultat(result: string): string {
  if (/REUSS|OK|CONFIRME|TERMINE|TRAITEE|CREE/i.test(result)) return "var(--ruban)";
  if (/ECHEC|ERREUR|BLOQUE|REJET|REFUSE|FAIL/i.test(result)) return "var(--erreur)";
  return "var(--encre-2)";
}

/** Vue d'ensemble — bordereau du jour, indicateurs réels, registres denses. */
export function OverviewView() {
  const { t } = useI18n();
  const setView = useAppStore((s) => s.setView);
  const setDetailFileId = useAppStore((s) => s.setDetailFileId);
  const setOnboardingOpen = useAppStore((s) => s.setOnboardingOpen);
  const [data, setData] = useState<DashboardData | null>(null);
  const [chargement, setChargement] = useState(true);

  // Bordereau réel — chargé une fois, rappelé depuis les handlers si besoin
  useEffect(() => {
    let vivant = true;
    (async () => {
      const d = await apiGet<DashboardData>("/api/dashboard");
      if (!vivant) return;
      if (d) setData(d);
      setChargement(false);
    })();
    return () => {
      vivant = false;
    };
  }, []);

  const ouvrirFichier = (id: string) => {
    setDetailFileId(id);
    setView("files");
  };

  if (chargement && !data) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-6" aria-busy="true">
        <Skeleton className="h-[88px] w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-12 w-full rounded-md" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-[1100px]">
        <p className="border border-[var(--bordure)] rounded-lg px-6 py-10 text-center text-[13.5px] text-muted-foreground">
          {t("files.empty")}
        </p>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setView("files")}>{t("files.upload")}</Button>
        </div>
      </div>
    );
  }

  const c = data.counters;
  const registreNo = new Date().toISOString().slice(0, 10);
  const ob = data.onboarding;
  // Jauge de crédits : max réel du plan renvoyé par /api/dashboard (jamais une valeur en dur).
  const quotaMax = data.plan?.monthlyCredits ?? 0;
  const etapesOnboarding = ob
    ? [
        { fait: ob.clientCreated, key: "onboarding.step1" },
        { fait: ob.groupCreated, key: "onboarding.step2" },
        { fait: ob.storageConnected, key: "onboarding.step3" },
        { fait: ob.teamInvited, key: "onboarding.step4" },
        { fait: ob.firstDocArchived, key: "onboarding.step5" },
      ]
    : [];
  const onboardingEnCours = etapesOnboarding.some((e) => !e.fait);

  const indicateurs: { key: string; value: number; quota?: boolean }[] = [
    { key: "overview.stat.archived", value: c.archiveCount },
    { key: "overview.stat.pending", value: c.aVerifierCount },
    { key: "overview.stat.clients", value: c.clientsCount },
    { key: "overview.stat.groups", value: c.groupsCount },
    { key: "overview.stat.credits", value: c.credits, quota: true },
  ];

  return (
    <div className="mx-auto max-w-[1100px]">
      {/* Bordereau du jour */}
      <section className="rounded-lg border border-[var(--bordure)] bg-[var(--papier-leve)] px-6 py-5">
        <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{t("overview.bordereau")}</p>
        <p className="bordereau-num mt-1.5 text-[25px] leading-tight">
          {t("overview.registreNo").toUpperCase()} {registreNo}
        </p>
      </section>

      {/* Indicateurs réels — rangée de paires séparées par des filets verticaux */}
      <section className="mt-6" aria-label={t("overview.bordereau")}>
        <div className="flex flex-wrap items-stretch gap-y-4">
          {indicateurs.map((ind, i) => (
            <div
              key={ind.key}
              className={`flex min-w-[150px] flex-1 flex-col justify-between py-1 ${i > 0 ? "border-l border-[var(--bordure)] pl-6" : ""} ${i < indicateurs.length - 1 ? "pr-6" : ""}`}
            >
              <p className="text-[11.5px] text-muted-foreground">{t(ind.key)}</p>
              <p className="mt-1 font-display tnum text-[25px] leading-tight">{ind.value}</p>
              {ind.quota && quotaMax > 0 && (
                <div className="mt-2.5 max-w-[180px]">
                  {/* Jauge honnête : max réel du plan — si le plan est inconnu, la jauge reste masquée. */}
                  <QuotaBar value={c.credits} max={quotaMax} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Mise en service en cours */}
      {onboardingEnCours && ob && (
        <section className="mt-8" aria-label={t("overview.onboarding.title")}>
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-[16px] font-semibold">{t("overview.onboarding.title")}</h2>
            <Button variant="link" className="h-11 px-2 text-[13px]" onClick={() => setOnboardingOpen(true)}>
              {t("overview.onboarding.resume")}
            </Button>
          </div>
          <ul className="mt-2 border-t border-[var(--bordure)]">
            {etapesOnboarding.map((e) => (
              <li key={e.key} className="flex h-12 items-center gap-3 border-b border-[var(--bordure)] px-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={
                    e.fait
                      ? { background: "var(--ruban)" }
                      : { border: "2px solid var(--bordure-forte)", background: "transparent" }
                  }
                  aria-hidden="true"
                />
                <span className={`text-[13.5px] ${e.fait ? "text-muted-foreground line-through decoration-[var(--bordure-forte)]" : ""}`}>
                  {t(e.key)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Dernières réceptions */}
      <section className="mt-8" aria-label={t("overview.recentFiles")}>
        <h2 className="font-display text-[16px] font-semibold">{t("overview.recentFiles")}</h2>
        {data.recentFiles.length === 0 ? (
          <div className="mt-3">
            <p className="border border-[var(--bordure)] rounded-lg px-6 py-8 text-center text-[13.5px] text-muted-foreground">
              {t("files.empty")}
            </p>
            <div className="mt-3 flex justify-end">
              <Button onClick={() => setView("files")}>{t("files.upload")}</Button>
            </div>
          </div>
        ) : (
          <ul className="registre mt-2 border-t border-[var(--bordure)]">
            {data.recentFiles.map((f) => (
              <li key={f.id} className="registre-row">
                <button
                  type="button"
                  onClick={() => ouvrirFichier(f.id)}
                  className="flex h-12 w-full items-center gap-4 px-2 text-left"
                  title={f.originalFilename}
                >
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{f.originalFilename}</span>
                  <span className="meta-points hidden max-w-[220px] shrink-0 items-center text-[12px] text-muted-foreground md:flex">
                    {f.client && <span className="truncate">{f.client.name}</span>}
                    {f.group && <span className="truncate">{f.group.name}</span>}
                  </span>
                  <span className="w-36 shrink-0">
                    <StatusPill status={f.status} label={t(`status.${f.status}`)} />
                  </span>
                  <time className="w-24 shrink-0 text-right text-[12px] tnum text-muted-foreground" dateTime={f.createdAt}>
                    {new Date(f.createdAt).toLocaleDateString()}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Activité récente */}
      {data.recentLogs.length > 0 && (
        <section className="mt-8" aria-label={t("overview.activity")}>
          <h2 className="font-display text-[16px] font-semibold">{t("overview.activity")}</h2>
          <ul className="registre mt-2 border-t border-[var(--bordure)]">
            {data.recentLogs.map((l, i) => (
              <li key={`${l.at}-${i}`} className="flex h-12 items-center gap-3 border-b border-[var(--bordure)] px-2">
                <span className="w-28 shrink-0 truncate text-[12.5px] font-medium tnum">{l.step}</span>
                <span className="w-28 shrink-0 truncate text-[12px] tnum" style={{ color: couleurResultat(l.result) }}>
                  {l.result}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{l.details ?? ""}</span>
                <time className="hidden shrink-0 text-[11.5px] tnum text-muted-foreground sm:block" dateTime={l.at}>
                  {new Date(l.at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* État des intégrations */}
      {data.integrations.length > 0 && (
        <section className="mt-8" aria-label={t("overview.integrations")}>
          <h2 className="font-display text-[16px] font-semibold">{t("overview.integrations")}</h2>
          <ul className="registre mt-2 border-t border-[var(--bordure)]">
            {data.integrations.map((intg) => (
              <li key={intg.connector} className="flex h-12 items-center gap-3 border-b border-[var(--bordure)] px-2">
                <span className="w-40 shrink-0 truncate text-[13px] font-medium">
                  {CONNECTEURS[intg.connector] ?? intg.connector}
                </span>
                <span
                  className="text-[12px]"
                  style={{
                    color:
                      intg.status === "CONNECTE"
                        ? "var(--ruban)"
                        : intg.status === "ERREUR"
                          ? "var(--erreur)"
                          : "var(--encre-2)",
                  }}
                >
                  {t(`admin.integrations.status.${intg.status}`)}
                </span>
                {intg.envReady === false && (
                  <span className="min-w-0 flex-1 truncate text-right text-[12px]" style={{ color: "var(--carton)" }}>
                    {t("admin.integrations.status.NON_CONFIGURE")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
