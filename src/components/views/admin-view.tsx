"use client";

/**
 * Console opérateur — cinq registres réels : équipe (rôles, désactivation, retrait),
 * intégrations (états réels, OAuth Drive), abonnement (usage, checkout Polar),
 * journaux (audit horodaté réel) et paramètres (organisation, fuseau, langue).
 */
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useApi, apiGet } from "@/hooks/use-api";
import { toast } from "@/hooks/use-toast";
import { useAppStore, type AdminTab } from "@/store/app";
import { QuotaBar } from "@/components/app/cachet";
import { EtatErreur } from "@/components/app/etat-erreur";
import { Pill } from "@/components/app/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { Copy, ExternalLink, ArchiveRestore, Ban, CheckCircle2, UserMinus, Download, Loader2, MessageSquareOff, QrCode, Trash2 } from "lucide-react";

type Membership = {
  id: string;
  role: string;
  user: { id: string; email: string; name: string; lastLoginAt: string | null; status: string };
};

type Invite = { id: string; email: string; role: string; token: string; expiresAt: string };

type Plan = {
  code: string;
  name: string;
  priceMonthlyCents: number;
  currency: string;
  maxUsers: number;
  monthlyDocuments: number;
  monthlyCredits: number;
  maxAutomations: number;
};

type SubscriptionData = {
  subscription: { planCode: string; status: string; currentPeriodEnd: string | null } | null;
  plan: Plan | null;
  plans: Plan[];
  usage: { docsMonth: number; agentMonth: number; deliverablesMonth: number; credits: number };
  polarConfigured: boolean;
};

type IntegrationData = {
  connections: { connector: string; status: string }[];
  env: Record<string, boolean>;
  whatsappSetup: { variablesRequises?: string[] };
  driveSetup: { variablesRequises?: string[] };
};

type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { name: string; email: string } | null;
  createdAt: string;
};

type AuditData = { total: number; page: number; entries: AuditEntry[] };

type MemoryItem = { id: string; content: string; source: string; createdAt: string };

type Pairing = {
  id: string;
  code: string | null;
  status: string;
  phone: string | null;
  expiresAt: string;
  pairedAt: string | null;
  createdAt: string;
  createdBy: string;
};

type PairingData = { pairings: Pairing[]; whatsappConfigured: boolean };

type Invoice = {
  id: string;
  number: string;
  kind: string;
  label: string;
  amountCents: number;
  currency: string;
  status: string;
  issuedAt: string;
  hasFile: boolean;
  downloadUrl: string | null;
};

const INVITE_ROLES = ["EMPLOYE", "ADMINISTRATEUR", "LECTEUR"] as const;
const CONNECTORS = ["GOOGLE_DRIVE", "WHATSAPP_CLOUD", "POLAR", "N8N"] as const;
/** Pagination du journal d'audit — alignée sur la taille de page de /api/audit. */
const AUDIT_PAGE_SIZE = 50;
const TABS: { id: AdminTab; key: string }[] = [
  { id: "team", key: "admin.team" },
  { id: "integrations", key: "admin.integrations" },
  { id: "subscription", key: "admin.subscription" },
  { id: "logs", key: "admin.audit" },
  { id: "security", key: "admin.security" },
  { id: "settings", key: "admin.settings" },
];

const FUSEAUX_COURANTS = [
  "Europe/Paris", "Europe/London", "Europe/Brussels", "Europe/Geneva", "Africa/Casablanca",
  "Africa/Abidjan", "Africa/Dakar", "Africa/Lagos", "Africa/Nairobi", "Asia/Dubai",
  "America/Montreal", "America/New_York", "America/Sao_Paulo", "UTC",
];

/** Niveaux d'autonomie de l'agent (CDC §4) — fixés par l'exploitant, affichés en lecture seule. */
const AUTONOMY_LEVELS = ["A0", "A1", "A2"] as const;

/** Exports CSV réels proposés à l'organisation (CDC §9.8). */
const EXPORTS = [
  { entity: "referentiel", key: "admin.export.referentiel" },
  { entity: "documents", key: "admin.export.documents" },
  { entity: "receptions", key: "admin.export.receptions" },
  { entity: "livrables", key: "admin.export.livrables" },
] as const;

/** Masque honnête d'un numéro appairé : seuls les quatre derniers chiffres restent lisibles. */
function masquerTelephone(phone: string) {
  const nettoye = phone.replace(/\s+/g, "");
  if (nettoye.length <= 4) return phone;
  return `••••• ${nettoye.slice(-4)}`;
}

