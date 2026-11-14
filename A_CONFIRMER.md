# A_CONFIRMER.md — Informations externes à confirmer (ne bloquent pas le développement)

| # | Sujet | Hypothèse de travail retenue | Ce qui reste à confirmer |
|---|---|---|---|
| A1 | Pays d'immatriculation de l'entreprise exploitante | France (devise EUR, TVA 20 %, légalisation des archives électroniques conforme) | Pays réel → ajuste prestataire de paiement et mentions légales |
| A2 | Prestataire de paiement | **Polar — DÉCIDÉ par le commanditaire (règle absolue, 14/11/2026).** Connecteur réel livré (Checkout API + webhooks Standard Webhooks, idempotence atomique, crédits = Plan.monthlyCredits). Interface honnête : dormant sans `POLAR_ACCESS_TOKEN`/`POLAR_WEBHOOK_SECRET` | Stripe retiré du code ; MVP/Paddle hors périmètre sans nouvelle décision |
| A3 | Éligibilité Meta Groups API | Collecte = conversation directe WhatsApp Cloud API + dépôt web (canal principal). Groups API = réel si éligible, sinon désactivé honnêtement | Numéro Meta Business réel, vérification d'entreprise, GO/NO-GO Groups API |
| A4 | Google Drive : My Drive ou Shared Drive | My Drive d'un compte de service utilisateur (OAuth utilisateur), périmètre `drive.file` le plus étroit | My Drive vs Shared Drive de l'organisation |
| A5 | Grille de prix | Essai 14 j gratuit sans carte ; Standard 89 €/mois ; Entreprise 290 €/mois (valeurs en base, administrables) | Grille définitive après mesure du coût réel par document |
| A6 | Fournisseur de modèle | **Azure AI Foundry = fournisseur de production (décision commanditaire)** : couche unique `src/lib/ai/provider.ts` branchée sur agent, classification, résumés, rapports, extraction. Sandbox = GLM réel (repli explicite, `modelVersion` journalisé). OCR = **Google Document AI** (imposé, UNIQUE moteur — tout repli OCR alternatif supprimé du code le 14/11/2026) | Budget mensuel + déploiement Azure à provisionner ; aucun fournisseur supplémentaire sans décision |
| A7 | Hébergement VPS | Hypothèse : VPS 4 vCPU/8 GB, Docker Compose + Nginx + HTTPS | Fournisseur VPS réel, région (données archives françaises) |
| A8 | RPO/RTO | Proposition : RPO 24 h (sauvegarde quotidienne chiffrée), RTO 8 h — non acquis avant exercice réel | Exercice de restauration sur infrastructure réelle |
| A9 | Numéro WhatsApp de test | Le webhook réel est actif dès que `WHATSAPP_*` est fourni ; aucun numéro fictif n'est affiché dans l'UI | Numéro de test Meta + secret d'app |
