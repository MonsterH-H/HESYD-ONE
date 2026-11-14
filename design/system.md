# system.md — Système de design HESYD ONE (tokens persistés)

## Tokens de couleur (OKLCH, neutres teintés, jamais #000/#fff)

| Token | Clair « papier » (défaut) | Sombre « encre » |
|---|---|---|
| `--papier` (background) | oklch(0.968 0.008 85) | oklch(0.185 0.012 75) |
| `--papier-leve` (card/panel) | oklch(0.985 0.006 85) | oklch(0.225 0.012 75) |
| `--papier-creuse` (input) | oklch(0.938 0.011 82) | oklch(0.155 0.010 75) |
| `--encre` (foreground) | oklch(0.245 0.018 65) | oklch(0.905 0.012 85) |
| `--encre-2` (muted) | oklch(0.46 0.016 65) | oklch(0.640 0.014 80) |
| `--encre-3` (faint) | oklch(0.62 0.014 70) | oklch(0.480 0.012 75) |
| `--cachet` (accent UNIQUE) | oklch(0.545 0.175 33) | oklch(0.635 0.170 33) |
| `--cachet-fond` | oklch(0.94 0.045 33) | oklch(0.30 0.060 33) |
| `--ruban` (succès/actif, olive) | oklch(0.51 0.065 120) | oklch(0.66 0.080 120) |
| `--ruban-fond` | oklch(0.945 0.030 120) | oklch(0.27 0.035 120) |
| `--carton` (attente, carton de chemise) | oklch(0.55 0.055 75) | oklch(0.68 0.060 75) |
| `--carton-fond` | oklch(0.955 0.025 75) | oklch(0.26 0.030 75) |
| `--erreur` | oklch(0.50 0.170 25) | oklch(0.66 0.160 25) |
| `--bordure` | oklch(0.245 0.018 65 / 0.14) | oklch(0.905 0.012 85 / 0.13) |
| `--bordure-forte` | oklch(0.245 0.018 65 / 0.26) | oklch(0.905 0.012 85 / 0.24) |

Règles : `--cachet` réservé au sens (action primaire, cachet d'archivage, alerte critique de registre). Statuts distinguables sans la couleur : forme + libellé (badge rond plein = actif, anneau = attente, croix barrée = erreur).

## Typographie
- Titres + chiffres clés : **Fraunces** (variable, axes opsz/SOFT/WONK neutres), `font-display`.
- Texte : **Instrument Sans** (variable), `font-sans`.
- Échelle modulaire ratio 1.25 : 13 · 16 · 20 · 25 · 31 · 39. Corps ≥ 16 px. `max-width: 65ch`. `text-wrap: balance` (titres), `pretty` (paragraphes).
- Chiffres : `font-variant-numeric: tabular-nums` partout où l'on compare (registres, quotas, timestamps).
- Interdits : Inter, Roboto, Arial, Open Sans, Space Grotesk, monospace décoratif.

## Composition
- Alignement gauche, asymétrie : colonne registre ~2/3 + panneau détail 1/3.
- Espacement base 4 pt, tokens `--espace-1..8` (4/8/12/16/24/32/48/64), `gap` plutôt que marges.
- Listes-registres : lignes 52 px, séparateurs hairline, méta-données jointes par « · », pas de cartes.
- Un seul bouton primaire `--cachet` par écran. Le reste : secondaire (bordure), fantôme, lien.
- Panneaux latéraux (Sheet side=right) pour détail document, approbation, fiche client — jamais de Dialog central par défaut.
- Pas de cartes imbriquées, pas d'icône-héros, pas de dégradés, pas de glow, pas de glassmorphism.

## Profondeur (surfaces empilées)
fond `--papier` → élévation basse `--papier-leve` (+1 % luminosité) → élévation haute `--papier-leve` + bordure. En sombre : plus haut = plus clair. Sidebar même teinte que le fond. Inputs `--papier-creuse` (plus sombres). Rayons concentriques : `--rayon 6px`, boutons 4, panneaux 8, cachets circulaires.

## Mouvement (peu, juste)
- Retour immédiat : 120 ms (`--duree-retour`). État : 220 ms (`--duree-etat`). Mise en page : 320 ms (`--duree-mise-en-page`). Cachet : 480 ms (`--duree-cachet`).
- Courbes tokenisées et exposées via `@theme inline` : `ease-out` = `cubic-bezier(0.25, 1, 0.5, 1)` (courbe du système, étend le token Tailwind par défaut — pas de fork), `ease-in-out` = `cubic-bezier(0.77, 0, 0.175, 1)`, `ease-drawer` = `cubic-bezier(0.32, 0.72, 0, 1)` (Sheets/drawers).
- **Moment fort unique : apposition du cachet** (échelle 1.6→1, rotation -8°→-3°, opacité 0→1, 480 ms, courbe du système) déclenchée uniquement par l'événement réel « archivage confirmé ».
- Entrée de vue : `.vue-entree` (opacité + 6 px, 220 ms) à chaque changement de vue — un seul élément, jamais par ligne.
- Seulement `transform` et `opacity`. Hauteurs via `grid-template-rows`. `prefers-reduced-motion` : transitions/anim à ~0 ms, itérations à 1, délais à 0.
- Interface optimiste : l'état s'affiche d'abord, la confirmation réseau arrive ensuite. Aucune progression fabriquée (pas de minuteries de fausses étapes).

## Tokens exposés (utilities Tailwind, `@theme inline`)
Tous les tokens couleur sont des utilities : `bg-papier / papier-leve / papier-creuse`, `text-encre / encre-2 / encre-3`, `bg-cachet / cachet-fond`, `ruban / ruban-fond`, `carton / carton-fond`, `text-erreur / bg-erreur-fond`, `border-bordure / bordure-forte`, `bg-voile` (scrim sombre des superpositions, les deux thèmes). Échelle typo : `text-meta/corps/section/titre/page/hero`. Espacement : `p-espace-1..8`. Rayons : `--rayon 6px` (boutons 4, panneaux 8).

## Composants récurrents
- `.registre` : table-dense (lignes hover `--papier-leve`, colonne statut à gauche en pastille 8 px).
- `.chaine-garde` : timeline horizontale 4 états avec pastilles + horodatage réels.
- `.cachet` : SVG circulaire double anneau, texte « ARCHIVÉ — HESYD ONE » en arc, couleur `--cachet`.
- `.badge-statut` : pastille + libellé (forme ≠ couleur seule).
- `.jauge-quota` : barre fine 6 px, seuils 80 % (carton) / 100 % (cachet).
- `.bordereau` : bloc d'en-tête numéroté `REGISTRE N° YYYY-MM-DD/xx`.
- Focus visible : `outline: 2px solid var(--cachet); offset 2px`. Zones ≥ 44 px.

## Écriture UI (ux-copy)
Français d'abord, phrases courtes, verbes d'action, aucun jargon IA. Erreurs = cause simple + action de correction. Statuts honnêtes : « Archivé · confirmé dans le dossier » / « Identifiants requis » / « En attente de vous ».
