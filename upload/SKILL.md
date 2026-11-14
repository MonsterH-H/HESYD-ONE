---
name: saas-module-gate
description: Garde-fou qualité pour construire un SaaS (IA, multi-tenant) module par module. À utiliser dès qu'on implémente un cahier des charges, une fonctionnalité, un module, une page d'auth ou un CRUD. Interdit de passer au module suivant tant que le module courant n'est pas COMPLET (back-end, données, sécurité, UI, états, tests) et validé par la Definition of Done.
---

# SaaS Module Gate — le fond avant la forme

## Principe non négociable
Un module est accepté quand il est **utilisable en production**, pas quand il est « produit ».
Back-end solide d'abord, front ensuite. Une interface jolie sur un back-end vide = module REFUSÉ.

## Règle 1 — Un seul module à la fois
1. Lire le cahier des charges. Produire `docs/MODULES.md` : liste ordonnée des modules, dépendances, statut (`TODO` / `EN COURS` / `VALIDÉ`).
2. Un seul module `EN COURS` à tout moment. Interdit de toucher au module suivant, même « juste le squelette ».
3. Passage à `VALIDÉ` uniquement après la checklist DoD ci-dessous, preuves à l'appui (commandes lancées, sorties, captures). Sans preuve = pas validé.
4. Si un blocage ou une ambiguïté apparaît : poser la question, ne pas inventer.

## Règle 2 — Ordre d'implémentation d'un module (obligatoire)
1. **Spécification du module** : entités, relations, règles métier, rôles autorisés, cas d'erreur, critères d'acceptation. Écrite AVANT le code.
2. **Modèle de données** : migrations, clés étrangères, index, contraintes, `tenant_id` sur toute table métier, soft delete si besoin, timestamps, audit.
3. **Isolation tenant** : RLS (ou filtre garanti côté repository) + test prouvant qu'un tenant ne voit jamais les données d'un autre.
4. **Logique serveur** : services/API, validation d'entrée (Zod ou équivalent), autorisation par rôle sur CHAQUE endpoint, erreurs typées, pagination, tri, filtres, recherche.
5. **Tests back-end** : unitaires (règles métier) + intégration (API, permissions, isolation tenant).
6. **Front-end** : seulement une fois 1→5 verts. Branché sur la vraie API, aucune donnée factice.
7. **Revue** : relecture contre la DoD, puis mise à jour de `docs/MODULES.md`.

## Définition of Done (DoD) — tout doit être coché

### Fonctionnel
- [ ] CRUD complet : créer, lister (pagination, tri, filtres, recherche), voir le détail, modifier, supprimer (confirmation + gestion des dépendances).
- [ ] Les relations avec les autres modules sont réelles (sélecteurs, liens, jointures), pas des champs texte libres.
- [ ] Toutes les règles métier du cahier des charges sont implémentées, pas seulement le cas nominal.
- [ ] Import/export si prévu au cahier des charges.

### Données & sécurité
- [ ] Migrations rejouables, contraintes et index présents, aucun `any`/`TODO` laissé.
- [ ] Isolation multi-tenant testée (tenant A ne lit/écrit jamais tenant B).
- [ ] Autorisation vérifiée côté serveur sur chaque route/action (jamais seulement côté UI).
- [ ] Validation serveur de toutes les entrées, protection CSRF/XSS/injection, secrets en variables d'environnement.
- [ ] Rate limiting sur les routes sensibles, journal d'audit sur les actions critiques.

### Auth (module obligatoire en premier)
- [ ] Inscription + vérification e-mail, connexion, déconnexion.
- [ ] Mot de passe oublié + réinitialisation (token à usage unique, expiration ≤ 1 h).
- [ ] Changement de mot de passe, gestion des sessions, verrouillage/limitation des tentatives.
- [ ] Invitation de membres, rôles, changement de tenant/organisation si applicable.
- [ ] Pages d'auth soignées : marque, validation en direct, messages d'erreur clairs, états de chargement, accessibilité clavier.

### UI/UX (chaque écran)
- [ ] Les 4 états existent : chargement (skeleton), vide (avec action), erreur (avec retry), succès (toast).
- [ ] Formulaires : validation, erreurs par champ, désactivation pendant l'envoi, protection double-clic.
- [ ] Responsive (mobile/tablette/desktop), accessibilité WCAG 2.1 AA (labels, focus, contraste).
- [ ] Zéro lien mort, zéro bouton sans action, zéro lorem ipsum, zéro donnée codée en dur.

### Notifications / emails / asynchrone (si dans le module)
- [ ] Déclencheurs, destinataires, contenu, préférences utilisateur, centre de notifications (lu/non lu) : TOUT, pas seulement l'icône.
- [ ] Jobs asynchrones avec retry, idempotence et suivi d'échec.

### IA (modules agents / LLM)
- [ ] Prompts versionnés, sorties structurées validées, gestion des erreurs/timeouts/limites de coût.
- [ ] Quotas par tenant, journalisation des appels, garde-fous contre l'injection de prompt, aucune fuite de données inter-tenants dans le contexte.
- [ ] Jeu d'évaluation minimal (cas attendus vs obtenus) avant de déclarer le module fini.

### Qualité & preuves
- [ ] Lint, typecheck et build passent sans erreur ni warning ignoré.
- [ ] Tests automatisés verts (commande + résultat collés dans le compte rendu).
- [ ] Parcours utilisateur principal rejoué de bout en bout (manuellement ou E2E) et décrit.
- [ ] Documentation courte : endpoints, variables d'environnement, décisions prises.

## Règle 3 — Interdictions explicites
- Générer des pages « coquille » dont la logique est à venir.
- Passer au module suivant avec des `TODO`, des mocks ou des fonctions non branchées.
- Annoncer « terminé » sans avoir exécuté les tests, le build et le parcours utilisateur.
- Ajouter des fonctionnalités non demandées pour « faire plus » : qualité avant quantité.
- Masquer une erreur (try/catch vide, `@ts-ignore`) au lieu de la corriger.

## Règle 4 — Revue indépendante avant validation
À la fin de chaque module, lancer un sous-agent de revue **qui n'a pas écrit le code** avec pour consigne : « Cherche ce qui manque ou casse par rapport à la spécification du module et à la DoD. Réponds par une liste de défauts, ou par ACCEPTÉ uniquement si tout est prouvé. » Corriger tous les défauts, puis relancer la revue. Le module est `VALIDÉ` uniquement sur un ACCEPTÉ.

## Format du compte rendu de fin de module
```
MODULE : <nom>
SPEC : docs/specs/<module>.md
DoD : <n>/<n> cases cochées
PREUVES : tests (commande + résultat) · build · parcours E2E
REVUE INDÉPENDANTE : ACCEPTÉ / défauts corrigés
DÉPENDANCES DÉBLOQUÉES : <modules suivants>
```
Puis attendre la validation de l'utilisateur avant d'ouvrir le module suivant.
