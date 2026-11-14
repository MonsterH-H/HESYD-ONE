"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useApi, apiGet } from "@/hooks/use-api";
import { useI18n } from "@/lib/i18n";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
};

/** Cloche de notifications — compte non-lus réel, liste dense, marquage de lecture réel. */
export function NotificationsMenu() {
  const { t } = useI18n();
  const { call } = useApi();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [marking, setMarking] = useState(false);

  const refetch = useCallback(async () => {
    const data = await apiGet<{ notifications: NotificationItem[]; unread: number }>("/api/notifications");
    if (data) {
      setItems(data.notifications);
      setUnread(data.unread);
    }
  }, []);

  // Chargement initial puis rafraîchissement à chaque ouverture (callbacks asynchrones, jamais synchrone)
  useEffect(() => {
    let vivant = true;
    apiGet<{ notifications: NotificationItem[]; unread: number }>("/api/notifications").then((d) => {
      if (vivant && d) {
        setItems(d.notifications);
        setUnread(d.unread);
      }
    });
    return () => {
      vivant = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let vivant = true;
    apiGet<{ notifications: NotificationItem[]; unread: number }>("/api/notifications").then((d) => {
      if (vivant && d) {
        setItems(d.notifications);
        setUnread(d.unread);
      }
    });
    return () => {
      vivant = false;
    };
  }, [open]);

  const markAllRead = async () => {
    const ids = items.filter((n) => !n.readAt).map((n) => n.id);
    if (ids.length === 0) return;
    setMarking(true);
    const res = await call<{ ok: boolean }>("/api/notifications", {
      method: "POST",
      body: JSON.stringify({ ids }),
      silent: true,
    });
    setMarking(false);
    if (res) refetch();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-11 w-11"
          // Les non-lus sont annoncés par le trigger lui-même (audit UI — le
          // badge visuel seul était muet pour les lecteurs d'écran).
          aria-label={t("notifications.title") + (unread > 0 ? " — " + unread : "")}
          title={t("notifications.title")}
        >
          <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
          {unread > 0 && (
            <span
              className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--cachet)] px-1 text-[10px] font-medium tnum leading-none text-[var(--papier-leve)]"
              aria-hidden="true"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-[var(--bordure)] px-4 py-3">
          <span className="font-display text-[13px] font-semibold">{t("notifications.title")}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-[12px] text-muted-foreground"
            disabled={unread === 0 || marking}
            onClick={markAllRead}
          >
            {t("notifications.markRead")}
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">{t("notifications.empty")}</p>
        ) : (
          <ul className="scroll-fin max-h-96 overflow-y-auto" aria-label={t("notifications.title")}>
            {items.map((n) => (
              <li key={n.id} className="flex items-start gap-2.5 border-b border-[var(--bordure)] px-4 py-3 last:border-b-0">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: n.readAt ? "transparent" : "var(--cachet)" }}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium leading-snug">{n.title}</p>
                  <p className="text-[12px] leading-snug text-muted-foreground">{n.message}</p>
                </div>
                <time className="shrink-0 pt-0.5 text-[11px] tnum text-muted-foreground" dateTime={n.createdAt}>
                  {new Date(n.createdAt).toLocaleDateString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
