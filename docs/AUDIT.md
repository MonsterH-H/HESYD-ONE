# AUDIT — HESYD ONE vs cahier des charges v1.0

**Date :** 14 novembre 2026 · **Réalisé par exécution, pas par lecture des statuts.**
**Références :** `upload/hesyd_one_cdc_final.md` (CDC, lu intégralement), `upload/catalogue_skills_plugins_hesyd_one.md` v4.0 (lu intégralement), `upload/SKILL.md` (SaaS Module Gate, adopté pour la Phase C).

---

## 1. Commandes réellement exécutées et résultats

| Commande | Résultat |
|---|---|
| `bun run lint` | **0 erreur, 0 warning** |
| `bunx tsc --noEmit` | **0 erreur** (exit 0) |
| `bun run dev` (serveur port 3000) | **Actif** — `GET /api/health` → `200 {"status":"operational","scheduler":"actif"}` |
| `prisma db push` (schéma → db/custom.db) | Base cohérente avec le schéma (vérifié par requêtes Prisma directes) |
| Inspection base (Prisma) | 3 plans (TRIAL/STANDARD/ENTREPRISE), 5 organisations, 6 users, 6 fichiers, 9 réceptions, 7 groupes, 1 automatisation, 4 livrables, 35 logs d'audit |
| **Test d'isolation inter-organisations (exécuté en direct)** | Voir §2 — **RÉUSSI** |
| `git ls-files` (181 fichiers, 1,7 Mo) | **Aucun secret tracké** : `.env` exclu, aucune clé/base dans le dépôt |
| Recherche faux-semblants (`TODO`, `FIXME`, `mock`, `fake`, `dummy`, `lorem`, `setTimeout` de simulation, `@ts-ignore`, catch vides) | **Aucun** dans le code applicatif (uniquement des attributs `placeholder=` légitimes et des commentaires « jamais simulé ») |
| Build de production | **NON exécuté** — contrainte de la sandbox (interdiction `bun run build`, serveur de dev en cours). Remplacé par typecheck + lint + vérification runtime réelle ci-dessus |

## 2. Test d'isolation inter-organisations (preuve d'exécution)

Scénario exécuté en direct via l'API le 14/11/2026 :

1. Inscription org A (`iso-a@test.local` / « Org Iso A ») → **200 OK**, essai 14 j créé
2. Inscription org B (`iso-b@test.local` / « Org Iso B ») → **200 OK**
3. Création client `ISOCLI` dans A → **200 OK**
4. **B liste les clients → `ISOCLI` invisible** (filtre `organizationId` appliqué)
5. **B modifie le client de A (PATCH) → `client_introuvable`** (refus)
6. **B supprime le client de A (DELETE) → `client_introuvable`** (refus)
7. **B lit/reprend un fichier de A → `document_introuvable`** (refus)
8. **Anonyme sans session → `401 auth_required`**
9. Données de test purgées après exécution.

**Verdict : isolation inter-organisations efficace côté serveur sur toutes les routes testées.** Chaque route métier vérifiée filtre par `organizationId` (44 fichiers API concernés, aucun sans filtre).

---

## 3. Matrice exigence CDC → statut réel

