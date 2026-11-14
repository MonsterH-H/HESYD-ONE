"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * État vide partagé — même vocabulaire visuel que Cachet et EtatErreur :
 * icône fine dans un carré bordé, titre du registre, phrase, action optionnelle.
 * Les libellés sont passés déjà traduits par l'appelant (aucun texte en dur).
 */
export function EtatVide({
  icon: Icon,
  title,
  detail,
  actionLabel,
  onAction,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 text-center border border-bordure rounded-md bg-papier-leve ${compact ? "py-6 px-4" : "py-10 px-6"}`}
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-md border border-bordure bg-papier"
      >
        <Icon className="h-5 w-5 text-encre-3" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <div>
        <p className="text-corps font-medium text-encre">{title}</p>
        {detail ? <p className="text-meta text-encre-2 mt-1 max-w-md">{detail}</p> : null}
      </div>
      {actionLabel && onAction ? (
        <Button variant="outline" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
