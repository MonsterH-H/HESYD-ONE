"use client";

/**
 * Approbations — actions à effet externe, aperçu exact avant décision.
 * Registre dense + Sheet de détail (side=right), décision réelle POST /api/approvals/[id].
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useApi, apiGet } from "@/hooks/use-api";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChevronDown } from "lucide-react";

type Approval = {
  id: string;
  actionType: string;
  riskLevel: string;
  status: string;
  preview: Record<string, unknown>;
  requestedById: string;
  decidedById: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
};

// libellés traduits des champs d'aperçu connus ; les autres clés restent des données brutes
const PREVIEW_LABELS: Record<string, string> = {
  destinataire: "approvals.destinataire",
  contenu: "approvals.contenu",
  document: "approvals.document",
  action: "approvals.detail",
  execution: "approvals.execution",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </h3>
  );
}

/** Pastille : forme + libellé, jamais la couleur seule. */
function Pill({ tone, shape = "dot", label }: { tone: "ruban" | "carton" | "erreur" | "cachet" | "encre"; shape?: "dot" | "ring" | "cross"; label: string }) {
  const color = { ruban: "var(--ruban)", carton: "var(--carton)", erreur: "var(--erreur)", cachet: "var(--cachet)", encre: "var(--encre-2)" }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium whitespace-nowrap" style={{ color }}>
      {shape === "dot" && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} aria-hidden="true" />}
      {shape === "ring" && <span className="h-2 w-2 rounded-full border-2 shrink-0" style={{ borderColor: color }} aria-hidden="true" />}
      {shape === "cross" && (
        <span className="relative h-2 w-2 shrink-0" aria-hidden="true">
          <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2" style={{ background: color }} />
          <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2" style={{ background: color }} />
        </span>
      )}
      <span>{label}</span>
    </span>
  );
}

function statusPill(status: string, label: string) {
  switch (status) {
    case "APPROUVEE":
      return <Pill tone="ruban" shape="dot" label={label} />;
    case "EN_ATTENTE":
      return <Pill tone="carton" shape="ring" label={label} />;
    case "REFUSEE":
      return <Pill tone="erreur" shape="cross" label={label} />;
    default:
      return <Pill tone="encre" shape="ring" label={label} />;
  }
}

function riskPill(risk: string, label: string) {
  switch (risk) {
    case "CRITIQUE":
    case "ELEVE":
      // risque élevé / critique → cachet (vermillon), réservé au sens
      return <Pill tone="cachet" shape="dot" label={label} />;
    case "MOYEN":
      return <Pill tone="carton" shape="ring" label={label} />;
    default:
      return <Pill tone="encre" shape="ring" label={label} />;
  }
}

export function ApprovalsView() {
  const { t } = useI18n();
  const { call } = useApi();

  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [selected, setSelected] = useState<Approval | null>(null);
  const [deciding, setDeciding] = useState(false);

  const load = async () => {
    const data = await apiGet<{ approvals: Approval[] }>("/api/approvals");
    if (!data?.approvals) return;
    setApprovals(data.approvals);
    // le Sheet suit l'état réel : si la décision est passée, il se referme
    setSelected((cur) => (cur ? data.approvals.find((a) => a.id === cur.id) ?? null : null));
  };

  useEffect(() => {
    let vivant = true;
    (async () => {
      const data = await apiGet<{ approvals: Approval[] }>("/api/approvals");
      if (!vivant || !data?.approvals) return;
      setApprovals(data.approvals);
    })();
    return () => {
      vivant = false;
    };
  }, []);

  const decide = async (approval: Approval, decision: "APROUVER" | "REFUSER") => {
    setDeciding(true);
    // API réelle : l'énumération serveur attend APROUVER / REFUSER
    const result = await call<{ status: string; executed?: string }>(`/api/approvals/${approval.id}`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
    setDeciding(false);
    if (result) {
      toast({ title: t("approvals.decided"), description: result.executed });
      setSelected(null);
      void load();
    }
    // en cas d'erreur serveur (ex. whatsapp_non_configure), le toast destructif
    // avec le message réel est déjà émis par useApi().call
  };

  const previewEntries = selected ? Object.entries(selected.preview ?? {}) : [];

  return (
    <div className="space-y-4 max-w-[1100px]">
      <div className="registre border rounded-md bg-card" role="list" aria-label={t("approvals.title")}>
        {approvals.length === 0 ? (
          <p className="text-[13px] text-muted-foreground px-4 py-6">{t("approvals.empty")}</p>
        ) : (
          approvals.map((a) => {
            const pending = a.status === "EN_ATTENTE";
            return (
              <button
                key={a.id}
                onClick={() => pending && setSelected(a)}
                disabled={!pending}
                className={`registre-row w-full min-h-[52px] text-left px-3 py-2 flex items-center gap-3 ${pending ? "cursor-pointer" : "cursor-default"}`}
              >
                <span className="text-[13.5px] font-medium truncate min-w-0 flex-1">{a.actionType}</span>
                {riskPill(a.riskLevel, t(`approvals.risk.${a.riskLevel}`))}
                {statusPill(a.status, t(`approvals.status.${a.status}`))}
                {pending ? (
                  <span className="text-[12px] tnum text-muted-foreground shrink-0 hidden sm:inline">{t("approvals.expiresAt")} {new Date(a.expiresAt).toLocaleDateString()}</span>
                ) : (
                  a.decidedAt && <span className="text-[12px] tnum text-muted-foreground shrink-0 hidden sm:inline">{t("approvals.decidedAt")} {new Date(a.decidedAt).toLocaleDateString()}</span>
                )}
                {pending && <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />}
              </button>
            );
          })
        )}
      </div>

      {/* Sheet détail — aperçu exact de l'action, décision */}
      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto scroll-fin">
          <SheetHeader>
            <SheetTitle className="font-display text-[16px]">{t("approvals.preview")}</SheetTitle>
            <SheetDescription className="text-[12.5px]">
              {selected?.actionType} · {t(`approvals.risk.${selected?.riskLevel ?? ""}`)}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="px-4 space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                {statusPill(selected.status, t(`approvals.status.${selected.status}`))}
                <span className="text-[12px] tnum text-muted-foreground">{t("approvals.expiresAt")} {new Date(selected.expiresAt).toLocaleString()}</span>
              </div>

              <div className="border rounded-md bg-[var(--papier-leve)] p-3 space-y-2.5">
                <SectionTitle>{t("approvals.preview")}</SectionTitle>
                {previewEntries.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground">—</p>
                ) : (
                  previewEntries.map(([key, value]) => {
                    const labelKey = PREVIEW_LABELS[key];
                    const label = labelKey ? t(labelKey) : key;
                    return (
                      <div key={key}>
                        <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
                        <p className="text-[12.5px] leading-snug mt-0.5 whitespace-pre-wrap break-words">{String(value ?? "—")}</p>
                      </div>
                    );
                  })
                )}
              </div>

              {selected.status === "EN_ATTENTE" && (
                <div className="flex items-center gap-2 pb-4">
                  {/* Bouton primaire unique du panneau : Approuver */}
                  <Button className="h-11 flex-1" disabled={deciding} onClick={() => void decide(selected, "APROUVER")}>
                    {t("approvals.approve")}
                  </Button>
                  <Button variant="outline" className="h-11" disabled={deciding} onClick={() => void decide(selected, "REFUSER")}>
                    {t("approvals.refuse")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
