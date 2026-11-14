"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/store/app";
import { useI18n } from "@/lib/i18n";
import { useApi, apiGet } from "@/hooks/use-api";
import { StatusPill } from "@/components/app/cachet";
import { EtatErreur } from "@/components/app/etat-erreur";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, ClipboardCheck } from "lucide-react";

type FileRow = {
  id: string;
  originalFilename: string;
  category: string;
  status: string;
  detectedType?: string | null;
  detectedTypeConfidence?: number | null;
  client?: { id: string; name: string } | null;
  group?: { id: string; name: string } | null;
  createdAt: string;
  motif: string;
};

type ReceptionRow = {
  id: string;
  caption?: string | null;
  source: string;
  status: string;
  receivedAt: string;
  fileId?: string | null;
  motif: string;
};

type InboxData = {
  motif1_verifications: FileRow[];
  motif2_receptions: ReceptionRow[];
  motif3_faibleConfiance: FileRow[];
  motif4_nonClasses: FileRow[];
  total: number;
};

type ClientOption = { id: string; name: string; code: string };
type GroupOption = { id: string; name: string; code: string; clientId: string };

/** File « À traiter » : interventions humaines réelles, motifs issus des données. */
export function InboxView() {
  const { t } = useI18n();
  const { call, loading } = useApi();
  const setDetailFileId = useAppStore((s) => s.setDetailFileId);
  const setView = useAppStore((s) => s.setView);
  const role = useAppStore((s) => s.session?.role);
  // Corrections et reprises exigent EMPLOYE+ côté serveur (audit sécurité) —
  // masquées pour un LECTEUR plutôt que vouées au 403 (audit UI P2).
  const peutCorriger = role !== "LECTEUR";
  const [data, setData] = useState<InboxData | null>(null);
  const [erreur, setErreur] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [correctingFile, setCorrectingFile] = useState<FileRow | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [selClient, setSelClient] = useState("");
  const [selGroup, setSelGroup] = useState("");

  const load = async () => {
    const inbox = await apiGet<InboxData>("/api/inbox");
    if (inbox) {
      setData(inbox);
      setErreur(false);
    } else {
      setErreur(true);
    }
    const clientsRes = await apiGet<{ clients: ClientOption[] }>("/api/clients");
    if (clientsRes) setClients(clientsRes.clients);
    const groupsRes = await apiGet<{ groups: GroupOption[] }>("/api/groups");
    if (groupsRes) setGroups(groupsRes.groups);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const inbox = await apiGet<InboxData>("/api/inbox");
      if (!alive) return;
      if (inbox) {
        setData(inbox);
        setErreur(false);
      } else {
        setErreur(true);
      }
      const clientsRes = await apiGet<{ clients: ClientOption[] }>("/api/clients");
      if (clientsRes && alive) setClients(clientsRes.clients);
      const groupsRes = await apiGet<{ groups: GroupOption[] }>("/api/groups");
      if (groupsRes && alive) setGroups(groupsRes.groups);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const groupsForClient = groups.filter((g) => g.clientId === selClient);

  const retryFile = async (fileId: string) => {
    setBusyId(fileId);
    const res = await call<{ proof: string }>(`/api/files/${fileId}/retry`, { method: "POST" });
    setBusyId(null);
    if (res) {
      toast({ title: t("inbox.corrected"), description: res.proof });
      load();
    }
  };

  const retryReception = async (receptionId: string) => {
    setBusyId(receptionId);
    const res = await call<unknown>(`/api/files/retry-reception`, { method: "POST", body: JSON.stringify({ receptionId }) });
    setBusyId(null);
    if (res) {
      toast({ title: t("inbox.corrected") });
      load();
    }
  };

  const submitCorrection = async () => {
    if (!correctingFile) return;
    if (!selClient || !selGroup) {
      toast({ title: t("common.error"), description: t("common.errorRequired"), variant: "destructive" });
      return;
    }
    setBusyId(correctingFile.id);
    const res = await call<unknown>(`/api/files/${correctingFile.id}/correct`, {
      method: "POST",
      body: JSON.stringify({ clientId: selClient, groupId: selGroup }),
    });
    setBusyId(null);
    if (res) {
      toast({ title: t("inbox.corrected") });
      setCorrectingFile(null);
      setSelClient("");
      setSelGroup("");
      load();
    }
  };

  if (!data) {
    if (erreur) {
      return (
        <div className="max-w-[1100px]">
          <EtatErreur
            onRetry={() => {
              setErreur(false);
              void load();
            }}
          />
        </div>
      );
    }
    return (
      <div className="space-y-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 rounded bg-secondary animate-pulse" />
        ))}
        <span className="sr-only">{t("common.loading")}</span>
      </div>
    );
  }

  if (data.total === 0) {
    return (
      <div className="flex flex-col items-start gap-3 py-16">
        <p className="font-display text-lg">{t("inbox.empty")}</p>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4" />
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const sections: { key: string; items: (FileRow | ReceptionRow)[]; kind: "file" | "reception" }[] = [
    { key: "inbox.motif.verification", items: data.motif1_verifications, kind: "file" },
    { key: "inbox.motif.reception", items: data.motif2_receptions, kind: "reception" },
    { key: "inbox.motif.confidence", items: data.motif3_faibleConfiance, kind: "file" },
    { key: "inbox.motif.unclassified", items: data.motif4_nonClasses, kind: "file" },
  ];

  return (
    <div className="space-y-8 max-w-[1100px]">
      {sections.map((section) =>
        section.items.length === 0 ? null : (
          <section key={section.key} aria-label={t(section.key)}>
            <div className="flex items-baseline gap-3 mb-2">
              <h2 className="text-[13px] font-medium tracking-[0.08em] uppercase text-muted-foreground">{t(section.key)}</h2>
              <span className="tnum text-[12px] text-muted-foreground">{section.items.length}</span>
            </div>
            <div className="border-t">
              {section.items.map((item) => {
                const isFile = section.kind === "file";
                const file = item as FileRow;
                const reception = item as ReceptionRow;
                const id = isFile ? file.id : reception.id;
                return (
                  <div key={id} className="registre-row flex items-center gap-3 h-12 px-1 min-w-0">
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <span className="truncate text-[13.5px]">
                        {isFile ? file.originalFilename : reception.caption ?? `${t("inbox.reception_prefix")} ${reception.id.slice(0, 8)}`}
                      </span>
                      {isFile && file.client && <span className="meta-points text-[11.5px] text-muted-foreground hidden sm:inline"><span>{file.client.name}</span></span>}
                      {!isFile && (
                        <span className="text-[11.5px] text-muted-foreground tnum hidden sm:inline">{reception.source}</span>
                      )}
                    </div>
                    {isFile && (
                      <button
                        onClick={() => {
                          setDetailFileId(file.id);
                          setView("files");
                        }}
                        className="text-[12px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline min-h-[44px]"
                      >
                        {t("files.detail.title")}
                      </button>
                    )}
                    {peutCorriger && isFile && file.status === "A_VERIFIER" && (
                      <Button variant="outline" size="sm" className="h-9" onClick={() => setCorrectingFile(file)}>
                        <ClipboardCheck className="h-4 w-4" />
                        {t("inbox.correct")}
                      </Button>
                    )}
                    {peutCorriger && !isFile && reception.status !== "ERREUR_DEFINITIVE" && (
                      <Button variant="outline" size="sm" className="h-9" disabled={busyId === id || loading} onClick={() => retryReception(reception.id)}>
                        <RefreshCw className={`h-4 w-4 ${busyId === id ? "animate-spin" : ""}`} />
                        {t("inbox.retry")}
                      </Button>
                    )}
                    {peutCorriger && isFile && file.status === "A_VERIFIER" && (
                      <Button variant="outline" size="sm" className="h-9" disabled={busyId === id || loading} onClick={() => retryFile(file.id)}>
                        <RefreshCw className={`h-4 w-4 ${busyId === id ? "animate-spin" : ""}`} />
                        {t("inbox.retry")}
                      </Button>
                    )}
                    {isFile ? (
                      <StatusPill status={file.status} label={t(`status.${file.status}`)} />
                    ) : (
                      <StatusPill status={reception.status === "ERREUR_DEFINITIVE" ? "REJETE_JUSTIFIE" : "A_VERIFIER"} label={reception.status === "ERREUR_DEFINITIVE" ? t("status.REJETE_JUSTIFIE") : t("inbox.motif.reception")} />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )
      )}

      {/* Correction de rattachement — panneau latéral, jamais de modale */}
      <Sheet open={Boolean(correctingFile)} onOpenChange={(v) => !v && setCorrectingFile(null)}>
        <SheetContent side="right" className="w-[480px] sm:w-[520px] overflow-y-auto scroll-fin">
          <SheetHeader>
            <SheetTitle className="font-display">{t("inbox.correct")}</SheetTitle>
            <SheetDescription className="truncate">{correctingFile?.originalFilename}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="inbox-client">{t("files.upload.toClient")}</Label>
              <Select
                value={selClient || "none"}
                onValueChange={(v) => {
                  setSelClient(v === "none" ? "" : v);
                  setSelGroup("");
                }}
              >
                <SelectTrigger id="inbox-client" className="h-10 w-full bg-[var(--papier-creuse)]">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inbox-group">{t("files.upload.toGroup")}</Label>
              <Select
                value={selGroup || "none"}
                onValueChange={(v) => setSelGroup(v === "none" ? "" : v)}
                disabled={!selClient}
              >
                <SelectTrigger id="inbox-group" className="h-10 w-full bg-[var(--papier-creuse)]">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {groupsForClient.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.code} — {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[12px] text-muted-foreground">{t("inbox.subtitle")}</p>
          </div>
          <SheetFooter>
            <Button onClick={submitCorrection} disabled={busyId === correctingFile?.id || loading}>
              {t("common.confirm")}
            </Button>
            <Button variant="ghost" onClick={() => setCorrectingFile(null)}>
              {t("common.cancel")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
