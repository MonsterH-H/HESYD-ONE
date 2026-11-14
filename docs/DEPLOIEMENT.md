# DEPLOIEMENT — HESYD ONE sur VPS de production

Guide pas à pas pour l'hébergement de production : **Docker Compose +
PostgreSQL/pgvector + Nginx + HTTPS** (hypothèse retenue : A_CONFIRMER.md A7 —
VPS 4 vCPU / 8 Go ; objectifs RPO 24 h / RTO 8 h : A8).

## 0. État réel avant de commencer (à lire honnêtement)

- **La sandbox de développement utilise SQLite** (`db/custom.db`, décision D1).
  En production, `DATABASE_URL` passe à PostgreSQL + pgvector et **les tables
  sont créées par les migrations Prisma** (`prisma migrate deploy`). Le schéma
  est préparé pour ce portage (`embeddingJson` réservé pour pgvector).
- **Prérequis de préparation côté développement** (avant tout déploiement,
  écarts documentés dans `docs/AUDIT.md` §4.7 et §7-E6) :
  1. `prisma/schema.prisma` déclare aujourd'hui `provider = "sqlite"` ; il
     doit être passé à `"postgresql"` pour la production ;
  2. le dossier `prisma/migrations/` n'existe pas encore (la sandbox utilise
     `prisma db push`) : générer et committer la migration initiale
     (`npx prisma migrate dev --name init` contre un PostgreSQL éphémère,
     ex. `docker run -e POSTGRES_PASSWORD=test -p 5433:5432 pgvector/pgvector:pg16`).
- **Le build de production n'a jamais été exécuté en sandbox** (E7 :
  `next build` interdit pendant le développement). Le premier
  `docker compose build` est donc le premier build réel — prévoir une fenêtre
  de correction. (`next.config.ts` a `output: "standalone"` et
  `ignoreBuildErrors: true` ; le typecheck `bunx tsc --noEmit` passe à 0
  erreur en sandbox.)
- **Secrets externes** : WhatsApp (E1), Google/Drive/Document AI (E2), Polar (E3),
  Resend (E4), n8n (E5), Azure AI Foundry (E8) — les connecteurs sont réels mais
  dormants sans identifiants. Le produit fonctionne sans eux (archivage local,
  agent, automatisations) et affiche leur état honnête. **Aucun stub, aucune
  réussite fabriquée** : sans identifiants, les flux e-mail renvoient `email_non_configure`
  en production (LOCAL_REVEAL interdit hors développement) et les webhooks paiements
  répondent 503.

Fichiers d'infrastructure fournis dans ce dépôt : `.nvmrc`, `Dockerfile`
(étages `deps` → `builder` → `migrator` → `runner`), `docker-compose.yml`
(`db`, `app`, `nginx`), `nginx/hesyd.conf`, `scripts/backup.sh`,
`scripts/restore.sh`, `n8n/`.

## 1. Prérequis serveur

