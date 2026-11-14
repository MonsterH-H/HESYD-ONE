"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, PauseCircle, Pencil, PlayCircle, Search } from "lucide-react";
import { useAppStore } from "@/store/app";
import { useI18n } from "@/lib/i18n";
import { useApi, apiGet } from "@/hooks/use-api";
import { toast } from "@/hooks/use-toast";
import { StatusPill } from "@/components/app/cachet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

type ClientGroup = { id: string; code: string; name: string; status: string; collectionStatus: string };

type ClientRow = {
  id: string;
  code: string;
  name: string;
  contact: string | null;
  status: string;
  createdAt: string;
  groups: ClientGroup[];
  _count: { files: number };
};

type FileLite = { id: string; originalFilename: string; status: string; createdAt: string };

const formVide = { code: "", name: "", contact: "" };

/** Libellé simple du statut client, pastille conforme (rond plein = actif, anneau = attente). */
function PillStatutClient({ status }: { status: string }) {
  const { t } = useI18n();
  if (status === "ACTIF") return <StatusPill status="ARCHIVE" label={t("clients.status.ACTIF")} />;
  if (status === "SUSPENDU") return <StatusPill status="A_VERIFIER" label={t("clients.status.SUSPENDU")} />;
  return <StatusPill status={status} label={status} />;
}

