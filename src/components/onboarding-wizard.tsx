"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ChevronDown, Copy, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useAppStore } from "@/store/app";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type OnboardingState = {
  clientCreated: boolean;
  groupCreated: boolean;
  storageConnected: boolean;
  teamInvited: boolean;
  firstDocArchived: boolean;
  clientAt: string | null;
  groupAt: string | null;
  storageAt: string | null;
  teamAt: string | null;
  docAt: string | null;
};

type DashboardData = {
  onboarding: OnboardingState | null;
  integrations: { connector: string; status: string; envReady: boolean }[];
};

type ClientItem = { id: string; code: string; name: string };

const STEP_KEYS = [
  "onboarding.step1",
  "onboarding.step2",
  "onboarding.step3",
  "onboarding.step4",
  "onboarding.step5",
] as const;

const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : null);

/** Pastille d'état : point plein (fait, ruban) ou anneau (à faire, bordure forte). */
function Dot({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: "var(--ruban)" }} aria-hidden="true" />
  ) : (
    <span className="h-2.5 w-2.5 rounded-full shrink-0 border-2" style={{ borderColor: "var(--bordure-forte)" }} aria-hidden="true" />
  );
}

function DoneLine({ date }: { date: string | null | undefined }) {
  const formatted = fmtDate(date);
  return (
    <p className="flex items-center gap-2 text-[13px] text-[var(--encre-2)]">
      <Dot ok />
      <span className="tnum">{formatted ?? "—"}</span>
    </p>
  );
}

const inputClass = "h-11 bg-[var(--papier-creuse)]";

/**
 * Assistant de mise en service — Sheet latéral droit (pas de Dialog central).
 * Chaque étape est réelle : création client, groupe dépôt web, états connecteurs,
 * invitation avec lien réel, puis bascule vers la vue Fichiers.
 */
