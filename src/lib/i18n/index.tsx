"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useAppStore } from "@/store/app";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

type I18nCtx = { t: (key: string, fallback?: string) => string; lang: "fr" | "en"; setLang: (l: "fr" | "en") => void };

const Ctx = createContext<I18nCtx>({ t: (k) => k, lang: "fr", setLang: () => undefined });

const DICTS: Record<"fr" | "en", Record<string, string>> = { fr, en };

export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);

  useEffect(() => {
    const stored = localStorage.getItem("hesyd_lang");
    if (stored === "en" || stored === "fr") setLang(stored);
  }, [setLang]);

  const t = (key: string, fallback?: string) => DICTS[lang][key] ?? DICTS["fr"][key] ?? fallback ?? key;
  return <Ctx.Provider value={{ t, lang, setLang }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}