/** Compte à rebours mm:ss pour le code d'appairage. */
function formatCompteARebours(resteMs: number) {
  const total = Math.max(0, Math.floor(resteMs / 1000));
  const minutes = Math.floor(total / 60);
  const secondes = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secondes).padStart(2, "0")}`;
}

/** Pastille d'état d'un appairage WhatsApp — forme + libellé, jamais la couleur seule. */
function pillAppairage(status: string, label: string) {
  switch (status) {
    case "ACTIF":
      return <Pill tone="ruban" shape="dot" label={label} />;
    case "EN_ATTENTE":
      return <Pill tone="carton" shape="ring" label={label} />;
    case "REVOQUE":
      return <Pill tone="erreur" shape="cross" label={label} />;
    default:
      return <Pill tone="encre" shape="ring" label={label} />;
  }
}

/** Interpolation locale des libellés {cle}. */
function fmt(template: string, params: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </h2>
  );
}

function integrationPill(status: string, label: string) {
  switch (status) {
    case "CONNECTE":
      return <Pill tone="ruban" shape="dot" label={label} />;
    case "NON_CONFIGURE":
    case "EN_ATTENTE_AUTH":
      return <Pill tone="carton" shape="ring" label={label} />;
    case "ERREUR":
      return <Pill tone="erreur" shape="cross" label={label} />;
    default:
      return <Pill tone="encre" shape="ring" label={label} />;
  }
}

export function AdminView() {
  const { t } = useI18n();
  const { call } = useApi();
  const session = useAppStore((s) => s.session);
  const adminTab = useAppStore((s) => s.adminTab);
  const setAdminTab = useAppStore((s) => s.setAdminTab);
  const refreshSession = useAppStore((s) => s.refreshSession);

  const [users, setUsers] = useState<Membership[] | null>(null);
  const [erreurUsers, setErreurUsers] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationData | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [erreurAudit, setErreurAudit] = useState(false);
  const [auditPage, setAuditPage] = useState(1);

  // Sécurité et mémoire
  const [memories, setMemories] = useState<MemoryItem[] | null>(null);
  const [erreurMemories, setErreurMemories] = useState(false);
  const [pairings, setPairings] = useState<PairingData | null>(null);
  const [erreurPairings, setErreurPairings] = useState(false);
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [confirmMemoryDelete, setConfirmMemoryDelete] = useState<MemoryItem | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [activePairing, setActivePairing] = useState<{ code: string; expiresAt: string; instructions: string } | null>(null);
  const [pairTick, setPairTick] = useState(Date.now());
  const [confirmRevokePairing, setConfirmRevokePairing] = useState<Pairing | null>(null);

  // Abonnement : factures et résiliation
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [erreurInvoices, setErreurInvoices] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelState, setCancelState] = useState<{ requestedAt: string | null; message: string } | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("EMPLOYE");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [confirmRetrait, setConfirmRetrait] = useState<Membership | null>(null);

  // Paramètres organisation
  const [orgName, setOrgName] = useState(session?.organization.name ?? "");
  const [orgTz, setOrgTz] = useState(session?.organization.timezone ?? "Europe/Paris");
  const [orgLocale, setOrgLocale] = useState(session?.organization.locale ?? "fr");
  const [orgEnvoi, setOrgEnvoi] = useState(false);

  const canInvite = session?.role === "PROPRIETAIRE" || session?.role === "ADMINISTRATEUR";

  const loadUsers = useCallback(async () => {
    setErreurUsers(false);
    const data = await apiGet<{ users: Membership[]; invites: Invite[] }>("/api/users");
    if (data) {
      setUsers(data.users ?? []);
      setInvites(data.invites ?? []);
    } else {
      setErreurUsers(true);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    setErreurInvoices(false);
    const d = await apiGet<{ invoices: Invoice[] }>("/api/subscription/attestation");
    if (d) setInvoices(d.invoices ?? []);
    else setErreurInvoices(true);
  }, []);

  const loadAudit = useCallback(async () => {
    setErreurAudit(false);
    const d = await apiGet<AuditData>(`/api/audit?page=${auditPage}`);
    if (d) setAudit(d);
    else setErreurAudit(true);
  }, [auditPage]);

  const chargerMemoire = useCallback(async () => {
    setErreurMemories(false);
    const d = await apiGet<{ memories: MemoryItem[] }>("/api/memory");
    if (d) setMemories(d.memories ?? []);
    else setErreurMemories(true);
  }, []);

  const chargerAppairages = useCallback(async () => {
    setErreurPairings(false);
    const d = await apiGet<PairingData>("/api/whatsapp/pairing");
    if (d) setPairings(d);
    else setErreurPairings(true);
  }, []);

  // Chargement paresseux réel : chaque registre charge sa donnée à l'ouverture de l'onglet.
  // Les chargeurs sont partagés entre l'effet d'onglet et les reprises après erreur.
  useEffect(() => {
    let vivant = true;
    if (adminTab === "team") void loadUsers();
    if (adminTab === "integrations") {
      apiGet<IntegrationData>("/api/integrations").then((d) => {
        if (vivant && d) setIntegrations(d);
      });
    }
    if (adminTab === "subscription") {
      apiGet<SubscriptionData>("/api/subscription").then((d) => {
        if (vivant && d) setSubscription(d);
      });
      void loadInvoices();
    }
    if (adminTab === "security") {
      void chargerMemoire();
      void chargerAppairages();
    }
    if (adminTab === "logs") void loadAudit();
    return () => {
      vivant = false;
    };
  }, [adminTab, auditPage, loadUsers, loadInvoices, loadAudit, chargerMemoire, chargerAppairages]);

  // Compte à rebours du code d'appairage actif (15 minutes, honnête jusqu'à l'expiration)
  useEffect(() => {
    if (!activePairing) return;
    const id = window.setInterval(() => setPairTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [activePairing]);

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    const result = await call<{ invite: Invite }>("/api/users", {
      method: "POST",
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    });
    if (result) {
      toast({ title: t("toast.invited"), description: inviteEmail.trim() });
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("EMPLOYE");
      void loadUsers();
    }
  };

  const copyInviteLink = (invite: Invite) => {
    const link = `${window.location.origin}/?invite=${invite.token}`;
    navigator.clipboard
      .writeText(link)
      .then(() => {
        setCopiedId(invite.id);
        toast({ title: t("common.copied"), description: invite.email });
      })
      .catch(() => {
        toast({ title: t("common.error"), description: link, variant: "destructive" });
      });
  };

  const changerRole = async (m: Membership, role: string) => {
    const result = await call<{ membership: Membership }>("/api/users", {
      method: "PATCH",
      body: JSON.stringify({ membershipId: m.id, role }),
    });
    if (result) {
      toast({ title: t("toast.saved"), description: m.user.email });
      void loadUsers();
    }
  };

  const basculerStatut = async (m: Membership) => {
    const status = m.user.status === "ACTIF" ? "DESACTIVE" : "ACTIF";
    const result = await call<{ membership: Membership }>("/api/users", {
      method: "PATCH",
      body: JSON.stringify({ membershipId: m.id, status }),
    });
    if (result) {
      toast({ title: status === "DESACTIVE" ? t("admin.users.disabled") : t("admin.users.enabled"), description: m.user.email });
      void loadUsers();
    }
  };

  const retirer = async () => {
    if (!confirmRetrait) return;
    const result = await call<{ ok: boolean }>(`/api/users?membershipId=${encodeURIComponent(confirmRetrait.id)}`, {
      method: "DELETE",
    });
    if (result) {
      toast({ title: t("admin.users.removed"), description: confirmRetrait.user.email });
      setConfirmRetrait(null);
      void loadUsers();
    }
  };

  const revoquerInvite = async (inv: Invite) => {
    const result = await call<{ ok: boolean }>(`/api/users?inviteId=${encodeURIComponent(inv.id)}`, { method: "DELETE" });
    if (result) {
      toast({ title: t("admin.users.inviteRevoked"), description: inv.email });
      void loadUsers();
    }
  };

  // ————— Sécurité et mémoire : actions réelles —————

  const ajouterMemoire = async () => {
    const content = memoryContent.trim();
    if (content.length < 3) return;
    setMemoryBusy(true);
    const result = await call<{ memory: MemoryItem }>("/api/memory", {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    setMemoryBusy(false);
    if (result) {
      toast({ title: t("admin.memory.added") });
      setMemoryContent("");
      void chargerMemoire();
    }
  };

  const supprimerMemoire = async () => {
    if (!confirmMemoryDelete) return;
    const result = await call<{ ok: boolean }>(`/api/memory/${encodeURIComponent(confirmMemoryDelete.id)}`, {
      method: "DELETE",
    });
    if (result) {
      toast({ title: t("admin.memory.removed") });
      setConfirmMemoryDelete(null);
      void chargerMemoire();
    }
  };

  const genererCodeAppairage = async () => {
    if (pairBusy) return;
    setPairBusy(true);
    const result = await call<{ id: string; code: string; expiresAt: string; instructions: string }>(
      "/api/whatsapp/pairing",
      { method: "POST" },
    );
    setPairBusy(false);
    if (result) {
      setActivePairing({ code: result.code, expiresAt: result.expiresAt, instructions: result.instructions });
      setPairTick(Date.now());
      void chargerAppairages();
    }
  };

  const revoquerAppairage = async () => {
    if (!confirmRevokePairing) return;
    const result = await call<{ ok: boolean }>(`/api/whatsapp/pairing/${encodeURIComponent(confirmRevokePairing.id)}`, {
      method: "DELETE",
    });
    if (result) {
      toast({ title: t("admin.whatsapp.revoked") });
      setConfirmRevokePairing(null);
      void chargerAppairages();
    }
  };

  const demanderResiliation = async () => {
    if (cancelBusy) return;
    setCancelBusy(true);
    const result = await call<{ ok: boolean; alreadyRequested?: boolean; requestedAt?: string; message: string }>(
      "/api/subscription/cancel-request",
      {
        method: "POST",
        body: JSON.stringify({ reason: cancelReason.trim() || undefined }),
      },
    );
    setCancelBusy(false);
    if (result) {
      setCancelState({ requestedAt: result.requestedAt ?? new Date().toISOString(), message: result.message });
      setCancelOpen(false);
      setCancelReason("");
      toast({ title: t("admin.subscription.cancel.title"), description: result.message });
    }
  };

  const connectDrive = async () => {
    // flux OAuth réel : POST puis redirection vers l'URL d'autorisation Google
    const result = await call<{ authorizeUrl: string }>("/api/integrations", { method: "POST" });
    if (result?.authorizeUrl) window.location.assign(result.authorizeUrl);
  };

  const buyPlan = async (planCode: string) => {
    if (!subscription?.polarConfigured) return; // la note réelle est affichée à la place
    const result = await call<{ checkoutUrl: string }>("/api/subscription/checkout", {
      method: "POST",
      body: JSON.stringify({ planCode }),
    });
    if (result?.checkoutUrl) window.location.assign(result.checkoutUrl);
  };

  const enregistrerOrganisation = async () => {
    if (!orgName.trim()) return;
    setOrgEnvoi(true);
    const result = await call<{ organization: { name: string } }>("/api/organization", {
      method: "PATCH",
      body: JSON.stringify({ name: orgName.trim(), timezone: orgTz, locale: orgLocale }),
    });
    setOrgEnvoi(false);
    if (result) {
      toast({ title: t("toast.saved") });
      await refreshSession();
    }
  };

  const currentPlan = subscription?.plan ?? null;
  const trial = subscription?.subscription?.status === "ESSAI";
  const trialDate = subscription?.subscription?.currentPeriodEnd ?? session?.organization.trialEndsAt ?? null;

  // Niveau d'autonomie réel de l'organisation (lecture seule — fixé par l'exploitant)
  const autonomieBrute = session?.organization.autonomyLevel ?? "A2";
  const niveauAutonomie = (AUTONOMY_LEVELS as readonly string[]).includes(autonomieBrute) ? autonomieBrute : "A2";

  // Temps restant du code d'appairage affiché
  const resteAppairage = activePairing
    ? new Date(activePairing.expiresAt).getTime() - pairTick
    : 0;

  const connectionFor = (connector: string) => integrations?.connections.find((c) => c.connector === connector);
  const statusFor = (connector: string) => {
    const row = connectionFor(connector);
    if (row) return row.status;
    return integrations?.env?.[connector] ? "CONNECTE" : "NON_CONFIGURE";
  };

  return (
    <div className="space-y-8 max-w-[1100px]">
      {/* Onglets de la console opérateur */}
      <div role="tablist" aria-label={t("space.operator")} className="flex gap-1 overflow-x-auto scroll-fin border-b border-[var(--bordure)]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={adminTab === tab.id}
            onClick={() => setAdminTab(tab.id)}
            className={`shrink-0 px-3.5 py-2.5 text-[13px] border-b-2 -mb-px transition-colors ${
              adminTab === tab.id
                ? "border-[var(--cachet)] text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(tab.key)}
          </button>
        ))}
      </div>

      {/* ——— Équipe ——— */}
      {adminTab === "team" && (
        <section aria-label={t("admin.team")} className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle>{t("admin.team")}</SectionTitle>
            {canInvite && (
              <Button className="h-11 px-4" onClick={() => setInviteOpen(true)}>
                {t("admin.users.invite")}
              </Button>
            )}
          </div>

          <div className="registre border rounded-md bg-card" role="list" aria-label={t("admin.users.title")}>
            {users === null && erreurUsers && <EtatErreur compact onRetry={() => void loadUsers()} />}
            {users === null && !erreurUsers && (
              <>
                <Skeleton className="h-12 w-full rounded-md" />
                <Skeleton className="mt-2 h-12 w-full rounded-md" />
              </>
            )}
            {users?.map((m) => {
              const estSoiMeme = m.user.id === session?.user.id;
              const estProprietaire = m.role === "PROPRIETAIRE";
              return (
                <div key={m.id} role="listitem" className="registre-row flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 min-h-[56px] md:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium truncate flex items-center gap-2">
                      {m.user.name}
                      {estProprietaire && <Pill tone="ruban" shape="dot" label={t("admin.users.role.PROPRIETAIRE")} />}
                      {m.user.status === "DESACTIVE" && <Pill tone="erreur" shape="cross" label={t("admin.users.disabledBadge")} />}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground truncate">{m.user.email}</div>
                  </div>
                  <span className="text-[12px] tnum text-muted-foreground shrink-0 hidden lg:inline">
                    {m.user.lastLoginAt ? `${t("admin.users.lastLogin")} ${new Date(m.user.lastLoginAt).toLocaleDateString()}` : "—"}
                  </span>
                  {/* Rôle modifiable — jamais pour le propriétaire ni pour soi-même */}
                  <div className="w-[170px] shrink-0">
                    {estProprietaire || estSoiMeme ? (
                      <span className="block px-1 text-[12px] text-muted-foreground">{t(`admin.users.role.${m.role}`)}</span>
                    ) : (
                      <Select value={m.role} onValueChange={(v) => void changerRole(m, v)}>
                        <SelectTrigger className="h-9 w-full text-[12.5px]" aria-label={fmt(t("admin.users.roleChange"), { name: m.user.name })}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INVITE_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>{t(`admin.users.role.${role}`)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  {/* Actions : désactivation / réactivation, retrait */}
                  {!estProprietaire && !estSoiMeme && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10"
                        aria-label={m.user.status === "ACTIF" ? t("admin.users.disable") : t("admin.users.enable")}
                        title={m.user.status === "ACTIF" ? t("admin.users.disable") : t("admin.users.enable")}
                        onClick={() => void basculerStatut(m)}
                      >
                        {m.user.status === "ACTIF" ? <Ban className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10"
                        aria-label={t("admin.users.remove")}
                        title={t("admin.users.remove")}
                        onClick={() => setConfirmRetrait(m)}
                      >
                        <UserMinus className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {invites.length > 0 && (
            <div>
              <SectionTitle>{t("admin.users.pendingInvites")}</SectionTitle>
              <div className="registre border rounded-md bg-card mt-1.5" role="list">
                {invites.map((inv) => (
                  <div key={inv.id} role="listitem" className="registre-row flex items-center gap-3 px-3 py-2 min-h-[52px]">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate">{inv.email}</div>
                      <div className="text-[11px] tnum text-muted-foreground truncate">{`${typeof window !== "undefined" ? window.location.origin : ""}/?invite=${inv.token}`}</div>
                    </div>
                    <span className="text-[12px] text-muted-foreground shrink-0 hidden sm:inline">{t(`admin.users.role.${inv.role}`)}</span>
                    <span className="text-[11.5px] tnum text-muted-foreground shrink-0 hidden md:inline">{t("admin.users.expires")} {new Date(inv.expiresAt).toLocaleDateString()}</span>
                    <Button variant="ghost" className="h-9 w-9 px-0 shrink-0" onClick={() => copyInviteLink(inv)} aria-label={t("common.copy")} title={t("common.copy")}>
                      <Copy className="h-3.5 w-3.5" style={copiedId === inv.id ? { color: "var(--ruban)" } : undefined} aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" className="h-9 w-9 px-0 shrink-0" onClick={() => void revoquerInvite(inv)} aria-label={t("admin.users.revoke")} title={t("admin.users.revoke")}>
                      <Ban className="h-3.5 w-3.5" style={{ color: "var(--erreur)" }} aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ——— Intégrations ——— */}
      {adminTab === "integrations" && (
        <section aria-label={t("admin.integrations")} className="space-y-3">
          <SectionTitle>{t("admin.integrations")}</SectionTitle>
          <div className="registre border rounded-md bg-card" role="list">
            {CONNECTORS.map((connector) => {
              const status = statusFor(connector);
              const configured = Boolean(integrations?.env?.[connector]);
              return (
                <li key={connector} role="listitem" className="registre-row">
                  <div className="flex items-center gap-3 px-3 py-2 min-h-[52px]">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium truncate">{t(`admin.integrations.${connector}`)}</div>
                      <div className="text-[11.5px] text-muted-foreground truncate tnum">{connector}</div>
                    </div>
                    {integrationPill(status, t(`admin.integrations.status.${status}`))}
                  </div>
                  {/* Notes honnêtes + variables réellement requises */}
                  {connector === "GOOGLE_DRIVE" && !configured && (
                    <div className="px-3 pb-3 space-y-2 bg-[var(--papier-leve)] border-b border-border">
                      <p className="text-[12px] leading-snug text-muted-foreground">{t("admin.integrations.connectDriveNote")}</p>
                      <div className="text-[11.5px] tnum text-muted-foreground">
                        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em]">{t("admin.integrations.variables")}</span>
                        <span className="ml-2 break-all">{(integrations?.driveSetup?.variablesRequises ?? []).join(" · ")}</span>
                      </div>
                      <Button variant="outline" className="h-10" onClick={() => void connectDrive()}>
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("admin.integrations.connectDrive")}
                      </Button>
                    </div>
                  )}
                  {connector === "WHATSAPP_CLOUD" && !configured && (
                    <div className="px-3 pb-3 space-y-2 bg-[var(--papier-leve)] border-b border-border">
                      <p className="text-[12px] leading-snug text-muted-foreground">{t("admin.integrations.whatsappNote")}</p>
                      <div className="text-[11.5px] tnum text-muted-foreground">
                        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em]">{t("admin.integrations.variables")}</span>
                        <span className="ml-2 break-all">{(integrations?.whatsappSetup?.variablesRequises ?? []).join(" · ")}</span>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </div>
        </section>
      )}

      {/* ——— Abonnement et usage ——— */}
      {adminTab === "subscription" && (
        <section aria-label={t("admin.subscription")} className="space-y-3">
          <SectionTitle>{t("admin.subscription")}</SectionTitle>

          {trial && trialDate && (
            <p className="text-[12.5px] leading-snug px-3 py-2.5 rounded-md" style={{ background: "var(--carton-fond)", color: "var(--carton)" }}>
              {fmt(t("admin.trialBanner"), { date: new Date(trialDate).toLocaleDateString() })}
            </p>
          )}

          <div className="border rounded-md bg-card p-3 space-y-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("admin.subscription.plan")}</span>
              <span className="text-[14px] font-display font-semibold">{currentPlan?.name ?? "—"}</span>
              {subscription?.subscription && (
                <Pill tone={subscription.subscription.status === "ACTIF" ? "ruban" : "carton"} shape={subscription.subscription.status === "ACTIF" ? "dot" : "ring"} label={t(`admin.subscription.status.${subscription.subscription.status}`)} />
              )}
              {currentPlan && <span className="text-[12px] tnum text-muted-foreground ml-auto">{fmt(t("admin.subscription.priceMonthly"), { price: (currentPlan.priceMonthlyCents / 100).toFixed(2) })}</span>}
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center gap-3 text-[12.5px]">
                <span className="min-w-0 flex-1 text-muted-foreground">{t("admin.subscription.docs")}</span>
                <span className="tnum shrink-0">{subscription?.usage.docsMonth ?? 0}{currentPlan ? ` / ${currentPlan.monthlyDocuments}` : ""}</span>
              </div>
              {currentPlan && <QuotaBar value={subscription?.usage.docsMonth ?? 0} max={currentPlan.monthlyDocuments} />}
              <div className="flex items-center gap-3 text-[12.5px]">
                <span className="min-w-0 flex-1 text-muted-foreground">{t("admin.subscription.questions")}</span>
                <span className="tnum shrink-0">{subscription?.usage.agentMonth ?? 0}</span>
              </div>
              <div className="flex items-center gap-3 text-[12.5px]">
                <span className="min-w-0 flex-1 text-muted-foreground">{t("admin.subscription.deliverables")}</span>
                <span className="tnum shrink-0">{subscription?.usage.deliverablesMonth ?? 0}</span>
              </div>
              <div className="flex items-center gap-3 text-[12.5px]">
                <span className="min-w-0 flex-1 text-muted-foreground">{t("admin.subscription.credits")}</span>
                <span className="tnum shrink-0">{subscription?.usage.credits ?? 0}</span>
              </div>
            </div>
          </div>

          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("admin.subscription.offers")}</div>
          <div className="registre border rounded-md bg-card" role="list">
            {(subscription?.plans ?? []).map((p) => {
              const current = subscription?.subscription?.planCode === p.code;
              return (
                <div key={p.code} role="listitem" className="registre-row flex items-center gap-3 px-3 py-2 min-h-[52px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium truncate">{p.name}</div>
                    <div className="text-[11px] tnum text-muted-foreground meta-points">
                      <span>{p.maxUsers} {t("admin.subscription.users")}</span>
                      <span>{p.monthlyDocuments} {t("admin.subscription.docs")}</span>
                      <span>{p.maxAutomations} {t("admin.subscription.automations")}</span>
                    </div>
                  </div>
                  <span className="text-[12.5px] tnum shrink-0">{fmt(t("admin.subscription.priceMonthly"), { price: (p.priceMonthlyCents / 100).toFixed(2) })}</span>
                  {current ? (
                    <Pill tone="ruban" shape="dot" label={t("admin.subscription.currentOffer")} />
                  ) : (
                    <Button variant="outline" className="h-9 shrink-0 text-[12px]" disabled={!subscription?.polarConfigured} onClick={() => void buyPlan(p.code)}>
                      {t("admin.subscription.buy")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {subscription && !subscription.polarConfigured && (
            <p className="text-[12px] leading-snug text-muted-foreground">{t("admin.subscription.polarNote")}</p>
          )}

          {/* Factures et attestations réelles — téléchargement par lien signé */}
          <div className="pt-3 space-y-3">
            <SectionTitle>{t("admin.subscription.invoices")}</SectionTitle>
            <div className="registre border rounded-md bg-card" role="table" aria-label={t("admin.subscription.invoices")}>
              {invoices === null && erreurInvoices && <EtatErreur compact onRetry={() => void loadInvoices()} />}
              {invoices === null && !erreurInvoices && (
                <>
                  <Skeleton className="h-12 w-full rounded-md" />
                  <Skeleton className="mt-2 h-12 w-full rounded-md" />
                </>
              )}
              {invoices !== null && invoices.length === 0 && (
                <p className="text-[13px] text-muted-foreground px-4 py-6">{t("admin.subscription.invoices.empty")}</p>
              )}
              {invoices?.map((inv) => (
                <div key={inv.id} role="row" className="registre-row flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 min-h-[56px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate flex items-center gap-2">
                      <span className="tnum">{inv.number}</span>
                      <Badge variant="outline" className="text-[10px] font-normal px-1.5 shrink-0">
                        {t(`admin.subscription.kind.${inv.kind}`, inv.kind)}
                      </Badge>
                    </div>
                    <div className="text-[11.5px] text-muted-foreground truncate">{inv.label}</div>
                  </div>
                  <span className="text-[12.5px] tnum shrink-0">
                    {inv.amountCents > 0 ? `${(inv.amountCents / 100).toFixed(2)} ${inv.currency}` : "—"}
                  </span>
                  <time className="text-[11.5px] tnum text-muted-foreground shrink-0 hidden sm:inline" dateTime={inv.issuedAt}>
                    {t("admin.subscription.invoice.issuedAt")} {new Date(inv.issuedAt).toLocaleDateString()}
                  </time>
                  {inv.downloadUrl ? (
                    <Button
                      variant="outline"
                      className="h-11 px-3 shrink-0 text-[12px]"
                      onClick={() => window.open(inv.downloadUrl ?? "")}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("admin.subscription.invoice.download")}
                    </Button>
                  ) : (
                    <span className="text-[11.5px] text-muted-foreground shrink-0">{t("admin.subscription.invoice.noFile")}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Résiliation — demande du propriétaire, traitement par l'exploitant */}
          {session?.role === "PROPRIETAIRE" && (
            <div className="pt-3 space-y-3">
              <SectionTitle>{t("admin.subscription.cancel.title")}</SectionTitle>
              {cancelState ? (
                <div
                  className="border rounded-md px-4 py-3.5 space-y-1.5"
                  style={{ background: "var(--papier-leve)", borderColor: "var(--bordure)" }}
                  role="status"
                >
                  <p className="text-[13px] font-medium" style={{ color: "var(--carton)" }}>
                    {fmt(t("admin.subscription.cancel.requested"), {
                      date: cancelState.requestedAt ? new Date(cancelState.requestedAt).toLocaleDateString() : "—",
                    })}
                  </p>
                  <p className="text-[12px] leading-relaxed text-muted-foreground">{cancelState.message}</p>
                </div>
              ) : (
                <div className="border rounded-md bg-card p-4 space-y-3">
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t("admin.subscription.cancel.confirmDescription")}</p>
                  <Button
                    variant="outline"
                    className="h-11"
                    style={{ color: "var(--erreur)", borderColor: "var(--bordure-forte)" }}
                    onClick={() => setCancelOpen(true)}
                  >
                    {t("admin.subscription.cancel.request")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ——— Journaux d'audit — horodatés, lecture seule ——— */}
      {adminTab === "logs" && (
        <section aria-label={t("admin.audit")} className="space-y-3">
          <SectionTitle>{t("admin.audit")}</SectionTitle>
          <p className="text-[11.5px] text-muted-foreground">{t("admin.audit.note")}</p>
          <div className="registre border rounded-md bg-card" role="table" aria-label={t("admin.audit")}>
            {audit === null && erreurAudit && <EtatErreur compact onRetry={() => void loadAudit()} />}
            {audit === null && !erreurAudit && (
              <>
                <Skeleton className="h-11 w-full rounded-md" />
                <Skeleton className="mt-2 h-11 w-full rounded-md" />
                <Skeleton className="mt-2 h-11 w-full rounded-md" />
              </>
            )}
            {audit && audit.entries.length === 0 && (
              <p className="text-[13px] text-muted-foreground px-4 py-6">{t("admin.audit.empty")}</p>
            )}
            {audit?.entries.map((e) => (
              <div key={e.id} role="row" className="registre-row flex items-start gap-3 px-3 py-2 min-h-[44px]">
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium">
                    {t(`audit.${e.action}`, e.action)}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground leading-snug truncate">
                    {e.actor ? `${e.actor.name} · ` : ""}{e.entityType}
                    {e.entityId ? <span className="tnum"> · {e.entityId.slice(-8)}</span> : null}
                  </div>
                </div>
                <time className="text-[11px] tnum text-muted-foreground shrink-0 pt-0.5" dateTime={e.createdAt}>
                  {new Date(e.createdAt).toLocaleString()}
                </time>
              </div>
            ))}
          </div>
          {audit && audit.total > AUDIT_PAGE_SIZE && (
            <div className="flex items-center justify-between pt-1">
              <Button variant="outline" className="h-9 text-[12px]" disabled={auditPage <= 1} onClick={() => setAuditPage((p) => Math.max(1, p - 1))}>
                {t("common.prev")}
              </Button>
              <span className="text-[11.5px] tnum text-muted-foreground">{fmt(t("admin.audit.page"), { page: audit.page, total: audit.total })}</span>
              <Button variant="outline" className="h-9 text-[12px]" disabled={auditPage * AUDIT_PAGE_SIZE >= audit.total} onClick={() => setAuditPage((p) => p + 1)}>
                {t("common.next")}
              </Button>
            </div>
          )}
        </section>
      )}

      {/* ——— Paramètres de l'organisation ——— */}
      {adminTab === "settings" && (
        <section aria-label={t("admin.settings")} className="space-y-3 max-w-[560px]">
          <SectionTitle>{t("admin.settings.org")}</SectionTitle>
          <div className="border rounded-md bg-card p-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="org-name" className="text-[12.5px]">{t("admin.settings.orgName")}</Label>
              <Input id="org-name" value={orgName} onChange={(e) => setOrgName(e.target.value)} className="h-11" maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-tz" className="text-[12.5px]">{t("admin.settings.orgTimezone")}</Label>
              <Input
                id="org-tz"
                list="fuseaux-courants"
                value={orgTz}
                onChange={(e) => setOrgTz(e.target.value)}
                className="h-11 tnum"
                aria-describedby="org-tz-hint"
              />
              <datalist id="fuseaux-courants">
                {FUSEAUX_COURANTS.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
              <p id="org-tz-hint" className="text-[11px] text-muted-foreground">{t("admin.settings.orgTimezoneHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">{t("admin.settings.orgLocale")}</Label>
              <Select value={orgLocale} onValueChange={setOrgLocale}>
                <SelectTrigger className="w-full h-11" aria-label={t("admin.settings.orgLocale")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fr">Français</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end pt-1">
              <Button className="h-11 px-5" disabled={orgEnvoi || !orgName.trim()} onClick={() => void enregistrerOrganisation()}>
                {t("common.save")}
              </Button>
            </div>
          </div>
          <p className="text-[11.5px] text-muted-foreground flex items-start gap-1.5">
            <ArchiveRestore className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            {t("admin.settings.note")}
          </p>
        </section>
      )}

      {/* ——— Sécurité et mémoire ——— */}
      {adminTab === "security" && (
        <section aria-label={t("admin.security")} className="space-y-8 max-w-[720px]">
          {/* Politique d'autonomie — lecture seule, fixée par l'exploitant */}
          <div className="space-y-3">
            <SectionTitle>{t("admin.autonomy.title")}</SectionTitle>
            <div className="border rounded-md bg-card p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="outline" className="text-[11px] font-normal">
                  {t("admin.autonomy.current")} : {t(`admin.autonomy.${niveauAutonomie}`)}
                </Badge>
                <span className="text-[11.5px] text-muted-foreground">{t("admin.autonomy.operatorNote")}</span>
              </div>
              <RadioGroup value={niveauAutonomie} disabled aria-label={t("admin.autonomy.title")}>
                {AUTONOMY_LEVELS.map((niveau) => (
                  <label
                    key={niveau}
                    htmlFor={`autonomie-${niveau}`}
                    className="flex items-start gap-3 rounded-md border p-3 cursor-not-allowed"
                    style={{
                      borderColor: niveau === niveauAutonomie ? "var(--cachet)" : "var(--bordure)",
                      background: niveau === niveauAutonomie ? "var(--papier-leve)" : "transparent",
                    }}
                  >
                    <RadioGroupItem value={niveau} id={`autonomie-${niveau}`} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium">{t(`admin.autonomy.${niveau}`)}</span>
                      <span className="block mt-0.5 text-[12px] leading-snug text-muted-foreground">
                        {t(`admin.autonomy.${niveau}.desc`)}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
              <p className="text-[11.5px] leading-snug text-muted-foreground">{t("admin.autonomy.note")}</p>
            </div>
          </div>

          {/* Mémoire de l'organisation — consultable, corrigeable, supprimable */}
          <div className="space-y-3">
            <SectionTitle>{t("admin.memory.title")}</SectionTitle>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t("admin.memory.description")}</p>
            <div className="registre border rounded-md bg-card max-h-96 overflow-y-auto thin-scroll" role="list" aria-label={t("admin.memory.title")}>
              {memories === null && erreurMemories && <EtatErreur compact onRetry={() => void chargerMemoire()} />}
              {memories === null && !erreurMemories && (
                <>
                  <Skeleton className="h-12 w-full rounded-md" />
                  <Skeleton className="mt-2 h-12 w-full rounded-md" />
                </>
              )}
              {memories !== null && memories.length === 0 && (
                <p className="text-[13px] text-muted-foreground px-4 py-6">{t("admin.memory.empty")}</p>
              )}
              {memories?.map((m) => (
                <div key={m.id} role="listitem" className="registre-row flex items-start gap-3 px-3 py-2.5 min-h-[56px]">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug">{m.content}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground tnum">
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: m.source === "AGENT" ? "var(--ruban)" : "var(--encre-3)" }}
                          aria-hidden="true"
                        />
                        {t(`admin.memory.source.${m.source}`, m.source)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    aria-label={t("admin.memory.remove")}
                    title={t("admin.memory.remove")}
                    onClick={() => setConfirmMemoryDelete(m)}
                  >
                    <Trash2 className="h-4 w-4" style={{ color: "var(--erreur)" }} aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="border rounded-md bg-card p-4 space-y-3">
              <Textarea
                value={memoryContent}
                onChange={(e) => setMemoryContent(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={t("admin.memory.placeholder")}
                aria-label={t("admin.memory.add")}
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] tnum text-muted-foreground">{memoryContent.trim().length}/500</span>
                <Button className="h-11 px-4" disabled={memoryBusy || memoryContent.trim().length < 3} onClick={() => void ajouterMemoire()}>
                  {memoryBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t("admin.memory.add")}
                </Button>
              </div>
            </div>
          </div>

          {/* Appairage WhatsApp — codes réels à usage unique */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <SectionTitle>{t("admin.whatsapp.title")}</SectionTitle>
              {pairings !== null && !pairings.whatsappConfigured && (
                <Badge
                  className="text-[10.5px] font-medium"
                  style={{ background: "var(--carton-fond)", color: "var(--carton)" }}
                >
                  {t("admin.whatsapp.blocked")}
                </Badge>
              )}
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {pairings !== null && !pairings.whatsappConfigured
                ? t("admin.whatsapp.blockedNote")
                : t("admin.whatsapp.description")}
            </p>

            <div className="border rounded-md bg-card p-4 space-y-4">
              <Button className="h-11 px-4" disabled={pairBusy} onClick={() => void genererCodeAppairage()}>
                {pairBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <QrCode className="h-4 w-4" aria-hidden="true" />}
                {pairBusy ? t("admin.whatsapp.generating") : t("admin.whatsapp.generate")}
              </Button>

              {activePairing && (
                <div
                  className="rounded-md border p-4 space-y-3"
                  style={{ background: "var(--papier-leve)", borderColor: "var(--bordure)" }}
                  role="status"
                >
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {t("admin.whatsapp.codeTitle")}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-display text-[38px] leading-none font-semibold tracking-[0.14em] tnum">
                      {resteAppairage > 0 ? activePairing.code : t("admin.whatsapp.expired")}
                    </span>
                    {resteAppairage > 0 && (
                      <span className="text-[12px] tnum text-muted-foreground">
                        {t("admin.whatsapp.expiresIn")} {formatCompteARebours(resteAppairage)}
                      </span>
                    )}
                    {resteAppairage > 0 && (
                      <Button
                        variant="outline"
                        className="h-11 w-11 p-0 ml-auto shrink-0"
                        aria-label={t("common.copy")}
                        title={t("common.copy")}
                        onClick={() => {
                          navigator.clipboard
                            .writeText(activePairing.code)
                            .then(() => toast({ title: t("common.copied"), description: t("admin.whatsapp.codeTitle") }))
                            .catch(() => {
                              toast({ title: t("common.error"), description: activePairing.code, variant: "destructive" });
                            });
                        }}
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  <p className="text-[12px] leading-relaxed text-muted-foreground">{activePairing.instructions}</p>
                </div>
              )}

              <div className="registre border rounded-md" role="list" aria-label={t("admin.whatsapp.title")}>
                {pairings === null && erreurPairings && <EtatErreur compact onRetry={() => void chargerAppairages()} />}
                {pairings === null && !erreurPairings && (
                  <>
                    <Skeleton className="h-11 w-full rounded-md" />
                    <Skeleton className="mt-2 h-11 w-full rounded-md" />
                  </>
                )}
                {pairings !== null && pairings.pairings.length === 0 && (
                  <p className="text-[12.5px] text-muted-foreground px-4 py-5">{t("admin.whatsapp.empty")}</p>
                )}
                {pairings?.pairings.map((p) => (
                  <div key={p.id} role="listitem" className="registre-row flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 min-h-[52px]">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate flex items-center gap-2">
                        {pillAppairage(p.status, t(`admin.whatsapp.status.${p.status}`, p.status))}
                      </div>
                      <div className="text-[11.5px] tnum text-muted-foreground truncate">
                        {p.phone ? masquerTelephone(p.phone) : `${t("admin.whatsapp.createdBy")} ${p.createdBy}`}
                        {p.pairedAt ? ` · ${t("admin.whatsapp.pairedAt")} ${new Date(p.pairedAt).toLocaleDateString()}` : ""}
                      </div>
                    </div>
                    {(p.status === "ACTIF" || p.status === "EN_ATTENTE") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 shrink-0"
                        aria-label={t("admin.whatsapp.revoke")}
                        title={t("admin.whatsapp.revoke")}
                        onClick={() => setConfirmRevokePairing(p)}
                      >
                        <MessageSquareOff className="h-4 w-4" style={{ color: "var(--erreur)" }} aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Export de vos données — CSV réels générés à la demande */}
          <div className="space-y-3">
            <SectionTitle>{t("admin.export.title")}</SectionTitle>
            <p className="text-[12.5px] leading-snug text-muted-foreground">{t("admin.export.note")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {EXPORTS.map((exp) => (
                <Button
                  key={exp.entity}
                  variant="outline"
                  className="h-11 w-full justify-start px-4"
                  onClick={() => window.open(`/api/export?entity=${exp.entity}`)}
                >
                  <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t(exp.key)}</span>
                </Button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Sheet invitation — panneau latéral */}
      <Sheet open={inviteOpen} onOpenChange={setInviteOpen}>
        <SheetContent side="right" className="sm:max-w-sm">
          <SheetHeader>
            <SheetTitle className="font-display text-[16px]">{t("admin.users.inviteTitle")}</SheetTitle>
            <SheetDescription className="text-[12.5px]">{t("admin.users.inviteDescription")}</SheetDescription>
          </SheetHeader>
          <form
            className="px-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void sendInvite();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="invite-email" className="text-[12.5px]">{t("admin.users.email")}</Label>
              <Input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px]">{t("admin.users.role")}</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="w-full h-11" aria-label={t("admin.users.role")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITE_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>{t(`admin.users.role.${role}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-2 pb-4">
              <Button type="submit" className="h-11 flex-1">{t("admin.users.inviteSubmit")}</Button>
              <Button type="button" variant="outline" className="h-11" onClick={() => setInviteOpen(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* Confirmation de retrait d'un membre — l'accès est retiré, les documents sont conservés */}
      <AlertDialog open={!!confirmRetrait} onOpenChange={(v) => !v && setConfirmRetrait(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{t("admin.users.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRetrait ? fmt(t("admin.users.confirmRemove"), { name: confirmRetrait.user.name, email: confirmRetrait.user.email }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11" onClick={retirer}>
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Suppression d'un souvenir de la mémoire de l'organisation */}
      <AlertDialog open={!!confirmMemoryDelete} onOpenChange={(v) => !v && setConfirmMemoryDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{t("admin.memory.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMemoryDelete ? t("admin.memory.removeConfirm") : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmMemoryDelete && (
            <p className="text-[12.5px] leading-snug border rounded-md px-3 py-2.5" style={{ background: "var(--papier-leve)", borderColor: "var(--bordure)" }}>
              {confirmMemoryDelete.content}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              style={{ background: "var(--erreur)", color: "var(--papier-leve)" }}
              onClick={supprimerMemoire}
            >
              {t("admin.memory.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Révocation d'un appairage WhatsApp */}
      <AlertDialog open={!!confirmRevokePairing} onOpenChange={(v) => !v && setConfirmRevokePairing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{t("admin.whatsapp.revokeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRevokePairing
                ? `${t("admin.whatsapp.revokeConfirm")}${confirmRevokePairing.phone ? ` (${masquerTelephone(confirmRevokePairing.phone)})` : ""}`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11" onClick={revoquerAppairage}>
              {t("admin.whatsapp.revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Demande de résiliation — confirmation avec motif optionnel */}
      <AlertDialog open={cancelOpen} onOpenChange={(v) => { setCancelOpen(v); if (!v) setCancelReason(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{t("admin.subscription.cancel.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.subscription.cancel.confirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5 py-1">
            <Label htmlFor="cancel-reason" className="text-[12.5px]">{t("admin.subscription.cancel.reason")}</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              disabled={cancelBusy}
              onClick={(e) => {
                e.preventDefault(); // garde le dialogue ouvert jusqu'au résultat réel
                void demanderResiliation();
              }}
            >
              {cancelBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t("admin.subscription.cancel.request")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
