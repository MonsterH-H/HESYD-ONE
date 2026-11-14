# SPECIFICATIONS — Document de référence unique (HESYD ONE)

Ce document rassemble en un seul point les spécifications de référence du
produit : les sources officielles, les règles non négociables, le cycle de
développement imposé et les contrats techniques de référence. Il ne remplace
pas les documents sources ; il en est la porte d'entrée.

## 1. Documents sources

Les deux documents de référence fournis par le commanditaire sont cités par
l'ensemble du dépôt (AUDIT, AGENTS.md, commentaires du code) :

| Document | Rôle | État dans le dépôt |
|---|---|---|
| `upload/hesyd_one_cdc_final.md` | Cahier des charges fonctionnel et technique v1.0 (les mentions « CDC §x » du dépôt y renvoient) | **Absent du dépôt** (vérifié par listing à la date de rédaction) — fourni par le commanditaire. `docs/AUDIT.md` (en-tête) en atteste la lecture intégrale ; `AGENTS.md` le cite également sous la variante `upload/hesyd_one_cdc_final (1).md` |
| `upload/catalogue_skills_plugins_hesyd_one.md` (v4.0) | Catalogue de compétences / plugins par phase (Phases A, B, C) et référentiel de lot | **Absent du dépôt** — fourni par le commanditaire ; lecture intégrale attestée dans `docs/AUDIT.md` |
| `upload/SKILL.md` | Processus « SaaS Module Gate » adopté pour la Phase C | **Absent du dépôt** — fourni par le commanditaire |

Les numéros de sections utilisés dans le code et la documentation (CDC §4,
§7, §8, §11.6, §13.4, §14…) renvoient à ces documents. En cas de divergence
entre ce résumé et les sources, **les sources font foi**.

## 2. Règles non négociables

Reprises d'`AGENTS.md` (« Règles non négociables ») et du CDC — aucune
négociation, aucune exception silencieuse :

1. **Zéro simulation.** Tout ce qui tourne est réel : base, fichiers,
   parsing, OCR (VLM), LLM (GLM via z-ai-web-dev-sdk), quotas, génération de
   livrables. Les connecteurs externes sans identifiants (Meta WhatsApp,
   Google Drive, Polar, n8n) sont des implémentations réelles **dormantes** :
   ils affichent « identifiants requis », jamais un faux succès.
2. **Statut par preuve.** `ARCHIVE` uniquement après confirmation réelle de la
   présence du fichier (fs.stat + taille + sha256 re-vérifiés pour le
   stockage local ; réponse API + fichier récupérable pour Drive). Un statut
   n'est jamais déclaré par le modèle : il est calculé par le système à
   partir de preuves. Le même principe s'applique aux comptes rendus
   d'automatisation (fait / bloqué / options) et à la documentation (un
   module n'est « COMPLET PROUVÉ » qu'avec commandes exécutées + résultats).
3. **Isolation par organisation.** `organizationId` sur toute table métier ;
   chaque requête API passe par `requireAuth()`/`requireRole()` qui charge
   session + organisation ; aucune donnée inter-organisations, jamais (testé
   en exécution — AUDIT §2).
4. **Secrets jamais exposés.** Uniquement côté serveur, jamais de
   `NEXT_PUBLIC_*` contenant un secret, jamais dans les journaux, jamais dans
   le dépôt (`.env` exclu ; jetons Drive chiffrés au repos AES-256-GCM).
