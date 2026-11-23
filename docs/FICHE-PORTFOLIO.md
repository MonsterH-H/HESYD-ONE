# Fiche Projet — HESYD ONE

> Document de référence portfolio — généré lors de l'audit du portefeuille GitHub (nov. 2026).
> Vérification : contenu réel du dépôt (README, `docs/`, structure du code).

## Classification

| Champ | Valeur |
|---|---|
| Catégorie portfolio | **C — AI & Intelligent Applications** (LLM, agents, RAG) |
| Statut | `COMPLET` — niveau de maturité interne L4 |
| Visibilité | `PUBLIC` — code consultable |
| Dépôt | [MonsterH-H/HESYD-ONE](https://github.com/MonsterH-H/HESYD-ONE) |
| Langage principal | TypeScript (Next.js 16, App Router) |

## Problématique

Les organisations reçoivent leurs documents par e-mail, WhatsApp et Drive, sans classification ni preuve de dépôt. L'archivage devient opaque : impossible de répondre de façon sourcée à la question « où est ce document, qui l'a traité, quand ».

## Objectifs

1. Industrialiser le cycle documentaire complet : réception multicanale → classification → archivage → indexation → questions-réponses → livrables.
2. Garantir que chaque statut d'archivage est **calculé à partir d'une preuve technique** (fsstat + sha256 re-vérifié), jamais affirmé par un modèle.
3. Offrir une isolation multi-organisation stricte (`organization_id` sur chaque donnée, index et journal).

## Fonctionnalités clés

- Collecte multicanale réelle : **WhatsApp Cloud API (Meta)**, dépôt web, dossier surveillé **Google Drive**.
- Hiérarchie d'archives Client → Groupe → Catégorie → Année → Mois, statut `ARCHIVE` uniquement sur preuve.
- Agent de Q&A **sourcé** : réponse + fichiers + extraits ; chaque appel d'outil est journalisé (durée, requête SQL réelle).
- Livrables PDF / Excel / Word générés à la demande, sourcés et versionnés.
- Automatisations cron avec compte rendu honnête (fait / bloqué / options).
- Console opérateur plateforme (cross-organisations, allowlist e-mail) et espace opérateur par organisation.
- MFA TOTP RFC 6238, OAuth Google 2.0 + PKCE (S256), verrouillage progressif persisté en base.

## Architecture technique

```
src/app/api/…      auth (session, OAuth PKCE, MFA), organisation, équipe, audit,
                   finances, fichiers, agent, livrables, automatisations, webhooks,
                   console plateforme
lib/               auth (scrypt/sessions), oauth-google (PKCE), pipeline
                   (parse → classify → archive → index), connecteurs
                   (document-ai, polar, resend, whatsapp, n8n, drive)
prisma/schema      tables métier indexées, organization_id sur chaque ligne
```

Chaîne de garde : Réception → Persistance immédiate → PARSE → CLASSIFY → ARCHIVE (preuve fsstat + sha256) → INDEX. Statuts : Recu → Classé → Archivé (cachet) → Indexé.

## Stack — réel vs périmètre

| Composant | Réel |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict |
| Données | Prisma — SQLite (dev) / Neon PostgreSQL (prod) |
| OCR | Google Document AI (unique moteur ; indisponible = erreur honnête + reprise) |
| IA générale | Azure AI Foundry (classification, agent, extraction — texte) |
| Canaux | WhatsApp Cloud API (Meta), Google Drive, n8n (contrat HMAC signé) |
| Paiement | Polar — page hébergée, aucun numéro de carte stocké |
| E-mail | Resend (transactionnels) |

## KPIs vérifiables

- Les métriques structurelles citées dans la fiche de profil (routes API, modèles Prisma, modules `lib/`) sont tracées dans [`docs/AUDIT.md`](AUDIT.md) et [`docs/MODULES.md`](MODULES.md).
- Preuves d'exécution documentées : test d'isolation inter-organisations, blocages externes E1–E8 tracés, registre de lecture des documentations officielles par intégration (`docs/TECHNICAL_DOCUMENTATION_REVIEW.md`).
- Déploiement VPS documenté (`docs/DEPLOIEMENT.md`) : Docker, Nginx, migrations Neon, sauvegarde/restauration (RPO 24 h / RTO 8 h).

## Preuves (captures & diagrammes)

- Diagramme d'architecture et chaîne de garde : README principal (section Architecture).
- Matrices de vérification : `docs/AUDIT.md`, `docs/SPECIFICATIONS.md`, `docs/MODULES.md`.
- Aucune capture d'écran simulée n'est utilisée ; toute capture publiée provient d'une exécution réelle de l'application.

## Limites connues (honnêteté)

- Les intégrations externes (Meta WhatsApp, Google Document AI, Azure, Polar) exigent leurs credentials réels ; sans clé, le code reste **complet mais dormant** et l'état « non configuré » est affiché honnêtement — jamais simulé.
- Aucune suppression définitive par l'agent : archivage réversible par un humain uniquement.
