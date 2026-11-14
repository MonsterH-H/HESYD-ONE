"use client";

import { useCallback, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";

type ApiState = { loading: boolean; error: string | null };

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
          const message = (data as { error?: string }).error ?? "erreur_reseau";
          if (!options?.silent) {
            toast({
              title: t("common.error"),
              description: /Network error/i.test(message) ? t("common.errorNetwork") : message,
              variant: "destructive",
            });
          }
          setState({ loading: false, error: message });
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