- VPS Debian 12 / Ubuntu 22.04+ — 4 vCPU, 8 Go RAM, 80 Go SSD (A7).
- Accès root ou sudo ; ports 80 et 443 ouverts (et 22 pour l'administration).
- **Docker Engine + plugin Compose v2** :
  ```bash
  curl -fsSL https://get.docker.com | sh   # ou installation par la distribution
  docker compose version                    # doit répondre (plugin v2)
  ```
- Node 20 sur l'hôte (utile pour les opérations hors conteneur) : la version
  attendue est fixée par `.nvmrc` (`nvm install && nvm use` si nvm est
  installé).
- Un nom de domaine dédié à l'application.

## 2. DNS

Créer chez le registrar un enregistrement :

```
<domaine>     A      <IP publique du VPS>
<domaine>     AAAA   <IPv6 du VPS>        (si disponible)
```

Vérifier : `dig +short <domaine>` doit répondre l'IP du VPS.

## 3. Récupération du dépôt

```bash
sudo mkdir -p /opt/hesyd && sudo chown "$USER" /opt/hesyd
cd /opt/hesyd
git clone <url-du-depot> .
git checkout <tag-de-version>     # toujours déployer un tag, jamais une branche mouvante
```

## 4. Fichier `.env`

```bash
cp .env.example .env
chmod 600 .env
```

Compléter `.env` — liste exacte des variables de `.env.example` :

| Variable | Valeur de production |
|---|---|
| `DATABASE_URL` | laissé tel quel dans `.env` : **surchargé par Compose** qui construit `postgresql://…@db:5432/…` (décision D1) — en production les tables sont créées par les migrations, pas par ce fichier |
| `APP_URL` | `https://<domaine>` |
| `PUBLIC_BASE_URL` | `https://<domaine>` |
| `GOOGLE_CLIENT_ID` | identifiant OAuth Google (E2) — laisser vide si non activé |
| `GOOGLE_CLIENT_SECRET` | secret OAuth Google (E2) |
| `GOOGLE_REDIRECT_URI` | `https://<domaine>/api/integrations/drive/callback` |
| `DRIVE_ENCRYPTION_KEY` | 32+ caractères aléatoires (chiffrement des jetons Drive) |
| `WHATSAPP_TOKEN` | jeton Meta (E1) |
| `WHATSAPP_APP_SECRET` | secret d'application Meta (E1) — vérifie `X-Hub-Signature-256` |
| `WHATSAPP_VERIFY_TOKEN` | jeton de vérification webhook (E1) |
| `WHATSAPP_PHONE_NUMBER_ID` | identifiant du numéro (E1) |
| `POLAR_ACCESS_TOKEN` | jeton d'accès API Polar (E3) — Dashboard → Settings → API keys |
| `POLAR_WEBHOOK_SECRET` | secret du endpoint webhook Polar (E3) — schéma Standard Webhooks |
| `POLAR_PRODUCT_ID_STANDARD` | ID produit Polar de l'offre STANDARD |
| `POLAR_PRODUCT_ID_ENTREPRISE` | ID produit Polar de l'offre ENTREPRISE |
| `RESEND_API_KEY` | clé API Resend (E4) — e-mails transactionnels réels |
| `RESEND_FROM` | expéditeur (`HESYD ONE <notifications@domaine.fr>`) — domaine vérifié chez Resend |
| `GOOGLE_DOC_AI_PROJECT` / `GOOGLE_DOC_AI_LOCATION` / `GOOGLE_DOC_AI_PROCESSOR_ID` | processor OCR Document AI (E2b) — OCR imposé des scans |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | compte de service (JSON complet) pour Document AI — OU `DOC_AI_ACCESS_TOKEN` |
| `AZURE_AI_FOUNDRY_ENDPOINT` | endpoint Azure OpenAI (`https://<ressource>.openai.azure.com`) (E8) |
| `AZURE_AI_FOUNDRY_API_KEY` | clé API (en-tête `api-key`) (E8) |
| `AZURE_AI_FOUNDRY_DEPLOYMENT` | nom du déploiement chat (E8) |
| `AZURE_AI_FOUNDRY_API_VERSION` | version data-plane (défaut `2024-10-21`) (E8) |
| `N8N_BASE_URL` | URL de l'instance n8n (E5) — ex. `https://n8n.exemple.fr` |
| `N8N_SHARED_SECRET` | secret partagé HMAC (identique côté n8n — voir `n8n/README.md`) |

**Ajouter** (variables Compose, absentes de `.env.example`) :

```bash
POSTGRES_USER=hesyd
POSTGRES_PASSWORD=$(openssl rand -base64 32)   # jamais de mot de passe inventé à la main
POSTGRES_DB=hesyd
```

Si le mot de passe contient des caractères réservés d'URL (`@ : / ? # %`),
les encoder ou en choisir un sans caractères spéciaux (il est injecté dans
`DATABASE_URL`).

Aucun secret ne doit jamais être commité (`.env` est exclu du dépôt —
vérifié par l'audit §1).

## 5. Dossiers et droits

```bash
cd /opt/hesyd
mkdir -p storage certs certbot/www certbot/etc certbot/lib backups
# L'application tourne en utilisateur « node » (uid 1000) dans le conteneur.
sudo chown -R 1000:1000 storage
```

`backups/`, `certs/` et `certbot/` sont des données serveur : ne jamais les
commiter (les ajouter au `.gitignore` si ce n'est pas déjà fait).

## 6. Démarrage de la base puis construction

```bash
cd /opt/hesyd
docker compose up -d db        # démarre PostgreSQL + pgvector, healthcheck pg_isready
docker compose build app       # build Next.js standalone (premier build réel — voir §0)
docker compose up -d app       # dépend de « db : service_healthy »
```

## 7. Migrations (décision D1 : SQLite → PostgreSQL)

Les tables ne sont **jamais** créées par le conteneur applicatif au démarrage
mais par une exécution explicite et traçable de `prisma migrate deploy`,
via l'étage `migrator` du `Dockerfile` :

```bash
cd /opt/hesyd
set -a; . ./.env; set +a          # charge POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB

docker build --target migrator -t hesyd-migrator .
docker run --rm --network hesyd_default \
  -e "DATABASE_URL=postgresql://${POSTGRES_USER:-hesyd}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-hesyd}?schema=public" \
  hesyd-migrator                    # CMD par défaut : npx prisma migrate deploy
```

Vérification réelle (liste des tables créées) :

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'
```

**Palliatif honnête tant que le dossier `prisma/migrations/` n'est pas
généré** (écart documenté §0) : créer le schéma sans migrations versionnées :

```bash
docker run --rm --network hesyd_default \
  -e "DATABASE_URL=postgresql://${POSTGRES_USER:-hesyd}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-hesyd}?schema=public" \
  hesyd-migrator npx prisma db push
```

À n'utiliser qu'en connaissance de cause : `db push` ne laisse aucune trace
de versionnage (c'est précisément l'écart relevé par l'audit §4.7).

## 8. Amorçage des offres (obligatoire avant la première inscription)

L'inscription crée un abonnement `TRIAL` : la table `Plan` doit exister.
Valeurs officielles : `scripts/seed-plans.ts`. Amorçage idempotent via
l'image `migrator` (client Prisma généré dedans) :

```bash
docker run --rm --network hesyd_default \
  -e "DATABASE_URL=postgresql://${POSTGRES_USER:-hesyd}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-hesyd}?schema=public" \
  hesyd-migrator node -e '
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const plans = [
  ["TRIAL", "Essai 14 jours", 0, 3, 10, 20, 200, 500, 3, 60, false, false],
  ["STANDARD", "Standard", 8900, 10, 50, 100, 1500, 3000, 10, 15, false, false],
  ["ENTREPRISE", "Entreprise", 29000, 50, 500, 1000, 10000, 20000, 50, 5, true, true],
];
(async () => {
  for (const p of plans) {
    const [code, name, priceMonthlyCents, maxUsers, maxClients, maxGroups, monthlyDocuments, monthlyCredits, maxAutomations, minIntervalMinutes, groupCollection, dedicatedNumber] = p;
    await db.plan.upsert({ where: { code }, create: { code, name, priceMonthlyCents, maxUsers, maxClients, maxGroups, monthlyDocuments, monthlyCredits, maxAutomations, minIntervalMinutes, groupCollection, dedicatedNumber }, update: {} });
  }
  console.log("Plans crees : TRIAL / STANDARD / ENTREPRISE");
  await db.$disconnect();
})();
'
```

Vérification : `printf 'SELECT count(*) FROM "Plan";\n' | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA'`
doit répondre `3`.

## 9. Premier compte

Deux chemins réels, au choix :

- **Interface** : ouvrir `https://<domaine>` → « Créer un compte » : nom,
  e-mail, mot de passe (8+ caractères), nom de l'organisation → organisation
  d'essai 14 jours, 500 crédits, connecteurs initialisés à leur état honnête.
- **API** :
  ```bash
  curl -sS -X POST "https://<domaine>/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"name":"Prénom Nom","email":"admin@exemple.fr","password":"motdepasse-long","organizationName":"Mon organisation"}'
  ```

Le premier compte est PROPRIETAIRE de l'organisation ; les invités sont
ajoutés par jeton à usage unique depuis Administration → Équipe.

## 10. Nginx + HTTPS (certbot)

1. Adapter `nginx/hesyd.conf` : remplacer les deux `server_name _;` par le
   domaine réel (`<domaine>`).
2. Premier certificat (le conteneur nginx ne peut pas démarrer sans lui —
   mode `--standalone`, port 80 libre car nginx n'est pas encore lancé) :
   ```bash
   cd /opt/hesyd
   docker run --rm -p 80:80 \
     -v /opt/hesyd/certbot/etc:/etc/letsencrypt \
     -v /opt/hesyd/certbot/lib:/var/lib/letsencrypt \
     certbot/certbot certonly --standalone \
     -d <domaine> --email <email-admin> --agree-tos --no-eff-email

   cp certbot/etc/live/<domaine>/fullchain.pem certs/
   cp certbot/etc/live/<domaine>/privkey.pem  certs/
   chmod 600 certs/privkey.pem
   ```
3. Démarrer nginx :
   ```bash
   docker compose up -d nginx     # dépend de « app : service_healthy »
   curl -fsS https://<domaine>/api/health
   # attendu : {"status":"operational","scheduler":"actif","time":"…"}
   ```
4. Renouvellements automatiques (cron, webroot — nginx sert déjà
   `/.well-known/acme-challenge/` en HTTP) :
   ```cron
   0 4 * * 1 cd /opt/hesyd && docker run --rm -v /opt/hesyd/certbot/etc:/etc/letsencrypt -v /opt/hesyd/certbot/lib:/var/lib/letsencrypt -v /opt/hesyd/certbot/www:/var/www/certbot certbot/certbot renew --webroot -w /var/www/certbot --quiet && cp certbot/etc/live/<domaine>/fullchain.pem certs/ && cp certbot/etc/live/<domaine>/privkey.pem certs/ && docker compose exec nginx nginx -s reload
   ```

Rappels proxy : `client_max_body_size 30m` (dépôts jusqu'à 25 Mo), SSE de
l'agent sous `/api/agent/` sans mise en tampon et délais 300 s, en-têtes
HSTS / X-Content-Type-Options / Referrer-Policy — voir `nginx/hesyd.conf`.

## 11. Sauvegardes (RPO 24 h — A8)

```bash
crontab -e
```

```cron
0 3 * * *  /opt/hesyd/scripts/backup.sh >> /var/log/hesyd-backup.log 2>&1
```

- Contenu : `pg_dump` compressé + `tar.gz` de `storage/` (archives
  documentaires) + manifeste sha256, rétention `KEEP_DAYS` (défaut 14,
  ex. `KEEP_DAYS=30 scripts/backup.sh`).
- Aucun secret en dur : identifiants lus dans `.env` (mode `docker` par
  défaut : `pg_dump` via `docker compose exec db`).
- **Exercice de restauration obligatoire** avant d'annoncer le RTO (A8) :
  ```bash
  scripts/restore.sh backups/<horodatage>     # confirmation explicite demandée
  ```
- Prévoir la copie des sauvegardes vers un stockage distant (rsync chiffré
  vers un autre serveur) — un backup qui ne quitte pas le VPS n'est pas une
  sauvegarde.

## 12. Supervision

```bash
docker compose ps                                   # les 3 services doivent être « healthy/running »
docker compose logs -f --tail=100 app               # journaux applicatifs (stdout)
curl -fsS https://<domaine>/api/health              # {"status":"operational","scheduler":"actif"}
df -h /opt/hesyd                                    # stockage : archives + sauvegardes
du -sh /opt/hesyd/storage /opt/hesyd/backups
```

- **Journaux d'audit applicatifs** : Administration → Journaux (chaque action
  sensible, avant/après).
- Taille de la base :
  ```bash
  printf "SELECT pg_size_pretty(pg_database_size(current_database()));\n" | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA'
  ```
- Le scheduler in-process (scan 60 s, D9) démarre avec l'application ; n8n
  est un déclencheur additionnel (voir `n8n/README.md`).

## 13. Mise à jour

```bash
cd /opt/hesyd
scripts/backup.sh                                   # TOUJOURS avant toute mise à jour
git fetch --tags && git checkout <nouveau-tag>
docker compose build app
docker build --target migrator -t hesyd-migrator .
set -a; . ./.env; set +a
docker run --rm --network hesyd_default \
  -e "DATABASE_URL=postgresql://${POSTGRES_USER:-hesyd}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-hesyd}?schema=public" \
  hesyd-migrator                                     # prisma migrate deploy
docker compose up -d app
curl -fsS https://<domaine>/api/health
```

Vérifier ensuite dans l'application : connexion, dépôt d'un fichier,
exécution d'une automatisation, une question à l'agent (parcours critique).

## 14. Rollback

1. Revenir au tag précédent :
   ```bash
   git checkout <tag-precedent>
   docker compose build app && docker compose up -d app
   ```
2. Si une migration a rendu les données inutilisables : restaurer la
   sauvegarde prise juste avant la mise à jour (procédure §11) :
   ```bash
   scripts/restore.sh backups/<horodatage-avant-mise-a-jour>
   ```
   Note honnête : `prisma migrate deploy` est unidirectionnel (aucun
   « down » automatique) — la restauration de sauvegarde est la procédure
   de repli officielle, d'où la sauvegarde obligatoire du §13.

## 15. Références

- `docs/AUDIT.md` — état réel du produit, blocages externes (E1 à E7).
- `docs/MODULES.md` — suivi du cycle « SaaS Module Gate ».
- `docs/SPECIFICATIONS.md` — règles non négociables et cycle de développement.
- `n8n/README.md` — import et configuration des workflows n8n.
- `DECISIONS.md` — décisions techniques (D1 SQLite→PostgreSQL, D9 scheduler
  in-process, etc.).
