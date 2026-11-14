# ---------------------------------------------------------------------------
# HESYD ONE — Image de production Next.js (sortie « standalone », node:20-slim)
#
# Choix d'outillage : npm classique (npm ci / npm install) pour compatibilité
# maximale avec un VPS standard. La sandbox de développement utilise bun
# (verrouillage par bun.lock) ; le dépôt ne versionne pas package-lock.json à
# ce jour — `npm install` est donc utilisé en repli tant qu'il n'est pas
# commité. Commiter package-lock.json rendra les builds reproductibles
# (recommandé — voir docs/DEPLOIEMENT.md).
#
# NOTE IMPORTANTE : le script "build" du package.json copie DÉJÀ
# `.next/static` et `public` à l'intérieur de `.next/standalone` :
#     "build": "next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/"
# L'étage « runner » recopie néanmoins ces deux répertoires explicitement
# (ceinture et bretelles) : le serveur standalone doit les trouver à
# `./.next/static` et `./public`.
# ---------------------------------------------------------------------------

# ————— Étage 1 : dépendances (npm, scripts ignorés — génération Prisma explicite) —————
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# --ignore-scripts : aucun script d'installation exécuté à l'aveugle ; le
# client Prisma est généré explicitement à l'étage suivant (npx prisma
# generate), ce qui est déterministe.
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund --ignore-scripts; \
    else \
      npm install --no-audit --no-fund --ignore-scripts; \
    fi

# ————— Étage 2 : build —————
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# Copie sélective (jamais .env, db/, backups/ : aucun secret dans l'image).
COPY next.config.ts tsconfig.json tailwind.config.ts postcss.config.mjs eslint.config.mjs components.json ./
COPY prisma ./prisma
COPY public ./public
COPY src ./src

ENV NEXT_TELEMETRY_DISABLED=1
# Valeur factice de génération : `prisma generate` n'établit aucune connexion ;
# à l'exécution, la vraie URL (PostgreSQL en production — décision D1) est
# fournie par variable d'environnement, jamais par l'image.
ENV DATABASE_URL="file:./db/custom.db"

# Client Prisma généré avant le build Next.js.
RUN npx prisma generate

# Build standalone. Le script "build" du package.json copie déjà
# .next/static et public dans .next/standalone (voir note en tête de fichier).
RUN npm run build

# ————— Étage 3 : migrateur (usage unique, voir docs/DEPLOIEMENT.md) —————
# Décision D1 : la sandbox utilise SQLite ; en production la base est
# PostgreSQL + pgvector et les tables sont créées par les migrations Prisma :
#     npx prisma migrate deploy
# PRÉREQUIS (côté développement, avant tout déploiement) :
#   1. prisma/schema.prisma doit déclarer provider = "postgresql" ;
#   2. le dossier prisma/migrations doit être généré et versionné
#      (écart documenté dans docs/AUDIT.md §4.7 — db push utilisé en sandbox).
# Exécution (sur le VPS) :
#   docker build --target migrator -t hesyd-migrator .
#   docker run --rm --network hesyd_default \
#     -e "DATABASE_URL=postgresql://…@db:5432/…" hesyd-migrator
FROM node:20-slim AS migrator
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
ENV NEXT_TELEMETRY_DISABLED=1
# Génère le client Prisma pour permettre aussi l'amorçage des plans via
# `node -e` (mêmes valeurs que scripts/seed-plans.ts) — voir DEPLOIEMENT.md.
RUN npx prisma generate
# Valeur factice : toujours surchargée par -e DATABASE_URL=… au docker run.
ENV DATABASE_URL="postgresql://remplacer-au-demarrage@db:5432/hesyd"
CMD ["npx", "prisma", "migrate", "deploy"]

# ————— Étage 4 : exécution (final) —————
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# Répertoires écrits par l'application : archives documentaires (storage/,
# monté depuis l'hôte par docker-compose.yml) et base SQLite (inutilisée en
# production PostgreSQL — présente par compatibilité).
RUN mkdir -p /app/storage /app/db && chown -R node:node /app

# Sortie standalone du build. Le serveur est démarré en Node standard
# (en sandbox, le script "start" du package.json utilise bun ; en conteneur,
# le server.js standalone s'exécute avec node — aucun bundler requis).
COPY --from=builder --chown=node:node /app/.next/standalone ./
# Rappel : le script "build" de package.json a déjà copié ces répertoires
# dans .next/standalone — les copies suivantes garantissent leur présence
# même si ce script évolue.
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
