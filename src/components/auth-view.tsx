"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useAppStore, type AuthFlow } from "@/store/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { DeliveryReveal } from "@/components/app/delivery-reveal";
import { HesydMark } from "@/components/app/hesyd-mark";

/** Interpolation locale des libellés {cle}. */
function fmt(template: string, params: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}

/** Extrait le jeton d'un chemin de lien renvoyé par l'API (ex. /reinitialisation?token=…). */
function tokenFromPath(path: string): string | null {
  try {
    const idx = path.indexOf("?");
    const query = idx >= 0 ? path.slice(idx + 1) : path;
    return new URLSearchParams(query).get("token");
  } catch {
    return null;
  }
}

/** Logo Google officiel (quatre couleurs, matriciel — aucune dépendance externe). */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.98 11.98 0 0 0 12 0 11.99 11.99 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

/**
 * Acceptation d'invitation réelle : GET /api/auth/invite/{token} pour l'aperçu,
 * POST pour créer le compte + adhésion. Aucun raccourci simulé.
 */
export function InviteAcceptView({ token }: { token: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "invalid">("loading");
  const [info, setInfo] = useState<{ email: string; role: string; organization: string } | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/auth/invite/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("invalid");
        const d = await r.json();
        if (alive) {
          setInfo(d);
          setState("ready");
        }
      })
      .catch(() => {
        if (alive) setState("invalid");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  async function handleAccept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/invite/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, password }),
      });
      if (res.ok) {
        await useAppStore.getState().refreshSession();
      } else {
        toast({ title: t("common.error"), description: t("auth.invite.error"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <h1 className="font-display text-[25px] leading-tight">{t("auth.invite.title")}</h1>
      {state === "loading" && (
        <p className="mt-6 text-[14px] text-[var(--encre-2)] flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t("auth.invite.loading")}
        </p>
      )}
      {state === "invalid" && (
        <p className="mt-6 text-[14px] leading-relaxed text-[var(--encre-2)]" role="alert">
          {t("auth.invite.error")}
        </p>
      )}
      {state === "ready" && info && (
        <>
          <p className="mt-4 text-[14.5px] leading-relaxed text-[var(--encre-2)]">
            {t("auth.invite.subtitle")
              .replace("{org}", info.organization ?? "—")
              .replace("{role}", info.role.toLowerCase())}
          </p>
          <p className="mt-1.5 text-[13px] tnum text-[var(--encre-3)]">{info.email}</p>
          <form onSubmit={handleAccept} className="mt-7 grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="invite-name">{t("auth.invite.name")}</Label>
              <Input
                id="invite-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={80}
                autoComplete="name"
                className="h-11 bg-[var(--papier-creuse)]"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invite-password">{t("auth.invite.password")}</Label>
              <Input
                id="invite-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                className="h-11 bg-[var(--papier-creuse)]"
              />
            </div>
            <Button
              type="submit"
              disabled={busy}
              className="h-11 mt-1 bg-[var(--cachet)] text-[var(--primary-foreground)] hover:bg-[var(--cachet)]/90"
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("auth.invite.submit")}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

/** Réinitialisation de mot de passe via lien à jeton — écran dédié, session révoquée après succès. */
export function ResetPasswordView({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"form" | "success" | "error">("form");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || password.length < 8) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        setState("success");
        toast({ title: t("auth.reset.success"), description: t("auth.reset.successDetail") });
      } else {
        setState("error");
      }
    } catch {
      toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (state === "success") {
    return (
      <div className="w-full max-w-md">
        <h1 className="font-display text-[25px] leading-tight">{t("auth.reset.title")}</h1>
        <div
          className="mt-6 rounded-md border px-4 py-3.5 space-y-1"
          style={{ background: "var(--ruban-fond)", borderColor: "var(--bordure)" }}
          role="status"
        >
          <p className="text-[14px] font-medium" style={{ color: "var(--ruban)" }}>
            {t("auth.reset.success")}
          </p>
          <p className="text-[13px] leading-relaxed text-[var(--encre-2)]">{t("auth.reset.successDetail")}</p>
        </div>
        <Button className="h-11 mt-6 w-full bg-[var(--cachet)] text-[var(--primary-foreground)] hover:bg-[var(--cachet)]/90" onClick={onDone}>
          {t("auth.reset.continue")}
        </Button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="w-full max-w-md">
        <h1 className="font-display text-[25px] leading-tight">{t("auth.reset.title")}</h1>
        <div
          className="mt-6 rounded-md border px-4 py-3.5"
          style={{ background: "var(--erreur-fond)", borderColor: "var(--bordure)" }}
          role="alert"
        >
          <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--erreur)" }}>
            {t("auth.reset.error")}
          </p>
        </div>
        <Button className="h-11 mt-6 w-full bg-[var(--cachet)] text-[var(--primary-foreground)] hover:bg-[var(--cachet)]/90" onClick={onDone}>
          {t("auth.reset.continue")}
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <h1 className="font-display text-[25px] leading-tight">{t("auth.reset.title")}</h1>
      <p className="mt-4 text-[14.5px] leading-relaxed text-[var(--encre-2)]">{t("auth.reset.subtitle")}</p>
      <form onSubmit={handleSubmit} className="mt-7 grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="reset-password">{t("auth.reset.password")}</Label>
          <Input
            id="reset-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            className="h-11 bg-[var(--papier-creuse)]"
          />
        </div>
        <Button
          type="submit"
          disabled={busy || password.length < 8}
          className="h-11 mt-1 bg-[var(--cachet)] text-[var(--primary-foreground)] hover:bg-[var(--cachet)]/90"
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {busy ? t("auth.reset.working") : t("auth.reset.submit")}
        </Button>
      </form>
    </div>
  );
}

/** Vérification d'adresse e-mail via lien à jeton — appel réel au montage, bannière verte au succès. */
export function VerifyEmailView({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<"pending" | "success" | "error">("pending");

  const verifier = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => null)) as { verified?: boolean } | null;
      setState(res.ok && data?.verified ? "success" : "error");
    } catch {
      setState("error");
    }
  }, [token]);

  useEffect(() => {
    // Vérification réelle au montage — différée d'un micro-tick pour éviter
    // le rendu en cascade (setState asynchrone seulement après la réponse API).
    const id = window.setTimeout(() => {
      void verifier();
    }, 0);
    return () => window.clearTimeout(id);
  }, [verifier]);

  return (
    <div className="w-full max-w-md">
      <h1 className="font-display text-[25px] leading-tight">{t("auth.verify.title")}</h1>
      {state === "pending" && (
        <p className="mt-6 text-[14px] text-[var(--encre-2)] flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t("auth.verify.pending")}
        </p>
      )}
      {state === "success" && (
        <>
          <div
            className="mt-6 rounded-md border px-4 py-3.5 space-y-1"
            style={{ background: "var(--ruban-fond)", borderColor: "var(--bordure)" }}
            role="status"
          >
            <p className="text-[14px] font-medium" style={{ color: "var(--ruban)" }}>
              {t("auth.verify.success")}
            </p>
            <p className="text-[13px] leading-relaxed text-[var(--encre-2)]">{t("auth.verify.successDetail")}</p>
          </div>
          <Button className="h-11 mt-6 w-full bg-[var(--cachet)] text-[var(--primary-foreground)] hover:bg-[var(--cachet)]/90" onClick={onDone}>
            {t("auth.verify.continue")}
          </Button>
        </>
      )}
      {state === "error" && (
        <>
          <div
            className="mt-6 rounded-md border px-4 py-3.5"
            style={{ background: "var(--erreur-fond)", borderColor: "var(--bordure)" }}
            role="alert"
          >
            <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--erreur)" }}>
              {t("auth.verify.error")}
            </p>
          </div>
          <Button className="h-11 mt-6 w-full bg-[var(--cachet)] text-[var(--primary-foreground)] hover:bg-[var(--cachet)]/90" onClick={onDone}>
            {t("auth.verify.continue")}
          </Button>
        </>
      )}
    </div>
  );
}

