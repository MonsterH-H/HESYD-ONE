"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, PauseCircle, Pencil, PlayCircle, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useApi, apiGet } from "@/hooks/use-api";
import { toast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/app";
import { EtatErreur } from "@/components/app/etat-erreur";
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

type GroupRow = {
  id: string;
  code: string;
  name: string;
  sourceType: string;
  whatsappGroupId: string | null;
  collectionStatus: string;
  status: string;
  lastEventAt: string | null;
  client: { id: string; name: string };
  _count: { files: number };
};

type ClientLite = { id: string; name: string; code: string; status: string };

// Restriction honnête : seules ces deux sources ont un mécanisme de collecte réel
// (WhatsApp direct appairé + dépôt web). WHATSAPP_GROUPE et DOSSIER_SURVEILLE
// n'ont aucun canal de collecte opérationnel : ils ne sont plus proposables.
const SOURCES = ["WHATSAPP_DIRECT", "DEPOT_WEB"] as const;

const formVide = { clientId: "", code: "", name: "", sourceType: "DEPOT_WEB" };

/** Pastille de collecte : forme + couleur sémantique, jamais la couleur seule. */
function PastilleCollecte({ statut }: { statut: string }) {
  const { t } = useI18n();
  const couleur =
    statut === "ACTIF"
      ? "var(--ruban)"
      : statut === "EN_VERIFICATION"
        ? "var(--carton)"
        : statut === "SUSPENDU" || statut === "DECONNECTE"
          ? "var(--erreur)"
          : "var(--encre-3)";
  const plein = statut === "ACTIF";
  const croise = statut === "DECONNECTE";
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: couleur }}>
      {plein && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: couleur }} aria-hidden="true" />}
      {!plein && !croise && <span className="h-2 w-2 shrink-0 rounded-full border-2" style={{ borderColor: couleur }} aria-hidden="true" />}
      {croise && (
        <span className="relative h-2 w-2 shrink-0" aria-hidden="true">
          <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2" style={{ background: couleur }} />
          <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2" style={{ background: couleur }} />
        </span>
      )}
      <span className="whitespace-nowrap">{t(`groups.collection.${statut}`)}</span>
    </span>
  );
}

