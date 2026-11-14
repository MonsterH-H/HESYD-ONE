"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { toast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/app";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeliveryReveal } from "@/components/app/delivery-reveal";
import { Loader2, MailCheck } from "lucide-react";

/**
 * Bannière discrète sous l'en-tête lorsque l'adresse e-mail n'est pas
 * vérifiée — ouvre un dialogue réel de renvoi du lien (remise honnête
 * tant que SMTP n'est pas configuré).
 */
export function EmailVerifyBanner() {
  const { t } = useI18n();
  const session = useAppStore((s) => s.session);
  const refreshSession = useAppStore((s) => s.refreshSession);
  const setAuthFlow = useAppStore((s) => s.setAuthFlow);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    alreadyVerified?: boolean;
    sent?: boolean;
    deliveryMode?: string;
    verifyPath?: string;
    deliveryNote?: string;
  } | null>(null);

  if (!session || session.user.emailVerified) return null;

  async function renvoyer() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resend: true }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          alreadyVerified?: boolean;
          sent?: boolean;
          deliveryMode?: string;
          verifyPath?: string;
          deliveryNote?: string;
        };
        if (data.alreadyVerified) {
          toast({ title: t("banner.verify.title"), description: t("banner.verify.alreadyVerified") });
          setOpen(false);
          await refreshSession();
          return;
        }
        setResult(data);
      } else {
        toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  function ouvrirLien(verifyPath: string) {
    try {
      const idx = verifyPath.indexOf("?");
      const query = idx >= 0 ? verifyPath.slice(idx + 1) : verifyPath;
      const token = new URLSearchParams(query).get("token");
      if (!token) return;
      setOpen(false);
      setResult(null);
      // Vérification dans la même SPA — bannière verte au succès, retour à l'app.
      setAuthFlow({ kind: "verify", token });
    } catch {
      toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
    }
  }

  return (
    <>
      <div
        className="border-b px-4 md:px-8 py-2 flex flex-wrap items-center gap-x-2 gap-y-1"
        style={{ background: "var(--carton-fond)", borderColor: "var(--bordure)" }}
        role="status"
      >
        <MailCheck className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--carton)" }} aria-hidden="true" />
        <span className="text-[12.5px] font-medium" style={{ color: "var(--carton)" }}>
          {t("banner.emailUnverified")}
        </span>
        <span className="text-[12.5px] text-[var(--encre-2)]" aria-hidden="true">—</span>
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setOpen(true);
          }}
          className="inline-flex min-h-11 items-center text-[12.5px] font-medium text-[var(--cachet)] underline-offset-4 hover:underline py-1"
        >
          {t("banner.emailVerifyNow")}
        </button>
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setResult(null); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="font-display text-[17px]">{t("banner.verify.title")}</DialogTitle>
            <DialogDescription className="text-[12.5px]">
              {t("banner.verify.description").replace("{email}", session.user.email)}
            </DialogDescription>
          </DialogHeader>

          {!result ? (
            <div className="grid gap-4">
              <Button className="h-11 w-full" disabled={busy} onClick={() => void renvoyer()}>
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {t("banner.verify.resend")}
              </Button>
              <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setOpen(false)}>
                {t("common.close")}
              </Button>
            </div>
          ) : result.verifyPath && result.deliveryNote ? (
            <div className="grid gap-4">
              <DeliveryReveal
                note={result.deliveryNote}
                path={result.verifyPath}
                onOpen={() => ouvrirLien(result.verifyPath!)}
              />
              <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setOpen(false)}>
                {t("common.close")}
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              <p
                className="rounded-md border px-4 py-3.5 text-[13px] leading-relaxed text-[var(--encre-2)]"
                style={{ background: "var(--papier-leve)", borderColor: "var(--bordure)" }}
                role="status"
              >
                {t("banner.verify.sent")}
              </p>
              <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setOpen(false)}>
                {t("common.close")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