export function OnboardingWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useI18n();
  const setView = useAppStore((s) => s.setView);

  const [dash, setDash] = useState<DashboardData | null>(null);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [openSteps, setOpenSteps] = useState<number[]>([]);
  const autoOpened = useRef(false);

  // Formulaires réels (aucune donnée fictive affichée comme existante)
  const [clientCode, setClientCode] = useState("");
  const [clientName, setClientName] = useState("");
  const [groupClientId, setGroupClientId] = useState("");
  const [groupCode, setGroupCode] = useState("");
  const [groupName, setGroupName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const [clientBusy, setClientBusy] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [dRes, cRes] = await Promise.all([
        fetch("/api/dashboard", { cache: "no-store" }),
        fetch("/api/clients", { cache: "no-store" }),
      ]);
      if (dRes.ok) setDash((await dRes.json()) as DashboardData);
      if (cRes.ok) {
        const data = (await cRes.json()) as { clients?: ClientItem[] };
        setClients(data.clients ?? []);
      }
    } catch {
      // Réseau indisponible : les états déjà connus restent affichés
    }
  }, []);

  useEffect(() => {
    // Lancement hors du corps synchrone de l'effet (microtask) : refresh recharge
    // des états via setState, la microtask évite le rendu en cascade sans changer
    // le comportement observable (elle s'exécute avant le prochain évènement).
    if (open) queueMicrotask(() => void refresh());
  }, [open, refresh]);

  // À la première charge : déplier la première étape non faite (sommaire utile)
  useEffect(() => {
    if (!dash || autoOpened.current) return;
    autoOpened.current = true;
    const ob = dash.onboarding;
    const flags = [
      ob?.clientCreated === true,
      ob?.groupCreated === true,
      ob?.storageConnected === true ||
        (dash.integrations ?? []).some((i) => i.connector === "STORAGE_LOCAL" && i.status === "CONNECTE"),
      ob?.teamInvited === true,
      ob?.firstDocArchived === true,
    ];
    const first = flags.findIndex((f) => !f);
    setOpenSteps(first >= 0 ? [first] : []);
  }, [dash]);

  const ob = dash?.onboarding ?? null;
  const integrations = dash?.integrations ?? [];
  const localConnector = integrations.find((i) => i.connector === "STORAGE_LOCAL");
  const driveConnector = integrations.find((i) => i.connector === "GOOGLE_DRIVE");
  const storageOk = ob?.storageConnected === true || localConnector?.status === "CONNECTE";

  const done = [
    ob?.clientCreated === true,
    ob?.groupCreated === true,
    storageOk,
    ob?.teamInvited === true,
    ob?.firstDocArchived === true,
  ];
  const dates: (string | null)[] = [ob?.clientAt ?? null, ob?.groupAt ?? null, null, ob?.teamAt ?? null, ob?.docAt ?? null];
  const allDone = done.every(Boolean);
  const doneCount = done.filter(Boolean).length;

  const isOpen = (i: number) => openSteps.includes(i);
  const toggleStep = (i: number) =>
    setOpenSteps((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  function networkError() {
    toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
  }

  function actionError() {
    toast({ title: t("common.error"), description: t("toast.actionError"), variant: "destructive" });
  }

  // Étape 1 — création client réelle
  async function createClient(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (clientBusy) return;
    setClientBusy(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: clientCode, name: clientName }),
      });
      if (res.ok) {
        toast({ title: t("toast.clientCreated") });
        setClientCode("");
        setClientName("");
        await refresh();
      } else {
        actionError();
      }
    } catch {
      networkError();
    } finally {
      setClientBusy(false);
    }
  }

  // Étape 2 — groupe / dépôt web réel (source DEPOT_WEB, active à la première réception)
  async function createGroup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (groupBusy) return;
    if (!groupClientId) {
      toast({ title: t("common.error"), description: t("common.errorRequired"), variant: "destructive" });
      return;
    }
    setGroupBusy(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: groupClientId, code: groupCode, name: groupName, sourceType: "DEPOT_WEB" }),
      });
      if (res.ok) {
        toast({ title: t("toast.groupCreated") });
        setGroupCode("");
        setGroupName("");
        await refresh();
      } else {
        actionError();
      }
    } catch {
      networkError();
    } finally {
      setGroupBusy(false);
    }
  }

  // Étape 3 — flux OAuth Google réel si les variables d'environnement sont prêtes
  async function connectDrive() {
    if (driveBusy) return;
    setDriveBusy(true);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = (await res.json()) as { authorizeUrl?: string };
        if (data.authorizeUrl) {
          window.location.href = data.authorizeUrl;
          return;
        }
      }
      actionError();
    } catch {
      networkError();
    } finally {
      setDriveBusy(false);
    }
  }

  // Étape 4 — invitation réelle : jeton unique, lien à transmettre
  async function inviteMember(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inviteBusy) return;
    setInviteBusy(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: "EMPLOYE" }),
      });
      if (res.ok) {
        const data = (await res.json()) as { invite?: { token?: string } };
        if (data.invite?.token) {
          setInviteLink(`${window.location.origin}/?invite=${data.invite.token}`);
        }
        toast({ title: t("toast.invited") });
        setInviteEmail("");
        await refresh();
      } else {
        actionError();
      }
    } catch {
      networkError();
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInvite() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast({ title: t("common.copied") });
    } catch {
      networkError();
    }
  }

  // Étape 5 — bascule vers la vue Fichiers pour déposer le premier document
  function goToFiles() {
    onOpenChange(false);
    setView("files");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[520px] max-w-[calc(100vw-1.5rem)] sm:max-w-[520px] gap-0 p-0 bg-background"
      >
        <SheetHeader className="px-6 pt-6 pb-5 border-b gap-2 text-left" style={{ borderColor: "var(--bordure)" }}>
          <div className="flex items-center gap-3 flex-wrap pr-8">
            <SheetTitle className="font-display text-[20px] leading-none">{t("onboarding.title")}</SheetTitle>
            {allDone && (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium" style={{ color: "var(--ruban)" }}>
                <span className="h-2 w-2 rounded-full" style={{ background: "var(--ruban)" }} aria-hidden="true" />
                {t("onboarding.done")}
              </span>
            )}
          </div>
          <SheetDescription className="text-[13.5px] leading-relaxed">
            {t("onboarding.subtitle")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto scroll-fin px-6 pt-2 pb-6">
          <ul>
            {STEP_KEYS.map((key, i) => (
              <li key={key} className="border-b last:border-b-0" style={{ borderColor: "var(--bordure)" }}>
                {/* Sommaire : ligne dense cliquable (≥ 44 px) qui déplie l'étape */}
                <button
                  type="button"
                  onClick={() => toggleStep(i)}
                  aria-expanded={isOpen(i)}
                  aria-controls={`onboarding-panel-${i}`}
                  className="w-full min-h-[52px] flex items-center gap-4 py-3 text-left"
                >
                  <span className="font-display tnum text-[20px] leading-none text-[var(--encre-3)] w-8 shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className={`text-[15px] ${done[i] ? "text-[var(--encre-2)]" : "text-foreground font-medium"}`}>
                    {t(key)}
                  </span>
                  {done[i] && dates[i] && (
                    <span className="tnum text-[11px] text-[var(--encre-3)] hidden sm:inline truncate">
                      {fmtDate(dates[i])}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-3 shrink-0">
                    <Dot ok={done[i]} />
                    <ChevronDown
                      className={`size-4 text-[var(--encre-3)] transition-transform duration-200 ${isOpen(i) ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    />
                  </span>
                </button>

                {/* Expansion en ligne via grid-template-rows (200 ms, réduite sous prefers-reduced-motion) */}
                <div
                  id={`onboarding-panel-${i}`}
                  className="grid transition-[grid-template-rows] duration-200 ease-out"
                  style={{ gridTemplateRows: isOpen(i) ? "1fr" : "0fr" }}
                  inert={!isOpen(i)}
                >
                  <div className="overflow-hidden">
                    <div className="pb-7 pl-12 pr-1">
                      {i === 0 &&
                        (!done[0] ? (
                          <form onSubmit={createClient} className="grid gap-4">
                            <div className="grid gap-1.5">
                              <Label htmlFor="ob-client-code">{t("clients.code")}</Label>
                              <Input
                                id="ob-client-code"
                                value={clientCode}
                                onChange={(e) => setClientCode(e.target.value)}
                                placeholder="CLI-ALPES"
                                required
                                minLength={1}
                                maxLength={30}
                                className={inputClass}
                              />
                            </div>
                            <div className="grid gap-1.5">
                              <Label htmlFor="ob-client-name">{t("clients.name")}</Label>
                              <Input
                                id="ob-client-name"
                                value={clientName}
                                onChange={(e) => setClientName(e.target.value)}
                                placeholder={t("clients.name")}
                                required
                                minLength={1}
                                maxLength={120}
                                className={inputClass}
                              />
                            </div>
                            <Button
                              type="submit"
                              disabled={clientBusy}
                              className="h-11 justify-self-start bg-[var(--cachet)] text-[var(--primary-foreground)] hover:bg-[var(--cachet)]/90"
                            >
                              {clientBusy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                              {t("common.create")}
                            </Button>
                          </form>
                        ) : (
                          <DoneLine date={dates[0]} />
                        ))}

                      {i === 1 &&
                        (!done[1] ? (
                          clients.length === 0 ? (
                            <p className="text-[13px] leading-relaxed text-[var(--encre-2)]">
                              {t("clients.empty")}
                            </p>
                          ) : (
                            <form onSubmit={createGroup} className="grid gap-4">
                              <div className="grid gap-1.5">
                                <Label htmlFor="ob-group-client">{t("groups.client")}</Label>
                                <Select value={groupClientId} onValueChange={setGroupClientId}>
                                  <SelectTrigger id="ob-group-client" className={`w-full ${inputClass}`}>
                                    <SelectValue placeholder={t("onboarding.selectClient")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {clients.map((c) => (
                                      <SelectItem key={c.id} value={c.id}>
                                        <span className="tnum">{c.code}</span>
                                        <span className="text-[var(--encre-3)]"> · </span>
                                        {c.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="grid gap-1.5">
                                <Label htmlFor="ob-group-code">{t("clients.code")}</Label>
                                <Input
                                  id="ob-group-code"
                                  value={groupCode}
                                  onChange={(e) => setGroupCode(e.target.value)}
                                  placeholder={t("clients.code")}
                                  required
                                  minLength={1}
                                  maxLength={30}
                                  className={inputClass}
                                />
                              </div>
                              <div className="grid gap-1.5">
                                <Label htmlFor="ob-group-name">{t("clients.name")}</Label>
                                <Input
                                  id="ob-group-name"
                                  value={groupName}
                                  onChange={(e) => setGroupName(e.target.value)}
                                  placeholder={t("clients.name")}
                                  required
                                  minLength={1}
                                  maxLength={120}
                                  className={inputClass}
                                />
                              </div>
                              <Button
                                type="submit"
                                disabled={groupBusy}
                                className="h-11 justify-self-start bg-[var(--cachet)] text-[var(--primary-foreground)] hover:bg-[var(--cachet)]/90"
                              >
                                {groupBusy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                                {t("common.create")}
                              </Button>
                              <p className="text-[12.5px] leading-relaxed text-[var(--encre-3)]">
                                {t("groups.whatsappNotice")}
                              </p>
                            </form>
                          )
                        ) : (
                          <DoneLine date={dates[1]} />
                        ))}

                      {i === 2 && (
                        <>
                          <ul>
                            <li className="flex items-center gap-3 py-2.5 border-b" style={{ borderColor: "var(--bordure)" }}>
                              <Dot ok={localConnector?.status === "CONNECTE"} />
                              <span className="text-[14px] tnum">STORAGE_LOCAL</span>
                              <span className="ml-auto text-[12.5px] text-[var(--encre-2)]">
                                {t(`admin.integrations.status.${localConnector?.status ?? "NON_CONFIGURE"}`)}
                              </span>
                            </li>
                            <li className="flex items-center gap-3 py-2.5">
                              <Dot ok={driveConnector?.status === "CONNECTE"} />
                              <span className="text-[14px] tnum">GOOGLE_DRIVE</span>
                              <span className="ml-auto text-[12.5px] text-[var(--encre-2)]">
                                {t(`admin.integrations.status.${driveConnector?.status ?? "NON_CONFIGURE"}`)}
                              </span>
                            </li>
                          </ul>
                          {driveConnector?.envReady && driveConnector.status !== "CONNECTE" ? (
                            <Button
                              variant="outline"
                              onClick={connectDrive}
                              disabled={driveBusy}
                              className="h-11 mt-4 border-[var(--bordure-forte)]"
                            >
                              {driveBusy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                              {t("admin.integrations.connectDrive")}
                            </Button>
                          ) : (
                            <p className="text-[12.5px] leading-relaxed text-[var(--encre-3)] mt-4 max-w-[48ch]">
                              {t("admin.integrations.connectDriveNote")}
                            </p>
                          )}
                        </>
                      )}

                      {i === 3 &&
                        (!done[3] ? (
                          <form onSubmit={inviteMember} className="grid gap-4">
                            <div className="grid gap-1.5">
                              <Label htmlFor="ob-invite-email">{t("admin.users.email")}</Label>
                              <Input
                                id="ob-invite-email"
                                type="email"
                                inputMode="email"
                                value={inviteEmail}
                                onChange={(e) => setInviteEmail(e.target.value)}
                                placeholder={t("admin.users.email")}
                                required
                                className={inputClass}
                              />
                            </div>
                            <p className="text-[12.5px] text-[var(--encre-3)]">
                              {t("admin.users.role")} · {t("admin.users.role.EMPLOYE")}
                            </p>
                            <Button
                              type="submit"
                              disabled={inviteBusy}
                              className="h-11 justify-self-start bg-[var(--cachet)] text-[var(--primary-foreground)] hover:bg-[var(--cachet)]/90"
                            >
                              {inviteBusy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                              {t("admin.users.invite")}
                            </Button>
                          </form>
                        ) : (
                          <DoneLine date={dates[3]} />
                        ))}

                      {inviteLink && (
                        <div className="grid gap-2 mt-4 pt-4 border-t" style={{ borderColor: "var(--bordure)" }}>
                          <span className="text-[13px] font-medium">{t("onboarding.inviteLink")}</span>
                          <div className="flex items-start gap-2">
                            <p className="flex-1 min-w-0 text-[12.5px] tnum break-all bg-[var(--papier-creuse)] rounded-md px-2.5 py-2">
                              {inviteLink}
                            </p>
                            <Button
                              variant="outline"
                              onClick={copyInvite}
                              aria-label={t("common.copy")}
                              className="size-11 shrink-0 border-[var(--bordure-forte)]"
                            >
                              <Copy className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                      )}

                      {i === 4 &&
                        (!done[4] ? (
                          <div className="grid gap-3">
                            <p className="text-[13.5px] leading-relaxed text-[var(--encre-2)] max-w-[52ch]">
                              {t("files.empty")}
                            </p>
                            <button
                              type="button"
                              onClick={goToFiles}
                              className="inline-flex items-center gap-2 min-h-11 justify-self-start text-[14px] font-medium text-[var(--cachet)] underline-offset-4 hover:underline"
                            >
                              {t("files.upload")}
                              <ArrowRight className="size-4" aria-hidden="true" />
                            </button>
                          </div>
                        ) : (
                          <DoneLine date={dates[4]} />
                        ))}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t px-6 py-4 flex items-center justify-between" style={{ borderColor: "var(--bordure)" }}>
          <span className="tnum text-[12px] text-[var(--encre-3)]" aria-live="polite">
            {doneCount} / {done.length}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11 border-[var(--bordure-forte)]">
            {t("common.close")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
