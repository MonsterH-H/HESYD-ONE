"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app";
import { Landing } from "@/components/landing";
import { AppShell } from "@/components/app/app-shell";
import { TokenFlowView } from "@/components/auth-view";

export default function Page() {
  const session = useAppStore((s) => s.session);
  const sessionLoaded = useAppStore((s) => s.sessionLoaded);
  const refreshSession = useAppStore((s) => s.refreshSession);
  const authFlow = useAppStore((s) => s.authFlow);
  const setAuthFlow = useAppStore((s) => s.setAuthFlow);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // Liens à jeton (réinitialisation, vérification e-mail) : détection au montage
  // uniquement — le paramètre est retiré de l'URL pour ne pas rejouer l'écran.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("token");
      if (!token) return;
      const kind = window.location.pathname === "/verification-email" ? "verify" : "reset";
      params.delete("token");
      const rest = params.toString();
      window.history.replaceState(null, "", "/" + (rest ? `?${rest}` : ""));
      setAuthFlow({ kind, token });
    }, 0);
    return () => window.clearTimeout(id);
  }, [setAuthFlow]);

  if (!sessionLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="font-display text-sm">HESYD ONE</span>
        </div>
      </div>
    );
  }

  // Écran dédié tant qu'un flux à jeton est actif (connexion ou non).
  if (authFlow) {
    return (
      <TokenFlowView
        flow={authFlow}
        onDone={() => {
          setAuthFlow(null);
          void refreshSession();
        }}
      />
    );
  }

  if (!session) {
    return <Landing />;
  }

  return <AppShell />;
}
