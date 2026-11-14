"use client";

import { useEffect, useCallback } from "react";
import { useAppStore, type ViewId, type AdminTab } from "@/store/app";
import { useI18n } from "@/lib/i18n";
import { OverviewView } from "@/components/views/overview-view";
import { ClientsView } from "@/components/views/clients-view";
import { GroupsView } from "@/components/views/groups-view";
import { FilesView } from "@/components/views/files-view";
import { InboxView } from "@/components/views/inbox-view";
import { AssistantView } from "@/components/views/assistant-view";
import { DeliverablesView } from "@/components/views/deliverables-view";
import { FinancesView } from "@/components/views/finances-view";
import { AutomationsView } from "@/components/views/automations-view";
import { ApprovalsView } from "@/components/views/approvals-view";
import { ImportsView } from "@/components/views/imports-view";
import { AdminView } from "@/components/views/admin-view";
import { PlatformView } from "@/components/views/platform-view";
import { CommandPalette } from "@/components/app/command-palette";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { NotificationsMenu } from "@/components/app/notifications-menu";
import { ProfileDialog } from "@/components/app/profile-dialog";
import { EmailVerifyBanner } from "@/components/app/email-verify-banner";
import { HesydMark } from "@/components/app/hesyd-mark";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { refreshCredits } from "@/store/app";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard, FolderKanban, MessagesSquare, FileStack, Inbox, Sparkles,
  FileOutput, CalendarClock, Stamp, UploadCloud, Users, Blocks, BadgeEuro,
  ScrollText, Settings2, LogOut, FileText, ShieldCheck, Building2, BrainCircuit, Wallet,
} from "lucide-react";

type NavItem = { id: ViewId; key: string; icon: React.ComponentType<{ className?: string }>; tab?: AdminTab };

/** Espace documents — vue quotidienne, tous les rôles. */
const DOC_NAV: NavItem[] = [
  { id: "overview", key: "nav.overview", icon: LayoutDashboard },
  { id: "clients", key: "nav.clients", icon: FolderKanban },
  { id: "groups", key: "nav.groups", icon: MessagesSquare },
  { id: "files", key: "nav.files", icon: FileStack },
  { id: "inbox", key: "nav.inbox", icon: Inbox },
  { id: "assistant", key: "nav.assistant", icon: Sparkles },
  { id: "deliverables", key: "nav.deliverables", icon: FileOutput },
  { id: "finances", key: "nav.finances", icon: Wallet },
  { id: "automations", key: "nav.automations", icon: CalendarClock },
  { id: "approvals", key: "nav.approvals", icon: Stamp },
  { id: "imports", key: "nav.imports", icon: UploadCloud },
];

/** Console opérateur — réservée aux rôles PROPRIÉTAIRE / ADMINISTRATEUR. */
const ADMIN_NAV: NavItem[] = [
  { id: "admin", key: "admin.team", icon: Users, tab: "team" },
  { id: "admin", key: "admin.integrations", icon: Blocks, tab: "integrations" },
  { id: "admin", key: "admin.subscription", icon: BadgeEuro, tab: "subscription" },
  { id: "admin", key: "admin.audit", icon: ScrollText, tab: "logs" },
  { id: "admin", key: "admin.security", icon: BrainCircuit, tab: "security" },
  { id: "admin", key: "admin.settings", icon: Settings2, tab: "settings" },
];