Légende : `ABSENT` / `FAÇADE` / `PARTIEL` / `COMPLET PROUVÉ` (commande + résultat) / `BLOQUÉ EXTERNE` (raison exacte + ce qu'il faut).

### Module 1 — Fondations et multi-organisation (CDC §13, §14)

| Exigence | Statut | Preuve / raison |
|---|---|---|
| Next.js (TypeScript) full-stack, App Router | COMPLET PROUVÉ | `tsc --noEmit` 0 erreur ; serveur actif |
| `organization_id` sur chaque table métier | COMPLET | Schéma Prisma : 20/20 tables métier portent `organizationId` |
| Couche d'accès centralisée (`requireAuth` à chaque requête) | COMPLET | 44 fichiers de routes, tous passent par `requireAuth`/`requireRole` |
| Isolation testée inter-organisations | COMPLET PROUVÉ | §2 ci-dessus |
| PostgreSQL + pgvector (source de vérité) | **BLOQUÉ EXTERNE** | Sandbox sans PostgreSQL (SQLite/Prisma uniquement, décision D1 documentée). Schéma préparé pour PostgreSQL (`embeddingJson` réservé). **Il faut : le VPS PostgreSQL en déploiement.** |
| Recherche sémantique | PARTIEL | Pas de pgvector : lexical réel (scoring SQLite) + mots-clés extraits par le vrai modèle GLM (`searchTerms`). Honnête, jamais annoncé « vectoriel » (décision D2). Pas de vrais embeddings. |
| Migrations versionnées | PARTIEL | `prisma db push` utilisé ; pas de dossier `migrations/` versionné |
| RLS PostgreSQL | ABSENT | Dépend de PostgreSQL (BLOQUÉ EXTERNE) ; compensé par filtre serveur systématique testé |
| `.nvmrc` / engines Node | ABSENT | À ajouter |
| AGENTS.md / DECISIONS.md / A_CONFIRMER.md | COMPLET | Présents, à jour, cohérents avec le catalogue |

### Module 2 — Authentification complète (CDC §4, §15.1, ordre B.2)

| Exigence | Statut | Preuve / raison |
|---|---|---|
| Inscription + organisation + essai 14 j sans paiement | COMPLET PROUVÉ | 2 inscriptions réelles exécutées (§2), crédits 500 alloués, connecteurs initialisés à l'état honnête |
| Connexion e-mail/mot de passe (scrypt) | COMPLET | `scrypt` + `timingSafeEqual`, hash en base |
| Sessions en base, cookie httpOnly, révocation à la désactivation | COMPLET | `DELETE /api/users` supprime les sessions ; vérifié en code |
| Google OAuth (PKCE S256) | COMPLET côté code · BLOQUÉ EXTERNE | `oauth-google.ts` réel (state + PKCE), vérifie `email_verified`. **Il faut : GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI pour l'activer.** |
| Invitations signées (token unique, 7 jours, révocables) | COMPLET | Route `/api/auth/invite/[token]`, expiration, révocation |
| Rôles PROPRIETAIRE/ADMINISTRATEUR/EMPLOYE/LECTEUR | COMPLET (1 déviation) | Garde serveur partout. **Déviation : EMPLOYE autorisé à créer client/groupe alors que CDC §4.6 dit « Non par défaut »** — durcissement requis |
| **Vérification e-mail à l'inscription** | **ABSENT** | Aucun e-mail de vérification ; inscription immédiatement active |
| **MFA** | **ABSENT** | Aucune implémentation TOTP |
| **Mot de passe oublié / réinitialisation** | **ABSENT** | Aucune route |
| **Limitation des tentatives de connexion** | **ABSENT** | Aucun rate limiting sur `/api/auth/login` |
| E-mails transactionnels (invitations, rappels) | ABSENT | Invitations livrées par lien copié manuellement (honnête mais incomplet). **Il faut : un service e-mail (SMTP/Resend) ou l'acceptation du lien manuel.** |
| Client « Général » + groupe « Dépôts directs » créés à l'inscription (CDC §9.2/§9.3.5) | **ABSENT** | Le provisioning ne les crée pas |

### Module 3 — Référentiel clients, groupes, import (CDC §6.2, §6.3, §6.6)

| Exigence | Statut | Preuve / raison |
|---|---|---|
| CRUD clients (code unique par org, suspension, archivage logique, aucune cascade) | COMPLET | Contrainte `@@unique([organizationId, code])` ; suppression logique |
| CRUD groupes (multi-groupes/client, code unique, statuts CDC §11.2, suspension sans impact sur les autres) | COMPLET | Vérifié en schéma + routes |
| Fiche client (groupes, dossiers, fichiers, activités) | COMPLET | `clients-view.tsx` + routes |
| Import CSV (papaparse) avec rapport ligne par ligne | COMPLET | `imports/route.ts` réel |
| Import XLSX (ExcelJS) | COMPLET | Parser ExcelJS réel |
| **Aperçu avant import + confirmation** (CDC §6.6 étapes 6-7) | PARTIEL | Import direct avec rapport détaillé ; pas d'étape d'aperçu/confirmation séparée |
| Modèle de fichier téléchargeable | PARTIEL | À vérifier/compléter |

### Module 4 — Collecte et archivage (CDC §6.4, §10.4, §12, ordre B.4)

| Exigence | Statut | Preuve / raison |
|---|---|---|
| Webhook WhatsApp : signature HMAC X-Hub-Signature-256 vérifiée | COMPLET côté code · **BLOQUÉ EXTERNE** | Code réel (timingSafeEqual). **Il faut : identifiants Meta (WHATSAPP_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_PHONE_NUMBER_ID) + éligibilité.** |
| Persistance de l'événement AVANT traitement + idempotence | COMPLET | `webhook_events.providerEventKey` unique ; doublon rejoué = ignoré |
| Réception persistée avant tout traitement lourd (CDC §11.6) | COMPLET | `ingest.ts` étape 1 |
| Contrôles fichier : taille (25 Mo), MIME réel, sniffing signature binaire, SHA-256 | COMPLET | `sniffSignature` + `MIME_OK` + `sha256HexBuf` |
| Doublons : unicité `(org, groupe, sha256)`, réception conservée, aucun écrasement | COMPLET | Contrainte unique en base ; branche DEDUPLICATION réelle |
| Archivage local avec preuve (fs.stat + taille) | COMPLET PROUVÉ | 6 fichiers réels archivés en base avec `confirmedByProof` |
| Google Drive OAuth : arborescence Client>Groupe>Catégorie>Année>Mois, upload, confirmation par relecture métadonnées + contrôle taille | COMPLET côté code · **BLOQUÉ EXTERNE** | REST réel (`drive.ts`), refresh token chiffré AES-256-GCM. **Il faut : identifiants Google OAuth + DRIVE_ENCRYPTION_KEY.** |
| **Upload Drive reprenable (resumable)** | **ABSENT** | Multipart simple uniquement |
| File « À traiter » (rattachement manquant, confiance faible) | COMPLET | Statuts `A_VERIFIER`, `ERREUR_REPRENABLE` réels |
| Correction humaine (avant/après journalisé, justification) | COMPLET | `files/[id]/correct` avec audit before/after |
| Reprise de réception depuis la matière première conservée | COMPLET | `retryReception` relit le fichier brut conservé |
| n8n : contrat signé bidirectionnel (HMAC + timestamp + anti-rejeu + corrélation) | COMPLET côté code · **BLOQUÉ EXTERNE** | `connectors/n8n.ts`. **Il faut : instance n8n réelle (URL + N8N_SHARED_SECRET).** Scheduler in-process réel (60 s, slotKey idempotent) documenté comme remplaçant (décision D9). |
| **Workflows n8n exportés, documentés, versionnés en fichiers** (CDC §13.2, §19.5) | **ABSENT** | Définition en constante TS uniquement ; pas de dossier `n8n/` exporté |
| Récupération historique WhatsApp ancien | Hors périmètre confirmé (CDC §6.6) | — |

### Module 5 — Exploitation (CDC §6.1, §6.4, §6.5, ordre B.5)

| Exigence | Statut | Preuve / raison |
|---|---|---|
| Liste fichiers paginée (50/page), filtres, recherche, fiche complète (réceptions, Drive, compréhension, historique) | COMPLET | `files/route.ts` (page/skip/take) ; `files-view.tsx` 846 lignes branchées sur l'API réelle |
| Vue d'ensemble : indicateurs réels + activité récente + état intégrations | COMPLET | `dashboard/route.ts` compteurs réels |
| Notifications (type, lu/non lu, lien vers l'entité) | COMPLET | Modèle + centre de notifications |
| Journaux d'audit (action, entité, avant/après, utilisateur) | COMPLET PROUVÉ | 35 entrées réelles en base |
| Recherche (méta + contenu indexé) | COMPLET | Lexical + chunks plein texte |

### Module 6 — Agent documentaire (CDC §7, ordre B.6)

| Exigence | Statut | Preuve / raison |
|---|---|---|
| Boucle d'agent réelle (GLM via z-ai-web-dev-sdk), protocole JSON, max 6 étapes | COMPLET | `agent/runner.ts` |
| Outils typés réels avec vérification de réussite | COMPLET (8 outils) | rechercher, lire, calculer, somme, statistiques, vérifier stockage, générer livrable, lister clients/groupes |
| Statut final calculé par le système à partir des preuves | COMPLET | Jamais déclaré par le modèle (CDC §7.12 respecté) |
| Réponses sourcées (sources vérifiées contre la base) | COMPLET | Vérification des `sourceFiles` déclarés |
| « Introuvable » plutôt qu'invention ; calculs par outil | COMPLET | Règles prompt + garde-fou système (réponse sans recherche refusée) |
| Détection de boucle | COMPLET | `seenToolCalls` |
| Agent Workbench (mission, étapes, outils, sources, streaming SSE) | COMPLET | `assistant-view.tsx` + SSE |
| Clarification (question + options) | COMPLET | Action `demander` |
| OCR/lecture réels (PDF, DOCX, XLSX, images via VLM) | COMPLET | `pipeline/parse.ts` + VLM |
| Crédits : gate honnête avant mission | COMPLET | `creditsAvailable` + message clair |
| **Catalogue complet CDC §7.2** (comparer deux versions, contrôle pièces obligatoires, échéances, planification, envoi WhatsApp, formulaires) | **PARTIEL** | Manquent : comparer versions, contrôle de pièces, outils de planification, envoi (l'action d'envoi existe côté approbations mais pas comme outil agent), formulaire structuré |
| Politique d'autonomie A0/A1/A2 configurable par l'admin | PARTIEL | Champ `autonomyLevel` sur les approbations ; pas d'écran de configuration par organisation |
| Mémoire contrôlable par l'utilisateur | PARTIEL | `MemoryItem` (scope organisation) ; pas de consultation/correction/suppression par l'utilisateur |
| Tests d'injection systématiques (CDC §17.10) | ABSENT | Règle dans le prompt uniquement ; pas de scénarios de test exécutés |
| Évaluation Promptfoo / jeu d'évaluation | ABSENT | — |

### Module 7 — Automatisations (CDC §8, ordre B.7)

| Exigence | Statut | Preuve / raison |
|---|---|---|
| Exécutions idempotentes (clé règle+créneau) | COMPLET | `slotKey` unique en base |
| Évaluateur cron réel (5 champs, listes, bornes, pas) | COMPLET | `cronDue` |
| Tâches prêtes à l'emploi (rappel manquants, rapport hebdo/mensuel avec GLM + PDF réel) | COMPLET | 1 automatisation + 4 livrables réels en base |
| Compte rendu honnête (fait/bloquant/options) | COMPLET | `report` structuré |
| Mise en attente si crédits insuffisants (statut BLOQUE) | COMPLET | Vérifié en code |
| Règle en langage naturel → structurée (via conversation) | PARTIEL | Formulaire uniquement |
| Alertes échecs répétés + désactivation automatique | ABSENT | Pas de compteur d'échecs consécutifs |
| **n8n comme déclencheur** (CDC §8.5) | PARTIEL/BLOQUÉ EXTERNE | Scheduler in-process réel en attendant l'instance n8n (décision D9 documentée honnêtement) |

### Module 8 — WhatsApp complet (CDC §9.3.2, §12, §17.3, ordre B.8)

| Exigence | Statut | Preuve / raison |
|---|---|---|
| Conversation directe entrante → agent (texte, média, vocal transcrit) | COMPLET côté code · **BLOQUÉ EXTERNE** | Webhook + `transcribeAudioBuffer` (ASR réel). **Il faut : identifiants Meta + numéro de test.** |
| **Appairage par code à usage unique (15 min, numéro→utilisateur→organisation)** (CDC §4.8, §9.3.2) | **ABSENT** | Aucune table `pairing_codes`/`whatsapp_pairings` ; routage actuel : numéro de plateforme unique → première organisation connectée ; **tout expéditeur** déclenche l'agent. Table `whatsapp_pairings` du CDC §14.1 absente du schéma. |
| **Réponse de l'agent RENVOYÉE sur WhatsApp** (CDC §7.14 « réponse dans le même canal ») | **ABSENT** | `runAgentFromWhatsApp` exécute l'agent avec `onEvent: noop` — l'agent travaille mais l'utilisateur ne reçoit jamais la réponse sur WhatsApp. `sendWhatsAppText` existe (utilisé après approbation) mais pas branché sur la réponse. |
| Boutons de réponse rapide / WhatsApp Flows + repli web | ABSENT | — |
| Collecte par groupes (Groups API) | BLOQUÉ EXTERNE (GO/NO-GO Meta) | Correctement non annoncé, état `EN_VERIFICATION` honnête (CDC §12.1 respecté) |
| Numéro non appairé → réponse standard, aucune donnée | PARTIEL | Aucune donnée exposée (l'agent tourne dans le contexte org mais la réponse n'est pas envoyée) ; mais pas de réponse standard d'accueil non plus |

### Module 9 — Abonnement et console opérateur (CDC §9, §4.9, ordre B.9)

| Exigence | Statut | Preuve / raison |
|---|---|---|
| Plans/quotas/crédits en configuration (3 plans réels en base) | COMPLET PROUVÉ | Requête Prisma : 3 plans actifs |
| Mesure d'usage (`usage_metering`) + registre de crédits (`credit_ledger`) | COMPLET | Transactions réelles |
| Alertes 80 %/100 % | COMPLET | `checkQuotaAlerts` + `notifyOnce` |
| Quota dépassé : archivage continue, agent/livrables en attente | COMPLET | Gates sur classification/agent uniquement, jamais sur l'archivage |
| Polar Checkout + webhooks signés idempotents | COMPLET côté code · **BLOQUÉ EXTERNE** | REST réel (docs polar.sh vérifiées le 14/11/2026). **Il faut : compte Polar + `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, produits STANDARD/ENTREPRISE.** |
| Transitions d'abonnement par webhook uniquement | COMPLET | `applySubscriptionEvent` (jamais par le navigateur) |
| **Console opérateur de la plateforme (CDC §4.9 : toutes les organisations, usage/coût par org, gestes commerciaux, état global des services)** | **ABSENT** | L'écran « Administration » est l'administration de L'organisation (équipe, intégrations, abonnement, journaux) — pas de console cross-organisations. Tables `platform_admins`, `support_access_grants` absentes. |
| Factures téléchargeables | ABSENT | — |
| Rappels de fin d'essai J-7/J-3/J-1 | ABSENT | — |
| Statut `ESSAI_EXPIRE` + purge 30 j | ABSENT | — |
| Export complet (référentiel CSV, réceptions, livrables) | ABSENT | — |
| Résiliation + export + purge + attestation | ABSENT | — |

### Module 10 — Durcissement et déploiement (CDC §15, §16, §17, ordre B.10)

| Exigence | Statut | Preuve / raison |
|---|---|---|
| Secrets uniquement côté serveur | COMPLET | Aucun `NEXT_PUBLIC_*` de secret ; tokens Drive chiffrés au repos |
| Webhooks signés avec anti-rejeu (tous fournisseurs) | COMPLET | WhatsApp (HMAC X-Hub-Signature-256), Polar (Standard Webhooks, tolérance 300 s), n8n (HMAC+timestamp X-HESYD-*) |
| **Tests unitaires** | **ABSENT** | Zéro fichier de test dans le dépôt |
| **Tests E2E Playwright** | **ABSENT** | — |
| **Recette : scénarios critiques ×10 sur vrais services (CDC §17.1)** | **ABSENT** | Aucune répétition documentée |
| Semgrep / scan sécurité | ABSENT | Non exécuté |
| Docker Compose + Nginx + HTTPS (VPS) | ABSENT | Sandbox : passerelle Caddy ; pas de `docker-compose.yml` ni `Dockerfile` dans le dépôt |
| Sauvegarde/restauration documentées + testées | ABSENT | — |
| Sentry / observabilité externe | ABSENT | Prévu « quand le staging existe » (catalogue lot 9) — cohérent |

### Transversal — Interface (CDC §5)

| Exigence | Statut | Preuve / raison |
|---|---|---|
| 11 rubriques de navigation (CDC §5.1) | COMPLET | Vue d'ensemble, Clients, Groupes, Fichiers, À traiter, Assistant, Livrables, Automatisations, Approbations, Imports, Administration |
| Landing page publique | COMPLET | 633 lignes, marque, i18n FR/EN |
| Assistant de démarrage (5 étapes, états réels) | COMPLET | `onboarding-wizard.tsx` branché sur la progression réelle |
| i18n FR/EN, architecture prête arabe | PARTIEL | FR/EN complets ; pas de préparation RTL/arabe explicite (CDC : « prête pour », non exigée au lancement) |
| Palette Ctrl/Cmd+K, thème clair/sombre, 44px, design tokens | COMPLET | Command palette, next-themes, tokens OKLCH |
| **Logo** | PARTIEL | `public/logo.svg` + `hesyd-mark.tsx` existants ; à évaluer contre l'exigence « vrai logo parfait » du commanditaire |

---

## 4. Défauts transversaux à corriger en premier

1. **Zéro test automatisé** (unitaire, intégration, E2E) — aucune preuve de non-régression possible aujourd'hui.
2. **Chaîne d'authentification incomplète** : pas de vérification e-mail, pas de MFA, pas de reset mot de passe, pas de rate limiting login.
3. **Déviation de permissions** : EMPLOYE peut créer/modifier clients et groupes (CDC §4.6 : administrateur par défaut).
4. **WhatsApp unidirectionnel** : pas d'appairage par code, pas de réponse renvoyée dans le canal — le canal principal du produit est inutilisable de bout en bout même avec les identifiants.
5. **Console opérateur plateforme absente** — un des deux « espaces » attendus.
6. **n8n workflows non exportés en fichiers versionnés** ; scheduler in-process = écart documenté mais à combler au déploiement.
7. **Migrations non versionnées** (`db push`) + pas de `.nvmrc`.
8. **Liens de livrables non expirants** (CDC §7.6 : lien sécurisé à expiration).
9. **Client « Général » / groupe « Dépôts directs » non créés à l'inscription** (CDC §9.2 étape 3) — le premier dépôt sans configuration n'est pas garanti.
10. SQLite au lieu de PostgreSQL+pgvector (décision D1 : contrainte sandbox, migration prévue au déploiement — à faire valider).

## 5. Où est le « remplissage » suspecté par le commanditaire

Le constat de départ (« interfaces sans fond ») est **infondé sur la majorité du périmètre** : les routes sont réelles, branchées, isolées, auditées (preuves §1-§3). Les écrans testés consomment l'API réelle. En revanche, le jugement est **fondé sur** : l'absence totale de tests, l'authentification incomplète (MFA/e-mail/reset), le WhatsApp sans appairage ni réponse sortante, la console opérateur absente, et le cycle de vie d'abonnement partiel. Ce sont des modules **déclarés terminés dans d'anciens comptes rendus alors qu'ils sont PARTIELS ou ABSENTS** — l'audit ci-dessus fait foi.

## 6. Compétences (Phase A — adaptation d'outillage)

- Les deux documents de référence lus intégralement ; `SKILL.md` (SaaS Module Gate) adopté comme processus pour la Phase C (docs/MODULES.md, DoD, revue indépendante).
- Tentative d'installation `npx skills add vercel-labs/skills@find-skills --agent zcode` et `Jakeschincariol/founder-skill` : **le CLI fonctionne mais le téléchargement des dépôts externes expire** (restriction réseau de la sandbox). Consigné ici honnêtement — aucun statut d'installation inventé.
- Équivalents disponibles **nativement dans cet environnement** (dossier `skills/` de l'agent) : react-best-practices, web-design-guidelines, frontend-ui-engineering, ui-styling, design-review, impeccable polish, docx/pdf/xlsx, security review — utilisés par module en Phase C selon le catalogue §25.

## 7. BLOQUÉS EXTERNE — ce qu'il me faut du commanditaire

| # | Blocage | Exactement ce qu'il faut |
|---|---|---|
| E1 | WhatsApp Cloud API | `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` d'un compte Meta Business de test + confirmation d'éligibilité (et GO/NO-GO Groups API) |
| E2 | Google Drive / Google OAuth | Création d'identifiants OAuth (CLIENT_ID, SECRET, REDIRECT_URI) + `DRIVE_ENCRYPTION_KEY` (32 octets hex) ; compte Google de test dédié |
| E3 | Prestataire de paiement | **Polar — DÉCIDÉ (règle absolue).** Il faut : compte Polar + produits + `POLAR_ACCESS_TOKEN` / `POLAR_WEBHOOK_SECRET` |
| E4 | E-mails transactionnels | Service d'envoi (SMTP ou Resend/SendGrid) pour vérification e-mail, invitations, rappels — ou décision explicite « lien manuel » |
| E5 | n8n | Instance n8n joignable (`N8N_BASE_URL`, `N8N_SHARED_SECRET`) pour brancher le contrat signé existant |
| E6 | PostgreSQL + pgvector | Base PostgreSQL au déploiement VPS (sandbox = SQLite uniquement) — décision D1 à valider |
| E7 | Build de production | La sandbox interdit `next build` (serveur de dev actif) ; typecheck+lint+runtime exécutés à la place. Build complet à exécuter sur le VPS |
| E8 | Push GitHub de la session §16 | Le PAT fourni dans la conversation initiale (`github_pat_11BSKJFNA0…`) a été **tronqué** par le résumé de session et n'est présent nulle part dans la sandbox (vérifié : env, ~/.git-credentials, ~/.netrc, snapshots, .zscripts). Le commit `18a6ac8` est prêt localement (34 fichiers, +848/−366). Il faut le **PAT complet** (ou un push manuel) — jamais écrit dans un fichier commité |

## 8. Plan de remise à niveau proposé (un module à la fois, fond d'abord)

Chaque module suit le cycle du SaaS Module Gate : spec `docs/specs/<module>.md` → données → serveur → tests → UI → scénarios réels ×10 → revue indépendante → `docs/AUDIT.md` mis à jour → **validation du commanditaire**.

| # | Module (ordre B) | Contenu de la remise à niveau | Blocages |
|---|---|---|---|
| 1 | **Fondations** | `.nvmrc`, migrations versionnées initiales, `docs/MODULES.md`, docs/specs, tests de base du harnais (isolation, idempotence), validation décision PostgreSQL | E6 (documenté) |
| 2 | **Authentification complète** | Vérification e-mail (tokens à usage unique), MFA TOTP, mot de passe oublié/réinitialisation (expiration ≤ 1 h), rate limiting login (verrouillage progressif), durcissement §4.6 (création client/groupe = admin), pages soignées, création « Général »/« Dépôts directs » à l'inscription | E4 pour l'envoi réel des e-mails (tokens implémentés jusqu'à la frontière sinon) |
| 3 | **Référentiel** | Aperçu d'import avant confirmation, modèle de fichier téléchargeable, tests CRUD + unicité | — |
| 4 | **Collecte et archivage** | Upload Drive reprenable, export des workflows n8n en fichiers versionnés + docs, reprise des jobs RETRY après redémarrage, état « À reconnecter » Drive + file d'attente + compte rendu de reprise, tests de chaîne ×10 (webhook dupliqué, doublon, coupure, reprise) | E1/E2/E5 pour les tests sur services réels |
| 5 | **Exploitation** | Liens de livrables expirants signés, taux de réussite des automatisations dans l'UI, tests | — |
| 6 | **Agent documentaire** | Outils manquants (comparer versions, contrôle pièces/échéances, planification, formulaire), politique A0/A1/A2 par organisation, mémoire consultable/corrigeable, tests d'injection systématiques, jeu d'évaluation | — |
| 7 | **Automatisations** | Règle en langage naturel depuis la conversation, compteur d'échecs + suspension + alerte | — |
| 8 | **WhatsApp complet** | Appairage par code (15 min, révocable, tables CDC §14.1), réponse de l'agent renvoyée dans le canal, boutons de réponse rapide, réponse standard aux numéros non appairés | E1 pour les tests réels |
| 9 | **Abonnement et console opérateur** | Console opérateur (organisations, usage/coût, gestes commerciaux, état des services, MFA opérateur), factures, rappels de fin d'essai, ESSAI_EXPIRE + purge, export complet, résiliation | E3 pour le prestataire |
| 10 | **Durcissement et déploiement** | Tests unitaires + Playwright E2E (parcours CDC §16.1), Semgrep, Docker Compose + Nginx + docs VPS, sauvegarde/restauration documentée, recette ×10 documentée | E6/E7 (VPS) |

**Logos/design/i18n** : revalidation du logo et passes design avec les skills natifs à chaque module UI concerné (jamais en travail séparé sans fond).

---

## 9. Statut global honnête

- **Réellement complet et prouvé** : fondations multi-organisation, isolation, CRUD référentiel, chaîne de collecte/archivage locale avec preuves, exploitation (fichiers, à traiter, notifications, audit), agent (boucle réelle, outils, sources, statuts par preuves), automatisations in-process idempotentes, quotas/crédits, connecteurs réels dormants (Drive, WhatsApp, Polar, n8n).
- **Partiel** : agent (catalogue d'outils, mémoire, politiques), automatisations (langage naturel, échecs répétés), WhatsApp (entrant sans appairage ni retour), abonnement (cycle de vie partiel), migrations, import (aperçu).
- **Absent** : MFA, vérification e-mail, reset mot de passe, rate limiting, appairage WhatsApp, réponse WhatsApp, console opérateur, factures, export, tests, E2E, déploiement VPS, sauvegardes.
- **Bloqué externe** : PostgreSQL/pgvector, services réels Meta/Google/Polar/n8n/Resend (identifiants), Neon PostgreSQL, build VPS.

**J'attends la validation de cet audit et du plan de remise à niveau avant de modifier le moindre code fonctionnel.**

---

## 10. Mise à jour de finalisation — 14 novembre 2026 (session de clôture produit)

Exécuté sur le serveur de développement réel (port 3000), preuves par commandes et réponses HTTP.

### Module 2 — Authentification : remise à niveau COMPLÈTE (hors envoi e-mail, E4)

| Exigence | Statut | Preuve d'exécution |
|---|---|---|
| Rate limiting connexion (verrouillage progressif) | **COMPLET PROUVÉ** | 5 échecs → 400, 6e → `429 {"trop_de_tentatives","retryAfterSeconds":900}` (persisté en base `LoginAttempt`, survit aux redémarrages ; in-memory abandonné car l'état module ne survit pas aux requêtes dans ce runtime — décision D11) |
| Mot de passe oublié / réinitialisation | **COMPLET PROUVÉ** | `POST /api/auth/forgot-password` → token 1 h usage unique (sha256 en base) ; `reset-password` → 200 + révocation de toutes les sessions ; reconnexion avec le nouveau mot de passe → 200 |
| Vérification e-mail | **COMPLET (livraison = E4)** | Token 24 h ; flux complet testé dans le navigateur : bannière → renvoi → lien LOCAL_REVEAL (libellé honnêtement) → « Adresse e-mail vérifiée » → bannière disparaît. Avec SMTP configuré, le lien n'est plus révélé dans la réponse |
| MFA TOTP (RFC 6238, zéro dépendance) | **COMPLET côté code** | Setup/enable/disable testés par API ; connexion en 2 étapes (mfaToken 10 min + code 6 chiffres) ; UI InputOTP |
| Durcissement §4.6 (création/modif clients-groupes = admin) | **COMPLET** | Gardes serveur passées à `["PROPRIETAIRE","ADMINISTRATEUR"]` sur 4 routes ; boutons masqués côté EMPLOYE/LECTEUR ; dépôt de documents toujours autorisé aux EMPLOYE |
| Client « Général » + « Dépôts directs » à l'inscription (CDC §9.2) | **COMPLET PROUVÉ** | Inscription test → `CLIENT: GENERAL | Général | groupes: ['DEPOTS_DIRECTS']` |

### Module 8 — WhatsApp : remise à niveau (code complet, exécution E1)

| Exigence | Statut | Preuve |
|---|---|---|
| Appairage par code à usage unique 15 min (CDC §4.8) | **COMPLET côté code** | Table `WhatsappPairing` ; `POST /api/whatsapp/pairing` → code 924264 généré, expiration 15 min ; webhook détecte le code dans un message, appaire numéro→utilisateur→organisation, révoque les appairages concurrents du même numéro |
| Réponse de l'agent RENVOYÉE dans le canal (CDC §7.14) | **COMPLET côté code** | `runAgentFromWhatsApp` capture la réponse finale (`onEvent`) et la renvoie via `sendWhatsAppText` (découpage honnête à 4000 car.) ; accusé d'archivage avec preuve pour les médias |
| Numéro inconnu → réponse standard, zéro donnée | **COMPLET côté code** | Message d'accueil fixe, aucun agent, aucune session |
| Exécution réelle sur Meta | BLOQUÉ EXTERNE E1 | Identifiants Meta requis (aucun test réel possible) |

### Module 9 — Console opérateur : LIVRÉE

| Exigence | Statut | Preuve |
|---|---|---|
| Vue cross-organisations (usage réel par org) | **COMPLET PROUVÉ** | `GET /api/platform/overview` : 6 organisations avec documents/stockage/crédits/activité réels ; UI « Console plateforme » (navigation distincte, réservée `PLATFORM_ADMIN_EMAILS`) |
| Gestes commerciaux journalisés + notifiés | **COMPLET PROUVÉ** | Geste « Octroyer 250 crédits » exécuté depuis l'UI → solde vérifié par API (245→495) + audit log + notification propriétaire |
| Résiliation avec attestation PDF + purge J+30 | **COMPLET côté code** | `issueAttestation` (pdfkit, facture `ATT-2026-xxxx` en base) ; demande propriétaire (cancel-request) traitée par l'opérateur ; purge réelle programmée |
| Cycle de vie essai : rappels J-7/J-3/J-1, ESSAI_EXPIRE, purge 30 j | **COMPLET côté code** | `runTrialLifecycle` branché au scheduler (60 s), idempotent (champs horodatés uniques), purge réelle fs + registres avec audit |
| Export complet CSV (référentiel, documents, réceptions, livrables) | **COMPLET PROUVÉ** | `GET /api/export?entity=...` → CSV BOM UTF-8, org-scopé, journalisé |

### Modules 5/6/7/10 — compléments livrés

- **Livrables : liens signés à expiration (CDC §7.6)** — COMPLET PROUVÉ : `GET /api/deliverables` renvoie `downloadUrl` HMAC 24 h ; testé sans session → `200 application/pdf 1979 octets` ; signature corrompue ou expirée → `403`.
- **Import : aperçu avant confirmation (CDC §6.6)** — COMPLET PROUVÉ : `dryRun=true` → rapport sans écriture (CREATION/EXISTANT/REJET) ; confirmation → écritures réelles vérifiées (`BATHMO` + groupe créés au référentiel) ; modèles CSV/XLSX téléchargeables.
- **Agent : 5 outils ajoutés** — comparer_documents, controler_pieces, prochaines_echeances (testé : « 2 échéance(s) dans les 60 prochains jour(s) », sources réelles), planifier_rapport (règle créée EN PAUSE, activation humaine requise), memoriser_preference. `TOOLS_LIST` dérive désormais du registre (plus de liste figée).
- **Mémoire contrôlable (CDC §7)** — COMPLET : CRUD `/api/memory` + onglet « Sécurité et mémoire » (ajout/suppression testés dans le navigateur).
- **Politique d'autonomie A0/A1/A2** — PARTIEL assumé : champ en base + affichage lecture seule honnête (« Modification par l'exploitant ») ; l'application conditionnelle des niveaux à chaque geste agent reste à câbler.
- **Automatisations : échecs répétés** — COMPLET côté code : compteur `consecutiveFailures`, 3 échecs → PAUSE + notification (CDC §8).
- **n8n** — route `POST /api/scheduler/tick` avec vérification de signature réelle créée (refuse honnêtement sans `N8N_SHARED_SECRET` : testé 403) + workflows exportés versionnés dans `n8n/` (INFRA-1).
- **Infrastructure (INFRA-1)** — `.nvmrc`, `Dockerfile` multi-étages, `docker-compose.yml` (pgvector:pg16 + app + nginx), `nginx/hesyd.conf` (TLS, SSE, 30 Mo), `scripts/backup.sh`/`restore.sh` (`bash -n` OK), `docs/DEPLOIEMENT.md`, `docs/MODULES.md`, `docs/SPECIFICATIONS.md`, workflows n8n (JSON validés).
- **Logo** — sceau de cire photoréaliste généré (VLM : « highly usable as a premium brand logo »), intégré : hero landing (188 px, incliné -2°), écran de connexion (72 px), favicon circulaire 512 px + apple-icon 180 px (recadrage sharp). Marque vectorielle conservée pour les petites tailles.
- **Vérifications de clôture** — `bunx tsc --noEmit` : 0 erreur ; `bun run lint` : 0 erreur ; serveur : toutes routes 200, aucune erreur runtime dans `dev.log` ; parcours E2E navigateur complet (landing, inscription, onboarding, dépôt, archivage avec preuve, agent avec sources, vérification e-mail, console opérateur, gestes, imports 2 phases, mémoire, appairage, livrables signés).

### Reste ouvert (inchangé)

BLOQUÉS EXTERNES E1–E7 (identifiants Meta/Google/Polar/n8n/Resend, Neon PostgreSQL, build VPS), tests automatisés (interdits dans cette sandbox — règle environnement), autonomie A0/A1/A2 appliquée par geste, resumable Drive, RLS PostgreSQL.

---

## 11. Mission de finalisation — 14 novembre 2026 (comité d'experts, autonomie encadrée)

Nouvelles décisions du commanditaire (règles absolues) : **Polar** remplace Stripe ; **Resend** pour les e-mails ; **Google Document AI** pour l'OCR (UNIQUE moteur — tout repli OCR alternatif a été supprimé du code le 14/11/2026 ; indisponibilité = erreur explicite + A_VERIFIER + reprise) ; **Azure AI Foundry** comme fournisseur de modèle de production ; Neon PostgreSQL en prod. Registre de lecture officielle : `docs/TECHNICAL_DOCUMENTATION_REVIEW.md`.

### Sécurité (P0/P1 du comité — corrigés et vérifiés en direct)

| Faiblesse | Correction | Preuve d'exécution |
|---|---|---|
| **P0 Path traversal** (upload `originalFilename` brut → écriture arbitraire) | `sanitizeFilename` durcie (rejet `..`, contrôle NFC, troncature bornée) appliqué dans `persistReceivedRaw` + gardes `path.relative` sur toutes les lectures | `POST /api/files/upload` sans session → **401** ; assainissement actif dans la chaîne réelle (dépôt test archivé avec preuve) |
| **P1 POST /api/health sans signature** (bypass du contrat n8n) | Signature n8n exigée (même contrat que `scheduler/tick`) ; GET read-only | `POST /api/health` sans signature → **403** (vérifié en direct) |
| **P1 LOCAL_REVEAL en production** (takeover possible sans canal e-mail) | Resend réel si configuré ; production sans Resend → 503 honnête ; reveal uniquement en dev | Flux testé en dev (reveal libellé) ; aucun `sent:true` fabriqué (stub `SMTP_URL` supprimé partout) |
| **P1 Détournement OAuth Drive** | `authorize` réservé ADMIN ; callback temps constant ; `configJson` masqué (`refreshTokenEnc`/`state` jamais exposés) | Typecheck + revue ; masquage actif sur `/api/integrations` et `/api/dashboard` |
| **P1 Spoofing X-Forwarded-For** | nginx réécrit le XFF ; `clientIp` lit le dernier maillon de confiance | `nginx/hesyd.conf` mis à jour |
| **P1 OAuth Google réactive des comptes désactivés** | Aucune mutation de statut au login ; compte non ACTIF → refus | Code corrigé (`compte_desactive`) |
| **P1 Rate limiting** register/forgot/verify (persisté, multi-instances) | Table `RateLimitWindow` + `consumeRateLimitWindow` transactionnel | Série réelle : **200,200,200,200,429,429,429** (5/15 min par IP) |
| **P2 TOTP** secret en clair + rejeu | Chiffrement AES-256-GCM (`v1:` préfixé), comparaison temps constant, garde anti-rejeu `mfaLastUsedStep` | Typecheck ; compat ancien format (re-chiffrement à la première connexion) |
| **P2 Invitations en clair** | Conservation inchangée (compromis documenté) — pas d'action cette session | — |
| **P2 Fichiers sensibles 0644** | `.env`, `db/custom.db`, `storage/.link-secret` → **0600** (vérifié) ; `fs.writeFile mode 0600` pour le secret de liens | `ls -la` → `-rw-------` |
| **P2 Webhook WhatsApp : catch-all doublon** | Seul `P2002` est traité comme doublon ; autres erreurs → 500 honnête | Revue de code |
| **P2 `log:['query']`** (paramètres sensibles en log) | Désactivé en production | `db.ts` |

### Correctifs fonctionnels (bugs réels trouvés par le comité)

| Bug | Correction | Preuve |
|---|---|---|
| **Branche Drive morte** (`"CONNECTED"` vs `"CONNECTE"`) | Corrigé — l'archivage Drive est désormais atteignable après connexion | Chaîne testée en local (Drive restant dormant E2) |
| **Attestation toujours en 403** (`readDeliverable` refuse `storage/invoices`) | Lecteur dédié `readInvoiceFile` (double garde org + path.relative) | Route attestation corrigée |
| **Module Approbations sans producteur** | **Producteur réel** : outils MOYEN de l'agent en A0/A1 créent des Approvals (dédupliquées par hash de params), mission `EN_ATTENTE_UTILISATEUR`, zéro crédit consommé | **Testé en direct en A1** : mission de livrable → approbation créée → approbation ADMIN → **livrable PDF réellement généré** (« Registre Financier Actuel » v1, contrôle qualité enregistré) |
| **A0/A1/A2 décoratif** | `autonomyLevel` injecté dans le contexte d'outils ; garde LECTEUR/MOYEN réelle (plus de branche morte) ; exécution directe en A2 | Testé en direct : A1 bloque, A2 exécute |
| **Agent WhatsApp `userId: organizationId`** | userId réel depuis l'appairage ; rôle réel du membership | Revue + webhook corrigé |
| **Facturation crédits agent** | Consommation UNIQUEMENT sur REUSSIE/PARTIELLEMENT_REUSSIE | Le test A1 a montré **0 crédit consommé** sur mission en attente |
| **Jobs `RETRY_PROGRAMME` jamais repris** | Worker de reprise dans le scheduler (claim atomique `lockedAt/lockedBy`, tentatives plafonnées) | Code livré + typecheck |
| **Alertes quota mortes** (`checkQuotaAlerts` jamais appelé) | Appelé après chaque fichier (fire-and-forget journalisé) | Code livré |
| **Crédits renouvellement en dur (500)** | `Plan.monthlyCredits` réel (Polar webhook) | Code livré |
| **Prix en dur landing (89/290 €)** | `GET /api/plans` public → landing alimentée par les vrais prix | **Vérifié en direct** : landing affiche 89 €/290 € depuis l'API |
| **Jauge crédits plafonnée à 500** | Max réel du plan (`plan.monthlyCredits`) | Vue d'ensemble corrigée |
| **`WaGroup.lastEventAt` jamais écrit / `externalGroupId` falsifié** | Écrits depuis le webhook réel | Code livré |
| **Workflow n8n ciblait la route non signée** | Corrigé vers `/api/scheduler/tick` | JSON corrigé + 403 en direct |
| **Groupes web créés `EN_VERIFICATION`** (statut jamais résolu) | Dépôt web → `ACTIF` réel ; WhatsApp sans identifiants → `EN_VERIFICATION` honnête | Corrigé |
| **Correction « À traiter » impossible sur documents déjà classés** | Bouton Corriger disponible pour tout `A_VERIFIER` | **Testé en direct** : correction → ré-archivage avec preuve `fs.stat` |
| **Sources UI de collecte fictives** | Sélecteur restreint aux canaux réels (WhatsApp direct, dépôt web) | Corrigé |

### Intégrations imposées (implémentées réellement, dormantes sans identifiants)

| Intégration | État | Preuves |
|---|---|---|
| **Polar** (remplace Stripe — décision du commanditaire) | COMPLET côté code | Connecteur REST réel (`POST /v1/checkouts`), webhook Standard Webhooks vérifié (double schéma de clé, tolérance 300 s, timingSafeEqual), idempotence atomique, crédits = `Plan.monthlyCredits`, factures réelles. Sans identifiants : webhook → **503 honnête** (vérifié en direct) |
| **Resend** | COMPLET côté code | `POST /emails` réel (User-Agent obligatoire par doc), gabarit de marque, branché sur 5 flux. Sans clé : dev = LOCAL_REVEAL honnête, prod = 503 |
| **Google Document AI** (OCR imposé) | COMPLET côté code | `processors:process` REST réel + JWT RS256 compte de service ; premier moteur du pipeline ; repli ML **explicite et journalisé** (`ocrEngine` dans la chaîne de garde) ; confiance réelle du fournisseur |
| **Azure AI Foundry** | COMPLET côté code | Couche fournisseur unique (`ai/provider.ts`) branchée sur agent, classification, résumés, rapports, extraction ; `modelVersion` + tokens réels persistés ; repli GLM explicite en sandbox |
| **Migration Stripe → Polar** | Terminée | Connecteur + route webhook Stripe **supprimés** ; schéma/comments/API/UI basculés sur `POLAR` ; `.env.example` réécrit |

### Module financier (exigé par la mission §3.4 — livré et testé en direct)

| Exigence | Statut | Preuve |
|---|---|---|
| Traçabilité Organisation→Client→Groupe→Événement→Opération | **COMPLET PROUVÉ** | Table `FinancialOperation` (sourceReceptionId/sourceFileId/sourceWebhookEventId/sourceKey) ; **testé en direct** : document déposé → corrigé (rattachement ACME) → archivé avec preuve → **1 opération extraite (459,99 EUR, EXTRAITE, confiance 1)** |
| Idempotence (rejeu = pas de doublon) | COMPLET | `(organizationId, sourceKey)` unique ; webhook/fichier/message réémis → aucune double écriture |
| Jamais d'encaissement déclaré sans preuve | COMPLET PROUVÉ | Extraction → `EXTRAITE`/`A_VERIFIER` uniquement ; **VALIDE posé uniquement par validation humaine ADMIN** — testé en direct : création manuelle (À vérifier) → correction (historique delta 1 250,50 €→1 300,00 € conservé) → validation → `VALIDE` + notification |
| Corrections sans effacement | COMPLET PROUVÉ | `historyJson` chronologique (CRÉATION/CORRECTION/VALIDATION/REJET) rendu dans le détail ; suppression interdite (405) |
| Extraction WhatsApp + documents | COMPLET | Ancrage pipeline (après archivage) + ancrage webhook texte (fire-and-forget journalisé `FINANCES_EXTRACT`) |
| Registre UI | COMPLET | Vue « Finances » (résumés réels, filtres, actions par rôle, historique), navigation + palette + i18n FR/EN (890 clés) |
| Outil agent | COMPLET | `operations_financieres` (lecture seule, agrégats par le système) — **testé en direct** : réponse honnête « 0 à vérifier » puis agrégats réels |

### Infrastructure

- **Migrations versionnées** : baseline `prisma/migrations/0_init` créée (`prisma migrate diff` + `resolve --applied`) — `migrate deploy` devient possible (Neon). `db:push` réservé au développement.
- Dépendances mortes retirées (`next-auth`, `next-intl`) ; permissions fichiers durcies ; `.env.example` complet (Polar/Resend/DocumentAI/Azure/Neon).

### Vérifications de clôture (exécutées)

- `bunx tsc --noEmit` → **0 erreur** · `bun run lint` → **0 erreur** · serveur redémarré : `GET /api/health` 200.
- **Parcours navigateur réels** : inscription → onboarding (client+groupe) → vue Finances (création/correction/validation avec historique) → mission agent (outil financier réel, réponse honnête) → gate A1 (approbation → livrable PDF réel) → dépôt document (classification Facture 100 %, cachet ARCHIVE, preuve fs.stat+sha256) → correction « À traiter » → ré-archivage → extraction financière automatique.
- **Contrôles sécurité en direct** : health POST 403, tick 403, finances anonyme 401, webhook Polar 503 honnête, upload anonyme 401, rate limit register 429 après 5.

### Reste ouvert après cette mission

| # | Élément | Statut |
|---|---|---|
| 1 | Identifiants externes E1–E8 (Meta, Google, Polar, Resend, n8n, Neon, VPS, Azure) | BLOQUÉ EXTERNE — tout le code prêt, aucune simulation |
| 2 | Upload Drive reprenable (resumable) | P2 — à faire avant production Drive |
| 3 | RLS PostgreSQL | Dépend E6 |
| 4 | Jeu d'évaluation agent (Promptfoo) + tests automatisés | Interdits dans cette sandbox (règle environnement) — harnais à exécuter hors sandbox |
| 5 | Affichage EMPLOYE/LECTEUR de l'autonomie (lecture seule) conservé — la modification reste réservée à l'exploitant plateforme | Choix produit assumé |

---

## CONTRÔLE ARCHITECTURAL FINAL (directive du commanditaire — 14/11/2026)

Revue indépendante exécutée par trois agents de revue distincts (WhatsApp+n8n, Drive+Document AI/Finances, Polar+Resend+Azure), corrections appliquées dans la foulée, chaque écart corrigé avec preuve file:line. Registre documentaire mis à jour : `docs/TECHNICAL_DOCUMENTATION_REVIEW.md` (relecture EN DIRECT des pages officielles Polar events + delivery le 14/11/2026).

### 1. Architecture — conformité vérifiée ligne par ligne

| Verrou | Verdict | Preuve |
|---|---|---|
| **Google Document AI = unique moteur OCR** | CONFORME après correction | `connectors/document-ai.ts` (REST `processors:process` réel) ; **le repli VLM (`glm-4.5v`) a été SUPPRIMÉ** de `parse.ts` (il constituait un moteur OCR alternatif — directive §2) ; recherche exhaustive : plus aucun appel vision OCR dans src/ ; indisponibilité → `docai_non_configure` → `A_VERIFIER` + `ERREUR_DEFINITIVE` + reprise/correction manuelle |
| **Azure AI Foundry = IA générale (jamais OCR)** | CONFORME | `ai/provider.ts` : contrat `/openai/deployments/{d}/chat/completions?api-version=…` + `api-key` ; repli GLM explicite journalisé (`[ai] fournisseur=…`) ; aucun appelant ne passe d'image ; l'agent ne fait jamais d'OCR |
| **Neon PostgreSQL = prod** | CONFORME (prêt) | Schéma portable, migrations baseline `0_init`, `.env.example` Neon ; exécution réelle dépend E6 |
| **Resend = e-mails** | CONFORME après extension | `connectors/resend.ts` (API réelle) ; **le webhook Polar envoie désormais des e-mails** d'abonnement (activation/reprise/past_due/pause/résiliation) via Resend quand configuré + notification in-app + audit |
| **Polar = paiement/abonnement** | CONFORME après correction | **Connecteur Stripe + route `/api/webhook/stripe` SUPPRIMÉS** ; provisioning/UI/i18n/plateforme basculés sur POLAR (bug d'UI corrigé au passage : `stripeConfigured` inexistant désactivait définitivement les boutons d'achat) ; webhook Polar : claim atomique AVANT application (double-crédit TOCTOU éliminé), échec → réversion + 500 (relivraison Polar 10× doc officielle), événements alignés sur la doc relue en direct (`paused`, `uncanceled`, `cycled` conditionné à `status`), `purgeScheduledAt` à la résiliation |
| **n8n = automatisation** | CONFORME après correction | **Mismatch d'en-têtes corrigé** (`x-hesy-*` → `x-hesyd-*`) : le contrat signé n8n→HESYD était mort, tout appel conforme était rejeté 403 ; workflows exportés conformes, aucune simulation |
| **WhatsApp Business Cloud API** | CONFORME après durcissement | Signature vérifiée **AVANT toute écriture** (403 sec, plus d'écriture non authentifiée) ; lot traité en entier (un échec ne perd plus les messages suivants) ; appairage limité côté serveur (10 codes/15 min/expéditeur, persistant en base via `WebhookEvent.senderId`) ; limite officielle Groups API documentée (rattachement par correction web) |
| **Google Drive = propriété client** | CONFORME après correction | **Destination d'archivage unique** (`storage/destination.ts`) : pipeline + correction + reprise écrivent toutes dans le Drive du CLIENT (scope `drive.file`, tokens chiffrés AES-256-GCM par organisation, confirmation par relecture API) — correct/retry contournaient le Drive avant correction ; repli local uniquement hors Drive connecté (honnête, distinct) ; aucune migration automatique vers un stockage HESYD ONE |
| **Google OAuth ≠ Google Drive** | CONFORME | Deux intégrations distinctes : login `openid email profile` (PKCE) vs Drive `drive.file` (`access_type=offline`, `prompt=consent`) |

### 2. Corrections d'architecture exécutées (toutes réelles, vérifiées lint+tsc)

1. Suppression du fallback OCR ML (`parse.ts` — directive §2).
2. Suppression complète de Stripe (connecteur, webhook, UI, provisioning, i18n, docker-compose, README).
3. Webhook Polar : idempotence financière concurrente, 500 sur échec, événements officiels, transactions, audit, e-mails Resend, purge post-résiliation.
4. Webhook WhatsApp : signature avant écriture, lot complet, anti force brute persistant, message honnête.
5. n8n : contrat signé réellement applicable (en-têtes alignés).
6. Drive : destination unique client-possédée pour les trois voies d'archivage.
7. Base dev migrée : lignes `STRIPE` → `POLAR` (`IntegrationConnection`, 3 lignes) ; colonne `WebhookEvent.senderId` ajoutée (migration additive).

### 3. Statuts d'intégration (5 niveaux, preuves séparées — jamais transformés sans preuve)

| Intégration | Implémentée | Configurée (identifiants réels) | Connectée (service externe) | Testée (service réel) | Validée (production) |
|---|---|---|---|---|---|
| Google Document AI (OCR) | OUI (`connectors/document-ai.ts`, REST réel) | NON — E2b (`GOOGLE_DOC_AI_*` + compte de service absents) | NON | NON | NON |
| Azure AI Foundry (IA) | OUI (`ai/provider.ts`, contrat data plane) | NON — E8 | NON | NON (GLM runtime sandbox réel et journalisé) | NON |
| Neon PostgreSQL | Schéma + migrations prêts | NON — E6 | NON | SQLite dev réel ; Neon NON | NON |
| Resend | OUI (`connectors/resend.ts`) | NON — E4 | NON | NON | NON |
| Polar | OUI (checkout + webhook idempotent) | NON — E3 | NON | Contrats vérifiés par lecture doc en direct ; service réel NON | NON |
| n8n | OUI (contrat signé + 2 workflows exportés réels) | NON — E5 | NON | NON (scheduler in-process réel et actif) | NON |
| WhatsApp Business Cloud API | OUI (webhook signé, médias Graph, appairage) | NON — E1 | NON | NON | NON |
| Google Drive API | OUI (OAuth + upload + confirmation) | NON — E2 | NON | NON | NON |
| Storage local (repli déclaré) | OUI | OUI (fs réel) | OUI | OUI (preuves fs.stat+sha256 en base) | Sandbox seulement |

**Aucun statut n'a été transformé sans preuve** : chaque « NON » est un blocage externe enregistré (E1–E8), aucune simulation ne le masque.

---

## MISSION FINALE — FINALISATION INTÉGRALE ET LIVRAISON (14/11/2026, après-midi)

Méthode : audit indépendant à **quatre agents** (sécurité des 63 routes API, conformité architecturale des connecteurs, UI/UX des 13 vues, modèle de données/pipelines) → corrections autonomes hiérarchisées P1→P3 → vérification navigateur réelle + batterie de sécurité API. Registre détaillé par correction (file:line) : `docs/TECHNICAL_DOCUMENTATION_REVIEW.md` §8.

### Verdict de l'audit d'entrée

- **Aucun P0** : pas de violation architecturale (Document AI = unique OCR confirmé exhaustivement — plus aucun appel vision dans src/ ; Stripe totalement absent ; Polar idempotent atomique ; isolation multi-tenant systématique par `organizationId` dérivé de la session).
- 1 P1 (en-têtes HMAC `x-hesy-*` de `POST /api/health` — contrôle inopérant), 1 P1 UI (jauge crédits /500 en dur), ~15 P2, ~20 P3. **Tous les P1/P2 corrigés dans cette session** ; P3 priorisés corrigés également.

### Corrections livrées (toutes vérifiées tsc 0 erreur + lint 0 erreur + exécution)

| Domaine | Corrections |
|---|---|
| Sécurité | Tick externe signé réparé (`x-hesyd-*`) ; codes d'appairage `crypto.randomInt` + unicité globale ; gardes de rôle (PATCH automatisations, révocation appairage) ; Drive authorize non destructif (refresh token préservé) + callback résolu par state sur toutes les lignes en attente (fin de la course inter-organisations) ; option `vision` du provider IA supprimée (vecteur OCR alternatif) ; injection CSV neutralisée ; Host-header hardening (`app_url_requise_en_production`) ; bornes import (10 Mo / 5 000 lignes) + MIME audio ; rate limit sur la consommation des jetons de réinitialisation ; CSP + XFO + nosniff + Referrer-Policy + Permissions-Policy applicatifs ; `ignoreBuildErrors: false` |
| Intégrité des données | Déduplication applicative sans groupe (NULL SQLite) ; `rawPath` réel utilisé par correct/retry (plus de `matiere_premiere_absente` après assainissement de nom) ; unicité code groupe en contrainte DB + P2002 géré ; 12 index de performance ; champs morts supprimés ; limites de plan appliquées (maxClients/maxGroups/minIntervalMinutes) ; devise inconnue = `XXX` ISO |
| Audit & purge | Journalisation ajoutée : réinitialisation MDP, demande de reset, MFA enable/disable, connexions (+MFA), génération de livrables ; purge étendue aux payloads WhatsApp, tâches agent, approbations, livrables physiques, opérations financières, imports, jetons OAuth avec garde `path.relative` stricte ; archives Drive du client explicitement conservées (compteur distinct, message honnête) |
| UI/UX | Jauge sur le quota réel du plan (`planMonthlyCredits` de la session) ; **espace légal réel** (À propos / CGU / Confidentialité, FR/EN, contenu décrivant les sous-traitants effectivement implémentés) ; actions masquées par rôle dans 5 vues (fin des 403 prévisibles) ; i18n des statuts d'exécution + actions d'audit (parité FR/EN) ; état d'erreur réel du tableau de bord ; langue du profil appliquée + `<html lang>` dynamique ; onboarding réservé aux rôles capables ; codes d'erreur serveur traduits |
| Facturation honnête | Facture d'abonnement créée uniquement avec le montant réel du payload Polar (plus de 0 € « PAYEE ») |
| Écosystème | État plateforme : Resend/Document AI/Azure affichés (vestige SMTP supprimé) ; workflow d'export n8n aligné sur le contrat signé réel |

### Vérifications d'exécution (preuves)

- `bunx tsc --noEmit` : **0 erreur** · `bun run lint` : **0 erreur** · serveur redémarré : `/api/health` 200.
- **Parcours navigateur réels** (agent-browser) : inscription réelle → onboarding (client+groupe) → dépôt PDF réel → classification Facture → **archivage avec preuve** (`fs.stat confirmé : 374 octets · sha256 re-vérifié · chemin Client/Groupe/Catégorie/Année/Mois`) → cachet ARCHIVÉ → extraction financière automatique (459,99 € « À vérifier ») → **validation humaine → VALIDÉ** → vue d'ensemble (compteurs réels, jauge 498/500) → CGU/Confidentialité réelles → navigation mobile (390 px) fonctionnelle.
- **Batterie de sécurité API (16 contrôles, exécutés en direct)** : 401 anonyme sur API métier · 403 sur `health`/`tick` sans signature · 403 signature invalide · 503 honnête webhooks WhatsApp/Polar sans identifiants (fail-closed) · **isolation cross-tenant** : liste invisible, PATCH 400, DELETE 400 sur les ressources de l'autre organisation · PATCH automatisations anonyme 401 · console plateforme 403 pour un non-opérateur. **16/16 conformes.**
- Journal serveur : **aucune erreur runtime**.

### État final par intégration (5 niveaux — inchangés sans preuve nouvelle)

| Intégration | Implémentée | Configurée | Connectée | Testée (réel) | Validée (prod) |
|---|---|---|---|---|---|
| Google Document AI (OCR) | OUI | NON (E2b) | NON | NON | NON |
| Azure AI Foundry (IA générale) | OUI (texte uniquement) | NON (E8) | NON | NON (GLM repli journalisé) | NON |
| Neon PostgreSQL | Schéma + migrations prêts | NON (E6) | NON | SQLite dev réel | NON |
| Resend | OUI | NON (E4) | NON | NON | NON |
| Polar | OUI | NON (E3) | NON | Contrats vérifiés par lecture doc | NON |
| n8n | OUI (contrat signé + workflows conformes) | NON (E5) | NON | NON (scheduler in-process réel actif) | NON |
| WhatsApp Business Cloud API | OUI | NON (E1) | NON | NON | NON |
| Google Drive API | OUI | NON (E2) | NON | NON | NON |
| Stockage local (repli déclaré) | OUI | OUI | OUI | **OUI — preuves fs.stat+sha256 en base** | Sandbox |

### Reste ouvert (inchangé, bloqué externe)

E1–E8 (identifiants externes), build VPS (E7 — interdit dans cette sandbox), upload Drive resumable (P2, avant production Drive), RLS PostgreSQL (dépend E6), jeu d'évaluation Promptfoo (hors sandbox).

### Dépôt git

- `.env`, `.zscripts/`, `.initial_snapshot.json` **retirés du tracking** et ignorés (le `.env` committé ne contenait que `DATABASE_URL` local — aucun secret ; corrigé par précaution).
- `.gitignore` réorganisé : secrets en tête, métadonnées sandbox, données réelles locales.
- Pousse vers GitHub avec un token d'accès **jamais écrit dans le dépôt** ; rotation du token recommandée après usage.

---

## 15. Session refonte complète + finalisation (14/11/2026, après-midi)

**Objectif utilisateur :** installer 4 skills demandés, finaliser l'application, l'améliorer et mener une refonte complète. Méthode : audit parallèle par 3 agents (UI, sécurité backend, conformité design) puis corrections par 4 agents parallèles sur domaines indépendants, conformément au skill `dispatching-parallel-agents`.

### 15.1 Correctifs issus de l'audit (preuves)

| Priorité | Constat | Correctif | Preuve |
|---|---|---|---|
| **CRITIQUE** | `src/app/api/files/upload/route.ts` supprimé du working tree mais encore appelé par `files-view.tsx:281` → 404 sur tout dépôt web (régression non commitée post-datant l'audit 16/16) | Route restaurée depuis git (`git checkout --`) | Dépôt PDF réel via navigateur → **archivage confirmé** (voir 15.3) |
| HAUT | 2 violations a11y : `span[role=button]` imbriqué dans `<button>` (deliverables, automations) | Restructurés en boutons frères avec stopPropagation | HTML valide, navigation clavier préservée |
| HAUT | 5 Dialogs centraux contrevenaient au système de design (détail finances, correction finances, génération livrables, geste plateforme, + auth oubli conservé) | Convertis en Sheets latérales | Navigateur : détail + création opération en Sheet fonctionnels |
| HAUT | États d'erreur manquants : `apiGet` null → squelettes infinis (files, inbox, clients, groups, 5 onglets admin, assistant) | Composant partagé `EtatErreur` (retry réel) branché sur 10+ points | Code + lint vert |
| MOYEN | Flash d'état vide au premier chargement (deliverables, approvals, automations, imports) | Drapeau `loaded` + squelettes | Code |
| MOYEN | Progrès d'upload simulé par `setInterval(1400ms)` (fausse progression — interdite) | Supprimé → état honnête « Dépôt en cours… » sans étapes fabriquées | Capture navigateur pendant dépôt réel |
| MOYEN | Pas de rate limit sur les routes IA coûteuses | `AGENT_CHAT` 40/5 min, `VOICE_TRANSCRIBE` 12/5 min, `DELIVERABLES_POST` 20/15 min (clés `{orgId}:{userId}`, 429 avec `retryAfterSeconds`) | Code, même contrat que register |
| MOYEN | Commentaire obsolète `rate-limit.ts` (`WEBHOOK:{provider}` inexistant) | Corrigé : documente la réalité (webhooks = signature + idempotence fournisseur, pas de fenêtre) | Code |
| MOYEN | Fuite i18n ×3 (`réception …`, aria-label « Sections », libellés catégories) + select natif inbox | `t()` partout + shadcn Select (`inbox.reception_prefix`, `nav.sections` ajoutés fr/en) | Code |
| MOYEN | `Pill` copiée-collée dans 5 vues | Extraite vers `src/components/app/pill.tsx`, 5 imports | Code |
| BAS | Code mort (app-shell `itemActif`/`navKey`, inbox `correctOpenFileId`), `color:"white"` en dur ×3, retry par `location.reload()`, magie `50` | Supprimés/tokenisés/extrait (`AUDIT_PAGE_SIZE`) | Code |

### 15.2 Refonte design system (fondations)

- `globals.css` réécrit : **tous les tokens exposés en utilities Tailwind** (`bg-papier`, `text-encre-2`, `bg-cachet`, `border-bordure`, `bg-voile`, `text-erreur`…) via `@theme inline` — fin des ~198 usages arbitraires `bg-[var(--…)]` dans les fichiers refondus ;
- **Échelle typographique du registre** tokenisée (`text-meta` 13 · `text-corps` 16 · `text-section` 20 · `text-titre` 25 · `text-page` 31 · `text-hero` 39) ;
- **Courbes de mouvement** : `ease-out`/`ease-in-out` Tailwind redirigés vers les courbes du système (`cubic-bezier(0.25,1,0.5,1)` — extension du token, pas de fork, conformément au skill `animate`), ajout `ease-drawer` iOS-like pour les Sheets ; durées tokenisées (`--duree-retour/etat/mise-en-page/cachet`) ;
- `--rayon` + `--destructive-foreground` (clair et sombre) définis — corrige le contraste cassé des toasts destructifs en thème clair ;
- **Cibles tactiles ≥ 44px** sur `pointer: coarse` (rule globale) + bases boutons/inputs passées à 40px ;
- `prefers-reduced-motion` complété (`animation-iteration-count`, délais, scroll-behavior) ;
- `tailwind.config.ts` mort (wrappers `hsl(oklch)` invalides, jamais chargé en v4) **supprimé** ;
- Primitives shadcn alignées : `transition-all` ×8 → propriétés nommées, `bg-black/50` ×4 → `bg-voile`, `text-white` ×2 → `text-primary-foreground`, `red-*` toast → tokens erreur, Sheet 500ms → 300ms `ease-drawer` ;
- Entrée de vue sobre (`vue-entree` 220ms opacité+6px, transform+opacity uniquement) au changement de vue via `key` sur `<main>`.

### 15.3 Refonte landing + métadonnées sociales

- Landing tokenisée (utilities + échelle typo), révélation 500→400ms, corps 15,5→16px conformes au spec ;
- **Image OG native** `src/app/opengraph-image.tsx` (1200×630, ImageResponse) : polices Fraunces 600 / Instrument Sans 400 **instanciées en TTF statique** depuis @fontsource-variable (fontTools, OFL) vers `public/fonts/` — satori refuse les woff2 variables ; `<text>` SVG remplacé par des rects ; rendu vérifié : `GET /opengraph-image 200` PNG 61 Ko on-brand ;
- `layout.tsx` : `metadataBase` (env `PUBLIC_BASE_URL`/`APP_URL`), template de titre, OpenGraph (fr_FR), Twitter card, robots.

### 15.4 Correctif UX découvert en vérification navigateur

- **Le wizard « Mise en service » se rouvrait** après toute actualisation de session tant que l'onboarding était incomplet (dépendance d'effet à l'identité de `session`). Garde ajoutée : après fermeture explicite, il ne se rouvre plus avant rechargement de page. Vérifié en direct.

### 15.5 Vérifications d'exécution de la session (preuves navigateur réelles)

- `npx tsc --noEmit` : **0 erreur** · `bun run lint` : **0 erreur, 0 warning**.
- Parcours exécutés via agent-browser : inscription réelle (org « Registre Test ») → wizard → clients (client « Général » du provisioning, pill Actif) → **dépôt PDF réel** → état honnête « Dépôt en cours… » → **ARCHIVÉ avec preuve** (`fs.stat confirmé · 921 octets · sha256 re-vérifié après écriture`, chemin Client/Groupe/Catégorie/Année/Mois) → fiche détail : chaîne de garde Reçu→Classé→Archivé→Indexé horodatée, champs extraits (référence/montant/date, confiance 100 %) → **opération financière extraite automatiquement** (1 250,00 € « Extraite », jamais auto-confirmée) → création manuelle en Sheet → « À vérifier » → console opérateur : intégrations honnêtes « Identifiants requis » + variables exactes listées → mobile 390 px (nav scrollable, bordereau adapté) → thème sombre « encre » cohérent.
- Refus MIME honnête vérifié : `.txt` → `mime_refuse:application/octet-stream` (validation serveur réelle, toast clair).
- Crédits réels décomptés : 500 → 498 après traitement du document.
- Image OG : 200, PNG 1200×630.
- Journal serveur : aucune erreur runtime après corrections.

### 15.6 État global inchangé

Les statuts d'intégration du §14 restent inchangés : aucune donnée externe nouvelle n'a été fournie ; rien ne passe de « non configuré » à « connecté » sans preuve réelle. La refonte est strictement UI/UX + durcissement + correctifs — l'architecture et les décisions techniques verrouillées n'ont pas été modifiées.

### 15.7 Durcissement des dépendances (même session)

- **6 paquets entièrement inutilisés supprimés** (usage vérifié par recherche d'imports) : `@reactuses/core`, `react-syntax-highlighter`, `@mdxeditor/editor`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` — élimine les chaînes vulnérables js-cookie (high) et prismjs ;
- **sharp 0.34.3 → 0.35.5** : corrige les 3 advisories high (libvips CVE-2026-33327/33328/35590/35591, libheif, librsvg) ;
- **next 16.1.x → 16.4.6** + **react/react-dom alignés exactement 19.3.1** (le désalignement causait des 500 au démarrage — résolu par cache `.next` vidé et redémarrage) : élimine les 4 CVE critiques RCE Next.js ;
- `bun update` global (dans les ranges) ;
- **Audit : 101 vulnérabilités (4 critiques, 56 high) → 35 (0 critique, 23 high).** Les 23 restantes sont transitives et bornées par les upstream — chaînes dev-only (eslint → flatted/browserslist/brace-expansion, prisma CLI → defu/deepmerge-ts) ou portée runtime non exploitable dans ce produit (exceljs → archiver → glob sur chemins de zip ; recharts → lodash interne). **Aucun correctif disponible sans montée majeure cassante** ; à reprendre lors des prochaines montées de version d'upstream.
- Corrections lint rendues nécessaires par eslint-plugin-react-hooks 7.1.1 (règle `set-state-in-effect` durcie) : frontières microtask/rAF vérifiées par sondes empiriques (onboarding-wizard, carousel vendu, loaders admin/files/platform), `useSyncExternalStore` pour `use-mobile`, reset de page déplacé dans le handler de recherche (platform-view), justification en ligne pour la redirection OAuth pleine page (auth-view). `bun run lint` : 0 erreur, 0 warning ; `npx tsc --noEmit` : 0 erreur.

## 16. Session refonte haute gamme + durcissement sécurité (14/11/2026, soirée)

### 16.1 Audit sécurité exhaustif (62 routes API, lecture seule, agent dédié)

**Verdict : 0 faille CRITIQUE d'authentification, 0 IDOR.** 62 fichiers `route.ts` lus intégralement + primitives (`auth.ts`, `rate-limit.ts`, `signed-links.ts`, `auth-tokens.ts`, `platform.ts`, connecteurs, stockage, agent). Bilan : 45 routes en session, 10 publiques de flux d'authentification, 2 webhooks signés (Polar Standard Webhooks, WhatsApp X-Hub-Signature-256), `scheduler/tick` + `health POST` signés HMAC n8n, `plans`/`/api`/`health GET` publics sans donnée métier. Les 11 familles de routes `[id]` filtrent toutes `id` **et** `organizationId`. Signatures webhooks vérifiées **avant toute écriture**, idempotence atomique par contrainte unique DB. Points forts confirmés : scrypt + `timingSafeEqual` systématiques, sessions DB token haché SHA-256, secrets AES-256-GCM au repos, liens signés HMAC TTL 24 h, anti-traversal `path.relative`, quotas serveur réels, verrouillage de connexion persisté.

**Failles corrigées dans la foulée (preuves code) :**

| Priorité | Faille | Correctif appliqué |
|---|---|---|
| **MAJEURE** | Élévation de privilège via appairage WhatsApp : code EN_ATTENTE visible par LECTEUR (`whatsapp/pairing/route.ts`) + agent exécuté avec le rôle du créateur du code | `code` masqué pour LECTEUR ; `tryPairByCode` recontrôle le rôle du membership au moment de l'appairage (code de LECTEUR → jamais ACTIF) ; `resolvePairingRuntime()` relecture du rôle réel à chaque message, garde LECTEUR de `runner.ts` appliquée |
| MINEURE | Import XLSX non plafonné (DoS par ADMIN) | `rows.slice(0, 5000)` symétrique au CSV |
| MINEURE | Fuite de messages d'infrastructure (`Prisma`, chemins, stack) via `api.ts` | Liste noire `INFRA_ERROR_PATTERNS` → `erreur_interne` 500 + `console.error` serveur ; codes métier snake_case préservés (80+ sites i18n dépendants) |
| MINEURE | Replai d'idempotence Polar faible (`raw.length`) | SHA-256 du corps brut tronqué 32 hex quand `webhook-id` absent |
| MINEURE | Route index `/api` « Hello, world! » inutilement exposée | Manifeste neutre `{"service":"hesyd-one","status":"ok"}` |
| MINEURE | Branche consommation de token `verify-email` sans débit | `consumeRateLimitWindow("VERIFY_TOKEN:<ip>", 10/15 min)` avant `consumeAuthToken` |

(Énumération de comptes register/login : trade-off documenté conservé — commentaire existant.)

### 16.2 Audit UI/UX des 4 espaces (agent dédié, ~13 700 lignes) + refonte appliquée

Scores avant refonte : **A public 9/10 · B organisation 7,5/10 · C invité 8/10 · D super-admin 7,5/10** ; parité i18n vérifiée 928/928 clés fr/en. Corrections appliquées par 4 agents parallèles (périmètres de fichiers disjoints) :

- **Composants partagés nouveaux** : `EtatVide` (icône fine encadrée + titre + CTA, même vocabulaire que `Cachet`/`EtatErreur`) adopté par les 13 vues ; token `--ombre-cachet` (clair+sombre) exposé en utility `shadow-cachet` — fin des ombres rgba hardcodées ;
- **Ossature** (`app-shell`) : header `bg-background` opaque (fin du glassmorphism contraire au système), h1 `text-section`, **profil et jauge de crédits accessibles mobile** (avatar 44 px + jauge fine dans la nav mobile), ARIA complet des jauges (`aria-valuemin/max`, libellés), commutateurs d'espaces `role="group"`+`aria-pressed`, nav mobile `<nav aria-label>`+`aria-current` ;
- **Registres** (clients/groups/files) : sémantique `role="row"`/`role="cell"`/`role="columnheader"` homogène (modèle imports/platform), bouton réel dans la cellule nom (action au clavier, clic pleine ligne conservé) ;
- **États harmonisés** : `EtatErreur` remplace les 3 états d'erreur artisanaux (overview, finances, platform) ; `Skeleton` structurés au gabarit réel remplacent les `animate-pulse` bruts (inbox, approvals, imports) ; `EtatVide` partout (icônes Lucide adaptées par domaine) ;
- **Micro-feedback** : suspendre/activer clients & groups obtiennent `pendingId` + spinner + toast (modèle automations) ;
- **A11y ciblée** : `thin-scroll` (classe inexistante) → `scroll-fin` ×3, tabs admin `aria-controls`+`role="tabpanel"`×6, badge notifications annonce les non-lus, `Chaîne de garde` i18nisé dans `Cachet`, jeton d'invitation masqué (`inv-…••••`, copie complète intacte) ;
- **Convergence typographique** : échelle du registre appliquée aux titres de vue (`text-section font-display`) et aux tailles arbitraires listées ; micro-labels de densité conservés et documentés (1 commentaire par fichier) ;
- **Espace public** : CTA « Essai » visible mobile (version compacte), ombres tokenisées, `<img>` → `next/image` (sceau 1024×1024 mesuré, `sizes`+`priority` au hero) ;
- **Palette de commandes enrichie** : bascule thème + langue + déconnexion branchés sur mécanismes réels (aucune action fictive).

### 16.3 Régression CRITIQUE découverte et corrigée en vérification

`src/app/api/files/upload/route.ts` **à nouveau absent du working tree** (suppression jamais commitée post-§15, la restauration précédente n'avait pas survécu) alors que `files-view.tsx:279` appelle `POST /api/files/upload` → **404 sur tout dépôt web**. Restaurée depuis `git HEAD` et **commitée** pour rendre la régression impossible. Dépôt réel re-vérifié au navigateur (16.4).

### 16.4 Vérifications d'exécution de la session (preuves navigateur réelles)

- `npx tsc --noEmit` : **0 erreur** · `bun run lint` : **0 erreur, 0 warning** (après exclusion `.claude/**` des skills installés).
- Parcours exécutés via agent-browser : landing (footer bas de page naturel, header sticky) → **inscription réelle** (« Org Verification », 500 crédits d'essai) → wizard 5 étapes → Clients (client « Général » provisioning, pill Actif) → Finances (cartes VALIDÉ/À VÉRIFIER/EXTRAIT honnêtes à 0, `EtatVide` + CTA) → Fichiers (`EtatVide` + CTA) → **dépôt réel** `facture-test.txt` → **archivage confirmé** (fs.stat + sha256 re-vérifié, chemin Client/Groupe/Catégorie/Année/Mois) → fiche détail : classification « Facture fournisseur · Confiance 100 % », résumé IA, chaîne de garde horodatée Reçu→Classé→Archivé→Indexé, champs extraits (date/montant/émetteur à 100 %) → **crédits réellement décomptés 500 → 408** → mobile 375 px (avatar profil, jauge crédits, nav horizontale) → thème sombre « encre » cohérent → **aucune erreur console**.
- L'intégralité du parcours produit promis (dépôt → classification → archivage prouvé → extraction financière jamais auto-validée) fonctionne en réel.

### 16.5 État global inchangé

Les statuts d'intégration des §14-15 restent inchangés : aucune donnée externe nouvelle fournie, rien ne passe à « CONNECTÉ » sans preuve réelle. La refonte est UI/UX + sécurité + correctifs — architecture et technologies verrouillées intactes (Google Document AI unique OCR, Azure AI Foundry GLM explicite textuel, Drive honnête, Polar, Resend, n8n, WhatsApp Cloud API).

### 16.6 Résiduels documentés (passe 2 possible)

- Micro-labels `text-[10.5–12.5px]` restants hors périmètre refondu (documentés par commentaire) ;
- Navigation clavier ←/→ des tabs admin (aria-controls posé) ;
- `document.title` par vue (SPA) ;
- Observation fonctionnelle préexistante : premier appairage d'un numéro WhatsApp neuf non reconnu par `tryPairByCode` (garde `findActivePairingByPhone` précède) — à qualifier séparément si le parcours « premier appairage » est attendu ;
- 23 vulnérabilités transitives dev-only (cf. §15.7) bornées par upstream.
