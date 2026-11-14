# n8n — Workflows HESYD ONE

Workflows n8n exportables (format natif `nodes` / `connections`), prêts à
importer sur une instance n8n réelle. Ils mettent en œuvre le **contrat signé
Next.js ↔ n8n** défini dans `src/lib/connectors/n8n.ts` (CDC §13.4).

| Fichier | Rôle |
|---|---|
| `workflows/hesyd-automatisations.json` | Schedule Trigger (cron `*/5 * * * *`) → appel signé `POST /api/health` (tick du scheduler des automatisations) |
| `workflows/hesyd-collecte-whatsapp.json` | Webhook n8n recevant les événements WhatsApp Cloud API → transfert signé vers `POST /api/webhook/whatsapp` (corps brut + signature Meta conservées) |

Aucun secret n'est écrit dans ces fichiers : tout passe par des expressions
`$env.…` lues sur l'instance n8n.

---

## 1. Le contrat signé (extrait fidèle du code)

Source de vérité : `src/lib/connectors/n8n.ts`. Toute évolution du code doit
être répercutée ici.

- Méthode : `POST`, corps JSON exact envoyé octet pour octet.
- Signature : `HMAC-SHA256(secret, "<timestamp>.<corps>")`, encodage **hex**,
  où `<timestamp>` est l'heure epoch en **millisecondes** (chaîne).
- En-têtes requis :

| En-tête | Valeur |
|---|---|
| `Content-Type` | `application/json` |
| `X-HESYD-Timestamp` | epoch en millisecondes (même valeur que celle signée) |
| `X-HESYD-Signature` | HMAC-SHA256 hex de `<timestamp>.<corps>` |
| `X-HESYD-Correlation` | identifiant de corrélation unique par appel |
| `X-HESYD-Payload-Version` | `v1` |

- Anti-rejeu : rejet de tout appel dont le timestamp s'écarte de plus de
  **300 secondes** de l'heure serveur (`verifyN8nSignature`).
- Corps attendu par la sortie applicative (`triggerWorkflow`) :
  `{"payloadVersion":"v1","correlationId":"…","payload":{…}}`.

Dans les deux workflows, la chaîne exacte envoyée est construite une seule
fois (nœud Code), signée par le nœud Crypto (`action: HMAC`, `SHA256`,
encodage `Hex`, secret `{{$env.N8N_SHARED_SECRET}}`), puis le nœud HTTP
Request envoie ce corps **brut** (`contentType: raw`) — la signature porte
donc bien sur les octets réellement transmis.

## 2. Variables à définir sur l'instance n8n

| Variable | Rôle | Exemple |
|---|---|---|
| `HESYD_BASE_URL` | URL publique de l'application HESYD | `https://archives.exemple.fr` |
| `N8N_SHARED_SECRET` | Secret partagé — **même valeur** que `N8N_SHARED_SECRET` côté HESYD (`.env`) | (secret, jamais en dur) |
| `WHATSAPP_VERIFY_TOKEN` | Jeton de vérification Meta — même valeur que `WHATSAPP_VERIFY_TOKEN` côté HESYD | (secret) |

Pour que `$env` soit accessible dans les expressions, l'instance n8n
auto-hébergée doit être démarrée avec (selon la version, l'accès est bloqué
par défaut) :

```bash
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

(docker : `docker run -e N8N_BLOCK_ENV_ACCESS_IN_NODE=false …`, ou variable
dans l'unité systemd / le `.env` de l'instance n8n).

## 3. Import et activation

1. n8n → **Workflows → Import from File** → choisir
   `workflows/hesyd-automatisations.json` puis
   `workflows/hesyd-collecte-whatsapp.json`.
2. Vérifier chaque nœud **Crypto** : Action = `HMAC`, Type = `SHA256`,
   Encoding = `Hex`, Value = `{{ $json.stringToSign }}`, Secret =
   `{{ $env.N8N_SHARED_SECRET }}`. (Selon la version de n8n, les libellés
   peuvent nécessiter une re-sélection après import — vérifier avant
   activation.)
3. Vérifier chaque nœud **HTTP Request** : corps envoyé en *raw*
   `application/json` = `{{ $('Corps signé').first().json.body }}` (ou
   `rawBody` pour le workflow WhatsApp) — la signature doit porter sur les
   octets envoyés.
4. Vérifier le nœud **Webhook POST** du workflow WhatsApp : l'option
   **Raw Body** doit être active (sinon le corps est réinterprété par n8n et
   la signature Meta `X-Hub-Signature-256` devient invalide côté HESYD).
5. Définir les variables de la §2 sur l'instance, puis **activer** les
   workflows.
6. URL du webhook n8n à déclarer chez Meta (WhatsApp → Configuration →
   Webhook) : `https://<hote-n8n>/webhook/hesyd-whatsapp`.
   Le workflow répond au `GET` de vérification (`hub.challenge`) après
   contrôle de `hub.verify_token` contre `{{$env.WHATSAPP_VERIFY_TOKEN}}`.

