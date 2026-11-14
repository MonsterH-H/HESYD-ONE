"use client";

import { useCallback, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";

type ApiState = { loading: boolean; error: string | null };

/** Codes d'erreur serveur → clés i18n (sinon le code brut est affiché). */
const ERREURS_I18N: Record<string, string> = {
  forbidden: "api.forbidden",
  limite_clients_atteinte: "api.limite_clients_atteinte",
  limite_groupes_atteinte: "api.limite_groupes_atteinte",
  limite_automatisations_atteinte: "api.limite_automatisations_atteinte",
  intervalle_cron_trop_court: "api.intervalle_cron_trop_court",
  code_groupe_deja_utilise: "api.code_groupe_deja_utilise",
  trop_de_tentatives: "api.trop_de_tentatives",
  credits_insuffisants: "api.credits_insuffisants",
  credits_insuffisants_transcription_en_attente: "api.credits_insuffisants",
};

/** Hook d'appel API réel avec états de chargement et erreurs explicites. */
export function useApi() {
  const { t } = useI18n();
  const [state, setState] = useState<ApiState>({ loading: false, error: null });

  const call = useCallback(
    async <T,>(url: string, options?: RequestInit & { silent?: boolean }): Promise<T | null> => {
      setState({ loading: true, error: null });
      try {
        const res = await fetch(url, {
          ...options,
          headers: { ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options?.headers },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const raw = (data as { error?: string }).error ?? "erreur_reseau";
          const message = ERREURS_I18N[raw] ? t(ERREURS_I18N[raw]) : /Network error/i.test(raw) ? t("common.errorNetwork") : raw;
          if (!options?.silent) {
            toast({
              title: t("common.error"),
              description: message,
              variant: "destructive",
            });
          }
          setState({ loading: false, error: raw });
          return null;
        }
        setState({ loading: false, error: null });
        return data as T;
      } catch {
        if (!options?.silent) {
          toast({ title: t("common.error"), description: t("common.errorNetwork"), variant: "destructive" });
        }
        setState({ loading: false, error: "erreur_reseau" });
        return null;
      }
    },
    [t]
  );

  return { ...state, call };
}

export async function apiGet<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