/** Écran plein cadre pour les liens à jeton (réinitialisation, vérification e-mail). */
export function TokenFlowView({ flow, onDone }: { flow: NonNullable<AuthFlow>; onDone: () => void }) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b" style={{ borderColor: "var(--bordure)" }}>
        <div className="mx-auto w-full max-w-6xl px-6 md:px-10 h-14 flex items-center gap-2">
          <HesydMark className="h-7 w-7" />
          <span className="font-display text-[15px] font-semibold ml-2.5">HESYD ONE</span>
        </div>
      </header>
      <main className="flex-1 grid place-items-center px-6 py-14">
        {flow.kind === "reset" ? (
          <ResetPasswordView token={flow.token} onDone={onDone} />
        ) : (
          <VerifyEmailView token={flow.token} onDone={onDone} />
        )}
      </main>
    </div>
  );
}

/**
 * Vue d'authentification — inscription (essai 14 jours) ou connexion.
 * Google sign-in réel (OAuth 2.0 + PKCE, démarré côté serveur), deuxième
 * étape TOTP quand la double authentification est activée, mot de passe
 * oublié avec remise honnête du lien quand SMTP n'est pas configuré.
 */
export function AuthView({
  mode,
  onSwitch,
}: {
  mode: "signup" | "login";
  onSwitch?: (next: "signup" | "login") => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Deuxième étape MFA (TOTP) — le mot de passe reste en mémoire le temps de l'étape.
  const [mfaStep, setMfaStep] = useState<{ mfaToken: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaErrorCount, setMfaErrorCount] = useState(0);
  const [mfaCanResend, setMfaCanResend] = useState(false);

  // Mot de passe oublié
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotResult, setForgotResult] = useState<{
    message: string;
    deliveryMode?: string;
    deliveryNote?: string;
    resetPath?: string;
  } | null>(null);

  const isSignup = mode === "signup";

  // Détection réelle de la configuration Google (jamais simulée)
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/providers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (alive) setGoogleConfigured(Boolean(d?.google?.configured));
      })
      .catch(() => {
        if (alive) setGoogleConfigured(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Erreurs renvoyées par le callback OAuth via ?auth_error=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("auth_error");
    if (!err) return;
    params.delete("auth_error");
    window.history.replaceState(null, "", window.location.pathname + (params.toString() ? `?${params}` : ""));
    if (err === "google_refuse") return; // choix explicite de l'utilisateur : pas un échec
    if (err === "google_non_configure") {
      toast({ title: t("common.error"), description: t("auth.google.unconfigured"), variant: "destructive" });
    } else {
      toast({ title: t("common.error"), description: t("auth.google.error"), variant: "destructive" });
    }
  }, [t]);

  async function handleGoogle() {
    if (googleBusy) return;
    if (googleConfigured === false) {
      toast({ title: t("common.error"), description: t("auth.google.unconfigured"), variant: "destructive" });
      return;
    }
    setGoogleBusy(true);
    // Redirection réelle vers la page de consentement Google (flux serveur) :
    // navigation pleine page requise — router.push ne déclenche pas ce flux OAuth.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- redirection pleine page requise pour l'OAuth
    window.location.assign("/api/auth/oauth/google");
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(isSignup ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isSignup ? { organizationName, name, email, password } : { email, password },
        ),
      });
      const data = (await res.json().catch(() => null)) as
        | { mfaRequired?: boolean; mfaToken?: string; code?: string; retryAfterSeconds?: number }
        | null;
      if (res.ok) {
        if (data?.mfaRequired && data.mfaToken) {
          // Mot de passe vérifié : deuxième étape TOTP réelle.
          setMfaStep({ mfaToken: data.mfaToken });
          setMfaCode("");
          setMfaError(null);
          setMfaErrorCount(0);
          setMfaCanResend(false);
          return;
        }
        // La session réelle recharge l'app shell (page.tsx bascule sur AppShell).
        await useAppStore.getState().refreshSession();
      } else {
        const code = (data as { code?: string } | null)?.code;
        let desc: string;
        if (code === "compte_google_sans_mot_de_passe") {
          desc = t("auth.login.googleOnly");
        } else if (code === "trop_de_tentatives") {
          // Verrouillage progressif réel : durée exacte renvoyée par l'API (429).
          const minutes = Math.max(1, Math.ceil((data?.retryAfterSeconds ?? 60) / 60));
          desc = fmt(t("auth.mfa.errorLocked"), { minutes });
        } else {
          desc = t(isSignup ? "toast.signupError" : "toast.loginError");
        }
        toast({
          title: t("common.error"),
          description: desc,
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("common.error"),
        description: t("common.errorNetwork"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleMfaSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mfaBusy || !mfaStep || mfaCode.length !== 6) return;
    setMfaBusy(true);
    try {
      const res = await fetch("/api/auth/login/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, mfaToken: mfaStep.mfaToken, code: mfaCode }),
      });
      if (res.ok) {
        await useAppStore.getState().refreshSession();
        return;
      }
      const data = (await res.json().catch(() => null)) as
        | { code?: string; retryAfterSeconds?: number }
        | null;
      if (data?.code === "trop_de_tentatives") {
        const minutes = Math.max(1, Math.ceil((data.retryAfterSeconds ?? 60) / 60));
        setMfaError(fmt(t("auth.mfa.errorLocked"), { minutes }));
        setMfaCanResend(true);
      } else if (data?.code === "etape_mfa_expiree") {
        setMfaError(t("auth.mfa.errorExpired"));
        setMfaCanResend(true);
      } else {
        setMfaError(t("auth.mfa.errorInvalid"));
        const count = mfaErrorCount + 1;
        setMfaErrorCount(count);
        if (count >= 3) setMfaCanResend(true);
      }
    } catch {
      setMfaError(t("common.errorNetwork"));
    } finally {
      setMfaBusy(false);
    }
  }

  /** « Renvoyer » : relance la connexion classique pour régénérer l'étape MFA. */
  async function handleMfaResend() {
    if (mfaBusy) return;
    setMfaBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => null)) as
        | { mfaRequired?: boolean; mfaToken?: string; code?: string; retryAfterSeconds?: number }
        | null;
      if (res.ok && data?.mfaRequired && data.mfaToken) {
        setMfaStep({ mfaToken: data.mfaToken });
        setMfaCode("");
        setMfaError(null);
        setMfaErrorCount(0);
        setMfaCanResend(false);
        toast({ title: t("auth.mfa.title"), description: t("auth.mfa.resent") });
      } else {
        // La connexion classique ne passe plus : retour honnête à l'étape 1.
        setMfaStep(null);
        setMfaCode("");
        setMfaError(null);
        setMfaErrorCount(0);
        setMfaCanResend(false);
        const code = (data as { code?: string } | null)?.code;
        const desc =
          code === "trop_de_tentatives"
            ? fmt(t("auth.mfa.errorLocked"), { minutes: Math.max(1, Math.ceil((data?.retryAfterSeconds ?? 60) / 60)) })
            : t("toast.loginError");
        toast({
          title: t("common.error"),
          description: desc,
          variant: "destructive",
        });
      }
    } catch {
      setMfaError(t("common.errorNetwork"));
    } finally {
      setMfaBusy(false);
    }
  }

  function retourConnexion() {
    setMfaStep(null);
    setMfaCode("");
    setMfaError(null);
    setMfaErrorCount(0);
    setMfaCanResend(false);
  }

  async function handleForgotSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (forgotBusy) return;
    setForgotBusy(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          message?: string;
          deliveryMode?: string;
          deliveryNote?: string;
          resetPath?: string;
        };
        setForgotResult({
          message: data.message ?? "",
          deliveryMode: data.deliveryMode,
          deliveryNote: data.deliveryNote,
          resetPath: data.resetPath,
        });
      } else {
        toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
    } finally {
      setForgotBusy(false);
    }
  }

  function ouvrirLienReset(resetPath: string) {
    const token = tokenFromPath(resetPath);
    if (!token) {
      toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
      return;
    }
    setForgotOpen(false);
    setForgotResult(null);
    // Ouverture du flux de réinitialisation dans la même SPA.
    useAppStore.getState().setAuthFlow({ kind: "reset", token });
  }

  // ——— Deuxième étape MFA : remplace le formulaire le temps de la vérification ———
  if (!isSignup && mfaStep) {
    return (
      <div className="w-full max-w-md">
        <h1 className="font-display text-[25px] leading-tight">{t("auth.mfa.title")}</h1>
        <p className="mt-4 text-[14.5px] leading-relaxed text-[var(--encre-2)]">{t("auth.mfa.subtitle")}</p>
        <form onSubmit={handleMfaSubmit} className="mt-7 grid gap-5">
          <div className="grid gap-2 justify-items-start">
            <Label htmlFor="mfa-code">{t("auth.mfa.title")}</Label>
            <InputOTP
              id="mfa-code"
              maxLength={6}
              value={mfaCode}
              onChange={setMfaCode}
              autoFocus
              inputMode="numeric"
              pattern="^[0-9]*$"
              autoComplete="one-time-code"
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} className="h-11 w-11 text-[16px]" />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>

          {mfaError && (
            <p
              className="text-[13px] leading-relaxed rounded-md px-3 py-2.5"
              style={{ background: "var(--erreur-fond)", color: "var(--erreur)" }}
              role="alert"
            >
              {mfaError}
            </p>
          )}

          <Button
            type="submit"
            disabled={mfaBusy || mfaCode.length !== 6}
            className="h-11 mt-1 bg-[var(--cachet)] text-[var(--primary-foreground)] hover:bg-[var(--cachet)]/90"
          >
            {mfaBusy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {mfaBusy ? t("auth.mfa.checking") : t("auth.mfa.submit")}
          </Button>

          {mfaCanResend && (
            <div className="grid gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={mfaBusy}
                className="h-11 w-full border-[var(--bordure-forte)] bg-[var(--papier)] hover:bg-[var(--papier-leve)]"
                onClick={() => void handleMfaResend()}
              >
                {t("auth.mfa.resend")}
              </Button>
              <p className="text-[12px] leading-snug text-[var(--encre-3)]">{t("auth.mfa.resendHint")}</p>
            </div>
          )}

          <button
            type="button"
            onClick={retourConnexion}
            className="inline-flex items-center justify-center min-h-11 text-[13.5px] font-medium text-[var(--cachet)] underline-offset-4 hover:underline"
          >
            {t("auth.mfa.back")}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      {/* Sceau de marque — cachet de cire réel, signature du produit */}
      <Image
        src="/logo-seal.png"
        alt=""
        aria-hidden="true"
        width={1024}
        height={1024}
        sizes="72px"
        className="mb-6 size-[72px] rounded-full object-cover shadow-cachet select-none"
        draggable={false}
      />
      <h1 className="font-display text-[25px] leading-tight">
        {t(isSignup ? "auth.signup.title" : "auth.login.title")}
      </h1>

      {/* Connexion Google — disponible sur les deux écrans, état réel affiché */}
      <div className="mt-7">
        <Button
          type="button"
          onClick={handleGoogle}
          disabled={googleBusy || busy}
          variant="outline"
          className="h-11 w-full border-[var(--bordure-forte)] bg-[var(--papier)] hover:bg-[var(--papier-leve)]"
          aria-label={t(googleBusy ? "auth.google.signingIn" : "auth.google.signin")}
        >
          {googleBusy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <GoogleMark />
          )}
          <span>{t(googleBusy ? "auth.google.signingIn" : "auth.google.signin")}</span>
        </Button>
      </div>

      {/* Séparateur éditorial — filet + « ou » centré */}
      <div className="mt-6 flex items-center gap-4" aria-hidden="true">
        <span className="h-px flex-1" style={{ backgroundColor: "var(--bordure)" }} />
        <span className="text-[12.5px] uppercase tracking-[0.12em] text-[var(--encre-3)]">
          {t("auth.or")}
        </span>
        <span className="h-px flex-1" style={{ backgroundColor: "var(--bordure)" }} />
      </div>

      <form onSubmit={handleSubmit} className="mt-6 grid gap-5">
        {isSignup && (
          <>
            <div className="grid gap-2">
              <Label htmlFor="auth-organization">{t("auth.signup.org")}</Label>
              <Input
                id="auth-organization"
                name="organizationName"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                required
                minLength={2}
                maxLength={80}
                autoComplete="organization"
                className="h-11 bg-[var(--papier-creuse)]"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="auth-name">{t("auth.signup.name")}</Label>
              <Input
                id="auth-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={80}
                autoComplete="name"
                className="h-11 bg-[var(--papier-creuse)]"
              />
            </div>
          </>
        )}

        <div className="grid gap-2">
          <Label htmlFor="auth-email">
            {t(isSignup ? "auth.signup.email" : "auth.login.email")}
          </Label>
          <Input
            id="auth-email"
            name="email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="h-11 bg-[var(--papier-creuse)]"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="auth-password">
            {t(isSignup ? "auth.signup.password" : "auth.login.password")}
          </Label>
          <Input
            id="auth-password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={isSignup ? 8 : undefined}
            maxLength={72}
            autoComplete={isSignup ? "new-password" : "current-password"}
            className="h-11 bg-[var(--papier-creuse)]"
          />
        </div>

        <Button
          type="submit"
          disabled={busy}
          className="h-11 mt-1 bg-[var(--cachet)] text-[var(--primary-foreground)] hover:bg-[var(--cachet)]/90"
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {t(isSignup ? "auth.signup.submit" : "auth.login.submit")}
        </Button>
      </form>

      {/* Mot de passe oublié — sous le formulaire de connexion uniquement */}
      {!isSignup && (
        <button
          type="button"
          onClick={() => {
            setForgotEmail(email);
            setForgotResult(null);
            setForgotOpen(true);
          }}
          className="mt-5 inline-flex min-h-11 items-center text-[13.5px] font-medium text-[var(--cachet)] underline-offset-4 hover:underline"
        >
          {t("auth.forgot.link")}
        </button>
      )}

      <p className="mt-6 text-[13px] leading-relaxed text-[var(--encre-3)] max-w-[52ch]">
        {t("auth.trial.note")}
      </p>

      <div
        className="mt-10 border-t pt-2 flex flex-wrap items-center gap-x-3"
        style={{ borderColor: "var(--bordure)" }}
      >
        <span className="text-[14px] text-[var(--encre-2)]">
          {t(isSignup ? "auth.signup.haveAccount" : "auth.login.noAccount")}
        </span>
        <button
          type="button"
          onClick={() => onSwitch?.(isSignup ? "login" : "signup")}
          className="inline-flex items-center min-h-11 px-1 text-[14px] font-medium text-[var(--cachet)] underline-offset-4 hover:underline"
        >
          {t(isSignup ? "auth.signup.signIn" : "auth.login.createOne")}
        </button>
      </div>

      {/* Mot de passe oublié — demande réelle, remise honnête du lien sans e-mail configuré */}
      <Dialog
        open={forgotOpen}
        onOpenChange={(v) => {
          setForgotOpen(v);
          if (!v) setForgotResult(null);
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="font-display text-[17px]">{t("auth.forgot.title")}</DialogTitle>
            <DialogDescription className="text-[12.5px]">{t("auth.forgot.description")}</DialogDescription>
          </DialogHeader>

          {!forgotResult ? (
            <form onSubmit={handleForgotSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="forgot-email">{t("auth.forgot.email")}</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  inputMode="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="h-11 bg-[var(--papier-creuse)]"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1"
                  onClick={() => setForgotOpen(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="submit" className="h-11 flex-1" disabled={forgotBusy || !forgotEmail.trim()}>
                  {forgotBusy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                  {forgotBusy ? t("auth.forgot.sending") : t("auth.forgot.submit")}
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-4">
              {forgotResult.resetPath && forgotResult.deliveryNote ? (
                <DeliveryReveal
                  note={forgotResult.deliveryNote}
                  path={forgotResult.resetPath}
                  onOpen={() => ouvrirLienReset(forgotResult.resetPath!)}
                />
              ) : (
                <p
                  className="rounded-md border px-4 py-3.5 text-[13px] leading-relaxed text-[var(--encre-2)]"
                  style={{ background: "var(--papier-leve)", borderColor: "var(--bordure)" }}
                  role="status"
                >
                  {forgotResult.message}
                </p>
              )}
              <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setForgotOpen(false)}>
                {t("common.close")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