## 4. Test manuel de la signature (hors n8n)

```bash
source .env   # N8N_SHARED_SECRET
BODY='{"payloadVersion":"v1","correlationId":"test-manuel","payload":{"test":true}}'
TIMESTAMP="$(date +%s%3N)"
SIGNATURE="$(printf '%s.%s' "$TIMESTAMP" "$BODY" \
  | openssl dgst -sha256 -hmac "$N8N_SHARED_SECRET" -hex | awk '{print $NF}')"
curl -sS -X POST "https://<domaine>/api/health" \
  -H "Content-Type: application/json" \
  -H "X-HESYD-Timestamp: $TIMESTAMP" \
  -H "X-HESYD-Signature: $SIGNATURE" \
  -H "X-HESYD-Correlation: test-manuel" \
  -H "X-HESYD-Payload-Version: v1" \
  -d "$BODY"
# Réponse attendue : {"triggered":N,"skipped":N,"at":"…"} (exécution réelle du tick)
```

## 5. État réel, sans détour (au jour de l'export)

Honnêteté exigée par les règles du projet — voici ce qui est branché et ce
qui ne l'est pas encore :

1. **Le scheduler in-process reste actif en repli (décision D9).** Tant que
   rien n'est configuré côté n8n, les automatisations s'exécutent quand même
   : `src/lib/scheduler.ts` scanne toutes les 60 s avec clé d'idempotence par
   créneau (`slotKey` unique). n8n est un déclencheur **supplémentaire**, pas
   le seul : un double déclenchement est sans effet grâce à cette clé.
2. **Le tick manuel existe réellement** : `POST /api/health`
   (`src/app/api/health/route.ts`) exécute le même `tick()` et le commentaire
   du code le désigne comme « utilisé par le workflow n8n de reprise ». Le
   workflow `hesyd-automatisations` cible donc ce point d'entrée réel. À
   noter : la constante `N8N_REPRISE_WORKFLOW` dans `n8n.ts` mentionne
   `/api/scheduler/tick`, chemin qui n'est **pas** exposé par les routes de
   l'application — c'est bien `POST /api/health` qui exécute le tick.
3. **La vérification de signature n'est pas encore branchée sur la route** :
   `verifyN8nSignature` existe dans le connecteur mais, à la date de cet
   export, aucune route ne l'appelle (le `POST /api/health` exécute le tick
   sans contrôle d'en-têtes). Les workflows envoient dès maintenant les
   en-têtes exacts du contrat ; le câblage de la vérification côté Next.js
   reste à faire (suivi dans `docs/MODULES.md`, module 7).
4. **Webhook WhatsApp** : la route `/api/webhook/whatsapp` vérifie la
   signature **Meta** (`X-Hub-Signature-256`, HMAC du secret
   `WHATSAPP_APP_SECRET`) sur le corps brut. Le workflow transmet donc le
   corps **octet pour octet** avec l'en-tête Meta d'origine, plus les
   en-têtes `X-HESYD-*` du contrat n8n (utiles dès que la vérification du
   point 3 est câblée, et conformes au CDC §13.4).
5. **Prérequis externes** (docs/AUDIT.md §7) : une instance n8n joignable
   (E5) et les identifiants Meta (E1) pour le workflow WhatsApp. Sans eux,
   les workflows s'importent mais n'ont rien à déclencher.

## 6. Prochaines étapes côté application (hors périmètre de ce dossier)

- Brancher `verifyN8nSignature` sur le `POST /api/health` (ou exposer une
  route dédiée) pour que le tick signé soit réellement contrôlé.
- Optionnel : créer un workflow n8n « Error Trigger » nommé `hesyd-error`
  et le déclarer dans les paramètres d'erreur des deux workflows (la
  constante `N8N_REPRISE_WORKFLOW` du code y fait référence).
