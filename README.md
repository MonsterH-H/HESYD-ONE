# HESYD ONE

**Agent documentaire d'archives pour les organisations.** Recevez, classez, archivez et comprenez vos documents — avec preuve.

HESYD ONE reçoit vos documents (WhatsApp direct via l'API Meta officielle, dépôt web, dossier surveillé Drive), les identifie et les classe, les archive dans une hiérarchie réelle, puis répond à vos questions avec des sources citées et génère des livrables PDF / Excel / Word. **L'archivage n'est jamais déclaré : il est confirmé par une preuve technique.**

---

## Ce que fait le produit

| Capacité | Réalité exécutée |
|---|---|
| Collecte multicanale | WhatsApp direct (Meta Cloud API), dépôt web, dossier surveillé Drive |
| Classement et archivage | Hiérarchie Client → Groupe → Catégorie → Année → Mois ; statut `ARCHIVE` uniquement après preuve (fsstat, sha256 re-vérifié) |
| Compréhension documentaire | Lecture réelle des tranches indexées, OCR, extraction de champs, résumés |
| Questions-réponses sourcées | Réponse + fichiers + extraits ; chaque appel d'outil est prouvé (durée, requête SQL réelle) |
| Livrables | PDF, Excel, Word générés à la demande, sourcés, versionnés |
| Automatisations | Tâches programmées (cron) avec compte rendu honnête : fait / bloqué / options |
| Multi-organisation | Isolation stricte par `organization_id` : données, index, journaux, connecteurs |
| Chaîne de garde | Webhooks vérifiés (signature), déduplication, **persistance avant réponse**, reprise sur incident |

## Sécurité et confiance

- **Aucune suppression définitive** par l'agent — archivage réversible par un humain uniquement.
- **Aucun numéro de carte** stocké : le paiement passe par une page hébergée.
- **Journal d'audit** horodaté de chaque action sensible.
- **Secrets** exclusivement côté serveur (`GOOGLE_CLIENT_SECRET`, `WHATSAPP_TOKEN`, `N8N_SHARED_SECRET`…) — jamais `NEXT_PUBLIC_*`, jamais dans les journaux, jamais dans le dépôt.
- **Sessions** httpOnly, mots de passe scrypt (sel aléatoire), flux Google OAuth 2.0 avec PKCE (S256) et vérification d'état en temps constant.

## Authentification

- **E-mail + mot de passe** (scrypt) avec essai 14 jours sans moyen de paiement.
- **Double authentification (MFA TOTP, RFC 6238)** : compatible Google Authenticator, Aegis, 1Password ; connexion en deux étapes (mot de passe puis code à 6 chiffres).
- **Mot de passe oublié** : jeton à usage unique d'une heure ; toutes les sessions du compte sont révoquées à la réinitialisation.
- **Vérification d'adresse e-mail** : jeton 24 h ; sans service e-mail configuré, le lien est remis dans l'interface avec un libellé honnête (« mode sans e-mail ») — jamais d'envoi simulé.
- **Limitation des tentatives** : verrouillage progressif persisté en base (5 échecs → 15 min, doublement ensuite, plafond 24 h).
- **Google Sign-In** : flux OAuth 2.0 « authorization code » + PKCE côté serveur — `/api/auth/oauth/google` → consentement Google → `/api/auth/oauth/google/callback` (échange du code, userinfo OIDC, liaison ou création de compte + organisation d'essai).
- **Invitations** par jeton à usage unique avec expiration (`?invite=<token>`).

## Console opérateur de la plateforme

Les exploitants déclarés dans `PLATFORM_ADMIN_EMAILS` accèdent à un espace séparé, au-dessus des organisations : vue réelle de toutes les organisations (usage, stockage, crédits, activité), état global des services, file des demandes de résiliation, et gestes commerciaux journalisés et notifiés (prolonger un essai, octroyer des crédits, changer de plan, suspendre, réactiver, résilier avec attestation PDF, purger). Les transitions liées au paiement restent gouvernées par les webhooks signés uniquement.

## WhatsApp : appairage et réponse dans le canal

- **Appairage par code à usage unique** (15 minutes) : l'utilisateur génère un code dans son espace, l'envoie depuis son numéro ; le webhook appaire numéro → utilisateur → organisation. Un numéro non appairé reçoit une réponse d'accueil standard, sans aucune donnée.
- **Réponse de l'agent renvoyée sur WhatsApp** : la réponse finale (avec sources) et les accusés d'archivage (avec preuve) sont réellement envoyés dans le canal.
- Requiert les identifiants Meta (E1) pour l'exécution réelle — le code est complet et dormant, jamais simulé.

## Démarrage rapide

```bash
# 1. Dépendances
bun install

# 2. Schéma de base de données (SQLite réel)
bun run db:push

# 3. Catalogue d'offres (TRIAL / STANDARD / ENTREPRISE)
bun run scripts/seed-plans.ts

# 4. Lancer le serveur de développement
bun run dev        # http://localhost:3000

# 5. Qualité
bun run lint
bunx tsc --noEmit
```

### Variables d'environnement

Copier `.env.example` vers `.env` puis compléter. Chaque intégration déclare elle-même son état réel dans l'application ( Administration → Intégrations ) : non configurée ≠ simulée.

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | SQLite en dev (`file:./db/custom.db`) ; **Neon PostgreSQL en production** |
| `APP_URL` / `PUBLIC_BASE_URL` | URL canonique (OAuth, webhooks, liens e-mail) — requise en production |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth Google (connexion PKCE + Drive, deux flux distincts) |
| `GOOGLE_REDIRECT_URI` | Callback OAuth Drive |
| `DRIVE_ENCRYPTION_KEY` | Chiffrement AES-256-GCM des jetons Drive par organisation |
| `GOOGLE_DOC_AI_PROJECT` / `GOOGLE_DOC_AI_LOCATION` / `GOOGLE_DOC_AI_PROCESSOR_ID` + `GOOGLE_SERVICE_ACCOUNT_JSON` (ou `DOC_AI_ACCESS_TOKEN`) | **Google Document AI — unique moteur OCR** (indisponible = erreur honnête + reprise, jamais un moteur alternatif) |
| `WHATSAPP_TOKEN` / `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp Cloud API |
| `POLAR_ACCESS_TOKEN` / `POLAR_WEBHOOK_SECRET` (+ `POLAR_PRODUCT_ID_STANDARD`, `POLAR_PRODUCT_ID_ENTREPRISE`) | Facturation et abonnements Polar (page hébergée, jamais de carte) |
| `RESEND_API_KEY` / `RESEND_FROM` | E-mails transactionnels (vérification, invitations, réinitialisation, rappels) |
| `AZURE_AI_FOUNDRY_ENDPOINT` / `AZURE_AI_FOUNDRY_API_KEY` / `AZURE_AI_FOUNDRY_DEPLOYMENT` / `AZURE_AI_FOUNDRY_API_VERSION` | IA générale de production (classification, agent, extraction — texte uniquement) |
| `N8N_BASE_URL` / `N8N_SHARED_SECRET` | Orchestration et reprise (contrat HMAC signé) |
| `PLATFORM_ADMIN_EMAILS` | Exploitants de la console plateforme |
| `HESYD_AGENT_DEBUG` | Journal de debug de l'agent (optionnel) |

## Documentation

| Document | Contenu |
|---|---|
| `docs/AUDIT.md` | Audit réel complet : exigences → statuts prouvés, blocages externes E1–E8, missions de finalisation |
| `docs/TECHNICAL_DOCUMENTATION_REVIEW.md` | Registre de lecture des documentations officielles (URLs, sections, contrats, limites) par intégration |
| `docs/DEPLOIEMENT.md` | Déploiement VPS (Docker, Nginx, migrations Neon, sauvegarde/restauration) |
| `docs/SPECIFICATIONS.md` · `docs/MODULES.md` | Cahier des charges détaillé et définition de « terminé » par module |
| `AGENTS.md` · `DECISIONS.md` · `A_CONFIRMER.md` | Conventions du dépôt, décisions d'architecture verrouillées, points à confirmer |
| `n8n/workflows/*.json` | Workflows d'orchestration exportés, versionnés, alignés sur le contrat signé |

## Architecture

```
src/
  app/api/…          # API réelle : auth (session, OAuth, invitations, MFA), organisation,
                     # profil, équipe (rôles, désactivation, retrait), audit, finances,
                     # fichiers, agent, livrables, automatisations, approbations, webhooks,
                     # console plateforme (cross-organisations, allowlist e-mail)
  components/        # Landing + application (registre éditorial, cachet signé, marque
                     # vectorielle, espace légal in-app : À propos / CGU / Confidentialité)
  lib/               # auth (scrypt/sessions), oauth-google (PKCE), provisioning,
                     # pipeline (parse → classify → archive → index), quota, audit,
                     # connecteurs (document-ai, polar, resend, whatsapp, n8n, drive)
  store/             # état client Zustand — espaces Documents / Console opérateur / Plateforme
prisma/schema.prisma # tables métier indexées, chaque ligne porte organization_id
db/                  # SQLite (jamais commitée)
storage/             # archives réelles (jamais commitées)
```

### Les deux espaces

- **Espace Documents** — l'usage quotidien : tableau de bord, référentiels (clients, groupes), registre documentaire, à traiter, assistant, livrables, automatisations, approbations, imports.
- **Console opérateur** — réservée aux rôles PROPRIÉTAIRE / ADMINISTRATEUR : équipe (rôles, désactivation, retrait, invitations), intégrations (états réels, OAuth Drive), abonnement et usage, **journaux d'audit horodatés**, paramètres de l'organisation (nom, fuseau, langue).

### Chaîne de garde documentaire

```
Réception → Persistance immédiate (WebhookEvent/FileReception)
          → PARSE → CLASSIFY → ARCHIVE (preuve fsstat + sha256)
          → INDEX (tranches + mots-clés)
Statuts : Recu → Classé → Archivé (cachet) → Indexé
```

Un statut n'est jamais affirmé par un modèle : il est **calculé à partir d'une preuve**.

## Design

Registre éditorial « papier » : filets fins, chiffres tabulaires, serif d'apparat (Fraunces), un seul moment signé — **le cachet d'archivage**, apposé uniquement quand l'archive est confirmée. Clair (« papier ») et sombre (« encre »). FR par défaut, EN disponible.

## Licence

Propriétaire — © 2025 HESYD. Tous droits réservés.
