"use client";

/**
 * Cachet d'archivage — signature visuelle de HESYD ONE.
 * Apposé uniquement quand l'archivage est réellement confirmé (preuve).
 */
export function Cachet({ size = 92, animated = false, label = "ARCHIVÉ" }: { size?: number; animated?: boolean; label?: string }) {
  return (
    <div
      className={animated ? "cachet-anime" : undefined}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Cachet ${label}`}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ transform: "rotate(-4deg)" }}>
        <circle cx="50" cy="50" r="47" fill="none" stroke="var(--cachet)" strokeWidth="3" opacity="0.9" />
        <circle cx="50" cy="50" r="39" fill="none" stroke="var(--cachet)" strokeWidth="1" strokeDasharray="2.5 3" opacity="0.8" />
        <path id="cachet-arc-top" d="M 15 50 A 35 35 0 0 1 85 50" fill="none" stroke="none" />
        <path id="cachet-arc-bottom" d="M 18 50 A 32 32 0 0 0 82 50" fill="none" stroke="none" />
        <text fontSize="8.5" fill="var(--cachet)" letterSpacing="1.6" fontFamily="Georgia, serif" fontWeight="600">
          <textPath href="#cachet-arc-top" startOffset="50%" textAnchor="middle">
            HESYD ONE
          </textPath>
        </text>
        <text fontSize="7.5" fill="var(--cachet)" letterSpacing="1.4" fontFamily="Georgia, serif">
          <textPath href="#cachet-arc-bottom" startOffset="50%" textAnchor="middle">
            {label}
          </textPath>
        </text>
        <text x="50" y="58" textAnchor="middle" fontSize="26" fontFamily="Georgia, serif" fontWeight="700" fill="var(--cachet)">
          H
        </text>
      </svg>
    </div>
  );
}

/** Pastille de statut : forme + libellé, jamais la couleur seule. */
const STATUS_STYLE: Record<string, { color: string; bg: string; shape: "dot" | "ring" | "cross" }> = {
  ARCHIVE: { color: "var(--ruban)", bg: "var(--ruban-fond)", shape: "dot" },
  INDEXE: { color: "var(--ruban)", bg: "var(--ruban-fond)", shape: "dot" },
  A_VERIFIER: { color: "var(--carton)", bg: "var(--carton-fond)", shape: "ring" },
  EN_VALIDATION: { color: "var(--carton)", bg: "var(--carton-fond)", shape: "ring" },
  PRET_A_ARCHIVER: { color: "var(--carton)", bg: "var(--carton-fond)", shape: "ring" },
  EN_ARCHIVAGE: { color: "var(--carton)", bg: "var(--carton-fond)", shape: "ring" },
  INDEXATION_EN_ATTENTE: { color: "var(--carton)", bg: "var(--carton-fond)", shape: "ring" },
  ERREUR_REPRENABLE: { color: "var(--erreur)", bg: "var(--erreur-fond)", shape: "cross" },
  ERREUR_DEFINITIVE: { color: "var(--erreur)", bg: "var(--erreur-fond)", shape: "cross" },
  REJETE_JUSTIFIE: { color: "var(--erreur)", bg: "var(--erreur-fond)", shape: "cross" },
  INDEXATION_ECHEC: { color: "var(--erreur)", bg: "var(--erreur-fond)", shape: "cross" },
  INACCESSIBLE_DANS_DRIVE: { color: "var(--erreur)", bg: "var(--erreur-fond)", shape: "cross" },
};

export function StatusPill({ status, label }: { status: string; label: string }) {
  const style = STATUS_STYLE[status] ?? { color: "var(--encre-3)", bg: "var(--muted)", shape: "dot" as const };
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11.5px] font-medium whitespace-nowrap"
      style={{ color: style.color }}
      title={label}
    >
      {style.shape === "dot" && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: style.color }} aria-hidden="true" />}
      {style.shape === "ring" && <span className="h-2 w-2 rounded-full border-2 shrink-0" style={{ borderColor: style.color }} aria-hidden="true" />}
      {style.shape === "cross" && (
        <span className="relative h-2 w-2 shrink-0" aria-hidden="true">
          <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2" style={{ background: style.color }} />
          <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2" style={{ background: style.color }} />
        </span>
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Chaîne de garde : Reçu → Classé → Archivé → Indexé, horodatages réels. */
export function ChainCustody({
  receivedAt,
  classifiedAt,
  archivedAt,
  indexedAt,
  labels,
}: {
  receivedAt?: string | null;
  classifiedAt?: string | null;
  archivedAt?: string | null;
  indexedAt?: string | null;
  labels: { received: string; classified: string; archived: string; indexed: string; pending: string };
}) {
  const steps = [
    { label: labels.received, at: receivedAt, done: Boolean(receivedAt) },
    { label: labels.classified, at: classifiedAt, done: Boolean(classifiedAt) },
    { label: labels.archived, at: archivedAt, done: Boolean(archivedAt) },
    { label: labels.indexed, at: indexedAt, done: Boolean(indexedAt) },
  ];
  return (
    <ol className="flex flex-wrap items-start gap-x-1 gap-y-2" aria-label="Chaîne de garde">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1">
          <div className="flex flex-col items-start gap-0.5 min-w-0">
            <span className="flex items-center gap-1.5">
              <span
                className="chaine-garde-dot"
                style={
                  s.done
                    ? { background: i >= 2 ? "var(--ruban)" : "var(--encre-2)" }
                    : { border: "2px solid var(--bordure-forte)", background: "transparent" }
                }
                aria-hidden="true"
              />
              <span className={`text-[11.5px] ${s.done ? "font-medium" : "text-muted-foreground"}`}>{s.label}</span>
            </span>
            <span className="text-[10px] tnum text-muted-foreground pl-[18px]">{s.at ? new Date(s.at).toLocaleString() : labels.pending}</span>
          </div>
          {i < steps.length - 1 && <span className="mx-1.5 text-[10px] text-[var(--encre-3)] select-none" aria-hidden="true">→</span>}
        </li>
      ))}
    </ol>
  );
}

/** Jauge de quota fine — seuils 80 % carton / 100 % cachet. */
export function QuotaBar({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const color = ratio >= 1 ? "var(--cachet)" : ratio >= 0.8 ? "var(--carton)" : "var(--ruban)";
  return (
    <div className="h-1.5 rounded-full bg-secondary overflow-hidden" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(2, ratio * 100)}%`, background: color }} />
    </div>
  );
}