export function AppShell() {
  const session = useAppStore((s) => s.session);
  const view = useAppStore((s) => s.view);
  const space = useAppStore((s) => s.space);
  const adminTab = useAppStore((s) => s.adminTab);
  const setView = useAppStore((s) => s.setView);
  const setSpace = useAppStore((s) => s.setSpace);
  const setAdminTab = useAppStore((s) => s.setAdminTab);
  const setProfileOpen = useAppStore((s) => s.setProfileOpen);
  const logout = useAppStore((s) => s.logout);
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);
  const setOnboardingOpen = useAppStore((s) => s.setOnboardingOpen);
  const refreshSession = useAppStore((s) => s.refreshSession);
  const onboardingOpen = useAppStore((s) => s.onboardingOpen);
  const { t } = useI18n();

  const checkOnboarding = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      const data = await res.json();
      const ob = data.onboarding as Record<string, boolean> | null;
      if (ob && !(ob.clientCreated && ob.groupCreated && ob.storageConnected && ob.firstDocArchived)) {
        setOnboardingOpen(true);
      }
    } catch {
      // État suivant : le tableau de bord affichera les étapes manquantes
    }
  }, [setOnboardingOpen]);

  useEffect(() => {
    checkOnboarding();
    const interval = setInterval(() => refreshCredits(), 60000);
    return () => clearInterval(interval);
  }, [checkOnboarding]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setPaletteOpen]);

  const trialEnds = session?.organization.trialEndsAt ? new Date(session.organization.trialEndsAt) : null;
  const isTrial = session?.organization.status === "TRIAL";

  // Console opérateur : accessible uniquement aux rôles PROPRIÉTAIRE / ADMINISTRATEUR.
  const canAdmin = session?.role === "PROPRIETAIRE" || session?.role === "ADMINISTRATEUR";
  // Console plateforme : exploitant uniquement (au-dessus des organisations).
  const isPlatformAdmin = session?.isPlatformAdmin === true;
  const espaceActif: "documents" | "operator" | "platform" =
    space === "platform" && isPlatformAdmin ? "platform" : space === "operator" && canAdmin ? "operator" : "documents";
  const NAV = espaceActif === "operator" ? ADMIN_NAV : DOC_NAV;

  const itemActif = NAV.find((n) => n.id === view && (n.tab === undefined || n.tab === adminTab));
  void itemActif; // le titre actif est calculé ci-dessous (espaces documents / opérateur / plateforme)
  const titreActif =
    espaceActif === "platform"
      ? t("platform.title")
      : espaceActif === "operator" && view === "admin"
        ? t(ADMIN_NAV.find((n) => n.tab === adminTab)?.key ?? "admin.team")
        : t(DOC_NAV.find((n) => n.id === view)?.key ?? "nav.overview");

  const navKey = (item: NavItem) => (item.tab ? (view === "admin" && adminTab === item.tab ? "admin" : item.id) : item.id) as ViewId;
  void navKey; // réservé : la vue reste « admin » pour toute la console

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex flex-1">
        {/* Colonne de navigation — registre */}
        <nav aria-label="Navigation principale" className="hidden md:flex w-60 shrink-0 flex-col border-r bg-background sticky top-0 h-screen">
          <div className="px-5 py-5">
            <div className="flex items-center gap-2.5">
              <HesydMark className="h-8 w-8" />
              <div>
                <div className="font-display text-[15px] leading-tight font-semibold">HESYD ONE</div>
                <div className="text-[11px] text-muted-foreground tnum">{session?.organization.name}</div>
              </div>
            </div>
          </div>

          {/* Console plateforme — espace exploitant, au-dessus des organisations */}
          {isPlatformAdmin && (
            <div className="px-3 pb-3">
              <button
                onClick={() => setView("platform")}
                aria-current={espaceActif === "platform" ? "page" : undefined}
                className={`w-full flex items-center gap-2.5 rounded-md px-2.5 py-2.5 min-h-11 text-[13.5px] transition-colors ${
                  espaceActif === "platform"
                    ? "bg-secondary text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                }`}
              >
                <Building2 className="h-4 w-4 shrink-0" />
                <span className="truncate">{t("nav.platform")}</span>
                {espaceActif === "platform" && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--cachet)]" aria-hidden="true" />}
              </button>
            </div>
          )}

          {isPlatformAdmin && <Separator />}

          {/* Les deux espaces — commutateur explicite */}
          <div className="px-5 py-4">
            <div
              role="tablist"
              aria-label={t("space.switcher")}
              className="grid grid-cols-2 gap-0 rounded-md border p-0.5"
              style={{ borderColor: "var(--bordure)", backgroundColor: "var(--papier-creuse)" }}
            >
              <button
                role="tab"
                aria-selected={espaceActif === "documents"}
                onClick={() => setSpace("documents")}
                className={`flex items-center justify-center gap-1.5 rounded-[4px] px-2 py-1.5 text-[11.5px] font-medium transition-colors ${
                  espaceActif === "documents" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                {t("space.documents")}
              </button>
              {canAdmin && (
                <button
                  role="tab"
                  aria-selected={espaceActif === "operator"}
                  onClick={() => setSpace("operator")}
                  className={`flex items-center justify-center gap-1.5 rounded-[4px] px-2 py-1.5 text-[11.5px] font-medium transition-colors ${
                    espaceActif === "operator" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("space.operator")}
                </button>
              )}
            </div>
          </div>

          <Separator />
          <ul className="flex-1 py-2 scroll-fin overflow-y-auto">
            {NAV.map((item) => {
              const actif = item.tab
                ? view === "admin" && adminTab === item.tab
                : espaceActif === "documents" && view === item.id;
              return (
                <li key={item.key}>
                  <button
                    onClick={() => (item.tab ? setAdminTab(item.tab!) : setView(item.id))}
                    aria-current={actif ? "page" : undefined}
                    className={`w-full flex items-center gap-2.5 px-5 py-2.5 text-[13.5px] transition-colors ${
                      actif ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                    }`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t(item.key)}</span>
                    {actif && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--cachet)]" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <Separator />
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-muted-foreground">{t("common.credits")}</span>
              <span className="tnum font-display font-semibold">{session?.credits ?? 0}</span>
            </div>
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden" role="progressbar" aria-valuenow={Math.min(100, Math.round(((session?.credits ?? 0) / 500) * 100))}>
              <div
                className="h-full rounded-full bg-[var(--cachet)] transition-[width] duration-300"
                style={{ width: `${Math.max(2, Math.min(100, ((session?.credits ?? 0) / 500) * 100))}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 -mx-1 text-left hover:bg-secondary/60 transition-colors"
                aria-label={t("profile.open")}
                title={t("profile.open")}
              >
                {session?.user.avatarUrl ? (
                  <img
                    src={session.user.avatarUrl}
                    alt=""
                    className="h-6 w-6 rounded-full border object-cover"
                    style={{ borderColor: "var(--bordure)" }}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-display text-[10px] uppercase"
                    style={{ borderColor: "var(--bordure)", backgroundColor: "var(--papier-leve)" }}
                  >
                    {(session?.user.name ?? "?").slice(0, 1)}
                  </span>
                )}
                <span className="text-[12px] text-muted-foreground truncate">{session?.user.name}</span>
              </button>
              <Button variant="ghost" size="icon" onClick={logout} aria-label={t("common.logout")} title={t("common.logout")}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </nav>

        {/* Contenu */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b">
            <div className="flex items-center gap-3 px-4 md:px-8 h-14">
              <div className="md:hidden">
                <HesydMark className="h-7 w-7" />
              </div>
              <div className="flex items-center gap-2 min-w-0">
                {(espaceActif === "operator" || espaceActif === "platform") && (
                  <Badge variant="outline" className="hidden sm:inline-flex font-normal text-[10.5px] uppercase tracking-[0.08em] shrink-0">
                    {espaceActif === "platform" ? t("platform.badge") : t("space.operator.badge")}
                  </Badge>
                )}
                <h1 className="font-display text-[17px] font-semibold truncate">{titreActif}</h1>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {isTrial && trialEnds && (
                  <Badge variant="outline" className="hidden sm:inline-flex font-normal text-[11px] tnum">
                    {t("admin.trialBanner").replace("{date}", trialEnds.toLocaleDateString())}
                  </Badge>
                )}
                <Button variant="ghost" size="sm" className="h-8 text-[12px] text-muted-foreground" onClick={() => setPaletteOpen(true)}>
                  <kbd className="font-sans text-[11px]">{t("common.palette.hint")}</kbd>
                </Button>
                <NotificationsMenu />
                <ThemeToggle />
                {/* Déconnexion accessible sur mobile — la barre latérale est absente sur petit écran */}
                <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={logout} aria-label={t("common.logout")} title={t("common.logout")}>
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </header>

          {/* Bannière e-mail non vérifié — discrète, action réelle */}
          <EmailVerifyBanner />

          {/* Navigation mobile — commutateur d'espaces puis sections */}
          <div className="md:hidden border-b">
            <div className="px-3 pt-2 pb-1">
              <div
                role="tablist"
                aria-label={t("space.switcher")}
                className="grid grid-cols-2 gap-0 rounded-md border p-0.5"
                style={{ borderColor: "var(--bordure)", backgroundColor: "var(--papier-creuse)" }}
              >
                <button
                  role="tab"
                  aria-selected={espaceActif === "documents"}
                  onClick={() => setSpace("documents")}
                  className={`flex items-center justify-center gap-1.5 rounded-[4px] px-2 py-2 text-[12px] font-medium ${espaceActif === "documents" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("space.documents")}
                </button>
                {canAdmin && (
                  <button
                    role="tab"
                    aria-selected={espaceActif === "operator"}
                    onClick={() => setSpace("operator")}
                    className={`flex items-center justify-center gap-1.5 rounded-[4px] px-2 py-2 text-[12px] font-medium ${espaceActif === "operator" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("space.operator")}
                  </button>
                )}
              </div>
            </div>
            <div className="px-3 py-2 flex gap-1 overflow-x-auto scroll-fin" role="tablist" aria-label="Sections">
              {isPlatformAdmin && (
                <button
                  role="tab"
                  aria-selected={espaceActif === "platform"}
                  onClick={() => setView("platform")}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 min-h-11 rounded-md text-[12.5px] ${
                    espaceActif === "platform" ? "bg-secondary font-medium" : "text-muted-foreground"
                  }`}
                >
                  <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("nav.platform")}
                </button>
              )}
              {NAV.map((item) => {
                const actif = item.tab ? view === "admin" && adminTab === item.tab : view === item.id;
                return (
                  <button
                    key={item.key}
                    role="tab"
                    aria-selected={actif}
                    onClick={() => (item.tab ? setAdminTab(item.tab!) : setView(item.id))}
                    className={`shrink-0 px-3 py-1.5 min-h-11 rounded-md text-[12.5px] ${actif ? "bg-secondary font-medium" : "text-muted-foreground"}`}
                  >
                    {t(item.key)}
                  </button>
                );
              })}
            </div>
          </div>

          <main className="flex-1 px-4 md:px-8 py-6 w-full max-w-[1400px]">
            {espaceActif === "documents" && (
              <>
                {view === "overview" && <OverviewView />}
                {view === "clients" && <ClientsView />}
                {view === "groups" && <GroupsView />}
                {view === "files" && <FilesView />}
                {view === "inbox" && <InboxView />}
                {view === "assistant" && <AssistantView />}
                {view === "deliverables" && <DeliverablesView />}
                {view === "finances" && <FinancesView />}
                {view === "automations" && <AutomationsView />}
                {view === "approvals" && <ApprovalsView />}
                {view === "imports" && <ImportsView />}
              </>
            )}
            {espaceActif === "operator" && view === "admin" && <AdminView />}
            {espaceActif === "platform" && view === "platform" && <PlatformView />}
          </main>

          <footer className="mt-auto border-t px-4 md:px-8 py-3 text-[11.5px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
            <span className="font-display">HESYD ONE</span>
            <span aria-hidden="true">·</span>
            <span>{session?.organization.name}</span>
            <span aria-hidden="true">·</span>
            <span className="tnum">{t("landing.footer.line2")}</span>
          </footer>
        </div>
      </div>

      <CommandPalette />
      <OnboardingWizard open={onboardingOpen} onOpenChange={setOnboardingOpen} />
      <ProfileDialog />
    </div>
  );
}
