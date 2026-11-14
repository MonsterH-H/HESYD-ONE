"use client";

import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

/** État d'erreur partagé — message honnête + action de reprise. Remplace les squelettes infinis quand `apiGet` renvoie null. */
export function EtatErreur({ onRetry, compact = false }: { onRetry: () => void; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 text-center border border-bordure rounded-md bg-papier-leve ${compact ? "py-6 px-4" : "py-10 px-6"}`}
    >
      <span className="relative h-2.5 w-2.5 shrink-0" aria-hidden="true" style={{ color: "var(--erreur)" }}>
        <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2" style={{ background: "currentColor" }} />
        <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2" style={{ background: "currentColor" }} />
      </span>
      <div>
        <p className="text-corps font-medium text-encre">{t("common.erreur_chargement")}</p>
        <p className="text-meta text-encre-2 mt-1">{t("common.erreur_chargement_detail")}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
