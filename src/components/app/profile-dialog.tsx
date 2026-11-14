"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/hooks/use-api";
import { toast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Loader2, ShieldCheck } from "lucide-react";

/** Ligne copiable : valeur monospace + bouton copier (44 px, retour visuel). */
function CopyableRow({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1.5">
      <Label className="text-[12px]">{label}</Label>
      <div className="flex items-center gap-2">
        <output
          className="min-w-0 flex-1 rounded-md border bg-[var(--papier-leve)] px-3 py-2.5 text-[11.5px] tnum break-all leading-snug"
          style={{ borderColor: "var(--bordure)" }}
          aria-label={label}
        >
          {value}
        </output>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-11 shrink-0 p-0"
          onClick={() => {
            navigator.clipboard
              .writeText(value)
              .then(() => {
                setCopied(true);
                toast({ title: t("common.copied"), description: label });
                window.setTimeout(() => setCopied(false), 2000);
              })
              .catch(() => {
                toast({ title: t("common.error"), description: value, variant: "destructive" });
              });
          }}
          aria-label={t("common.copy")}
          title={t("common.copy")}
        >
          <Copy className="h-4 w-4" style={copied ? { color: "var(--ruban)" } : undefined} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/** Section double authentification (TOTP) — activation et désactivation réelles. */
function MfaSection() {
  const { t } = useI18n();
  const session = useAppStore((s) => s.session);
  const refreshSession = useAppStore((s) => s.refreshSession);

  const mfaEnabled = session?.user.mfaEnabled === true;

  // Activation : setup → saisie du code → enable
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupData, setSetupData] = useState<{ secret: string; otpauth: string } | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);

  // Désactivation : mot de passe + code
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableBusy, setDisableBusy] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);

  async function demarrerSetup() {
    if (setupBusy) return;
    setSetupBusy(true);
    setSetupError(null);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup" }),
      });
      const data = (await res.json().catch(() => null)) as
        | { secret?: string; otpauth?: string }
        | null;
      if (res.ok && data?.secret && data?.otpauth) {
        setSetupData({ secret: data.secret, otpauth: data.otpauth });
        setSetupCode("");
      } else if (res.ok) {
        await refreshSession();
        setSetupOpen(false);
        toast({ title: t("common.error"), description: t("toast.actionError"), variant: "destructive" });
      } else {
        toast({ title: t("common.error"), description: t("toast.actionError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
    } finally {
      setSetupBusy(false);
    }
  }

  async function confirmerActivation() {
    if (setupBusy || !setupData || setupCode.length !== 6) return;
    setSetupBusy(true);
    setSetupError(null);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable", code: setupCode }),
      });
      if (res.ok) {
        toast({ title: t("profile.mfa.activated"), description: t("profile.mfa.activatedDetail") });
        setSetupOpen(false);
        setSetupData(null);
        setSetupCode("");
        await refreshSession();
      } else {
        setSetupError(t("auth.mfa.errorInvalid"));
      }
    } catch {
      setSetupError(t("common.errorNetwork"));
    } finally {
      setSetupBusy(false);
    }
  }

  async function confirmerDesactivation() {
    if (disableBusy || disableCode.length !== 6 || !disablePassword) return;
    setDisableBusy(true);
    setDisableError(null);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable", code: disableCode, password: disablePassword }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) {
        toast({ title: t("profile.mfa.disabledToast") });
        setDisableOpen(false);
        setDisablePassword("");
        setDisableCode("");
        await refreshSession();
      } else if (data?.error === "mot_de_passe_invalide") {
        setDisableError(t("profile.password.currentRequired"));
      } else {
        setDisableError(t("auth.mfa.errorInvalid"));
      }
    } catch {
      setDisableError(t("common.errorNetwork"));
    } finally {
      setDisableBusy(false);
    }
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t("profile.mfa.title")}
          </div>
          <span
            className="inline-flex items-center gap-1.5 text-[11.5px] font-medium"
            style={{ color: mfaEnabled ? "var(--ruban)" : "var(--encre-3)" }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: mfaEnabled ? "var(--ruban)" : "var(--encre-3)" }}
              aria-hidden="true"
            />
            {t(mfaEnabled ? "profile.mfa.enabled" : "profile.mfa.disabled")}
          </span>
        </div>

        <p className="text-[12px] leading-relaxed text-muted-foreground">{t("profile.mfa.description")}</p>

        {!mfaEnabled ? (
          <Button
            variant="outline"
            className="h-11 w-full"
            disabled={setupBusy}
            onClick={() => {
              setSetupData(null);
              setSetupCode("");
              setSetupError(null);
              setSetupOpen(true);
            }}
          >
            {setupBusy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {t("profile.mfa.activate")}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="h-11 w-full"
            style={{ color: "var(--erreur)", borderColor: "var(--bordure-forte)" }}
            onClick={() => {
              setDisablePassword("");
              setDisableCode("");
              setDisableError(null);
              setDisableOpen(true);
            }}
          >
            {t("profile.mfa.disable")}
          </Button>
        )}
      </div>

      {/* Activation : secret + URI copiables, code de confirmation */}
      <Dialog open={setupOpen} onOpenChange={(v) => { setSetupOpen(v); if (!v) setSetupData(null); }}>
        <DialogContent className="sm:max-w-[480px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-[17px]">{t("profile.mfa.setup.title")}</DialogTitle>
            <DialogDescription className="text-[12.5px]">{t("profile.mfa.setup.note")}</DialogDescription>
          </DialogHeader>

          {!setupData ? (
            <div className="grid gap-4">
              <p className="text-[13px] leading-relaxed text-muted-foreground">{t("profile.mfa.description")}</p>
              <Button className="h-11 w-full" disabled={setupBusy} onClick={() => void demarrerSetup()}>
                {setupBusy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {t("profile.mfa.activate")}
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              <CopyableRow label={t("profile.mfa.setup.secret")} value={setupData.secret} />
              <CopyableRow label={t("profile.mfa.setup.uri")} value={setupData.otpauth} />
              <div className="grid gap-2 justify-items-start">
                <Label htmlFor="mfa-setup-code">{t("profile.mfa.setup.code")}</Label>
                <InputOTP
                  id="mfa-setup-code"
                  maxLength={6}
                  value={setupCode}
                  onChange={setSetupCode}
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
              {setupError && (
                <p
                  className="text-[12.5px] leading-relaxed rounded-md px-3 py-2.5"
                  style={{ background: "var(--erreur-fond)", color: "var(--erreur)" }}
                  role="alert"
                >
                  {setupError}
                </p>
              )}
              <Button
                className="h-11 w-full"
                disabled={setupBusy || setupCode.length !== 6}
                onClick={() => void confirmerActivation()}
              >
                {setupBusy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {t("profile.mfa.setup.confirm")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Désactivation : mot de passe + code, confirmation forte */}
      <AlertDialog open={disableOpen} onOpenChange={(v) => { setDisableOpen(v); if (!v) setDisableError(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{t("profile.mfa.disable.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("profile.mfa.disable.description")}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5">
              <Label htmlFor="mfa-disable-password" className="text-[12.5px]">{t("profile.mfa.disable.password")}</Label>
              <Input
                id="mfa-disable-password"
                type="password"
                autoComplete="current-password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="grid gap-1.5 justify-items-start">
              <Label htmlFor="mfa-disable-code" className="text-[12.5px]">{t("profile.mfa.disable.code")}</Label>
              <InputOTP
                id="mfa-disable-code"
                maxLength={6}
                value={disableCode}
                onChange={setDisableCode}
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
            {disableError && (
              <p
                className="text-[12.5px] leading-relaxed rounded-md px-3 py-2.5"
                style={{ background: "var(--erreur-fond)", color: "var(--erreur)" }}
                role="alert"
              >
                {disableError}
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              disabled={disableBusy || disableCode.length !== 6 || !disablePassword}
              onClick={(e) => {
                e.preventDefault(); // garde le dialogue ouvert jusqu'au résultat réel
                void confirmerDesactivation();
              }}
            >
              {disableBusy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("profile.mfa.disable.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Formulaire monté à chaque ouverture (le contenu Radix se démonte à la fermeture) — aucune synchronisation par effet. */
function ProfileForm() {
  const { t } = useI18n();
  const { call } = useApi();
  const session = useAppStore((s) => s.session);
  const setOpen = useAppStore((s) => s.setProfileOpen);
  const refreshSession = useAppStore((s) => s.refreshSession);

  const [name, setName] = useState(() => session?.user.name ?? "");
  const [locale, setLocale] = useState(() => session?.user.locale || "fr");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [envoi, setEnvoi] = useState(false);

  const hasPassword = Boolean(session?.user.hasPassword);

  const enregistrer = async () => {
    if (!name.trim()) return;
    setEnvoi(true);
    const payload: Record<string, string> = { name: name.trim(), locale };
    if (newPassword) {
      payload.newPassword = newPassword;
      if (hasPassword) payload.currentPassword = currentPassword;
    }
    const res = await call<{ user: { name: string; locale: string } }>("/api/profile", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    setEnvoi(false);
    if (res) {
      toast({ title: t("toast.saved") });
      setOpen(false);
      await refreshSession();
    }
  };

  const roleLabel = session ? t(`admin.users.role.${session.role}`) : "";
  const peutEnregistrer = name.trim().length > 0 && (!newPassword || ((!hasPassword || currentPassword.length > 0) && newPassword.length >= 8));

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-[17px]">{t("profile.title")}</DialogTitle>
        <DialogDescription className="text-[12.5px]">{t("profile.subtitle")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {/* Identité réelle : avatar Google si présent, sinon initiale */}
        <div className="flex items-center gap-3">
          {session?.user.avatarUrl ? (
            <img
              src={session.user.avatarUrl}
              alt=""
              className="h-10 w-10 rounded-full border object-cover"
              style={{ borderColor: "var(--bordure)" }}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full border font-display text-[15px] uppercase"
              style={{ borderColor: "var(--bordure)", backgroundColor: "var(--papier-leve)" }}
            >
              {(session?.user.name ?? "?").slice(0, 1)}
            </span>
          )}
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium truncate">{session?.user.email}</div>
            <div className="text-[11.5px] text-muted-foreground">{roleLabel}</div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-name" className="text-[12.5px]">{t("profile.name")}</Label>
          <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} className="h-11" maxLength={120} />
        </div>

        <div className="space-y-1.5">
          <Label className="text-[12.5px]">{t("profile.locale")}</Label>
          <Select value={locale} onValueChange={setLocale}>
            <SelectTrigger className="w-full h-11" aria-label={t("profile.locale")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fr">Français</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {hasPassword ? t("profile.password.change") : t("profile.password.define")}
          </div>
          {hasPassword && (
            <div className="space-y-1.5">
              <Label htmlFor="profile-current" className="text-[12.5px]">{t("profile.password.current")}</Label>
              <Input
                id="profile-current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="h-11"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="profile-new" className="text-[12.5px]">{t("profile.password.new")}</Label>
            <Input
              id="profile-new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="h-11"
              placeholder={hasPassword ? undefined : t("profile.password.placeholder")}
            />
            <p className="text-[11px] text-muted-foreground">{t("profile.password.hint")}</p>
          </div>
          {newPassword.length > 0 && hasPassword && currentPassword.length === 0 && (
            <p className="text-[11.5px]" style={{ color: "var(--carton)" }}>{t("profile.password.currentRequired")}</p>
          )}
        </div>

        <Separator />

        <MfaSection />
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button variant="outline" className="h-11 flex-1" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
        <Button className="h-11 flex-1" disabled={!peutEnregistrer || envoi} onClick={() => void enregistrer()}>
          {t("common.save")}
        </Button>
      </div>
    </>
  );
}

/** Profil de l'utilisateur connecté : identité, langue, mot de passe et double authentification — réel, jamais simulé. */
export function ProfileDialog() {
  const open = useAppStore((s) => s.profileOpen);
  const setOpen = useAppStore((s) => s.setProfileOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[440px] max-h-[88vh] overflow-y-auto">
        <ProfileForm />
      </DialogContent>
    </Dialog>
  );
}
