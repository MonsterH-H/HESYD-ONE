# INTENT.md — Intention de design HESYD ONE

## Qui, quoi, ressenti
- **Qui** : l'employé d'organisation qui, à 9 h, ouvre la file des documents reçus depuis hier. L'administrateur qui veut savoir *où en est* chaque document sans appeler un développeur.
- **Quoi** : retrouver, vérifier, valider, demander. Jamais « explorer » ni « découvrir » — ce produit tient des registres, il n'offre pas de navigation récréative.
- **Ressenti** : calme et précis comme un greffe. Dense comme un registre. Le papier et l'encre du cabinet d'archives contemporain — pas « propre et moderne », pas « dashboard SaaS ».

## Vocabulaire du produit (naming UI)
registre · versement · cachet · chaîne de garde · bordereau · dossier suspendu · À traiter (la « corbeille du greffe ») · année/mois de classement.

## 5 concepts d'exploration retenus
1. **Registre contemporain** (retenu) : listes denses à séparateurs fins, chiffres tabulaires, aucun tableau de cartes.
2. Cachet de cire numérique : le moment visuel fort — apposition du cachet quand l'archivage est **réellement confirmé**.
3. Bordereau de versement : résumé dense en tête de chaque vue d'ensemble.
4. Dossier suspendu : panneaux latéraux pour le détail, pas de modales.
5. Chaîne de garde : ligne de temps sobre Reçu → Classé → Archivé → Indexé, avec preuve datée.

## 5 couleurs de l'espace physique d'un cabinet (OKLCH)
papier (blanc cassé chaud) · encre (noir chaud teinté sépia) · cachet (vermillon de cire) · ruban (olive de classeur) · carton (brun de chemise).

## Signature (5 endroits où elle apparaît)
1. Cachet d'archivage apposé avec animation (rotation 8°, tampon) à la confirmation réelle.
2. Chaîne de garde sous chaque fiche documentaire.
3. Sceau HESYD ONE en favicon/logo (H dans un cachet circulaire).
4. Séparateurs « point de registre » (·) entre méta-données denses.
5. Bordereau numéroté en tête de la Vue d'ensemble (n° de registre du jour).

## 3 clichés SaaS à éviter exprès
1. Grille de cartes identiques icône-titre-texte.
2. Dégradé violet-bleu + glassmorphism + glow.
3. Grosse icône au-dessus de chaque titre, sparklines décoratives, « chiffres héroïques » en gabarit.