/** Vue Groupes — CRUD complet : création, édition, suspension, archivage logique, filtres. */
export function GroupsView() {
  const { t } = useI18n();
  const { call } = useApi();
  const role = useAppStore((s) => s.session?.role);

  // CDC §4.6 : création/modification de groupes réservées à PROPRIETAIRE et ADMINISTRATEUR.
  const peutGerer = role === "PROPRIETAIRE" || role === "ADMINISTRATEUR";

  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [whatsappOk, setWhatsappOk] = useState(true);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(false);

  // Filtres réels : recherche texte, client, statut
  const [recherche, setRecherche] = useState("");
  const [filtreClient, setFiltreClient] = useState("tous");
  const [filtreStatut, setFiltreStatut] = useState("tous");

  const [clients, setClients] = useState<ClientLite[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [edition, setEdition] = useState<GroupRow | null>(null);
  const [form, setForm] = useState(formVide);
  const [envoi, setEnvoi] = useState(false);

  const [confirmArchive, setConfirmArchive] = useState<GroupRow | null>(null);

  const refetch = useCallback(async () => {
    const d = await apiGet<{ groups: GroupRow[]; whatsappConfigured: boolean }>("/api/groups");
    if (d) {
      setGroups(d.groups);
      setWhatsappOk(d.whatsappConfigured);
      setErreur(false);
    } else {
      setErreur(true);
    }
  }, []);

  // Premier chargement du registre (callback asynchrone)
  useEffect(() => {
    let vivant = true;
    apiGet<{ groups: GroupRow[]; whatsappConfigured: boolean }>("/api/groups").then((d) => {
      if (!vivant) return;
      if (d) {
        setGroups(d.groups);
        setWhatsappOk(d.whatsappConfigured);
        setErreur(false);
      } else {
        setErreur(true);
      }
      setChargement(false);
    });
    return () => {
      vivant = false;
    };
  }, []);

  // Clients réels pour les selects — chargés à l'ouverture du panneau
  useEffect(() => {
    if (!sheetOpen) return;
    let vivant = true;
    apiGet<{ clients: ClientLite[] }>("/api/clients").then((d) => {
      if (vivant && d) setClients(d.clients);
    });
    return () => {
      vivant = false;
    };
  }, [sheetOpen]);

  const ouvrirCreation = () => {
    setEdition(null);
    setForm(formVide);
    setSheetOpen(true);
  };

  const ouvrirEdition = (g: GroupRow) => {
    setEdition(g);
    setForm({ clientId: g.client?.id ?? "", code: g.code, name: g.name, sourceType: g.sourceType });
    setSheetOpen(true);
  };

  const enregistrer = async () => {
    if (!form.clientId || !form.code.trim() || !form.name.trim()) return;
    setEnvoi(true);
    const res = edition
      ? await call<{ group: GroupRow }>(`/api/groups/${edition.id}`, {
          method: "PATCH",
          body: JSON.stringify(form),
        })
      : await call<{ group: GroupRow }>("/api/groups", {
          method: "POST",
          body: JSON.stringify(form),
        });
    setEnvoi(false);
    if (res) {
      toast({ description: edition ? t("toast.groupUpdated") : t("toast.groupCreated") });
      setForm(formVide);
      setEdition(null);
      setSheetOpen(false);
      refetch();
    }
  };

  const changerStatut = async (g: GroupRow) => {
    const prochain = g.status === "ACTIF" ? "SUSPENDU" : "ACTIF";
    const res = await call<{ group: GroupRow }>(`/api/groups/${g.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: prochain }),
    });
    if (res) refetch();
  };

  const archiver = async () => {
    if (!confirmArchive) return;
    const res = await call<{ group: GroupRow }>(`/api/groups/${confirmArchive.id}`, { method: "DELETE" });
    if (res) {
      toast({ description: t("toast.groupArchived") });
      setConfirmArchive(null);
      refetch();
    }
  };

  // Filtres appliqués localement sur le registre chargé (données réelles, jamais d'invention)
  const groupesFiltres = useMemo(() => {
    if (!groups) return null;
    const q = recherche.trim().toLowerCase();
    return groups.filter((g) => {
      if (q && !`${g.code} ${g.name} ${g.client?.name ?? ""}`.toLowerCase().includes(q)) return false;
      if (filtreClient !== "tous" && g.client?.id !== filtreClient) return false;
      if (filtreStatut !== "tous" && g.status !== filtreStatut) return false;
      return true;
    });
  }, [groups, recherche, filtreClient, filtreStatut]);

  const filtersActifs = recherche.trim() !== "" || filtreClient !== "tous" || filtreStatut !== "tous";

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[20px] font-semibold">{t("groups.title")}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{t("groups.subtitle")}</p>
        </div>
        {peutGerer && <Button onClick={ouvrirCreation}>{t("groups.add")}</Button>}
      </div>

      {/* Encart honnête (carton, pas d'alerte rouge) tant que Meta n'est pas configuré */}
      {!whatsappOk && (
        <p
          className="mt-4 rounded-md border px-4 py-3 text-[12.5px] leading-relaxed"
          style={{ background: "var(--carton-fond)", borderColor: "var(--bordure)", color: "var(--encre)" }}
        >
          {t("groups.whatsappNotice")}
        </p>
      )}

      {/* Filtres — recherche, client, statut */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder={t("groups.search")}
            aria-label={t("groups.search")}
            className="h-10 pl-8 bg-[var(--papier-creuse)]"
          />
        </div>
        <Select value={filtreClient} onValueChange={setFiltreClient}>
          <SelectTrigger className="h-10 w-[180px] bg-[var(--papier-creuse)]" aria-label={t("groups.client")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tous">{t("common.allClients")}</SelectItem>
            {(groups ?? []).map((g) => g.client).filter((c, i, arr) => c && arr.findIndex((x) => x?.id === c.id) === i).map((c) => (
              <SelectItem key={c!.id} value={c!.id}>{c!.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtreStatut} onValueChange={setFiltreStatut}>
          <SelectTrigger className="h-10 w-[150px] bg-[var(--papier-creuse)]" aria-label={t("clients.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tous">{t("common.allStatus")}</SelectItem>
            <SelectItem value="ACTIF">{t("groups.status.ACTIF")}</SelectItem>
            <SelectItem value="SUSPENDU">{t("groups.status.SUSPENDU")}</SelectItem>
          </SelectContent>
        </Select>
        {filtersActifs && (
          <Button
            variant="ghost"
            className="h-10 text-[12px] text-muted-foreground"
            onClick={() => {
              setRecherche("");
              setFiltreClient("tous");
              setFiltreStatut("tous");
            }}
          >
            {t("common.resetFilters")}
          </Button>
        )}
      </div>

      <div className="registre mt-3 border-t border-[var(--bordure)]" role="table" aria-label={t("groups.title")}>
        <div className="hidden h-9 items-center gap-4 px-2 text-[11px] uppercase tracking-[0.06em] text-muted-foreground md:flex">
          <span className="w-24 shrink-0">{t("clients.code")}</span>
          <span className="min-w-0 flex-1">{t("clients.name")}</span>
          <span className="hidden w-44 shrink-0 lg:block">{t("groups.client")}</span>
          <span className="w-36 shrink-0">{t("groups.source")}</span>
          <span className="w-36 shrink-0">{t("groups.collection")}</span>
          <span className="hidden w-14 shrink-0 text-right sm:block">{t("clients.files")}</span>
          <span className="hidden w-28 shrink-0 xl:block">{t("groups.lastEvent")}</span>
          <span className="w-[104px] shrink-0 text-right">{t("common.actions")}</span>
        </div>

        {groups === null && chargement && !erreur && (
          <>
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="mt-2 h-12 w-full rounded-md" />
          </>
        )}

        {groups === null && erreur && (
          <EtatErreur
            onRetry={() => {
              setErreur(false);
              setChargement(true);
              void refetch();
            }}
          />
        )}

        {groupesFiltres && groupesFiltres.length === 0 && (
          <p className="px-2 py-10 text-center text-[13.5px] text-muted-foreground">
            {filtersActifs ? t("common.noResults") : t("groups.empty")}
          </p>
        )}

        {groupesFiltres?.map((g) => (
          <div
            key={g.id}
            className="registre-row flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 px-2 py-2 md:flex-nowrap"
          >
            <span className="w-24 shrink-0 truncate text-[12.5px] tnum">{g.code}</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{g.name}</span>
            <span className="hidden w-44 shrink-0 truncate text-[12.5px] text-muted-foreground lg:block">
              {g.client?.name ?? "—"}
            </span>
            <span className="w-36 shrink-0 truncate text-[12.5px]">{t(`groups.source.${g.sourceType}`)}</span>
            <span className="w-36 shrink-0">
              <PastilleCollecte statut={g.collectionStatus} />
            </span>
            <span className="hidden w-14 shrink-0 text-right text-[13px] tnum sm:block">{g._count.files}</span>
            <span className="hidden w-28 shrink-0 text-right text-[12px] tnum text-muted-foreground xl:block">
              {g.lastEventAt ? new Date(g.lastEventAt).toLocaleDateString() : "—"}
            </span>
            <span className="ml-auto flex w-[104px] shrink-0 items-center justify-end md:ml-0">
              {peutGerer && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    aria-label={t("groups.edit")}
                    title={t("groups.edit")}
                    onClick={() => ouvrirEdition(g)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    aria-label={g.status === "ACTIF" ? t("groups.suspend") : t("groups.activate")}
                    title={g.status === "ACTIF" ? t("groups.suspend") : t("groups.activate")}
                    onClick={() => changerStatut(g)}
                  >
                    {g.status === "ACTIF" ? (
                      <PauseCircle className="h-[18px] w-[18px]" aria-hidden="true" />
                    ) : (
                      <PlayCircle className="h-[18px] w-[18px]" aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 hidden sm:inline-flex"
                    aria-label={t("groups.archive")}
                    title={t("groups.archive")}
                    onClick={() => setConfirmArchive(g)}
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
        <SheetContent side="right" className="w-[440px] sm:max-w-[440px]">
          <SheetHeader>
            <SheetTitle className="font-display text-[18px]">{edition ? t("groups.editTitle") : t("groups.add")}</SheetTitle>
            <SheetDescription>{edition ? edition.name : t("groups.subtitle")}</SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-1 flex-col gap-4 px-4"
            onSubmit={(e) => {
              e.preventDefault();
              enregistrer();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="group-client">{t("groups.client")}</Label>
              <Select
                value={form.clientId}
                onValueChange={(v) => setForm({ ...form, clientId: v })}
                required
              >
                <SelectTrigger id="group-client" className="h-11 w-full bg-[var(--papier-creuse)]">
                  <SelectValue placeholder={t("common.none")} />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-code">{t("clients.code")}</Label>
              <Input
                id="group-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className="h-11 bg-[var(--papier-creuse)] tnum"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-name">{t("clients.name")}</Label>
              <Input
                id="group-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-11 bg-[var(--papier-creuse)]"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-source">{t("groups.source")}</Label>
              <Select value={form.sourceType} onValueChange={(v) => setForm({ ...form, sourceType: v })}>
                <SelectTrigger id="group-source" className="h-11 w-full bg-[var(--papier-creuse)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`groups.source.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <SheetFooter className="mt-auto flex-row justify-between">
              <Button type="button" variant="ghost" className="h-11" onClick={() => setSheetOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                className="h-11"
                disabled={envoi || !form.clientId || !form.code.trim() || !form.name.trim()}
              >
                {edition ? t("common.save") : t("common.create")}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Confirmation d'archivage logique */}
      <AlertDialog open={!!confirmArchive} onOpenChange={(v) => !v && setConfirmArchive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{t("groups.archiveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmArchive ? t("groups.confirm.archive").replace("{name}", confirmArchive.name) : ""}
            </AlertDialogDescription>
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
