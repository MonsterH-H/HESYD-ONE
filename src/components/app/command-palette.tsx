"use client";

import { useAppStore, type ViewId } from "@/store/app";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { ArrowUpRight, FileUp, Languages, LogOut, MessageCircleQuestion, SunMoon } from "lucide-react";

/** Palette de commandes — navigation vers les vues autorisées + actions réelles. Escape ferme (Radix). */
export function CommandPalette() {
  const open = useAppStore((s) => s.paletteOpen);
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);
  const setView = useAppStore((s) => s.setView);
  const logout = useAppStore((s) => s.logout);
  const role = useAppStore((s) => s.session?.role);
  const isPlatformAdmin = useAppStore((s) => s.session?.isPlatformAdmin === true);
  const { t, lang, setLang } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();

  // Console opérateur réservée aux rôles élevés — cohérent avec la navigation latérale
  const canAdmin = role === "PROPRIETAIRE" || role === "ADMINISTRATEUR";
  const VUES: ViewId[] = [
    "overview",
    "clients",
    "groups",
    "files",
    "inbox",
    "assistant",
    "deliverables",
    "finances",
    "automations",
    "approvals",
    "imports",
    ...(canAdmin ? (["admin"] as ViewId[]) : []),
    ...(isPlatformAdmin ? (["platform"] as ViewId[]) : []),
  ];

  const go = (v: ViewId) => {
    setView(v);
    setPaletteOpen(false);
  };

  const labelPour = (v: ViewId) =>
    v === "admin" ? t("space.operator.badge") : v === "platform" ? t("nav.platform") : t(`nav.${v}`);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setPaletteOpen}
      title={t("common.palette.title")}
      description={t("common.palette.title")}
    >
      <CommandInput placeholder={t("common.palette.title")} />
      <CommandList>
        <CommandEmpty>{t("common.palette.empty")}</CommandEmpty>
        <CommandGroup heading={t("common.palette.navigation")}>
          {VUES.map((v) => (
            <CommandItem key={v} value={labelPour(v)} onSelect={() => go(v)}>
              <ArrowUpRight className="h-4 w-4 text-[var(--encre-3)]" aria-hidden="true" />
              <span>{labelPour(v)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t("common.actions")}>
          <CommandItem value={t("common.palette.upload")} onSelect={() => go("files")}>
            <FileUp className="h-4 w-4 text-[var(--encre-3)]" aria-hidden="true" />
            <span>{t("common.palette.upload")}</span>
          </CommandItem>
          <CommandItem value={t("common.palette.askAgent")} onSelect={() => go("assistant")}>
            <MessageCircleQuestion className="h-4 w-4 text-[var(--encre-3)]" aria-hidden="true" />
            <span>{t("common.palette.askAgent")}</span>
          </CommandItem>
          {/* Bascule de thème — même mécanique que ThemeToggle */}
          <CommandItem
            value={t("common.theme")}
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              setPaletteOpen(false);
            }}
          >
            <SunMoon className="h-4 w-4 text-[var(--encre-3)]" aria-hidden="true" />
            <span>{t("common.theme")}</span>
          </CommandItem>
          {/* Changement de langue — mêmes autonymes que ProfileForm (jamais traduits) */}
          <CommandItem
            value={t("common.language")}
            onSelect={() => {
              setLang(lang === "fr" ? "en" : "fr");
              setPaletteOpen(false);
            }}
          >
            <Languages className="h-4 w-4 text-[var(--encre-3)]" aria-hidden="true" />
            <span>{t("common.language")}</span>
            <span className="ml-auto text-[12px] text-muted-foreground">{lang === "fr" ? "English" : "Français"}</span>
          </CommandItem>
          {/* Déconnexion — même action réelle que la barre latérale */}
          <CommandItem
            value={t("common.logout")}
            onSelect={() => {
              setPaletteOpen(false);
              void logout();
            }}
          >
            <LogOut className="h-4 w-4 text-[var(--encre-3)]" aria-hidden="true" />
            <span>{t("common.logout")}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
