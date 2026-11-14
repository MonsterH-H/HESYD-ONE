"use client";

import { create } from "zustand";

export type SessionState = {
  user: {
    id: string;
    email: string;
    name: string;
    locale: string;
    avatarUrl: string | null;
    hasPassword: boolean;
    emailVerified: boolean;
    mfaEnabled: boolean;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
    timezone: string;
    locale: string;
    trialEndsAt: string | null;
    autonomyLevel: string;
  };
  role: "PROPRIETAIRE" | "ADMINISTRATEUR" | "EMPLOYE" | "LECTEUR";
  credits: number;
  /** Quota mensuel réel du plan actif (null : aucun plan chargé) — jauge honnête. */
  planMonthlyCredits: number | null;
  isPlatformAdmin: boolean;
};

/** Écran d'authentification piloté par un lien à jeton (réinitialisation, vérification e-mail). */
export type AuthFlow = { kind: "reset" | "verify"; token: string } | null;

/** Les deux espaces applicatifs et la console exploitant (au-dessus des organisations). */
export type SpaceId = "documents" | "operator" | "platform";

export type AdminTab = "team" | "integrations" | "subscription" | "logs" | "settings" | "security";

export type ViewId =
  | "overview"
  | "clients"
  | "groups"
  | "files"
  | "inbox"
  | "assistant"
  | "deliverables"
  | "finances"
  | "automations"
  | "approvals"
  | "imports"
  | "admin"
  | "platform";

type AppState = {
  session: SessionState | null;
  sessionLoaded: boolean;
  view: ViewId;
  space: SpaceId;
  adminTab: AdminTab;
  lang: "fr" | "en";
  paletteOpen: boolean;
  profileOpen: boolean;
  authFlow: AuthFlow;
  selectedClientId: string | null;
  detailFileId: string | null;
  onboardingOpen: boolean;
  setSession: (s: SessionState | null) => void;
  setSessionLoaded: (v: boolean) => void;
  setView: (v: ViewId) => void;
  setSpace: (s: SpaceId) => void;
  setAdminTab: (t: AdminTab) => void;
  setLang: (l: "fr" | "en") => void;
  setPaletteOpen: (v: boolean) => void;
  setProfileOpen: (v: boolean) => void;
  setAuthFlow: (f: AuthFlow) => void;
  setSelectedClientId: (id: string | null) => void;
  setDetailFileId: (id: string | null) => void;
  setOnboardingOpen: (v: boolean) => void;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
};

/** La vue détermine l'espace : `admin` appartient à la console opérateur, `platform` à la console exploitant. */
function espacePourVue(v: ViewId): SpaceId {
  if (v === "admin") return "operator";
  if (v === "platform") return "platform";
  return "documents";
}

export const useAppStore = create<AppState>((set) => ({
  session: null,
  sessionLoaded: false,
  view: "overview",
  space: "documents",
  adminTab: "team",
  lang: "fr",
  paletteOpen: false,
  profileOpen: false,
  authFlow: null,
  selectedClientId: null,
  detailFileId: null,
  onboardingOpen: false,
  setSession: (s) => set({ session: s }),
  setSessionLoaded: (v) => set({ sessionLoaded: v }),
  setView: (v) => set({ view: v, space: espacePourVue(v) }),
  setSpace: (s) =>
    set((state) => ({
      space: s,
      view:
        s === "operator"
          ? "admin"
          : s === "platform"
            ? "platform"
            : state.view === "admin" || state.view === "platform"
              ? "overview"
              : state.view,
    })),
  setAdminTab: (t) => set({ adminTab: t, view: "admin", space: "operator" }),
  setLang: (l) => {
    set({ lang: l });
    if (typeof window !== "undefined") localStorage.setItem("hesyd_lang", l);
  },
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  setProfileOpen: (v) => set({ profileOpen: v }),
  setAuthFlow: (f) => set({ authFlow: f }),
  setSelectedClientId: (id) => set({ selectedClientId: id }),
  setDetailFileId: (id) => set({ detailFileId: id }),
  setOnboardingOpen: (v) => set({ onboardingOpen: v }),
  refreshSession: async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      const data = await res.json();
      set({ session: data.authenticated ? data : null, sessionLoaded: true });
    } catch {
      set({ session: null, sessionLoaded: true });
    }
  },
  logout: async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    set({ session: null, view: "overview", space: "documents", detailFileId: null });
  },
}));

export async function refreshCredits() {
  try {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    const data = await res.json();
    if (data.authenticated) useAppStore.setState({ session: data });
  } catch {
    // silencieux : le quota sera rafraîchi au prochain tour
  }
}
