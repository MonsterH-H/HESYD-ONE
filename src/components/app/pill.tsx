"use client";

/** Pastille de statut partagée — forme ≠ couleur seule (dot plein = actif, anneau = attente, croix = erreur). */
const TONES = {
  ruban: "var(--ruban)",
  carton: "var(--carton)",
  erreur: "var(--erreur)",
  cachet: "var(--cachet)",
  encre: "var(--encre-2)",
} as const;

export type PillTone = keyof typeof TONES;
export type PillShape = "dot" | "ring" | "cross";

export function Pill({ tone, shape = "dot", label }: { tone: PillTone; shape?: PillShape; label: string }) {
  const color = TONES[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-meta font-medium whitespace-nowrap" style={{ color }}>
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
