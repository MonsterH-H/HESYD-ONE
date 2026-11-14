"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink } from "lucide-react";

/**
 * Remise honnête d'un lien quand aucun service e-mail n'est configuré :
 * titre « Mode sans e-mail configuré », note de l'API telle quelle, zone
 * copiable et bouton d'ouverture dans la même SPA.
 */
export function DeliveryReveal({
  note,
  path,
  onOpen,
}: {
  note: string;
  path: string;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const lienComplet =
    typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

  const copier = () => {
    navigator.clipboard
      .writeText(lienComplet)
      .then(() => {
        setCopied(true);
        toast({ title: t("common.copied"), description: t("delivery.link") });
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        toast({ title: t("common.error"), description: lienComplet, variant: "destructive" });
      });
  };

  return (
    <div
      className="rounded-md border p-3 space-y-2.5"
      style={{ background: "var(--carton-fond)", borderColor: "var(--bordure)" }}
      role="group"
      aria-label={t("delivery.title")}
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--carton)" }}>
        {t("delivery.title")}
      </div>
      <p className="text-[12.5px] leading-relaxed text-[var(--encre-2)]">{note}</p>
      <div className="flex items-center gap-2">
        <output
          className="min-w-0 flex-1 rounded-md border bg-[var(--papier)] px-3 py-2.5 text-[12px] tnum break-all"
          style={{ borderColor: "var(--bordure-forte)" }}
          aria-label={t("delivery.link")}
        >
          {lienComplet}
        </output>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-11 shrink-0 p-0"
          onClick={copier}
          aria-label={t("delivery.copyLink")}
          title={t("delivery.copyLink")}
        >
          <Copy className="h-4 w-4" style={copied ? { color: "var(--ruban)" } : undefined} aria-hidden="true" />
        </Button>
      </div>
      <Button type="button" className="h-11 w-full" onClick={onOpen}>
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
        {t("delivery.openLink")}
      </Button>
    </div>
  );
}