/** Vue Clients — référentiel dense : création, édition, suspension, archivage logique, filtres, fiche latérale. La création et la modification sont réservées au propriétaire et aux administrateurs (CDC §4.6) ; le dépôt de documents reste accessible aux employés. */
export function ClientsView() {
  const { t } = useI18n();
  const { call } = useApi();
  const setView = useAppStore((s) => s.setView);
  const setDetailFileId = useAppStore((s) => s.setDetailFileId);
  const role = useAppStore((s) => s.session?.role);

  // CDC §4.6 : création/modification de clients réservées à PROPRIETAIRE et ADMINISTRATEUR.
  const peutGerer = role === "PROPRIETAIRE" || role === "ADMINISTRATEUR";

  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [chargement, setChargement] = useState(true);

  // Filtres réels
  const [recherche, setRecherche] = useState("");
  const [filtreStatut, setFiltreStatut] = useState("tous");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [edition, setEdition] = useState<ClientRow | null>(null);
  const [form, setForm] = useState(formVide);
  const [envoi, setEnvoi] = useState(false);

  const [fiche, setFiche] = useState<ClientRow | null>(null);
  const [ficheFiles, setFicheFiles] = useState<FileLite[] | null>(null);

  const [confirmArchive, setConfirmArchive] = useState<ClientRow | null>(null);

  const refetch = useCallback(async () => {
    const d = await apiGet<{ clients: ClientRow[] }>("/api/clients");
    if (d) setClients(d.clients);
  }, []);

  // Premier chargement du registre (callback asynchrone — jamais de setState synchrone dans l'effet)
  useEffect(() => {
    let vivant = true;
    apiGet<{ clients: ClientRow[] }>("/api/clients").then((d) => {
      if (!vivant) return;
      if (d) setClients(d.clients);
      setChargement(false);
    });
    return () => {
      vivant = false;
    };
  }, []);

  // Documents réels du client pour la fiche latérale
  useEffect(() => {
    if (!fiche) return;
    let vivant = true;
    apiGet<{ files: FileLite[] }>(`/api/files?clientId=${encodeURIComponent(fiche.id)}&page=1`).then((d) => {
      if (vivant) setFicheFiles(d?.files ?? []);
    });
    return () => {
      vivant = false;
    };
  }, [fiche]);

  const ouvrirFiche = (cl: ClientRow) => {
    setFicheFiles(null);
    setFiche(cl);
  };

  const ouvrirCreation = () => {
    setEdition(null);
    setForm(formVide);
    setSheetOpen(true);
  };

  const ouvrirEdition = (cl: ClientRow) => {
    setEdition(cl);
    setForm({ code: cl.code, name: cl.name, contact: cl.contact ?? "" });
    setSheetOpen(true);
  };

  const enregistrer = async () => {
    if (!form.code.trim() || !form.name.trim()) return;
    setEnvoi(true);
    const res = edition
      ? await call<{ client: ClientRow }>(`/api/clients/${edition.id}`, {
          method: "PATCH",
          body: JSON.stringify({ code: form.code, name: form.name, contact: form.contact || undefined }),
        })
      : await call<{ client: ClientRow }>("/api/clients", {
          method: "POST",
          body: JSON.stringify({ code: form.code, name: form.name, contact: form.contact || undefined }),
        });
    setEnvoi(false);
    if (res) {
      toast({ description: edition ? t("toast.clientUpdated") : t("toast.clientCreated") });
      setForm(formVide);
      setEdition(null);
      setSheetOpen(false);
      refetch();
    }
  };

  const changerStatut = async (client: ClientRow) => {
    const prochain = client.status === "ACTIF" ? "SUSPENDU" : "ACTIF";
    const res = await call<{ client: ClientRow }>(`/api/clients/${client.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: prochain }),
    });
    if (res) refetch();
  };

  const archiver = async () => {
    if (!confirmArchive) return;
    const res = await call<{ client: ClientRow }>(`/api/clients/${confirmArchive.id}`, { method: "DELETE" });
    if (res) {
      toast({ description: t("toast.clientArchived") });
      setConfirmArchive(null);
      refetch();
    }
  };

  const ouvrirFichier = (id: string) => {
    setDetailFileId(id);
    setView("files");
  };

  // Filtres appliqués localement sur le registre chargé
  const clientsFiltres = useMemo(() => {
    if (!clients) return null;
    const q = recherche.trim().toLowerCase();
    return clients.filter((cl) => {
      if (q && !`${cl.code} ${cl.name} ${cl.contact ?? ""}`.toLowerCase().includes(q)) return false;
      if (filtreStatut !== "tous" && cl.status !== filtreStatut) return false;
      return true;
    });
  }, [clients, recherche, filtreStatut]);

  const filtersActifs = recherche.trim() !== "" || filtreStatut !== "tous";

  return (
    <div className="mx-auto max-w-[1100px]">
      {/* En-tête */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[20px] font-semibold">{t("clients.title")}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{t("clients.subtitle")}</p>
        </div>
        {peutGerer && <Button onClick={ouvrirCreation}>{t("clients.add")}</Button>}
      </div>

      {/* Filtres — recherche + statut */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder={t("clients.search")}
            aria-label={t("clients.search")}
            className="h-10 pl-8 bg-[var(--papier-creuse)]"
          />
        </div>
        <Select value={filtreStatut} onValueChange={setFiltreStatut}>
          <SelectTrigger className="h-10 w-[160px] bg-[var(--papier-creuse)]" aria-label={t("clients.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tous">{t("common.allStatus")}</SelectItem>
            <SelectItem value="ACTIF">{t("clients.status.ACTIF")}</SelectItem>
            <SelectItem value="SUSPENDU">{t("clients.status.SUSPENDU")}</SelectItem>
          </SelectContent>
        </Select>
        {filtersActifs && (
          <Button
            variant="ghost"
            className="h-10 text-[12px] text-muted-foreground"
            onClick={() => {
              setRecherche("");
              setFiltreStatut("tous");
            }}
          >
            {t("common.resetFilters")}
          </Button>
        )}
      </div>

      {/* Registre */}
      <div className="registre mt-3 border-t border-[var(--bordure)]" role="table" aria-label={t("clients.title")}>
        <div className="hidden h-9 items-center gap-4 px-2 text-[11px] uppercase tracking-[0.06em] text-muted-foreground md:flex">
          <span className="w-28 shrink-0">{t("clients.code")}</span>
          <span className="min-w-0 flex-1">{t("clients.name")}</span>
          <span className="hidden w-52 shrink-0 lg:block">{t("clients.contact")}</span>
          <span className="w-16 shrink-0 text-right">{t("clients.files")}</span>
          <span className="w-16 shrink-0 text-right">{t("clients.groups")}</span>
          <span className="w-28 shrink-0">{t("clients.status")}</span>
          <span className="w-[168px] shrink-0 text-right">{t("common.actions")}</span>
        </div>

        {chargement && !clients && (
          <>
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="mt-2 h-12 w-full rounded-md" />
            <Skeleton className="mt-2 h-12 w-full rounded-md" />
          </>
        )}

        {clientsFiltres && clientsFiltres.length === 0 && (
          <p className="px-2 py-10 text-center text-[13.5px] text-muted-foreground">
            {filtersActifs ? t("common.noResults") : t("clients.empty")}
          </p>
        )}

        {clientsFiltres?.map((cl) => (
          <div
            key={cl.id}
            role="button"
            tabIndex={0}
            onClick={() => ouvrirFiche(cl)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                ouvrirFiche(cl);
              }
            }}
            className="registre-row flex min-h-12 cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-2 py-2 md:flex-nowrap"
            aria-label={`${cl.code} — ${cl.name}`}
          >
            <span className="w-28 shrink-0 truncate text-[12.5px] tnum">{cl.code}</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{cl.name}</span>
            <span className="hidden w-52 shrink-0 truncate text-[12px] text-muted-foreground lg:block">
              {cl.contact ?? "—"}
            </span>
            <span className="w-16 shrink-0 text-right text-[13px] tnum">{cl._count.files}</span>
            <span className="w-16 shrink-0 text-right text-[13px] tnum">{cl.groups.length}</span>
            <span className="w-28 shrink-0">
              <PillStatutClient status={cl.status} />
            </span>
            <span className="flex w-[168px] shrink-0 items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {peutGerer && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    aria-label={t("clients.edit")}
                    title={t("clients.edit")}
                    onClick={() => ouvrirEdition(cl)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    aria-label={cl.status === "ACTIF" ? t("clients.suspend") : t("clients.activate")}
                    title={cl.status === "ACTIF" ? t("clients.suspend") : t("clients.activate")}
                    onClick={() => changerStatut(cl)}
                  >
                    {cl.status === "ACTIF" ? (
                      <PauseCircle className="h-[18px] w-[18px]" aria-hidden="true" />
                    ) : (
                      <PlayCircle className="h-[18px] w-[18px]" aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    aria-label={t("clients.archive")}
                    title={t("clients.archive")}
                    onClick={() => setConfirmArchive(cl)}
                  >
                    <Archive className="h-[18px] w-[18px]" aria-hidden="true" />
                  </Button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Sheet création / édition */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-[420px] sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle className="font-display text-[18px]">{edition ? t("clients.editTitle") : t("clients.add")}</SheetTitle>
            <SheetDescription>{edition ? `${edition.code} — ${edition.name}` : t("clients.subtitle")}</SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-1 flex-col gap-4 px-4"
            onSubmit={(e) => {
              e.preventDefault();
              enregistrer();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="client-code">{t("clients.code")}</Label>
              <Input
                id="client-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className="h-11 bg-[var(--papier-creuse)] tnum"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-name">{t("clients.name")}</Label>
              <Input
                id="client-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-11 bg-[var(--papier-creuse)]"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-contact">{t("clients.contact")}</Label>
              <Input
                id="client-contact"
                value={form.contact}
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
                className="h-11 bg-[var(--papier-creuse)]"
              />
            </div>
            <SheetFooter className="mt-auto flex-row justify-between">
              <Button type="button" variant="ghost" className="h-11" onClick={() => setSheetOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" className="h-11" disabled={envoi || !form.code.trim() || !form.name.trim()}>
                {edition ? t("common.save") : t("common.create")}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Fiche client */}
      <Sheet open={!!fiche} onOpenChange={(v) => !v && setFiche(null)}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px]">
          {fiche && (
            <>
              <SheetHeader>
                <SheetTitle className="font-display text-[18px]">{fiche.name}</SheetTitle>
                <SheetDescription className="tnum">
                  {t("clients.code")} {fiche.code} · {t("clients.created")} {new Date(fiche.createdAt).toLocaleDateString()}
                </SheetDescription>
              </SheetHeader>
              <div className="scroll-fin flex-1 overflow-y-auto px-4 pb-6">
                <dl className="space-y-2 text-[13px]">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{t("clients.contact")}</dt>
                    <dd className="text-right">{fiche.contact ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{t("clients.status")}</dt>
                    <dd>
                      <PillStatutClient status={fiche.status} />
                    </dd>
                  </div>
                </dl>

                <h3 className="mt-6 font-display text-[14px] font-semibold">
                  {t("clients.groups")} <span className="tnum">({fiche.groups.length})</span>
                </h3>
                {fiche.groups.length === 0 ? (
                  <p className="mt-2 text-[12.5px] text-muted-foreground">{t("groups.empty")}</p>
                ) : (
                  <ul className="mt-2 border-t border-[var(--bordure)]">
                    {fiche.groups.map((g) => (
                      <li key={g.id} className="flex h-12 items-center gap-3 border-b border-[var(--bordure)]">
                        <span className="w-28 shrink-0 truncate text-[12.5px] tnum">{g.code}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">{g.name}</span>
                        <span className="shrink-0 text-[12px]" style={{ color: "var(--encre-2)" }}>
                          {t(`groups.collection.${g.collectionStatus}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <h3 className="mt-6 font-display text-[14px] font-semibold">{t("overview.recentFiles")}</h3>
                {ficheFiles === null ? (
                  <Skeleton className="mt-2 h-12 w-full rounded-md" />
                ) : ficheFiles.length === 0 ? (
                  <p className="mt-2 text-[12.5px] text-muted-foreground">{t("files.empty")}</p>
                ) : (
                  <ul className="mt-2 border-t border-[var(--bordure)]">
                    {ficheFiles.map((f) => (
                      <li key={f.id} className="registre-row">
                        <button
                          type="button"
                          onClick={() => ouvrirFichier(f.id)}
                          className="flex h-12 w-full items-center gap-3 px-1 text-left"
                          title={f.originalFilename}
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px]">{f.originalFilename}</span>
                          <StatusPill status={f.status} label={t(`status.${f.status}`)} />
                          <time className="shrink-0 text-[11.5px] tnum text-muted-foreground" dateTime={f.createdAt}>
                            {new Date(f.createdAt).toLocaleDateString()}
                          </time>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <SheetFooter className="px-0 pb-0">
                  <Button variant="outline" className="h-11" onClick={() => setFiche(null)}>
                    {t("files.close")}
                  </Button>
                </SheetFooter>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Confirmation d'archivage logique */}
      <AlertDialog open={!!confirmArchive} onOpenChange={(v) => !v && setConfirmArchive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{t("clients.archive")}</AlertDialogTitle>
            <AlertDialogDescription>{t("clients.confirm.archive")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11" onClick={archiver}>
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
