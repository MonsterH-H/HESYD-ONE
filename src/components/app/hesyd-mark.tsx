"use client";

/**
 * Sceau HESYD ONE — marque vectorielle officielle.
 * Anneau d'apparat, rang de perles, monogramme H gravé (empattements) —
 * thémable : la couleur suit `var(--cachet)` en thème clair comme sombre.
 */
export function HesydMark({ className, title = "Sceau HESYD ONE" }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={title}
      style={{ color: "var(--cachet)" }}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Anneau d'apparat */}
      <circle cx="32" cy="32" r="28.5" stroke="currentColor" strokeWidth="3" />
      {/* Rang de perles — pointes de cire régulières (36) */}
      <circle
        cx="32"
        cy="32"
        r="24.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="0.5 7.5"
        pathLength={288}
      />
      {/* Cercle intérieur fin */}
      <circle cx="32" cy="32" r="21.5" stroke="currentColor" strokeWidth="1" />
      {/* Monogramme H gravé — empattements pleins */}
      <path
        fill="currentColor"
        d="M23.3 20.5 H26.7 V43.5 H23.3 Z
           M37.3 20.5 H40.7 V43.5 H37.3 Z
           M21.2 20.5 H28.8 V23.7 H21.2 Z
           M21.2 40.3 H28.8 V43.5 H21.2 Z
           M35.2 20.5 H42.8 V23.7 H35.2 Z
           M35.2 40.3 H42.8 V43.5 H35.2 Z
           M26.7 30.4 H37.3 V33.6 H26.7 Z"
      />
    </svg>
  );
}
