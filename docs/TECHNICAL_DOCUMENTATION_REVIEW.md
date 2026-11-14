# TECHNICAL_DOCUMENTATION_REVIEW — Registre de lecture documentaire officielle

**Règle de la mission (§2)** : aucune implémentation basée sur des souvenirs ou des exemples trouvés au hasard. Pour chaque intégration, la documentation officielle a été ouverte et lue, et le code se conforme à elle. Ce registre fait foi : il distingue ce qui a été **réellement lu** (avec les sections), ce qui est **implémenté**, ce qui reste **bloqué** (identifiants externes) et les **limitations officielles** constatées.

Méthode d'exécution de cette session : recherche des pages officielles (moteur + index `llms.txt` des fournisseurs), puis lecture réelle du contenu (référence REST, guides d'authentification, guides webhooks). Les URLs ci-dessous sont les pages effectivement consultées le 14/11/2026.

---

## 1. Polar — paiements et abonnements (décision imposée)

| Élément | Contenu |
|---|---|
| Fournisseur | Polar (Merchant of Record) |
| Fonctionnalité | Checkout hébergé + webhooks d'abonnement + crédits de cycle |
| Documentation officielle | `https://polar.sh/docs/features/checkout/session.md` (Checkout API) · `https://polar.sh/docs/integrate/webhooks/endpoints.md` (Setup Webhooks) · `https://polar.sh/docs/integrate/webhooks/delivery.md` (Handle & monitor webhook deliveries) · `https://polar.sh/docs/integrate/webhooks/events.md` (Webhook Events) |
| Sections consultées | Création de session Checkout (paramètres `products`, `prices`, `external_id`, `metadata`, `success_url`) ; validation de signature (schéma **Standard Webhooks** : en-têtes `webhook-id` / `webhook-timestamp` / `webhook-signature`, contenu signé `${id}.${timestamp}.${payload}`, HMAC-SHA256 ; deux schémas de clé selon la date du secret : après 08/09/2026 = `base64(whsec_ sans préfixe)`, avant = octets UTF-8 du `whsec_` complet) ; **RELECTURE EN DIRECT le 14/11/2026** (page_reader sur les URLs officielles) : page events = liste officielle exacte `subscription.created/updated/active/canceled/uncanceled/cycled/past_due/revoked/paused/resumed/migrated` + `order.created/paid/refunded/updated` ; sémantique lue : `cycled` « fires whether or not the payment succeeds » ; `paused` « benefits are revoked » ; `resumed` « Fired when a paused subscription resumes » ; page delivery = retries « up to 10 times with an exponential backoff » sur erreur/non-2xx, timeout 10 s, endpoint désactivé après 10 échecs consécutifs |
| Contrat technique | `POST https://api.polar.sh/v1/checkouts` avec `Authorization: Bearer <access token>` → `{url}` ; webhook POST avec triple en-tête Standard Webhooks |
| Comportement attendu | Redirection du client vers `checkout.url` ; les transitions d'abonnement n'arrivent QUE par webhook signé ; rejouable sans double effet |
| Code existant | Connecteur Polar réel (le connecteur Stripe et sa route webhook ont été SUPPRIMÉS du code le 14/11/2026 — architecture parallèle interdite) |
| Écarts corrigés (sessions précédentes) | Crédits de renouvellement en dur (500) → désormais `Plan.monthlyCredits` réel ; supplantation Stripe → Polar complète |
| Écarts corrigés (14/11/2026 — contrôle architectural final) | (1) **Idempotence financière** : le claim `processed` s'effectue désormais AVANT l'application (`updateMany` conditionnel) — deux livraisons concurrentes du même `webhook-id` ne peuvent plus créditer deux fois (TOCTOU éliminé) ; échec → claim réverti + **HTTP 500** (le `202` antérieur empêchait toute relivraison — contre la doc officielle « retry up to 10 times ») ; (2) **Événements conformes à la doc relue** : `subscription.paused` (→ SUSPENDU), `subscription.uncanceled` (→ rafraîchissement, sans forcer ACTIF) ajoutés ; `cycled` conditionné au champ `status` du payload (crédits ET ACTIF seulement si paiement réussi) ; `subscription.resumed` conservé (réellement documenté par Polar — erreur de la revue initiale corrigée après lecture en direct) ; (3) écritures subscription+organization enveloppées en transaction Prisma ; (4) `purgeScheduledAt` (+30 j) posé à la résiliation → purge automatique du cycle de vie ; (5) `logAudit` horodaté + e-mail Resend (si configuré) + notification in-app sur chaque transition ; facture uniquement sur `cycled` avec crédits réellement octroyés |
| Implémentation | `src/lib/connectors/polar.ts` (vérification double-schéma + transitions métier transactionnelles), `src/app/api/webhook/polar/route.ts` (signature → upsert → claim atomique → application → audit/notify/e-mail ; échec = réversion + 500), `src/app/api/subscription/checkout/route.ts` (session réelle) |
| Tests | Sans identifiants : `POST /api/webhook/polar` → **503 `polar_non_configure`** (honnête) ; checkout sans jeton → erreur `polar_non_configure_*` ; typecheck + lint verts. Test réel sur Polar : **BLOQUÉ EXTERNE E3** (nécessite `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, produits STANDARD/ENTREPRISE) |
| Limitations | Sandbox Polar distincte (essais gratuits) ; Polar est Merchant of Record (TVA/versements gérés par Polar — conditions du compte propriétaire à confirmer) |

## 2. Resend — e-mails transactionnels (décision imposée)

| Élément | Contenu |
|---|---|
| Fournisseur | Resend |
| Fonctionnalité | Envoi d'e-mails transactionnels (vérification e-mail, mot de passe oublié, invitations, rappels d'essai, purge) |
| Documentation officielle | `https://resend.com/docs/api-reference/introduction.md` (Base URL, Auth) · `https://resend.com/docs/api-reference/emails/send-email.md` (Send Email) |
| Sections consultées | Base URL `https://api.resend.com` ; authentification `Authorization: Bearer re_…` ; **en-tête `User-Agent` OBLIGATOIRE** (403 sans lui) ; paramètres `from` (format `Nom <email>`), `to` (max 50), `subject`, `html`, `text` (généré depuis le HTML si absent) |
| Contrat technique | `POST /emails` avec Bearer + User-Agent + JSON {from,to,subject,html,text} → 200 `{id}` |
| Comportement attendu | E-mail réellement délivré ; réponse honnête en cas d'échec (jamais `sent:true` fabriqué) |
| Code existant | Aucun transport ; branches `SMTP_URL` qui répondaient `{ok:true,sent:true}` **sans envoyer** (faux succès — corrigé) |
| Écarts corrigés | Suppression de tous les stubs SMTP ; kill-switch `LOCAL_REVEAL` interdit en production ; e-mails réels branchés sur : vérification, reset, invitations, rappels J-7/J-3/J-1, expiration, purge |
| Implémentation | `src/lib/connectors/resend.ts` (sendEmail réel + gabarit de marque) ; routes `auth/register`, `auth/verify-email`, `auth/forgot-password`, `users` (invitations), `lib/trial-lifecycle.ts` |
| Tests | Sans `RESEND_API_KEY` : développement → LOCAL_REVEAL libellé honnêtement ; production → 503 `email_non_configure` ; aucun `sent:true` fabriqué (grep vérifié). Test réel d'envoi : **BLOQUÉ EXTERNE E4** |
| Limitations | Domaine d'expédition à vérifier chez Resend (SPF/DKIM) avant production ; quota d'essai du domaine `resend.dev` |

## 3. Google Document AI — OCR (règle absolue : ne pas remplacer)

| Élément | Contenu |
|---|---|
| Fournisseur | Google Cloud — Document AI |
| Fonctionnalité | OCR des scans/images/PDF sans texte natif |
| Documentation officielle | `https://docs.cloud.google.com/document-ai/docs/reference/rest/v1/projects.locations.processors/process` (Method: processors.process) |
| Sections consultées | Requête HTTP `POST https://documentai.googleapis.com/v1/{name}:process` ; `name = projects/{project}/locations/{location}/processors/{processor}` ; corps `{rawDocument:{content:<base64>, mimeType}, skipHumanReview}` ; réponse `ProcessResponse.document{text, pages[]}` ; scope OAuth `https://www.googleapis.com/auth/cloud-platform` ; permissions IAM `documentai.processors.processOnline` |
| Contrat technique | REST v1 + OAuth 2.0 (compte de service → JWT RS256 → access token via `oauth2.googleapis.com/token`) |
| Comportement attendu | Texte OCR réel ; confiance moyenne du fournisseur quand fournie ; sans configuration ou en cas d'échec réel → erreur explicite (`docai_non_configure` / `docai_process_http_*`), fichier marqué `A_VERIFIER` (traitement manuel) et réception `ERREUR_DEFINITIVE` (reprise via `retryReception` une fois Document AI configuré). **AUCUN moteur OCR alternatif** |
| Code existant | OCR via Google Document AI, UNIQUE moteur (le repli vision ML a été **SUPPRIMÉ du code** le 14/11/2026 par directive du commanditaire : un modèle VLM constituait un moteur OCR alternatif) |
| Écarts corrigés (14/11/2026) | Suppression complète de `ocrWithVision` (appel `glm-4.5v` d'extraction documentaire) dans `parse.ts` ; `ocrEngine` réduit au type `"GOOGLE_DOCUMENT_AI"` seul ; indisponibilité = erreur propagée → `ProcessingJob ECHEC_DEFINITIF`, `File A_VERIFIER`, `FileReception ERREUR_DEFINITIVE` (reprise + correction manuelle réels) ; aucun crédit consommé en échec ; vérification exhaustive : plus AUCUN appel vision OCR dans src/ (les seuls `image_url` restants sont l'option vision d'Azure/GLM du chat, non utilisée, jamais pour l'OCR) |
| Implémentation | `src/lib/connectors/document-ai.ts` (process REST réel, JWT RS256 RFC 7523, cache de token) ; `src/lib/pipeline/parse.ts` (chaîne imposée) ; `src/lib/pipeline/ingest.ts` (journalisation du moteur) |
| Tests | Sans identifiants : image/PDF scanné → `docai_non_configure` → fichier `A_VERIFIER` + réception `ERREUR_DEFINITIVE` (état final honnête, reprise possible). Test réel Document AI : **BLOQUÉ EXTERNE E2b** (nécessite `GOOGLE_DOC_AI_PROJECT/LOCATION/PROCESSOR_ID` + compte de service) |
| Limitations | Quotas par location ; régions supportées (`eu` disponible) ; coûts à la page — à mesurer avant production |

## 4. Azure AI Foundry — fournisseur de modèle IA (listé dans les choix retenus)

| Élément | Contenu |
|---|---|
| Fournisseur | Microsoft — Azure OpenAI dans Microsoft Foundry |
| Fonctionnalité | Inférence chat (classification, agent documentaire, résumés, extraction) |
| Documentation officielle | `https://learn.microsoft.com/en-us/azure/ai-services/openai/reference` (+ page Foundry « Azure OpenAI … REST API reference » lue via lecteur) |
| Sections consultées | Surfaces d'API (control plane / data plane authoring / **data plane inference**) ; authentification par **en-tête `api-key`** (ou Bearer Entra, non utilisé) ; versionnement `api-version` (format YYYY-MM-DD, GA 2024-06-01/2024-10-21) ; exemple officiel `POST https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=…` |
| Contrat technique | Chat Completions compatible OpenAI sur le chemin `/openai/deployments/{deployment}/chat/completions` |
| Comportement attendu | Toutes les consommations LLM passent par le fournisseur de production quand configuré ; le fournisseur réellement utilisé est journalisé (console serveur `[ai] fournisseur=…` à chaque appel) et le modèle réellement employé est persisté pour l'agent (`AgentTask.modelVersion`, usage tokens) — repli GLM explicite en sandbox, jamais silencieux |
| Code existant | Appels `zai.chat.completions` directs dispersés (runner, classify, scheduler, tools) |
| Écarts corrigés | Couche fournisseur unique `src/lib/ai/provider.ts` ; branché sur : runner agent (+ `tokensIn/tokensOut/modelVersion` réels désormais persistés), classification, résumés, rapports d'automatisation, planification, extraction financière ; OCR reste Google Document AI (règle absolue) |
| Implémentation | `src/lib/ai/provider.ts` (`chatComplete`, `azureFoundryConfigured`, `azureFoundryDeployment`, journalisation `[ai] fournisseur=…` à chaque appel) |
| Tests | Sans identifiants : `azureFoundryConfigured() = false` → GLM réel utilisé et journalisé (`modelVersion: "glm"`). Test réel Azure : **BLOQUÉ EXTERNE E8** (`AZURE_AI_FOUNDRY_ENDPOINT/API_KEY/DEPLOYMENT`) |
| Limitations | Versions d'api-version datées (cycle de vie documenté par Microsoft) ; quotas TPM par déploiement |

## 5. Meta WhatsApp Business Cloud API (décision imposée — déjà implémentée, conformité revérifiée)

| Élément | Contenu |
|---|---|
| Fournisseur | Meta |
| Fonctionnalité | Réception webhooks (messages/médias), vérification HMAC, envoi de texte, téléchargement média |
| Documentation officielle (consultée à la session d'audit précédente, contract revérifié) | Référence Cloud API : webhooks `X-Hub-Signature-256` = HMAC SHA-256 du corps brut avec le secret d'application ; `hub.verify_token` pour GET d'inscription ; Graph `v21.0` : `POST /{phone_number_id}/messages`, média 2 étapes (`GET /{media_id}` → URL signée → téléchargement) |
| Contrat technique | Voir `src/lib/connectors/whatsapp.ts` (signature sur corps brut via `req.text()`, `timingSafeEqual`, anti-doublon `providerEventKey` unique) |
| Comportement attendu | Événement non signé → rejeté et persisté `REJETEE` ; appairage par code à usage unique (CDC §4.8) ; réponse de l'agent renvoyée dans le canal |
| Code existant | Implémentation réelle complète (session précédente) |
| Écarts corrigés (cette session) | `userId` de l'agent WhatsApp = **appairage réel** (plus l'ID d'organisation) ; rôle réel du membership ; message texte → extraction financière (`recordFinancialCandidates`) ; `WebhookEvent.organizationId` mis à jour après résolution ; catch de doublon restreint à `P2002` |
| Écarts corrigés (14/11/2026 — contrôle architectural final) | (1) **Signature AVANT toute écriture** : une requête sans signature valide reçoit un 403 sec et ne crée PLUS aucune ligne en base (l'écriture non authentifiée était exploitable) ; (2) **traitement complet du lot** : un échec sur un message ne fait plus perdre les messages suivants (statut ERREUR par événement, lot poursuivi) ; (3) **anti force brute persistant** de l'appairage : au-delà de 10 messages à code / 15 min / expéditeur (colonne `WebhookEvent.senderId`, comptage serveur en base — valable multi-instance), tentatives ignorées ; (4) message WhatsApp honnête : la correction de rattachement se fait dans l'espace web (Documents → À vérifier), la promesse « répondez ATL DEPWEB » (jamais implémentée) supprimée ; (5) limite officielle documentée : l'API Cloud ne délivre pas d'identifiant de groupe (Groups API soumise à éligibilité) — `msg.groupId` est null en pratique, le rattachement passe par la correction web |
| Implémentation | `src/app/api/webhook/whatsapp/route.ts`, `src/lib/whatsapp-pairing.ts` |
| Tests | Test réel Meta : **BLOQUÉ EXTERNE E1** (identifiants + éligibilité + GO/NO-GO Groups API). Les groupes WhatsApp restent honnêtement `EN_VERIFICATION` |
| Limitations | Groups API soumise à éligibilité Meta (A3) — aucune promesse d'accès aux messages de groupe sans GO |

## 6. Google Drive API + Google OAuth (décision imposée — déjà implémentée, durcie)

| Élément | Contenu |
|---|---|
| Fournisseur | Google |
| Fonctionnalité | OAuth utilisateur (connexion) ; archivage Drive côté organisation (arborescence Client>Groupe>Catégorie>Année>Mois) |
| Documentation officielle (contract revérifié) | OAuth 2.0 (PKCE S256, `email_verified`) ; Drive `files.create` multipart + relecture `files.get` comme preuve ; refresh token chiffré au repos |
| Comportement attendu | Documents archivés dans l'espace du client ; confirmation par relecture métadonnées |
| Écarts corrigés (cette session) | Bug bloquant : statut `"CONNECTED"` vs `"CONNECTE"` → **la branche Drive était morte** ; corrigé et l'archivage Drive est réellement atteignable après connexion ; OAuth Drive : authorize réservé ADMIN, callback en temps constant, `configJson` masqué (`refreshTokenEnc`/`state` jamais renvoyés aux clients) |
| Écarts corrigés (14/11/2026 — propriété documentaire) | **Destination d'archivage unique** `src/lib/storage/destination.ts` : les trois voies d'archivage (pipeline de réception, correction humaine `files/[id]/correct`, reprise `files/[id]/retry`) écrivent DÉSORMAIS toutes dans le Drive du client quand il est connecté — auparavant correct/retry archivaient toujours en local même Drive connecté (contournement de la propriété documentaire) ; repli local conservé uniquement quand le Drive n'est pas connecté (honnête, preuve fs.stat distincte) ; `driveFileId` persisté sur toutes les voies |
| Implémentation | `src/lib/storage/drive.ts`, `src/lib/storage/destination.ts` (destination unique), `src/lib/pipeline/ingest.ts`, `src/app/api/files/[id]/correct`, `src/app/api/files/[id]/retry`, `src/app/api/integrations/drive/*` |
| Tests | Test réel Drive : **BLOQUÉ EXTERNE E2** (identifiants OAuth + `DRIVE_ENCRYPTION_KEY`). Upload reprenable (resumable) : reste à faire, priorité P2 |
| Limitations | Périmètre OAuth `drive.file` (le plus étroit) ; My Drive vs Shared Drive à confirmer (A4) |

## 7. n8n — automatisations (décision imposée)

| Élément | Contenu |
|---|---|
| Fournisseur | n8n |
| Fonctionnalité | Déclencheur planifié signé du scheduler |
| Documentation officielle (contract établi côté produit) | Contrat HMAC bidirectionnel `X-HESYD-Timestamp` + `X-HESYD-Signature` (HMAC SHA-256 de `timestamp.corps`), anti-rejeu 300 s |
| Écarts corrigés (cette session) | Le workflow exporté ciblait `POST /api/health` **non signé** (bypass du contrat) ; corrigé : cible `POST /api/scheduler/tick` ; `POST /api/health` exige désormais la même signature ; reprise des jobs `RETRY_PROGRAMME` implémentée côté scheduler (claim atomique `lockedAt/lockedBy`) |
| Écarts corrigés (14/11/2026) | **Mismatch d'en-têtes corrigé** : le vérificateur lisait `x-hesy-timestamp`/`x-hesy-signature` alors que l'émetteur et les workflows exportés envoient `X-HESYD-Timestamp`/`X-HESYD-Signature` — tout appel n8n conforme était rejeté 403 ; le contrat signé n8n→HESYD est désormais réellement applicable (`n8n.ts`, `tick/route.ts`, `health/route.ts`) |
| Implémentation | `src/lib/connectors/n8n.ts`, `src/app/api/scheduler/tick/route.ts`, `src/app/api/health/route.ts`, `n8n/workflows/hesyd-automatisations.json`, `src/lib/scheduler.ts` |
| Tests | `POST /api/health` sans signature → **403** (vérifié en direct) ; `POST /api/scheduler/tick` sans signature → **403** ; exécution réelle sur instance n8n : **BLOQUÉ EXTERNE E5** |
| Limitations | Scheduler in-process actif en parallèle (décision D9) jusqu'à l'instance n8n réelle |

---

## Récapitulatif des blocages externes (aucun simulé)

| # | Blocage | Ce qui est prêt | Ce qui manque |
|---|---|---|---|
| E1 | Meta WhatsApp | Webhook signé, appairage, réponse canal, ASR | Identifiants Meta + éligibilité |
| E2 | Google Drive / OAuth / Document AI | Drive REST + OCR Document AI + OAuth PKCE | `GOOGLE_CLIENT_ID/SECRET`, `DRIVE_ENCRYPTION_KEY`, projet Document AI + compte de service |
| E3 | Polar | Checkout + webhooks signés + crédits de cycle réels | `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, IDs produits |
| E4 | Resend | Envoi réel + gabarits + flux branchés | `RESEND_API_KEY`, `RESEND_FROM`, domaine vérifié |
| E5 | n8n | Contrat signé + workflows exportés corrigés | Instance n8n + `N8N_SHARED_SECRET` |
| E6 | PostgreSQL/pgvector (Neon, imposé) | Schéma portable + migrations versionnées baseline | Instance Neon au déploiement |
| E7 | Build de production VPS | Dockerfile, compose, nginx, docs | Exécution VPS |
| E8 | Azure AI Foundry | Couche fournisseur branchée partout | Endpoint + clé + déploiement |