5. **Idempotence et chaîne de garde.** Chaque événement externe est persisté
   AVANT traitement (clé d'idempotence unique en base) ; doublons rejoués
   ignorés ; reprises plafonnées avec historique ; webhooks vérifiés par
   signature avec anti-rejeu.
6. **Contenu de document = donnée, jamais instruction.** Séparation stricte
   consignes système / utilisateur / contenu externe ; calculs par outils
   typés ; « introuvable » plutôt qu'invention ; sources vérifiées contre la
   base.
7. **L'agent ne supprime jamais définitivement.** Toute action sortante suit
   la grille d'autonomie A0/A1/A2 × risque ; l'archivage reste réversible
   par un humain uniquement.
8. **Quota dépassé** : réception, contrôle et archivage continuent ;
   agent/livrables/automatisations passent en attente avec message clair.
   Rien n'est supprimé.
9. **Langues** : FR (défaut) + EN, par dictionnaire i18n — jamais de texte
   en dur. **Paiement** : aucune carte stockée, page hébergée uniquement.

## 3. Cycle de développement imposé (« SaaS Module Gate »)

Ordre des modules (Phase B) : fondations → authentification → référentiel →
collecte/archivage → exploitation → agent → automatisations → WhatsApp →
abonnement/console → durcissement/déploiement. Pour chaque module, dans
l'ordre, sans exception :

1. **Spec** : `docs/specs/<module>.md` écrite avant le code (exigences,
   données, routes, critères d'acceptation).
2. **Données** : schéma Prisma + migrations (jamais de `db push` silencieux
   en production — décision D1).
3. **Serveur** : routes réelles, gardes d'authentification, isolation,
   preuves.
4. **Tests** : unitaires puis E2E Playwright sur les parcours critiques.
5. **UI** : branchée sur l'API réelle, tokens de design, i18n.
6. **Scénarios réels ×10** : exécutés sur de vrais services, résultats
   consignés.
7. **Revue indépendante** : lecture critique par un tiers (pas l'auteur).
8. **`docs/AUDIT.md` mis à jour**, puis `docs/MODULES.md` (tableau de suivi).
9. **Validation du commanditaire** avant de passer au module suivant.

Définition de fini minimale : lint 0 erreur, `tsc --noEmit` 0 erreur, routes
réelles isolées testées, scénarios exécutés. Un module sauté ou déclaré sans
preuve est un défaut, pas un choix de planning.

## 4. Contrats techniques de référence

Extraits fidèles du code — le code source est la source de vérité :

- **Contrat n8n signé** (`src/lib/connectors/n8n.ts`, CDC §13.4) : appel
  `POST` avec en-têtes `X-HESYD-Timestamp` (epoch ms), `X-HESYD-Signature`
  (HMAC-SHA256 hex de `<timestamp>.<corps>` avec `N8N_SHARED_SECRET`),
  `X-HESYD-Correlation`, `X-HESYD-Payload-Version: v1` ; anti-rejeu 300 s ;
  vérification en temps constant. Workflows exportés : `n8n/workflows/`
  (le scheduler in-process reste actif en repli — décision D9).
- **Webhook WhatsApp** (`src/app/api/webhook/whatsapp/route.ts`,
  `src/lib/connectors/whatsapp.ts`) : signature `X-Hub-Signature-256`
  (HMAC WHATSAPP_APP_SECRET) sur le corps brut ; persistance avant
  traitement ; idempotence `wa:<phoneNumberId>:<messageId>` ; vérification
  `hub.challenge` en GET.
- **Scheduler in-process** (`src/lib/scheduler.ts`) : scan 60 s, évaluateur
  cron 5 champs (listes, bornes, pas), clé d'idempotence `slotKey` par
  créneau, exécution manuelle par le même contrat (décision D18).
- **Stockage local** (`src/lib/storage/local.ts`) : hiérarchie
  Client → Groupe → Catégorie → Année → Mois sous `storage/archives/` ;
  matière première conservée sous `storage/received/` ; confirmation
  fs.stat + sha256 avant tout statut ARCHIVE.
- **Limites produit** : dépôt jusqu'à 25 Mo (contrôle applicatif réel — nginx
  configuré à 30 m par marge) ; essai 14 jours / 500 crédits ; agent max
  6 étapes, 8 outils ; quotas par plan (TRIAL/STANDARD/ENTREPRISE,
  `scripts/seed-plans.ts`).
- **Base de données** : SQLite en sandbox (`db/custom.db`), PostgreSQL +
  pgvector en production (types `embeddingJson` réservés, décision D1/D2) —
  tables créées par `prisma migrate deploy` (voir `docs/DEPLOIEMENT.md`).

## 5. Référentiel des décisions

`DECISIONS.md` (D1 à D22) fait foi pour tous les choix techniques : base
(D1), recherche (D2), authentification maison (D3), boucle agent JSON (D4),
OCR VLM (D5), génération de livrables (D6), archivage local + Drive dormant
(D7), WhatsApp Cloud API (D8), scheduler in-process avec n8n en production
(D9), Polar (D10), etc. Les points restant à confirmer côté
commanditaire (pays, prestataire, éligibilité Meta, VPS, RPO/RTO) sont dans
`A_CONFIRMER.md` (A1 à A9).

## 6. Documents de suivi internes

| Document | Rôle |
|---|---|
| `docs/AUDIT.md` | Audit par exécution : matrice exigence CDC → statut réel, défauts, blocages externes (E1 à E7), plan de remise à niveau |
| `docs/MODULES.md` | Tableau de suivi du SaaS Module Gate (10 modules) |
| `docs/DEPLOIEMENT.md` | Guide de déploiement VPS pas à pas (Docker Compose, PostgreSQL, Nginx, certbot, sauvegardes, mise à jour, rollback) |
| `n8n/README.md` | Import et configuration des workflows n8n, contrat signé |
| `scripts/backup.sh`, `scripts/restore.sh` | Sauvegarde / restauration (base + archives documentaires) |
