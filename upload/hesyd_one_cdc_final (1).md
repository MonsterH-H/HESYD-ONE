---
title: "CAHIER DES CHARGES FONCTIONNEL ET TECHNIQUE"
subtitle: "HESYD ONE — Agent documentaire connecté à WhatsApp et aux clouds de stockage"
date: "Version 1.0 — 12 novembre 2026"
---

**Produit :** HESYD ONE — agent IA spécialisé dans la collecte, le classement, l'archivage, la compréhension et l'exploitation des documents, avec exécution de tâches programmées.
**Statut :** Spécification consolidée — à valider par le commanditaire avant réalisation.
**Nature :** application web par abonnement, multi-organisation, exploitée et vendue comme produit.

---

## Fiche de contrôle du document

| Élément | Définition |
|---|---|
| Version du document | 1.0 — 12 novembre 2026 |
| Objet | Définition complète du produit HESYD ONE : périmètre, fonctions, interactions des utilisateurs et des administrateurs, parcours client, abonnement et monétisation, architecture, sécurité, recette et plan de réalisation |
| Nom du produit | **HESYD ONE** |
| Périmètre organisationnel | Plusieurs organisations abonnées, strictement isolées ; chacune connecte son propre Google Drive |
| Stockage documentaire | Google Drive de l'organisation abonnée, avec classement par client et par groupe ; autres clouds ensuite |
| Canaux | Interface web, conversation WhatsApp directe avec l'agent, WhatsApp Groups API sous réserve de validation technique |
| Modèle économique | Abonnement mensuel ou annuel par organisation, avec quotas et crédits de traitement (section 9) |
| Référentiel technique | Next.js (TypeScript), PostgreSQL (pgvector), n8n (obligatoire), Google Drive API, WhatsApp Business Platform, modèle IA à appels d'outils, prestataire de paiement, VPS Linux, Nginx |

## Sommaire

1. Synthèse du projet
2. Décisions fonctionnelles validées
3. Périmètre
4. Acteurs et droits d'accès
5. Organisation de l'application et interactions
6. Spécifications fonctionnelles détaillées — socle documentaire
7. Agent documentaire intégré
8. Automatisations, planifications et sauvegardes
9. Parcours client, abonnement et monétisation
10. Parcours d'usage et workflows de référence
11. Règles métier, statuts et traçabilité
12. Intégrations externes et contraintes de faisabilité
13. Architecture technique cible
14. Modèle de données cible
15. Sécurité, confidentialité et conformité opérationnelle
16. Exigences non fonctionnelles et exploitation
17. Critères de recette et conditions d'acceptation
18. Plan de réalisation recommandé
19. Livrables attendus
20. Décisions et informations à confirmer
21. Conclusion et engagement de périmètre
Annexes A et B — Références techniques et définitions

::: {.pagebreak}
:::

> **Principe de lecture :** les décisions décrites dans ce document constituent le périmètre cible. Les conditions dépendant des fournisseurs externes (éligibilité WhatsApp, autorisations Google, modèle IA) restent soumises à une validation sur les comptes réels avant toute promesse de mise en production.
>
> **Règle de périmètre :** chaque fonctionnalité doit renforcer la capacité de HESYD ONE à recevoir, classer, archiver, comprendre, exploiter ou automatiser l'information documentaire et les opérations qui en découlent. Une fonctionnalité sans lien avec cette mission n'a pas sa place dans le produit.

# 1. Synthèse du projet

## 1.1. Contexte

Une organisation échange des documents avec ses clients au moyen de groupes WhatsApp et de conversations. Un même client peut disposer de plusieurs groupes, par exemple pour la comptabilité, l'administration, les opérations ou la direction.

Les fichiers reçus doivent être enregistrés, rattachés au bon client et au bon groupe, classés selon des règles constantes, puis archivés dans le Google Drive de l'organisation. Les employés doivent ensuite pouvoir les rechercher, les consulter, les interroger et en tirer des rapports, depuis une seule application.

Le processus manuel expose l'organisation à plusieurs risques : perte de documents dans les conversations, classement irrégulier, confusion entre groupes, doublons, difficultés de recherche, absence de visibilité sur les traitements échoués, et temps perdu à produire à la main résumés et rapports.

## 1.2. Objectif général

Développer une application web par abonnement qui automatise le cycle documentaire suivant :

**Source (groupe WhatsApp compatible, conversation directe, dépôt web, dossier cloud surveillé) → Réception → Identification du groupe et du client → Vérification du fichier → Classement → Archivage Google Drive → Indexation et compréhension → Consultation, questions, rapports et tâches programmées.**

L'application assure la traçabilité des opérations. L'intervention humaine n'est requise que pour une décision, une correction, une reprise ou une validation d'action sensible.

## 1.3. Résultat métier attendu

À la livraison, les employés autorisés peuvent :

- retrouver un document sans parcourir manuellement les conversations WhatsApp ;
- savoir de quel client et de quel groupe provient chaque réception ;
- vérifier si le document est réellement présent dans le dossier Drive prévu ;
- retrouver les réceptions précédentes d'un même document ;
- identifier les erreurs et les traiter sans perdre la réception initiale ;
- consulter l'activité générale et l'état des intégrations ;
- **poser des questions en langage naturel sur leurs documents et obtenir des réponses sourcées** ;
- **demander à l'agent de créer des résumés, rapports, tableaux Excel, documents Word ou PDF** ;
- **programmer des tâches récurrentes (collecte et classement périodiques, rapport hebdomadaire, alerte de document manquant)** ;
- **recevoir un rapport sur WhatsApp ou le déposer dans un stockage choisi**.

L'administrateur peut configurer les connexions, gérer les clients et groupes, importer le référentiel initial, gérer les utilisateurs, superviser les traitements, définir les règles d'approbation de l'agent et gérer l'abonnement.

## 1.4. Priorité absolue

La priorité n'est pas de multiplier les fonctionnalités. Elle est de garantir huit résultats :

1. réceptionner un événement documentaire depuis une source réellement compatible ;
2. identifier sans ambiguïté son groupe et son client ;
3. conserver le fichier et sa provenance sans écrasement ni perte silencieuse ;
4. l'archiver dans le bon dossier Google Drive et confirmer l'opération ;
5. permettre aux employés de le retrouver et de traiter les exceptions ;
6. répondre aux questions sur les documents avec des sources vérifiables, sans inventer ;
7. produire des livrables corrects, contrôlés et versionnés ;
8. exécuter les tâches programmées de façon fiable, sans doublon ni perte, avec un compte rendu honnête.

Toute fonctionnalité qui ne contribue pas directement à ces résultats reste hors du premier périmètre.

## 1.5. Positionnement

HESYD ONE n'est pas un agent généraliste. C'est un agent **spécialisé dans le domaine documentaire** : il dispose d'un nombre limité d'outils, tous orientés documents (recevoir, classer, archiver, lire, rechercher, comparer, produire, envoyer, programmer). Il est hébergé, sans installation, utilisable par un non-technicien, et livré avec des tâches prêtes à l'emploi. Le navigateur piloté, les sous-agents, le code libre, les marketplaces de compétences et la construction d'agents arbitraires sont hors périmètre.

# 2. Décisions fonctionnelles validées

| Sujet | Décision retenue |
|---|---|
| Collecte WhatsApp | Conversation directe avec l'agent (canal principal) ; groupes pris en charge par l'intégration officielle, sous réserve du GO / NO-GO (§ 12.1) |
| Stockage | Google Drive de l'organisation abonnée ; autres clouds ensuite via une interface de connecteur de stockage |
| Organisation Drive | Client → Groupe → Catégorie → Année → Mois |
| Relation client / groupe | Un client peut posséder un ou plusieurs groupes ; chaque groupe appartient à un seul client |
| Configuration des groupes | Chaque groupe possède son propre statut, ses références externes et son dossier de classement |
| Visibilité des données | Au sein d'une organisation, tous les employés disposant d'un compte actif et autorisé consultent tous les clients, groupes et fichiers ; aucune visibilité entre organisations |
| Permissions | Les actions sensibles sont contrôlées par rôle ; la visibilité n'est pas cloisonnée par client |
| Type d'application | Application web par abonnement, multi-organisation |
| Interface et backend métier | **Next.js (TypeScript)** : écrans, API, authentification, permissions, webhooks, approbations |
| Automatisation | **n8n, obligatoire** : workflows, tâches programmées, intégrations, reprises, contrôles planifiés |
| Base de données | PostgreSQL (source de vérité) avec pgvector pour la recherche sémantique |
| Agent | Un agent unique, spécialisé documents, agissant uniquement par outils typés, permissionnés et vérifiés |
| Worker | Aucun par défaut ; un worker de traitements longs n'est ajouté que si le besoin est démontré (§ 13.3) |
| Modèle économique | Abonnement mensuel ou annuel payé par le propriétaire de l'organisation ; quotas et crédits de traitement ; packs de crédits ; essai gratuit de 14 jours sans moyen de paiement (§ 9) |
| Paiement | Prestataire de paiement par abonnement, page de paiement hébergée, état de l'abonnement mis à jour uniquement par webhooks signés (§ 9.6) |
| Numéro WhatsApp | Numéro de la plateforme partagé par défaut, appairage par code à usage unique ; numéro dédié pour l'offre supérieure (§ 9.3.2) |
| Propriété des documents | Les archives restent dans le Google Drive du client ; HESYD ONE conserve index, extractions, conversations et livrables (§ 9.9) |

## 2.1. Clarification du périmètre Google Drive

Le Drive de référence est celui de **l'organisation abonnée**. Il contient un dossier racine d'archives, puis un dossier distinct pour chaque client suivi et pour chacun de ses groupes.

Chaque organisation connecte son propre Drive. Il n'y a pas de connexion Google distincte pour chaque client métier répertorié dans l'application. Si le besoin est que chaque client métier connecte et contrôle son propre Drive, il s'agit d'un autre périmètre (plusieurs connexions OAuth, plusieurs propriétaires de stockage, règles d'accès séparées), non inclus dans cette version.

## 2.2. Règle multi-groupes

Un client peut avoir un, deux ou plusieurs groupes. Chaque groupe possède un code interne unique et une association WhatsApp indépendante lorsqu'elle est techniquement disponible.

La suspension ou la déconnexion d'un groupe ne bloque pas les autres groupes du même client. L'ajout d'un groupe ne nécessite pas la recréation du client ni la modification des groupes déjà opérationnels.

## 2.3. Règle d'accès global dans l'organisation

Tout utilisateur actif d'une organisation peut consulter l'ensemble des données documentaires de cette organisation. Il n'existe pas de cloisonnement de visibilité par client ou par groupe. En revanche, la création de clients, la configuration des intégrations, la gestion des utilisateurs, les règles d'approbation de l'agent et les autres actions sensibles restent réservées à l'administrateur ou à un employé disposant explicitement de l'autorisation correspondante.

## 2.4. Règle de l'agent

L'agent agit **avec les droits de l'utilisateur qui le sollicite** (ou, pour une tâche programmée, avec les droits de l'administrateur qui l'a validée), jamais avec des droits supérieurs. Il ne touche jamais directement la base de données, le système de fichiers ou le réseau : il utilise uniquement les outils du catalogue (§ 7.2).

# 3. Périmètre

## 3.1. Fonctionnalités incluses

1. authentification, organisations et gestion des utilisateurs ;
2. tableau de bord opérationnel ;
3. gestion des clients ;
4. gestion de plusieurs groupes WhatsApp par client ;
5. réception directe des événements et médias depuis les groupes compatibles ;
6. réception de fichiers dans la conversation directe avec l'agent, par dépôt web et par dossier cloud surveillé ;
7. gestion des fichiers et de leurs différentes réceptions ;
8. classement et archivage Google Drive ;
9. recherche, filtres et consultation des documents ;
10. file « À traiter » pour les anomalies ;
11. reprise des traitements et historique ;
12. import Excel/CSV des clients et groupes ;
13. ajout manuel de fichiers pour les cas exceptionnels ;
14. configuration des intégrations, notifications et journaux ;
15. sauvegarde et restauration documentées ;
16. **agent documentaire : lecture, OCR, extraction, classification, résumé, comparaison, recherche sémantique, questions-réponses sourcées** ;
17. **production de livrables : rapports PDF, tableaux Excel, documents Word, graphiques, résumés, comptes rendus, courriers** ;
18. **missions multi-étapes avec plan, clarification, validation et preuves** ;
19. **tâches programmées et déclenchées par événement (collecte, classement, rapports, alertes)** ;
20. **contrôle documentaire : pièces manquantes, échéances, incohérences** ;
21. **mémoire et préférences contrôlables par l'utilisateur** ;
22. **niveaux d'autonomie, approbations et garde-fous de l'agent** ;
23. **évaluation de la qualité de l'agent et suivi des coûts** ;
24. **abonnement, quotas et mesure d'usage** ;
25. **mode démonstration** sur une organisation dédiée ;
26. **parcours client guidé** : inscription, essai, assistant de démarrage, connexion de Google Drive et de WhatsApp, premier résultat en quelques minutes ;
27. **paiement et facturation** par prestataire, packs de crédits, relances d'impayés, résiliation et export ;
28. **back-office de l'opérateur** de la plateforme (organisations, offres, usage, exceptions, support encadré).

## 3.2. Fonctionnalités exclues

- CRM commercial, facturation ou paiement des clients métier de l'organisation ;
- portail externe destiné aux clients métier ;
- application mobile native (la version web adaptative suffit) ;
- connexion d'un Drive indépendant pour chaque client métier ;
- synchronisation bidirectionnelle complète de tous les changements effectués dans Drive ;
- lecture non officielle de WhatsApp Web, scraping ou automatisation d'une session WhatsApp personnelle ;
- migration automatique garantie de l'historique complet des anciennes conversations WhatsApp ;
- agent généraliste hors domaine documentaire ;
- navigateur piloté, sous-agents, exécution de code libre, marketplace de compétences tierces, constructeur d'agents arbitraires, marque blanche, API publique et widget (évolutions éventuelles après validation commerciale) ;
- actions financières réelles (paiements, virements) ;
- entraînement ou ajustement fin de modèles ;
- validation métier ou comptable des pièces à la place de l'utilisateur : l'agent signale et propose, l'humain décide.

Les fonctions exclues pourront être étudiées dans une version ultérieure, après validation d'un besoin réel.

## 3.3. Limites assumées

Le classement automatique des fichiers reçus s'appuie sur leurs métadonnées techniques (type MIME, extension, taille, règles configurées). La compréhension du contenu relève de l'agent (section 7) : il peut proposer une catégorie documentaire avec un niveau de confiance, mais le classement documentaire par contenu reste toujours confirmable ou corrigeable par un humain.

L'agent peut se tromper. Il doit citer ses sources, distinguer certitude et hypothèse, demander confirmation avant les actions à effet externe, et ne jamais annoncer un succès sans preuve technique.

La compatibilité des formats, tailles et médias dépend des capacités et limites effectives de WhatsApp, du serveur, de Google Drive et du modèle IA. Une liste de formats ne constitue pas une garantie avant les essais de bout en bout.

# 4. Acteurs et droits d'accès

## 4.1. Propriétaire d'organisation

Tous les droits de l'administrateur, plus : gestion de l'abonnement et de la facturation, export complet et suppression de l'organisation.

## 4.2. Administrateur

L'administrateur peut :

- créer, modifier, suspendre, réactiver et archiver les fiches clients ;
- ajouter, modifier, suspendre, réactiver et archiver les groupes ;
- importer les clients et les groupes ;
- configurer WhatsApp et Google Drive ;
- définir les catégories, les règles de nommage et les paramètres de traitement ;
- consulter l'ensemble des documents et réceptions ;
- traiter les anomalies et relancer les opérations ;
- gérer les comptes utilisateurs et leurs permissions ;
- consulter les journaux opérationnels et techniques ;
- effectuer les opérations administratives de sauvegarde et de restauration selon la procédure prévue ;
- définir les politiques d'approbation de l'agent, activer ou désactiver ses outils, créer et valider les tâches programmées ;
- consulter l'usage et les coûts de l'agent.

## 4.3. Employé / Opérateur

L'employé peut, selon les permissions activées :

- consulter tous les clients, groupes et fichiers de son organisation ;
- rechercher et ouvrir les fiches documentaires ;
- accéder au document dans Drive, sous réserve des permissions Google Drive de son compte ;
- consulter les réceptions et l'historique ;
- prendre en charge une anomalie ;
- ajouter un commentaire, corriger une association lorsque son autorisation le permet et relancer un traitement ;
- ajouter manuellement un fichier si cette action lui est autorisée ;
- consulter et marquer les notifications comme lues ;
- discuter avec l'agent, lui confier des missions, consulter ses livrables et valider les actions dans la limite de ses droits.

Il ne peut pas modifier les identifiants d'intégration, les secrets, les connexions globales ou les paramètres sensibles réservés à l'administrateur.

## 4.4. Lecteur

Consultation des documents, livrables et conversations partagées ; aucune action de modification ni de lancement de tâche.

## 4.5. Invité de démonstration

Accès restreint à l'organisation de démonstration, sans accès aux données d'aucune autre organisation.

## 4.6. Matrice des permissions

| Action | Propriétaire | Administrateur | Employé / Opérateur | Lecteur |
|---|---:|---:|---:|---:|
| Consulter tous les clients, groupes et fichiers | Oui | Oui | Oui | Oui |
| Rechercher et consulter l'historique | Oui | Oui | Oui | Oui |
| Ouvrir le document dans Drive | Selon droits Drive | Selon droits Drive | Selon droits Drive | Selon droits Drive |
| Créer ou modifier un client | Oui | Oui | Non par défaut | Non |
| Ajouter ou modifier un groupe | Oui | Oui | Non par défaut | Non |
| Suspendre ou réactiver un groupe | Oui | Oui | Non | Non |
| Traiter une anomalie | Oui | Oui | Oui si autorisé | Non |
| Corriger une association | Oui | Oui | Selon permission | Non |
| Relancer un traitement | Oui | Oui | Selon permission | Non |
| Ajouter un fichier manuellement | Oui | Oui | Selon permission | Non |
| Importer les clients et groupes | Oui | Oui | Non par défaut | Non |
| Modifier les intégrations | Oui | Oui | Non | Non |
| Gérer les utilisateurs | Oui | Oui | Non | Non |
| Consulter les journaux techniques détaillés | Oui | Oui | Consultation limitée si nécessaire | Non |
| Discuter avec l'agent, lancer une mission | Oui | Oui | Oui | Non |
| Approuver une action sensible de l'agent | Oui | Oui | Selon permission | Non |
| Créer ou valider une tâche programmée | Oui | Oui | Selon permission | Non |
| Définir les politiques d'approbation | Oui | Oui | Non | Non |
| Gérer l'abonnement et la facturation | Oui | Non | Non | Non |

Les permissions sont contrôlées côté backend. Masquer un bouton dans l'interface ne constitue pas une protection suffisante.

## 4.7. Principes de gestion des comptes

Chaque utilisateur possède un compte nominatif. Les comptes partagés entre plusieurs employés sont interdits. Un compte désactivé ne peut plus ouvrir de session ni exécuter d'action.

Les actions sensibles sont journalisées avec l'identifiant de l'utilisateur, la date, l'objet concerné et le résultat. Les mots de passe sont hachés avec un algorithme adapté ; ils ne sont jamais enregistrés en clair. L'authentification multifacteur est disponible et la connexion par Google est proposée.

## 4.8. Appairage WhatsApp

Un numéro WhatsApp est rattaché à un utilisateur par une procédure d'appairage vérifiée (code à usage unique). Un message provenant d'un numéro non appairé n'a accès à aucune donnée : il reçoit une réponse standard et aucun fichier n'est archivé (§ 9.3.2).

## 4.9. Opérateur de la plateforme (back-office HESYD ONE)

L'opérateur de la plateforme est l'équipe interne qui exploite et vend HESYD ONE. Ce rôle est distinct des rôles d'organisation : il s'exerce dans une console séparée, protégée par authentification multifacteur obligatoire, et n'est jamais attribuable par un client.

Fonctions :

- liste des organisations avec offre, statut d'abonnement, date d'inscription et dernière activité ;
- usage et coût de traitement par organisation (jetons, OCR, messages WhatsApp), afin de suivre la marge ;
- gestion des offres, quotas, options et crédits **par configuration**, sans redéploiement ;
- gestes commerciaux et exceptions : prolonger un essai, offrir des crédits, appliquer une remise, suspendre ou réactiver une organisation ;
- état global des services (WhatsApp, Drive, modèle IA, n8n, base de données, file de traitement) et alertes d'exploitation ;
- gestion des modèles de messages WhatsApp et du numéro partagé de la plateforme ;
- traitement des demandes d'export et de suppression de données.

**Règle de confidentialité :** l'opérateur n'a aucun accès au contenu documentaire d'une organisation par défaut. Il voit des métadonnées d'exploitation (statuts, compteurs, erreurs). Pour une assistance nécessitant de voir davantage, l'administrateur de l'organisation accorde un accès temporaire explicite (durée limitée, révocable) ; chaque consultation est journalisée et visible dans l'audit de l'organisation.

# 5. Organisation de l'application et interactions

## 5.1. Navigation principale

L'application comporte onze rubriques :

1. **Vue d'ensemble** : activité et état du système ;
2. **Clients** : référentiel et fiches clients ;
3. **Groupes WhatsApp** : groupes, associations et statut de collecte ;
4. **Fichiers** : recherche, consultation et historique documentaire ;
5. **À traiter** : anomalies et interventions humaines ;
6. **Assistant** : conversation avec l'agent, espace de travail des missions (plan, outils appelés, sources, résultats) ;
7. **Livrables** : rapports, tableaux et documents produits ;
8. **Automatisations** : tâches programmées, règles et historique d'exécution ;
9. **Approbations** : actions de l'agent en attente de validation ;
10. **Imports et reprise** : import du référentiel et inventaire de l'existant ;
11. **Administration** : utilisateurs, intégrations, règles, abonnement et surveillance.

Les notifications, les journaux et l'historique d'une entité sont accessibles depuis les écrans concernés. Ils ne nécessitent pas de rubriques supplémentaires.

## 5.2. Comportement commun de l'interface

L'interface comprend une navigation claire, le compte connecté, un centre de notifications, les états des intégrations, des listes paginées, des filtres et des messages explicites de réussite ou d'erreur.

Les écrans prévoient les états suivants : chargement, liste vide, absence de résultat, erreur de connexion, accès refusé et opération en cours. Une action destructive ou irréversible demande confirmation et affiche les conséquences.

L'application est conçue en priorité pour un usage sur ordinateur, tout en restant utilisable sur tablette et mobile. Les réponses de l'agent sont diffusées en continu. Thème clair et sombre ; interface en français, architecture prête pour l'anglais et l'arabe (sens d'écriture inclus).

## 5.3. Espace de travail de l'agent (Agent Workbench)

Pour chaque mission, l'écran affiche en temps réel : l'objectif compris, le plan et son avancement, les appels d'outils (outil, paramètres résumés, résultat, durée), les sources consultées, les questions posées, les approbations demandées, le livrable produit et le statut final (réussie, partiellement réussie, échouée, en attente). L'utilisateur voit l'agent travailler, pas seulement une réponse finale.

## 5.4. Écrans clés et interactions

| Écran | Qui | Ce que fait la personne | Ce que le système répond |
|---|---|---|---|
| **Assistant de démarrage** (checklist visible tant que la mise en service n'est pas terminée) | Administrateur | Suit cinq étapes : connecter Google Drive, appairer son WhatsApp, vérifier le référentiel, inviter l'équipe, envoyer un premier document | Chaque étape affiche son état (à faire, en cours, validée, en erreur) avec le test réel effectué et l'action de correction |
| **Assistant** (conversation) | Employé, administrateur | Écrit ou dicte une demande, joint un fichier, répond aux questions de l'agent | Réponse diffusée en continu avec sources cliquables ; plan et outils appelés visibles dans l'Agent Workbench ; boutons de réponse rapide quand un choix est demandé |
| **Fichiers** | Tous | Recherche en langage naturel ou par filtres, ouvre une fiche, demande un résumé ou une comparaison | Résultats classés par pertinence avec extrait et provenance ; accès direct au document dans Drive |
| **À traiter** | Employé autorisé, administrateur | Prend en charge un cas, choisit le bon client/groupe, relance ou rejette avec motif | Mise à jour immédiate, historique conservé, avertissement si un collègue traite déjà le cas |
| **Approbations** | Employé autorisé, administrateur | Voit l'aperçu exact de l'action (destinataire, contenu, document) et choisit Approuver, Modifier ou Refuser | Exécution uniquement après approbation ; une modification invalide l'approbation précédente |
| **Automatisations** | Employé autorisé, administrateur | Choisit un modèle ou décrit la règle, règle la fréquence et la destination, valide, active ou met en pause | Règle structurée affichée pour validation, prochaines exécutions listées, historique et taux de réussite (§ 8.6) |
| **Livrables** | Tous | Consulte, télécharge, demande une nouvelle version | Versions conservées, lien sécurisé à expiration, sources utilisées affichées |
| **Administration** | Administrateur | Gère utilisateurs, intégrations, règles de classement, politiques de l'agent, plafonds, journaux | Tests de connexion réels, journalisation de chaque modification |
| **Abonnement et usage** | Propriétaire (facturation) ; administrateur (usage) | Suit la consommation, change d'offre, achète des crédits, met à jour le paiement, télécharge les factures, résilie | Usage en temps réel, alertes avant dépassement, effets de chaque changement expliqués avant confirmation (§ 9) |

### Principes d'interaction

- l'utilisateur sait toujours **ce qui se passe maintenant** (en cours, en attente de lui, terminé, en erreur) et **ce qu'on attend de lui** ;
- sur WhatsApp, chaque réponse de l'agent tient en quelques lignes, avec le lien vers le détail dans l'application ; les actions à valider arrivent sous forme de message avec boutons Approuver / Refuser ;
- toute erreur affichée indique la cause en langage simple et l'action de correction (par exemple « Google Drive doit être reconnecté », avec le bouton) ;
- aucune action irréversible sans confirmation indiquant ses conséquences.

# 6. Spécifications fonctionnelles détaillées — socle documentaire

## 6.1. Module — Vue d'ensemble

### Objectif

Donner une lecture rapide de l'activité et des éventuels blocages.

### Indicateurs

- clients actifs ;
- groupes actifs, suspendus et déconnectés ;
- nombre de réceptions sur la période sélectionnée ;
- nombre de fichiers distincts ;
- fichiers archivés ;
- fichiers en cours de traitement ;
- éléments en attente de vérification ;
- traitements en erreur ou bloqués ;
- missions de l'agent en cours, en attente d'approbation ou échouées ;
- tâches programmées actives et dernier résultat ;
- usage de l'abonnement (tâches, jetons, stockage) par rapport aux quotas.

Les compteurs distinguent les **réceptions** des **fichiers distincts**. Une réception supplémentaire du même document ne gonfle pas artificiellement le nombre de fichiers uniques.

### Activité récente

Afficher les événements utiles : nouvelle réception, archivage confirmé, échec, reprise, anomalie créée ou résolue, client ou groupe modifié, import terminé, intégration déconnectée, mission terminée, livrable produit, tâche programmée exécutée ou échouée.

Chaque ligne indique, lorsque disponible, le fichier, le client, le groupe, la date, l'utilisateur ou le système responsable et le résultat.

### État des intégrations

Afficher l'état réel de WhatsApp, Google Drive, du backend, de n8n, de la base de données et du modèle IA. Le statut « connecté » n'est utilisé que si un contrôle technique récent a réussi. Afficher également la dernière réception, le dernier archivage réussi et le nombre de tâches en attente.

### Interactions

Chaque indicateur ouvre la liste correspondante avec les filtres déjà appliqués. Un clic sur une activité ouvre la fiche de l'entité concernée.

## 6.2. Module — Clients

### Liste des clients

Colonnes minimales : code, nom, nombre de groupes, nombre de fichiers, dernière activité, statut et actions.

Fonctions : recherche par code ou nom, filtre par statut, tri, pagination et création.

### Création et modification

Champs :

- code client unique et stable ;
- nom du client ;
- coordonnées utiles, facultatives selon le besoin opérationnel ;
- statut ;
- commentaire interne facultatif.

Le code est unique au sein de l'organisation. Le système refuse les doublons et explique la raison. Un client peut être créé avant ses groupes ; son état indique alors qu'il n'est pas encore opérationnel.

### Fiche client

La fiche comprend :

1. informations générales et statut ;
2. liste des groupes associés avec état de collecte, dernière réception et nombre de fichiers ;
3. dossier client dans Google Drive et état du mapping ;
4. liste des fichiers et réceptions du client ;
5. activités, anomalies et corrections récentes ;
6. livrables et missions de l'agent concernant ce client.

L'action « Ajouter un groupe » est disponible depuis cette fiche.

### Suspension et archivage

La suspension d'un client bloque le passage automatique de ses nouvelles réceptions vers l'archivage normal. Les événements reçus restent enregistrés et sont dirigés vers « À traiter » ou vers un état d'attente explicite.

Les fichiers déjà archivés restent consultables. L'archivage logique de la fiche ne supprime ni les fichiers de la base ni les documents du Drive.

Aucune suppression en cascade des archives n'est autorisée.

## 6.3. Module — Groupes WhatsApp

### Liste des groupes

Afficher : code interne, nom, client, identifiant externe WhatsApp lorsqu'il existe, état d'intégration, statut, nombre de réceptions, dernière activité et actions.

Filtres : client, statut, état d'intégration et période de dernière activité.

### Fiche de groupe

La fiche comprend :

- code interne unique ;
- nom du groupe ;
- client propriétaire ;
- identifiant externe fourni par l'API, lorsqu'il existe ;
- état de compatibilité et état de collecte ;
- référence du dossier Drive du groupe ;
- date du dernier événement reçu ;
- nombre de réceptions et de fichiers ;
- erreurs, tentatives et historique.

Le nom du groupe ne constitue pas une clé d'identification fiable, car il peut changer. L'association repose sur l'identifiant externe stable lorsqu'il est fourni par l'intégration. Le code interne reste la référence de l'application.

### Ajout d'un groupe

Depuis la fiche d'un client, l'administrateur renseigne le nom, le code interne et les informations requises pour raccorder une source compatible. Le système vérifie l'unicité du code, l'association au client, l'identifiant externe disponible, la compatibilité du groupe avec l'intégration et la configuration Drive.

Le groupe ne devient **Actif** qu'après :

1. validation technique de la connexion ;
2. réception d'un événement de test réel ;
3. identification correcte du groupe et du client ;
4. récupération d'un fichier de test ;
5. archivage de ce fichier dans le dossier attendu ;
6. confirmation de l'accès au document.

### Groupe sans WhatsApp (source alternative)

Un « groupe » peut aussi représenter un canal de dépôt non WhatsApp (conversation directe avec l'agent, dépôt web, dossier cloud surveillé) rattaché à un client. Il suit les mêmes règles de statut et de test d'activation. Le type de source est enregistré.

### Modification, suspension et réactivation

La modification du nom ou des paramètres ne change pas l'identifiant historique du groupe.

La suspension d'un groupe arrête son archivage automatique, mais les événements entrants identifiables continuent d'être enregistrés et mis en attente. Les autres groupes du client ne sont pas affectés.

La réactivation nécessite une vérification de la connexion, du mapping Drive et des éléments en attente avant la reprise.

### Groupes existants

Le fait de saisir un nom, un identifiant supposé ou un lien d'invitation ne prouve pas qu'un groupe WhatsApp classique est raccordable à la Groups API. La compatibilité est validée par l'API et par un test réel. Aucun groupe n'est affiché comme opérationnel sur la seule base d'une saisie manuelle.

## 6.4. Module — Fichiers et réceptions

### Principe de modélisation

L'application distingue deux notions :

- **Fichier documentaire** : document logique archivé pour un groupe donné ;
- **Réception** : chaque transmission du document, avec sa provenance, sa date et son résultat de traitement.

Un même fichier documentaire peut avoir plusieurs réceptions. Une réception conserve toujours sa propre trace, même lorsque son contenu est identique à celui d'un fichier déjà archivé.

### Types de fichiers

Catégories techniques proposées :

| Catégorie | Exemples indicatifs |
|---|---|
| Documents | PDF, DOC, DOCX, TXT, ODT |
| Tableurs | XLS, XLSX, CSV, ODS |
| Images | JPG, JPEG, PNG, WEBP, GIF |
| Présentations | PPT, PPTX, ODP |
| Archives | ZIP, RAR, 7Z |
| Audio | MP3, WAV, M4A, OGG |
| Vidéo | MP4, MOV, AVI, MKV |
| Techniques | JSON, XML, SQL, LOG, YAML |
| Autres | Formats non reconnus ou non classés |

Cette liste constitue une grille de test, pas une promesse de prise en charge exhaustive. Les formats et limites de taille acceptés sont définis après les tests avec les comptes et groupes réels. Un fichier non reconnu n'est pas supprimé silencieusement : il est conservé en attente ou en quarantaine selon le contrôle de sécurité.

La compréhension par l'agent (lecture, OCR, extraction) s'applique aux formats textuels, tableurs, images et PDF ; les autres formats sont archivés et indexés par leurs métadonnées uniquement.

### Liste des fichiers

Colonnes minimales : nom original, nom archivé, client, groupe, catégorie, taille, date de première réception, dernière réception, statut d'archivage, état d'indexation et actions.

Filtres : client, groupe, catégorie, période, statut, type de document détecté et nom. La recherche porte sur les métadonnées et, une fois le document indexé, sur son contenu (§ 7.4).

### Fiche documentaire

La fiche présente :

**Métadonnées du fichier** : nom original, nom archivé, extension, type MIME détecté, taille, empreinte SHA-256, catégorie, dates et statut.

**Provenance** : client, groupe, identifiant de message si disponible, identifiant d'expéditeur si disponible, date du message si disponible et date de réception par le système.

**Google Drive** : identifiant Drive, dossier de destination, URL, date d'archivage et résultat du dernier contrôle d'accessibilité.

**Réceptions** : liste de chaque transmission avec date, source, identifiant externe disponible et résultat de traitement.

**Compréhension** : type de document proposé avec niveau de confiance, résumé, champs extraits (date, montant, partie, référence, échéance) avec leur emplacement source et leur niveau de confiance, état d'indexation.

**Historique** : réception, téléchargement, validation, classement, archivage, indexation, reprise et corrections humaines.

### Contrôle des fichiers

À la réception, le système doit :

- contrôler la taille et les limites configurées ;
- vérifier la cohérence entre extension, MIME annoncé et signature réelle lorsque cela est possible ;
- calculer une empreinte SHA-256 après téléchargement complet ;
- refuser l'exécution ou l'ouverture automatique du contenu ;
- appliquer un contrôle antivirus ou une quarantaine adaptée avant mise à disposition, selon le dispositif retenu ;
- détecter les fichiers incomplets ou corrompus ;
- conserver le nom original en métadonnées et neutraliser les caractères dangereux dans le nom d'archivage.

Les archives compressées ne sont pas décompressées automatiquement.

### Gestion des doublons

1. **Même contenu dans le même groupe** : une seule archive physique est conservée ; chaque transmission est enregistrée comme une nouvelle réception rattachée au même fichier documentaire. La première archive confirmée reste la référence, sauf correction explicite.
2. **Même nom, contenu différent** : les deux fichiers sont conservés séparément ; aucun écrasement n'est autorisé.
3. **Même contenu dans deux groupes différents** : chaque groupe conserve sa propre archive dans son propre dossier ; les deux provenances restent indépendantes.
4. **Même événement webhook renvoyé plusieurs fois** : une seule réception logique est créée grâce à la clé d'idempotence.
5. **Empreinte indisponible avant téléchargement complet** : ne pas déclarer le document comme doublon ; terminer le téléchargement ou mettre la réception en attente.

### Ajout manuel

Un employé autorisé peut déposer un fichier, sélectionner le client et le groupe, puis confirmer l'envoi. La source est marquée `MANUAL_UPLOAD`, l'utilisateur est enregistré et le fichier suit les mêmes contrôles, règles de nommage et étapes d'archivage que les fichiers reçus de WhatsApp.

L'import manuel est un mécanisme de secours opérationnel ; il ne remplace pas la collecte directe.

## 6.5. Module — À traiter

### Objectif

Centraliser les réceptions et traitements qui nécessitent une vérification humaine.

### Motifs

- groupe externe inconnu ou non associé ;
- client ou groupe suspendu ;
- association ambiguë ;
- média inaccessible ou téléchargement incomplet ;
- format non reconnu ou fichier corrompu ;
- contrôle de sécurité non concluant ;
- échec d'envoi ou de confirmation Google Drive ;
- dossier déplacé, supprimé ou inaccessible ;
- permission Google révoquée ;
- dépassement de quota ou limitation temporaire ;
- doublon nécessitant une décision exceptionnelle ;
- document reçu en conversation directe dont le client ou le groupe n'a pas pu être établi ;
- extraction ou classification de contenu à faible confiance ;
- tâche programmée en échec répété.

### Informations affichées

Fichier ou média concerné, motif, client et groupe connus, identifiants externes disponibles, date, nombre de tentatives, dernière erreur, responsable de prise en charge et statut.

### Cycle de traitement humain

Statuts : `NOUVEAU`, `PRIS_EN_CHARGE`, `EN_ATTENTE`, `CORRIGE`, `RESOLU`, `REJETE_JUSTIFIE`.

Actions : consulter, prendre en charge, ajouter un commentaire, associer à un client/groupe lorsque la preuve est suffisante, relancer, résoudre ou rejeter avec justification.

La prise en charge empêche deux opérateurs de corriger simultanément le même cas sans avertissement. Le système conserve l'ancienne valeur, la nouvelle valeur, l'utilisateur, la date et la justification.

**Règle de prudence :** si la provenance ne peut pas être établie avec certitude, le système ne devine pas le client ou le groupe. L'élément reste en attente. L'agent peut proposer une association en citant ses indices, mais ne l'applique jamais seul lorsque la certitude est insuffisante.

## 6.6. Module — Imports et reprise

### Import clients / groupes

Formats : CSV et XLSX. Une ligne représente un groupe et répète les informations du client auquel il appartient.

Colonnes minimales : `code_client`, `nom_client`, `code_groupe`, `nom_groupe`. Les colonnes de contact ou de commentaire peuvent être ajoutées après validation du modèle de fichier.

### Étapes

1. sélection du fichier ;
2. lecture et validation du format ;
3. vérification des colonnes obligatoires ;
4. contrôle des champs vides et des codes dupliqués ;
5. rapprochement avec les clients et groupes existants ;
6. aperçu des créations et des lignes rejetées ;
7. confirmation par l'administrateur ;
8. enregistrement ;
9. rapport final téléchargeable ou consultable.

Aucune donnée existante n'est remplacée ou supprimée silencieusement. Les lignes valides peuvent être importées partiellement après confirmation, à condition que le rapport distingue clairement les lignes créées, ignorées et rejetées.

### Rapport d'import

Le rapport indique le nom du fichier source, l'utilisateur, la date, les lignes analysées, les clients créés ou rapprochés, les groupes créés, les doublons, les lignes invalides et les motifs précis de rejet.

### Inventaire Drive existant

Une opération initiale d'inventaire peut recenser les dossiers et documents déjà présents dans le Drive. Elle ne déplace, ne renomme ni ne supprime les archives sans validation expresse. Les documents inventoriés peuvent ensuite être indexés pour l'agent, sur demande de l'administrateur.

La récupération de l'historique WhatsApp ancien n'est pas garantie par le parcours de collecte des nouvelles réceptions. Elle constitue une opération distincte, dépendante des possibilités du canal source.

## 6.7. Module — Administration

### Connexion WhatsApp

Afficher le compte professionnel, le numéro, l'état de l'autorisation, les permissions, les abonnements webhook requis, la date du dernier événement reçu, le dernier test réussi et le dernier motif d'erreur. Les secrets ne sont jamais affichés en clair.

### Connexion Google Drive

L'administrateur connecte le compte de l'organisation, sélectionne le dossier racine d'archives et lance des tests : lecture du dossier, création d'un sous-dossier, dépôt d'un fichier test, lecture de ses métadonnées et suppression contrôlée du fichier test.

Le test confirme aussi que les employés qui devront consulter les documents disposent des permissions Google Drive nécessaires. L'accès à l'application ne confère pas automatiquement un accès Drive.

### Règles de classement

L'administrateur gère les catégories techniques, le format de nommage, les règles de période, les extensions autorisées ou à vérifier, la taille maximale configurée et la politique de doublons. Toute modification de règle est datée et journalisée.

### Utilisateurs

Création, modification, désactivation, réactivation, réinitialisation contrôlée des accès, attribution des rôles et consultation de l'activité. La désactivation d'un utilisateur révoque ses sessions actives.

### Agent

Activation et désactivation des outils, politiques d'approbation (§ 7.10), liste blanche des destinataires et des numéros autorisés à recevoir des envois, plafonds de coût, interrupteur d'urgence (tâche, outil, organisation), modèles de documents de l'organisation.

### Abonnement et usage

Consultation de l'usage et des alertes de quota par l'administrateur ; gestion de l'offre, du moyen de paiement, des factures et de la résiliation par le propriétaire uniquement (§ 9.6).

### Notifications

Centre interne pour les éléments nécessitant une action : anomalies nouvelles, erreurs durables, intégrations déconnectées, tâches bloquées, imports terminés, approbations en attente, missions terminées et tâches programmées en échec. Les archives réussies ne génèrent pas une notification individuelle par défaut. Les notifications peuvent aussi être envoyées sur WhatsApp.

Chaque notification contient un type, une date, un état lu/non lu et un lien vers l'élément concerné.

### Journaux et surveillance

L'administration expose les événements utiles : état des services, dernière réception, dernier traitement réussi, nombre de tâches en attente, tâches en retard, dernières erreurs et actions sensibles. Les journaux ne contiennent pas de tokens, mots de passe ou contenus documentaires complets.

# 7. Agent documentaire intégré

## 7.1. Principe

L'agent comprend une demande en langage naturel (écrite ou vocale), construit un plan, exécute des outils documentaires réels, demande ce qui lui manque, puis remet un résultat vérifiable avec ses sources. Il est spécialisé : tout ce qu'il fait concerne les documents de l'organisation et les opérations qui en découlent.

**Boucle de travail :** observer la demande et le contexte → décider la prochaine action (outil, question ou réponse) → agir → vérifier le résultat avec une preuve technique → replanifier → conclure seulement lorsque les critères d'achèvement sont vérifiés ou qu'une limite est atteinte. Au démarrage d'une mission, l'agent formule ses critères d'achèvement et tient une liste d'étapes visible dans l'Agent Workbench.

**Principes :**

- action par outils uniquement, jamais d'accès direct à la base, au système de fichiers ou au réseau ;
- sorties structurées validées par schéma ;
- le statut final est calculé par le système à partir des preuves, jamais déclaré par le modèle ;
- reprise d'une tâche interrompue à la dernière étape confirmée, sans rejouer les effets déjà produits ;
- limites par tâche : étapes, durée, jetons, coût, appels, avec alerte avant dépassement ;
- détection de boucle (appels identiques répétés, absence de progrès) : arrêt avec compte rendu honnête (fait, bloquant, options).

## 7.2. Catalogue d'outils

Peu d'outils, de haut niveau, tous documentaires. Chaque outil déclare : nom, description, schéma des paramètres et du résultat, niveau de risque, permission requise, délai maximal, politique de reprise, idempotence et méthode de vérification de réussite.

| Famille | Outils | Risque par défaut |
|---|---|---|
| Réception et archivage | recevoir un fichier, contrôler, classer, archiver dans Drive, créer un dossier Drive, renommer selon la règle | Faible à moyen |
| Lecture et compréhension | lire, OCR, extraire des champs, classifier, résumer, comparer deux versions | Faible |
| Recherche | recherche exacte, plein texte, sémantique, hybride, filtres | Faible |
| Production | générer PDF, Excel, Word, graphique, résumé, compte rendu, courrier à partir d'un modèle | Faible |
| Contrôle | vérifier les pièces obligatoires, détecter échéances, écarts et incohérences | Faible |
| Envoi | envoyer un livrable par WhatsApp, déposer dans un stockage, préparer un e-mail | Élevé (envoi externe) |
| Planification | créer, modifier, mettre en pause, supprimer une tâche programmée ; déclencher un workflow n8n | Moyen |
| Clarification | poser une question, afficher des boutons, générer un formulaire | Faible |
| Notification | alerter l'utilisateur sur le canal choisi | Faible |

Tout outil peut être désactivé instantanément (interrupteur d'urgence). Les outils sont chargés selon la mission pour limiter le contexte.

## 7.3. Compréhension documentaire

- lecture de PDF texte, Word, Excel, CSV, présentations, e-mails ;
- OCR pour les documents scannés et les images ;
- extraction de tableaux ;
- reconnaissance des entités : dates, montants, noms, références, adresses, échéances ;
- classification du type de document avec score de confiance ;
- résumé, comparaison de versions, détection d'écarts ;
- extraction structurée vers un schéma défini par l'administrateur (par exemple pour les factures ou les contrats).

Chaque extraction conserve l'emplacement exact de la source (fichier, page, zone) et un niveau de confiance. Une valeur peu fiable est marquée « à vérifier » et n'est jamais présentée comme certaine ; elle peut alimenter la file « À traiter ».

## 7.4. Indexation et recherche intelligente

Combinaison de :

1. recherche exacte (nom, référence, métadonnées) ;
2. recherche plein texte ;
3. recherche sémantique par embeddings (PostgreSQL avec pgvector) ;
4. recherche hybride avec reclassement des résultats ;
5. filtres : client, groupe, période, catégorie, type, provenance.

**Indexation :** automatique à l'arrivée d'un document archivé ; ré-indexation sur modification ; incrémentale, reprenable et idempotente ; isolation stricte par organisation ; suppression de l'index lors de la suppression logique d'un document, avec traçabilité ; suivi de l'état (en attente, indexé, échec). Les gros volumes (inventaire initial) sont traités en arrière-plan.

## 7.5. Questions-réponses avec preuves

Toute réponse documentaire cite ses sources : fichier, page ou zone, extrait utilisé, avec lien ouvrant le document à l'endroit concerné. L'agent n'invente jamais une information absente des documents ; si elle n'est pas trouvée, il le dit explicitement. Il distingue fait vérifié et hypothèse. Les calculs (totaux, moyennes) sont exécutés par un outil de calcul vérifiable et non « de tête ».

Exemple : « Quel est le total des factures du client X sur les trois derniers mois ? » → recherche, extraction des montants, calcul, réponse avec liste des factures sources.

## 7.6. Livrables

**Types :** rapports PDF (synthèses, comptes rendus, analyses), fichiers Excel (tableaux, analyses, exports), documents Word (courriers, procédures, synthèses), graphiques, résumés, brouillons de messages.

**Cycle de vie :** chaque livrable est un objet identifiable : titre, type, version, tâche d'origine, sources utilisées, emplacement, statut (brouillon, prêt, livré, remplacé), date, lien de consultation sécurisé. Une modification demandée crée une nouvelle version sans écraser la précédente.

**Livraison :** dans la conversation (web ou WhatsApp), par lien sécurisé à expiration configurable, dépôt dans Google Drive (arborescence de l'organisation), envoi sur un numéro WhatsApp autorisé après validation, téléchargement depuis l'espace Livrables.

**Qualité :** contrôle avant remise (ouverture réussie, sections attendues, cohérence des chiffres avec les sources, mise en page lisible). En cas de doute sur un chiffre, l'agent le signale.

**Modèles :** modèles de rapport et de documents propres à l'organisation (en-têtes, mises en page, formulations), réutilisables.

## 7.7. Missions multi-étapes

L'agent enchaîne plusieurs opérations pour accomplir une mission documentaire complète.

Exemple : « Prépare le dossier de suivi des fournisseurs du trimestre : contrats arrivant à expiration, factures à vérifier, anomalies. » → retrouver les documents, identifier fournisseurs et contrats, extraire dates et montants, comparer factures et contrats, repérer anomalies et pièces manquantes, produire le tableau de suivi et le rapport, soumettre à validation ce qui doit l'être.

**Pilotage en cours d'exécution :** l'utilisateur peut interrompre, rediriger (« limite-toi au dernier trimestre »), ajouter une information sans relancer, mettre en pause ou arrêter. Les messages envoyés pendant l'exécution sont mis en file et intégrés à la prochaine frontière d'étape ; l'agent confirme ce qu'il a pris en compte.

**Auto-correction :** chaque erreur est classée (transitoire : nouvel essai ; d'entrée : corriger les paramètres ; de permission : demander ; de logique : changer d'approche).

## 7.8. Clarification

L'agent ne reste pas bloqué lorsqu'une information manque, et ne devine pas.

| Situation | Moyen |
|---|---|
| Une précision simple | Question directe dans la conversation |
| Un choix parmi quelques options | Boutons de réponse rapide |
| Plusieurs informations structurées | Formulaire (WhatsApp Flows ou formulaire web) |
| Fichiers, champs complexes, données sensibles | Formulaire web sécurisé à lien unique |

**Règles :** la tâche passe en `EN_ATTENTE_UTILISATEUR` ; reprise automatique à la réponse, au même point du plan ; lien de formulaire signé, à usage unique, avec expiration ; relances configurables puis abandon documenté ; valeurs saisies traitées comme entrées non fiables et validées ; WhatsApp Flows utilisé lorsque le compte le permet, sinon repli automatique sur le formulaire web. Le schéma d'un formulaire est validé côté serveur avant affichage.

## 7.9. Contrôle et conformité documentaire

- vérification des pièces obligatoires par client ou par dossier (liste définie par l'administrateur) ;
- détection des documents manquants, des échéances proches et des incohérences entre documents ;
- relance d'un document manquant sur le canal choisi, dans le cadre d'une règle activée ;
- détection d'anomalies (écart de montant, doublon suspect, date incohérente) signalées sans correction automatique ;
- conservation des traces : actions réalisées, sources utilisées, validations et résultats.

## 7.10. Niveaux d'autonomie, risques et approbations

| Niveau | Comportement |
|---|---|
| A0 — Suggérer | L'agent propose, n'exécute aucun effet externe |
| A1 — Demander | Validation de chaque action à effet externe |
| A2 — Autonome encadré (défaut) | Exécution libre des actions faibles et moyennes ; validation des actions élevées ; actions critiques interdites |

| Niveau de risque | Exemples | Règle minimale |
|---|---|---|
| Faible | Recherche, lecture, analyse, brouillons | Libre dès A2 |
| Moyen | Création de dossiers, dépôt de fichiers, workflows internes | Libre en A2, notifié |
| Élevé | Envoi externe (WhatsApp, e-mail), partage, modification de données importantes | Validation sauf règle explicite de l'administrateur |
| Critique | Suppression définitive, accès sensibles, action irréversible | Interdit ou validation renforcée |

Aucune politique ne peut abaisser le minimum d'un outil critique. L'agent ne supprime jamais définitivement une archive.

**Approbations sans fatigue :** règles (« envois vers les numéros de la liste blanche autorisés »), « toujours autoriser pour ce destinataire », approbation groupée d'un lot d'actions similaires, aperçu exact de l'effet (destinataire, contenu, document), validation en un geste depuis WhatsApp, expiration des demandes, approbation liée à l'action précise (toute modification l'invalide).

**Réversibilité :** aperçu avant action quand l'outil le permet, corbeille plutôt que suppression, versions conservées, journal permettant de reconstituer ce qui a changé.

## 7.11. Protection contre l'injection de consignes et l'exfiltration

Le contenu des documents, messages et réponses d'outils est **donnée, jamais instruction**. Séparation stricte entre consignes système, demande de l'utilisateur et contenu externe. Si une tâche combine contenu non fiable, données privées et canal de sortie (WhatsApp, e-mail), toute action sortante exige une validation, quel que soit le niveau d'autonomie. Aucun secret ni donnée d'une organisation vers une autre. Les tentatives détectées (consignes cachées dans un document, demande d'envoi de données) sont signalées. Les tests d'attaque sont obligatoires en recette.

## 7.12. Statuts honnêtes des missions

`REUSSIE`, `PARTIELLEMENT_REUSSIE`, `ECHOUEE`, `EN_ATTENTE_UTILISATEUR`, `EN_ATTENTE_APPROBATION`, `ANNULEE`, `BLOQUEE`. Un statut final est accepté uniquement si les conditions de réussite déclarées par l'outil ou la mission ont été vérifiées (fichier présent et lisible, identifiant Drive confirmé, accusé de réception). Sans preuve, une mission ne peut pas passer à `REUSSIE`.

## 7.13. Mémoire et personnalisation

| Type | Contenu | Durée |
|---|---|---|
| Contexte de conversation | Échanges en cours, résumé progressif | Session |
| Mémoire de mission | État, décisions, résultats intermédiaires | Durée de la mission |
| Mémoire utilisateur | Préférences (langue, format, ton) | Persistante, modifiable |
| Mémoire d'organisation | Règles internes, vocabulaire, modèles de documents, contexte d'un dossier | Persistante, administrée |

L'utilisateur consulte, corrige et supprime ce que l'agent retient. Rien de sensible n'est mémorisé sans consentement. Aucune mémoire n'est partagée entre organisations. Un mode « sans mémoire » est disponible. Le contexte d'un dossier est retenu pour éviter de répéter les mêmes informations.

## 7.14. Canaux de conversation

| Canal | Usage |
|---|---|
| Interface web | Conversation complète, Agent Workbench, supervision |
| WhatsApp Business Cloud API (conversation directe) | Instructions, dépôt de fichiers, réponses, livrables, approbations |
| Formulaires web sécurisés | Collecte d'informations structurées |
| Voix | Message vocal transcrit puis traité comme une instruction |

Pièces jointes (documents, images) traitées et rattachées à un client/groupe ; si le rattachement est incertain, l'agent pose la question. Réponse dans le même canal. La langue de l'utilisateur est détectée (français, anglais, arabe selon les capacités du modèle). La conversation directe ne dépend pas de l'éligibilité à la Groups API : les deux fonctions sont indépendantes.

## 7.15. Modèles IA et coûts

Couche d'abstraction du fournisseur ; routage par besoin (raisonnement, extraction rapide, vision/OCR, embeddings) ; modèle de repli ; sorties structurées ; mise en cache ; aucune donnée de l'organisation utilisée pour l'entraînement sans consentement explicite ; invites et définitions d'outils versionnées avec retour arrière. Plafonds de coût par tâche, utilisateur et organisation ; estimation avant une tâche volumineuse ; alerte avant dépassement.

## 7.16. Évaluation et qualité de l'agent

L'évaluation mesure le **résultat** (critères atteints, exactitude des chiffres, sources correctes), la **trajectoire** (outils appropriés, absence d'action interdite, nombre d'étapes, absence de boucle, coût), la **sécurité** (injection, isolation entre organisations) et la **calibration** (« je ne sais pas » quand la preuve manque). Méthodes : jeu de scénarios avec vérifications automatiques, échantillonnage humain, rejeu de traces réelles contre une nouvelle version d'invite ou de modèle. Une régression bloque la publication. Tableau de bord : taux de réussite par outil, étapes moyennes, taux de précisions demandées, approbations et refus, coûts, retours pouce haut/bas rattachés à la trace.

## 7.17. Mode démonstration

Une organisation de démonstration isolée, dotée de comptes réels dédiés (Drive, numéro WhatsApp, documents réels non confidentiels), permet des démonstrations en exécution réelle : rien n'est simulé ni préenregistré. Scénarios prédéfinis déclenchables en un clic : (1) retrouver les factures d'un fournisseur et en calculer le total ; (2) classer et archiver un document reçu sur WhatsApp ; (3) produire un rapport PDF avec graphiques ; (4) comparer deux versions d'un document ; (5) règle automatique « à l'arrivée d'un document, analyser, classer, archiver et prévenir s'il manque une information » ; (6) instruction vocale transformée en livrable. Remise à l'état initial rapide des comptes dédiés, mode présentation (texte agrandi, masquage des informations sensibles), lien d'essai à quota limité. En cas d'incident, l'état réel est affiché tel quel.

# 8. Automatisations, planifications et sauvegardes

## 8.1. Types de déclencheurs

- **planning** : toutes les N minutes, quotidien, hebdomadaire, mensuel, date précise (intervalle minimal défini par l'offre) ;
- **événement** : nouveau document, nouveau message avec fichier, fichier déposé dans un dossier surveillé ;
- **condition** : document attendu non reçu, échéance proche, information manquante ;
- **manuel** : demande directe de l'utilisateur.

## 8.2. Tâches prêtes à l'emploi

1. **Collecte et classement périodiques** : à intervalle choisi, scanner une source connectée (dossier d'entrée Drive surveillé), appliquer les contrôles, classer et archiver selon l'arborescence, indexer, et rendre compte ;
2. **Rapport périodique** : par exemple « documents de la semaine », produit et envoyé sur WhatsApp ou déposé dans un stockage ;
3. **Alerte de document manquant ou d'échéance** ;
4. **Contrôle d'intégrité des archives** : vérifier que les fichiers archivés existent toujours dans Drive et signaler tout écart ;
5. **Sauvegarde périodique des documents** vers un second emplacement de stockage configuré par l'organisation, avec confirmation par identifiant et empreinte.

## 8.3. Règles en langage naturel

L'utilisateur décrit la règle (« chaque lundi, prépare le rapport des documents de la semaine et envoie-le à ce numéro »). L'agent la transforme en **règle structurée** (déclencheur, étapes, destinataires, limites) affichée pour validation avant activation. Aucune initiative de l'agent hors d'une règle activée.

## 8.4. Gestion

Activation, pause, modification, historique d'exécution, taux de réussite, alerte en cas d'échec répété, désactivation automatique après échecs successifs configurables. Toute automatisation respecte les mêmes politiques d'approbation que les missions manuelles ; les envois externes d'une tâche programmée exigent des destinataires de la liste blanche ou une validation préalable de la règle.

## 8.5. Exécution

Les déclencheurs et planifications reposent sur **n8n** et sur les tâches persistées en base. Les exécutions sont idempotentes (clé par règle et par créneau) ; un redémarrage ne provoque ni oubli ni doublon. Un contrôle planifié repère les tâches non démarrées, expirées ou bloquées. Le résultat d'une exécution n8n n'est accepté qu'après validation par le backend.

## 8.6. Création et gestion d'une tâche programmée par l'utilisateur

**Trois façons de créer une tâche**, toutes aboutissant à la même règle structurée :

1. **À partir d'un modèle** : l'utilisateur choisit parmi les tâches prêtes à l'emploi (§ 8.2) ;
2. **Dans la conversation** : « chaque lundi à 8 h, prépare le rapport des documents de la semaine et envoie-le à ce numéro » ;
3. **Avec le formulaire de l'écran Automatisations**.

**Paramètres d'une tâche :**

| Paramètre | Exemple |
|---|---|
| Source | Dossier d'entrée Drive surveillé, un client, un groupe, tous les documents |
| Action | Collecter et classer, produire un rapport, alerter, copier vers un second stockage |
| Fréquence | Toutes les N minutes (minimum selon l'offre), tous les jours à une heure précise, chaque semaine, chaque mois |
| Fuseau horaire | Celui de l'organisation par défaut |
| Destination | Conversation WhatsApp, numéro de la liste blanche, dossier Drive, espace Livrables |
| Approbation | Aucune pour les actions internes ; validation de la règle une fois pour toutes pour les envois vers la liste blanche ; validation à chaque exécution sinon |

**Avant activation**, l'application affiche la règle en clair, les trois prochaines exécutions prévues, l'estimation de consommation de quota par mois, et propose « Exécuter maintenant pour tester ». Une tâche n'est active qu'après validation explicite.

**Compte rendu :** chaque exécution produit un message court sur le canal choisi, par exemple « Collecte de 14 h 30 : 12 documents archivés, 2 à traiter, 0 erreur », avec le lien vers le détail. Une exécution sans nouveau document ne génère pas de message, sauf demande contraire.

**Gestion :** pause, reprise, modification (avec nouvelle validation si la destination change), suppression logique, historique, taux de réussite. Une tâche dont les exécutions échouent de façon répétée est suspendue et l'administrateur est alerté. Les exécutions comptent dans les quotas de l'offre ; une tâche suspendue pour dépassement reprend au renouvellement ou à l'achat de crédits.

# 9. Parcours client, abonnement et monétisation

## 9.1. Modèle économique

HESYD ONE est un service hébergé vendu **par abonnement à l'organisation**. Le client n'installe rien : il s'inscrit, connecte ses outils, invite son équipe et utilise l'agent.

| Question | Réponse |
|---|---|
| Qui paie ? | L'organisation, par son **propriétaire**. Les autres membres n'ont aucun paiement à effectuer |
| Quoi ? | Un abonnement mensuel ou annuel à une offre qui donne droit à des quotas (§ 9.4) |
| Quoi en plus ? | Des packs de crédits ponctuels en cas de besoin, et des options réservées aux offres supérieures (numéro WhatsApp dédié, collecte par groupes, support prioritaire) |
| Qu'est-ce qui n'est pas payé à HESYD ONE ? | Le stockage des documents : les archives restent dans le Google Drive du client, qui relève de son propre contrat avec Google |
| Quels coûts HESYD ONE doit couvrir ? | Principalement le modèle IA (lecture, OCR, extraction, embeddings, agent), les messages WhatsApp sortants facturés par Meta hors fenêtre de service, l'hébergement et le support |

**Règle de tarification :** aucune offre n'est mise en vente avant d'avoir mesuré, sur de vrais documents (phase 0 puis recette), le coût réel moyen d'un document traité et d'une mission de l'agent. Le prix et les quotas de chaque offre sont déduits de ces mesures avec une marge cible. Les valeurs sont stockées en configuration et modifiables sans redéploiement.

**Conséquence sur les données :** puisque les archives vivent dans le Drive du client, résilier HESYD ONE ne fait perdre aucun document au client (§ 9.9).

## 9.2. Parcours client de bout en bout

| # | Étape | Ce que fait le client | Ce que fait le système | Critère de réussite |
|---|---|---|---|---|
| 1 | Découverte | Consulte la présentation, essaie la démonstration en lien d'essai à quota limité | Exécute de vrais traitements sur l'organisation de démonstration | Le visiteur clique sur « Essayer gratuitement » |
| 2 | Inscription | S'inscrit avec e-mail et mot de passe ou avec Google, confirme son e-mail | Crée le compte, propose l'authentification multifacteur, crée l'organisation (nom, pays, fuseau, langue) et attribue le rôle de propriétaire | Compte vérifié, organisation créée |
| 3 | Démarrage de l'essai | Ne saisit aucun moyen de paiement | Active l'offre d'essai (§ 9.7), crée automatiquement un client « Général » et un groupe « Dépôts directs » pour pouvoir archiver sans configuration préalable | Essai actif, compte à rebours visible |
| 4 | Connexion de Google Drive | Clique sur « Connecter Google Drive », accepte l'écran de consentement Google, choisit de créer un dossier racine « HESYD ONE — Archives » ou d'en désigner un existant | Exécute les tests de connexion réels (lecture, création de sous-dossier, dépôt d'un fichier test, lecture des métadonnées, suppression du fichier test) et affiche le résultat | Test Drive validé |
| 5 | Appairage de WhatsApp | Scanne le code QR ou ouvre le lien affiché dans l'application, envoie le code à usage unique au numéro de HESYD ONE | Rattache le numéro au compte et à l'organisation, confirme dans la conversation | Message de bienvenue reçu sur WhatsApp |
| 6 | Premier résultat | Envoie un document sur WhatsApp, puis pose une question à son sujet | Contrôle, classe, archive dans Drive avec confirmation, indexe, répond avec la source citée | Document archivé et réponse sourcée obtenus. **Objectif : moins de 10 minutes entre l'inscription et ce résultat** (mesuré en recette) |
| 7 | Mise en place du référentiel | Importe ses clients et groupes (modèle CSV/XLSX fourni) ou les crée à la main | Valide, affiche l'aperçu, importe, crée les dossiers Drive à la demande | Référentiel opérationnel |
| 8 | Équipe | Invite ses collègues par e-mail avec un rôle | Envoie des invitations signées (expiration 7 jours) ; chaque invité appaire son WhatsApp | Membres actifs |
| 9 | Première automatisation | Active une tâche prête à l'emploi (collecte et classement périodiques, rapport hebdomadaire) | Valide la règle, planifie via n8n, envoie le compte rendu après chaque exécution | Première exécution réussie |
| 10 | Conversion | Choisit une offre, paie via la page de paiement hébergée (§ 9.6) | Active l'abonnement dès la confirmation du prestataire, conserve toutes les données de l'essai | Abonnement actif, facture disponible |
| 11 | Usage régulier | Interroge ses documents, reçoit ses rapports, valide les approbations | Mesure l'usage, alerte avant dépassement | Usage dans les quotas |
| 12 | Évolution | Change d'offre, achète des crédits, ajoute des utilisateurs | Applique le changement avec prorata et explications | Quotas mis à jour immédiatement |
| 13 | Départ | Résilie depuis l'application | Résilie en fin de période, propose l'export, révoque les accès à la fin (§ 9.9) | Aucune perte de documents |

L'avancement de ce parcours est enregistré par organisation (`onboarding_progress`) et alimente l'assistant de démarrage (§ 5.4) ainsi que le suivi commercial de l'opérateur de la plateforme.

## 9.3. Connexion de l'environnement de travail

Le client relie HESYD ONE à ses outils sans intervention technique et sans transmettre de mot de passe : toutes les connexions passent par des autorisations (OAuth) ou par des codes à usage unique.

### 9.3.1. Google Drive

- connexion par OAuth 2.0 côté serveur ; le client voit l'écran de consentement de Google et peut révoquer l'accès à tout moment depuis son compte Google ou depuis HESYD ONE ;
- **périmètre d'autorisation minimal** : l'application demande l'accès limité aux fichiers qu'elle crée ou que le client lui désigne, et le sélecteur de dossier de Google permet de choisir un dossier existant sans ouvrir l'ensemble du Drive. Un périmètre plus large n'est demandé que si les tests de la phase 0 démontrent qu'il est indispensable, car il entraîne une procédure de vérification Google plus lourde ;
- choix : création d'un dossier racine par l'application, ou désignation d'un dossier existant ;
- tests automatiques à la connexion et contrôle périodique ensuite ; états affichés : Connecté, À reconnecter, En erreur, avec date du dernier test réussi ;
- si l'autorisation est révoquée ou expire : bandeau explicite pour l'administrateur, notification, bouton « Reconnecter », traitements dépendant de Drive mis en attente sans perte (§ 10.14) ;
- chaque membre qui doit ouvrir les documents doit disposer d'un accès Drive au dossier racine ; l'application l'indique clairement lors de l'invitation et affiche un message d'accès explicite si ce n'est pas le cas.

### 9.3.2. WhatsApp

| Option | Fonctionnement | Offre |
|---|---|---|
| **Numéro de HESYD ONE (par défaut)** | Un numéro WhatsApp Business unique, géré par la plateforme, sert toutes les organisations. Chaque utilisateur appaire son propre numéro avec un code à usage unique. Le routage se fait par numéro appairé → utilisateur → organisation | Toutes les offres |
| **Numéro dédié à l'organisation** | L'organisation connecte son propre numéro WhatsApp Business par le parcours d'inscription proposé par Meta ; l'agent répond depuis son numéro. Seule option compatible avec la collecte par groupes (§ 12.1) | Offre supérieure |

Règles d'appairage :

- code à usage unique valable 15 minutes, lié à l'utilisateur connecté ; un code expiré ou déjà utilisé est refusé ;
- un numéro est rattaché à un seul utilisateur ; l'appairage est révocable par l'utilisateur ou par l'administrateur ; la désactivation d'un utilisateur révoque son appairage ;
- un message provenant d'un numéro non appairé reçoit une réponse standard invitant à s'inscrire ou à demander un accès ; aucune donnée n'est exposée et aucun fichier n'est archivé automatiquement ;
- si un même numéro appartient à plusieurs organisations, l'agent demande dans quelle organisation travailler, puis mémorise le choix pour la session.

### 9.3.3. Dépôt web et dossier d'entrée surveillé

- glisser-déposer de fichiers dans l'application ;
- dossier d'entrée « À classer » dans le Drive du client : tout fichier qui y est déposé est repris par la tâche de collecte périodique (§ 8.2), contrôlé, classé et archivé selon l'arborescence.

### 9.3.4. Équipe

- invitation par e-mail avec rôle choisi ; lien signé à usage unique, expirant au bout de 7 jours, révocable ;
- chaque membre se connecte, appaire son WhatsApp et vérifie son accès Drive ;
- le propriétaire peut transférer la propriété à un administrateur.

### 9.3.5. Référentiel de départ

- création manuelle ou import CSV/XLSX avec modèle téléchargeable ; aperçu avant import (§ 6.6) ;
- un client « Général » et un groupe « Dépôts directs » existent dès l'inscription pour ne jamais bloquer le premier dépôt ; ils peuvent être renommés ou archivés ;
- inventaire facultatif du Drive existant, avec indexation à la demande, pour que l'agent puisse interroger l'historique.

### 9.3.6. Autres clouds

Les futurs connecteurs de stockage suivent le même parcours : consentement, choix du dossier racine, tests de connexion, contrôle périodique, reconnexion guidée (§ 12.3).

## 9.4. Offres et quotas

Trois offres : **Essai**, **Standard**, **Entreprise**. Les valeurs chiffrées sont fixées avant l'ouverture des ventes selon la règle du § 9.1.

| Dimension mesurée | Rôle dans l'offre |
|---|---|
| Utilisateurs actifs | Nombre de membres de l'organisation |
| Clients et groupes suivis | Taille du référentiel |
| Documents traités par mois | Réceptions contrôlées, classées et archivées |
| Crédits de traitement par mois | Unité interne pondérant le coût réel : analyse d'un document (lecture, OCR, extraction, indexation), questions à l'agent, missions, génération de livrables |
| Tâches programmées actives et fréquence minimale | Nombre de règles et intervalle le plus court autorisé |
| Messages WhatsApp sortants hors fenêtre de service | Rapports et alertes envoyés à l'initiative du système |
| Stockage de traitement | Index, extractions, conversations et livrables conservés par HESYD ONE (pas les archives du Drive) |
| Connecteurs de stockage | Nombre de clouds connectés |

| Options | Essai | Standard | Entreprise |
|---|---|---|---|
| Numéro WhatsApp de la plateforme | Oui | Oui | Oui |
| Numéro WhatsApp dédié à l'organisation | Non | Non | Oui |
| Collecte par groupes (sous réserve d'éligibilité) | Non | Non | Oui |
| Tâches programmées | Limitées | Incluses | Étendues, fréquence plus courte |
| Support | Documentation | Support standard | Support prioritaire |
| Export complet et suppression avec attestation | Oui | Oui | Oui |

Le catalogue (offres, quotas, options, prix, devises) est enregistré dans les tables `plans` et ses dépendances et administré par l'opérateur (§ 4.9) ; un changement de catalogue s'applique sans redéploiement et n'affecte pas rétroactivement les abonnements en cours.

## 9.5. Mesure d'usage, alertes et dépassement

- chaque opération consommant une ressource facturable est enregistrée (`usage_metering`) avec organisation, utilisateur, nature, quantité et date ; le solde de crédits est tenu dans un registre (`credit_ledger`) ;
- l'écran Abonnement et usage affiche la consommation en temps réel par dimension et la date de renouvellement ;
- **alertes à 80 % puis à 100 %** de chaque quota : notification dans l'application, e-mail et message WhatsApp à l'administrateur et au propriétaire ;
- **au dépassement :**
  - la **réception, le contrôle et l'archivage dans Drive continuent** : un quota de traitement intelligent ne fait jamais perdre un document ;
  - l'analyse approfondie, l'agent, la production de livrables et les tâches programmées consommant des crédits sont **mis en attente** avec un message clair indiquant la cause et les options ; ils reprennent au renouvellement ou après achat de crédits ;
  - aucune donnée n'est supprimée ;
- trois sorties proposées dans le message : acheter un pack de crédits (paiement immédiat, crédits ajoutés à la confirmation), passer à l'offre supérieure (effet immédiat, prorata), attendre le renouvellement ;
- plafonds de coût par mission, par utilisateur et par organisation pour éviter une consommation accidentelle ; une mission volumineuse affiche son estimation avant exécution.

## 9.6. Paiement et facturation

**Principe :** le paiement est confié à un prestataire de paiement par abonnement ; aucune donnée de carte bancaire ne transite par les serveurs de HESYD ONE.

| Sujet | Règle |
|---|---|
| Page de paiement | Page hébergée par le prestataire, ouverte depuis « Choisir une offre » ; retour automatique dans l'application |
| Cycles | Mensuel ou annuel (remise annuelle à définir) ; renouvellement automatique |
| Moyens de paiement | Carte bancaire pour toutes les offres ; virement pour l'offre Entreprise sur facture ; autres moyens locaux selon le prestataire retenu |
| Qui gère | Le propriétaire uniquement : offre, moyen de paiement, coordonnées de facturation (raison sociale, adresse, identifiant fiscal), factures, résiliation |
| Montée en offre | Immédiate ; le prestataire facture au prorata de la période restante ; nouveaux quotas actifs dès la confirmation |
| Descente en offre | Effective à la fin de la période payée ; refusée tant que l'usage dépasse les limites de l'offre cible, avec la liste de ce qu'il faut réduire |
| Pack de crédits | Paiement ponctuel ; crédits valables jusqu'à une date d'expiration définie avec les offres |
| Source de vérité | L'état de l'abonnement est mis à jour uniquement par les notifications signées du prestataire (webhooks, idempotents) reçues par le backend, jamais par le navigateur |
| Factures | Générées par le prestataire ou par le backend, numérotation séquentielle, mentions et TVA conformes à la réglementation du pays de l'entreprise exploitante, téléchargeables à tout moment |
| Notifications au client | E-mails de confirmation, de rappel avant renouvellement, d'échec de paiement, de facture disponible, de résiliation |

### Échec de paiement

1. l'échec est notifié immédiatement au propriétaire (application, e-mail, WhatsApp) avec le lien de mise à jour du moyen de paiement ;
2. le prestataire retente automatiquement selon son calendrier ; l'organisation reste pleinement utilisable pendant une **période de grâce** (valeur proposée : 7 jours), avec un bandeau d'alerte ;
3. à l'issue de la grâce, le statut passe à `IMPAYE` (§ 9.8) : l'agent, les tâches programmées et la production de livrables sont suspendus ; la collecte et l'archivage continuent pour ne perdre aucun document (valeur proposée : 30 jours) ;
4. au-delà, le statut passe à `SUSPENDU` ; le règlement du montant dû réactive immédiatement l'organisation sans perte de données.

### Choix du prestataire de paiement

Le prestataire est choisi en phase 0 selon : le pays d'immatriculation de l'entreprise exploitante, les moyens de paiement des clients visés, la gestion des abonnements récurrents, des essais, des prorata et des packs, la prise en charge de la TVA et des factures, et la qualité des webhooks. Trois familles sont comparées : prestataire d'abonnement agissant comme marchand d'enregistrement (qui prend en charge TVA et facturation), prestataire de paiement par carte classique, solution de paiement locale. **Aucun n'est présumé disponible** : la disponibilité est vérifiée pour le pays d'immatriculation avant tout engagement.

## 9.7. Essai gratuit

- durée proposée : 14 jours, **sans moyen de paiement requis** pour supprimer la friction à l'inscription ;
- quotas réduits et fixes (§ 9.4), tous les modules du produit disponibles pour que le client juge la valeur ;
- rappels de fin d'essai à J-7, J-3 et J-1 (application, e-mail, WhatsApp), avec bouton « Choisir une offre » ;
- toutes les données de l'essai sont conservées à la conversion ;
- fin d'essai sans paiement : statut `ESSAI_EXPIRE` — consultation et export possibles, agent et tâches suspendus, collecte arrêtée avec message au dépôt ; les données de traitement sont conservées 30 jours (valeur proposée) puis purgées ; les documents dans le Drive du client restent intacts ; la réactivation par paiement est possible à tout moment avant la purge ;
- un seul essai par organisation ; contrôles anti-abus (vérification d'e-mail, numéro WhatsApp unique).

## 9.8. Cycle de vie de l'abonnement

| Statut | Interface | Collecte et archivage | Agent et tâches programmées | Données |
|---|---|---|---|---|
| `ESSAI` | Complète, quotas d'essai | Active | Actifs | Conservées |
| `ACTIF` | Complète | Active | Actifs | Conservées |
| `EN_GRACE` (paiement échoué) | Complète avec bandeau | Active | Actifs | Conservées |
| `IMPAYE` | Lecture, export, paiement | Active | Suspendus | Conservées |
| `SUSPENDU` | Paiement et export uniquement | Arrêtée, réponse explicite à l'expéditeur | Suspendus | Conservées pendant la durée de rétention |
| `RESILIE_EN_FIN_DE_PERIODE` | Complète jusqu'à la date de fin, bandeau | Active | Actifs | Conservées |
| `RESILIE` | Lecture et export | Arrêtée | Arrêtés | Conservées 30 jours (valeur proposée), puis purge |
| `SUPPRIMEE` | Aucun accès | Aucune | Aucun | Purgées, attestation délivrée |

Chaque transition est journalisée, notifiée au propriétaire et déclenchée par un événement du prestataire, une échéance ou une action explicite — jamais par un calcul côté navigateur.

## 9.9. Résiliation, portabilité et propriété des données

- **les documents restent la propriété du client et dans son Drive** : HESYD ONE n'en détient aucune copie d'archive à supprimer ;
- résiliation depuis l'application par le propriétaire, en un parcours, avec effet à la fin de la période payée et e-mail de confirmation ;
- **export complet** proposé à la résiliation et disponible à tout moment : référentiel clients et groupes (CSV), journal des réceptions et des fichiers avec identifiants Drive (CSV), livrables (fichiers), historique des missions ;
- à la fin de la rétention : purge de l'index, des extractions, de la mémoire, des conversations, des livrables temporaires et des secrets ; révocation et suppression des jetons Google ; attestation de suppression délivrée sur demande ;
- l'opérateur ne conserve aucune donnée documentaire d'une organisation supprimée, hors obligations de conservation des factures.

## 9.10. Exploitation commerciale et cadre juridique

Documentation publique et centre d'aide, support avec délais annoncés par offre, page d'état publique, notes de version, procédure d'incident avec communication aux clients. Conditions générales d'utilisation, politique de confidentialité, accord de traitement des données, liste des sous-traitants (fournisseur de modèle, hébergeur, services de messagerie, prestataire de paiement), clauses sur l'usage des données par les modèles, politique de remboursement. Ce document ne remplace pas une validation juridique.

# 10. Parcours d'usage et workflows de référence

## 10.1. Parcours quotidien de l'employé

| Je veux… | Je fais… | Je reçois… |
|---|---|---|
| **Archiver un document** | Je l'envoie sur WhatsApp à l'agent (ou je le dépose dans l'application), en indiquant le client si je le connais | « Reçu. Client : X, catégorie : Factures, archivé dans Drive » avec le lien. Si le client est incertain, l'agent propose les candidats sous forme de boutons ; si je ne réponds pas, le document reste dans À traiter |
| **Retrouver une information** | Je pose la question en texte ou en vocal : « Quel est le total des factures de X au dernier trimestre ? » | Une réponse courte avec les documents sources cités et cliquables ; « introuvable » si l'information n'existe pas |
| **Obtenir un rapport** | « Prépare le rapport des documents de la semaine en PDF et Excel » | Si une précision manque (période, client), une question ou un formulaire ; puis le livrable dans la conversation et dans Livrables |
| **Valider une action** | J'ouvre la demande d'approbation (WhatsApp ou application) | L'aperçu exact (destinataire, contenu, pièce jointe) et les boutons Approuver, Modifier, Refuser |
| **Programmer une tâche récurrente** | Je choisis un modèle ou je décris la règle dans la conversation | La règle en clair, les prochaines exécutions et le bouton Activer (§ 8.6) |
| **Corriger une anomalie** | J'ouvre À traiter, je prends en charge le cas, je choisis le bon client/groupe, j'ajoute un commentaire | Le traitement reprend, l'historique conserve l'ancienne valeur et ma justification |
| **Suivre mes missions** | J'ouvre Assistant ou Tâches | Le plan, les étapes terminées, les sources, le statut final fondé sur des preuves |
| **Interrompre ou rediriger l'agent** | J'écris « arrête » ou « limite-toi au mois dernier » pendant l'exécution | L'agent confirme ce qu'il a pris en compte |

## 10.2. Parcours quotidien et périodique de l'administrateur

### Mise en service initiale

Elle suit l'assistant de démarrage (§ 5.4) :

1. créer l'organisation et le compte administrateur ;
2. vérifier l'éligibilité du compte WhatsApp, tester la conversation directe et, pour une organisation disposant de son propre numéro, effectuer le test Groups API (non bloquant pour le reste) ;
3. connecter le numéro Cloud API et configurer les webhooks (numéro de la plateforme : déjà configuré) ;
4. connecter Google Drive par OAuth ;
5. choisir le dossier racine ;
6. vérifier création, lecture et accès des employés ;
7. importer les clients et groupes ;
8. associer les groupes compatibles ;
9. créer ou vérifier les dossiers Drive ;
10. effectuer un test réel de réception, de classement et d'ouverture ;
11. activer seulement les groupes ayant réussi le test ;
12. configurer les règles de l'agent (autonomie, liste blanche des destinataires, plafonds) ;
13. vérifier les sauvegardes, alertes et procédures de reprise avant ouverture aux utilisateurs.

### Pilotage courant

| Je dois… | Où | Comment | Effet |
|---|---|---|---|
| Vérifier que tout fonctionne | Vue d'ensemble | Contrôler l'état des intégrations, les compteurs, les erreurs | Chaque indicateur ouvre la liste filtrée correspondante |
| Traiter ce qui bloque | À traiter | Prendre en charge, corriger, relancer ou rejeter avec motif ; répartir les cas entre opérateurs | Historique et justification conservés |
| Décider des actions de l'agent | Approbations | Approuver, modifier ou refuser ; créer une règle « toujours autoriser » pour un destinataire de confiance | Moins de sollicitations, sans abaisser les règles des actions critiques |
| Gérer l'équipe | Administration › Utilisateurs | Inviter, attribuer un rôle, désactiver | La désactivation révoque sessions et appairage WhatsApp |
| Encadrer l'agent | Administration › Agent | Choisir le niveau d'autonomie, activer ou désactiver des outils, définir la liste blanche des destinataires, les plafonds de coût, l'interrupteur d'urgence | Appliqué immédiatement, journalisé |
| Adapter le classement | Administration › Règles de classement | Catégories, nommage, tailles et extensions, politique de doublons | Modification datée et journalisée, appliquée aux nouveaux fichiers |
| Superviser les automatisations | Automatisations | Valider, mettre en pause, corriger les règles en échec | Historique et taux de réussite |
| Suivre la consommation | Abonnement et usage | Consulter les jauges, les alertes, la date de renouvellement | Anticiper un dépassement avant qu'il bloque |
| Gérer le paiement (propriétaire) | Abonnement et usage | Changer d'offre, acheter des crédits, mettre à jour le moyen de paiement, télécharger les factures, résilier | Effets expliqués avant confirmation (§ 9.6) |
| Réagir à une déconnexion | Bandeau et notification | Cliquer sur Reconnecter, suivre la procédure guidée | Reprise automatique des traitements en attente (§ 10.14) |
| Consulter l'audit | Administration › Journaux | Filtrer par utilisateur, action, entité | Toutes les actions sensibles sont tracées |

Routine recommandée : chaque jour, vérifier À traiter et Approbations ; chaque semaine, consulter l'activité, les taux de réussite des automatisations et la consommation ; chaque mois, revoir les utilisateurs actifs et les règles de classement.

## 10.3. Création d'un client et ajout de ses groupes

L'administrateur crée la fiche client, puis ajoute un ou plusieurs groupes. Chaque groupe est associé individuellement à sa source et à son dossier Drive. Un nouveau groupe peut être ajouté à tout moment sans modifier les autres associations.

## 10.4. Réception automatique d'un fichier

1. la source (WhatsApp, conversation directe, dépôt web, dossier surveillé) émet un événement ;
2. le backend vérifie l'origine et la signature selon le protocole applicable ;
3. l'événement est enregistré durablement avec une référence d'idempotence ;
4. le backend accuse réception rapidement ;
5. une tâche persistée est créée et n8n est déclenché ;
6. le groupe externe est identifié ;
7. le client associé est retrouvé ;
8. les métadonnées média sont récupérées ;
9. le fichier est téléchargé dans une zone temporaire contrôlée ;
10. les contrôles de taille, MIME, intégrité et sécurité sont exécutés ;
11. l'empreinte SHA-256 est calculée ;
12. la règle de doublon est appliquée ;
13. la catégorie et le chemin Drive sont déterminés ;
14. le fichier est envoyé dans Drive ;
15. l'application vérifie le résultat et récupère l'identifiant Drive ;
16. la réception et le fichier passent à leurs statuts finaux ;
17. le document est indexé et analysé (type proposé, champs extraits) ;
18. la fiche, le tableau de bord et l'historique sont mis à jour.

Si une étape échoue, le système conserve la réception et crée un état reprenable ou une anomalie. Aucune erreur n'entraîne une suppression silencieuse. Un échec d'indexation ou d'analyse n'invalide pas l'archivage.

## 10.5. Réception provenant d'un groupe inconnu

L'événement et les métadonnées disponibles sont enregistrés. Le système ne rattache pas automatiquement le fichier à un client par simple similarité de nom. La réception est placée dans « À traiter » avec l'identifiant externe du groupe. Un administrateur peut créer ou corriger l'association, puis relancer le traitement.

## 10.6. Échec Google Drive

La réception reste enregistrée en base et le fichier temporaire contrôlé est conservé tant que la reprise en dépend. Les erreurs temporaires sont relancées avec temporisation progressive. Si l'erreur persiste, une anomalie est créée et l'administrateur est notifié. Après rétablissement de l'accès, le traitement reprend sans créer de doublon.

## 10.7. Réception d'un doublon

Le système conserve la nouvelle réception, calcule ou réutilise l'empreinte du fichier et recherche un document identique dans le même groupe. Si un document correspondant existe déjà, la réception y est reliée et aucun nouveau dépôt physique n'est créé. Le système indique le document d'origine et la date de sa première archive.

## 10.8. Correction humaine

L'employé autorisé prend en charge l'anomalie, vérifie les informations, sélectionne la bonne association si elle est certaine, saisit un commentaire lorsque la correction a un impact documentaire, puis relance le traitement. L'application conserve la provenance initiale et l'historique de la correction.

## 10.9. Suspension d'un groupe

Les nouveaux événements sont encore enregistrés s'ils arrivent, mais ne suivent plus le circuit d'archivage automatique. Ils sont mis en attente. Les autres groupes du même client continuent de fonctionner normalement. À la réactivation, les éléments en attente font l'objet d'une revue avant reprise.

## 10.10. Mission de l'agent, de la demande au livrable

1. l'utilisateur formule la demande (web, WhatsApp, voix) ;
2. l'agent détermine l'objectif et les critères d'achèvement, et construit un plan ;
3. il pose les questions manquantes (question, boutons ou formulaire) ; la mission passe en attente puis reprend à la réponse ;
4. il exécute les outils, en vérifiant chaque résultat ;
5. les actions à effet externe sont soumises à la politique d'approbation ;
6. le livrable est généré, contrôlé et versionné ;
7. il est livré (conversation, lien, Drive, WhatsApp après validation) ;
8. le statut final est calculé à partir des preuves et la trace complète reste consultable.

## 10.11. Tâche programmée

Règle validée → n8n déclenche au créneau → le backend crée la mission avec une clé d'idempotence (règle, créneau) → exécution des étapes → vérification → livraison → compte rendu (succès, succès partiel ou échec expliqué) → en cas d'échecs répétés, alerte et désactivation automatique.

## 10.12. Dépôt d'un fichier en conversation directe

1. l'utilisateur appairé envoie un fichier (avec ou sans légende) au numéro de l'agent ;
2. le numéro est résolu : numéro appairé → utilisateur → organisation ; sinon réponse standard sans traitement (§ 9.3.2) ;
3. le client et le groupe sont déduits de la légende, du contexte de la conversation ou de la mémoire du dossier ; en cas de doute, l'agent pose une question avec boutons ; sans réponse, le fichier reste dans À traiter sous le groupe « Dépôts directs » ;
4. le fichier suit ensuite le circuit de réception automatique (§ 10.4) ;
5. l'agent répond avec le résultat réel : archivé (lien Drive), doublon reconnu (document d'origine), refusé (motif), ou en attente.

## 10.13. Atteinte d'un quota

1. à 80 % puis 100 %, alertes à l'administrateur et au propriétaire (§ 9.5) ;
2. à 100 % : l'archivage continue ; analyse approfondie, agent, livrables et tâches consommant des crédits sont mis en attente ;
3. l'utilisateur qui lance une mission reçoit un message clair avec trois options : acheter des crédits, changer d'offre, attendre le renouvellement ;
4. après achat ou renouvellement, les éléments en attente reprennent dans l'ordre d'arrivée, sans doublon ni perte.

## 10.14. Perte de connexion Google Drive

1. une opération Drive échoue pour cause d'autorisation révoquée, expirée ou insuffisante ;
2. la connexion passe à l'état « À reconnecter » ; les réceptions suivantes sont enregistrées et mises en attente, les fichiers temporaires contrôlés sont conservés ;
3. l'administrateur est alerté par notification, e-mail et WhatsApp ; l'application affiche le bouton « Reconnecter » ;
4. après reconnexion et test réussi, les éléments en attente sont archivés automatiquement, sans doublon, et un compte rendu indique leur nombre ;
5. si la reconnexion n'a pas lieu dans le délai de conservation des fichiers temporaires, une anomalie est créée pour chaque élément concerné avant toute purge.

## 10.15. Paiement échoué ou abonnement suspendu

1. le prestataire notifie l'échec ; le backend met l'abonnement en `EN_GRACE` (§ 9.8) ;
2. le propriétaire reçoit la notification avec le lien de mise à jour du moyen de paiement ;
3. si le paiement est régularisé, l'abonnement redevient `ACTIF` sans aucune perte ;
4. sinon, passage à `IMPAYE` puis `SUSPENDU` selon les délais du § 9.6, avec message explicite renvoyé à tout expéditeur dont la collecte est arrêtée ;
5. le règlement réactive immédiatement l'organisation et reprend les éléments en attente.

# 11. Règles métier, statuts et traçabilité

## 11.1. Statuts des clients

- `ACTIF` : le client peut recevoir des documents via ses groupes actifs ;
- `SUSPENDU` : les nouvelles réceptions sont conservées mais mises en attente ;
- `ARCHIVE` : fiche retirée des opérations courantes, historique conservé.

## 11.2. Statuts des groupes

- `A_CONFIGURER` ;
- `EN_VERIFICATION` ;
- `ACTIF` ;
- `SUSPENDU` ;
- `DECONNECTE` ;
- `ARCHIVE`.

Un groupe ne passe à `ACTIF` qu'après validation technique et test de bout en bout.

## 11.3. Statuts des réceptions

- `RECUE` ;
- `MEDIA_A_RECUPERER` ;
- `EN_TRAITEMENT` ;
- `EN_ATTENTE_VERIFICATION` ;
- `TRAITEE` ;
- `ERREUR_REPRENABLE` ;
- `ERREUR_DEFINITIVE` ;
- `REJETEE_JUSTIFIEE`.

## 11.4. Statuts des fichiers documentaires

- `EN_VALIDATION` ;
- `PRET_A_ARCHIVER` ;
- `EN_ARCHIVAGE` ;
- `ARCHIVE` ;
- `A_VERIFIER` ;
- `INACCESSIBLE_DANS_DRIVE` ;
- `REJETE_JUSTIFIE`.

Le statut `ARCHIVE` signifie que l'API Drive a confirmé la création du fichier dans le dossier attendu et que son identifiant Drive est enregistré. Un simple lancement de l'upload ne suffit pas.

L'état d'indexation est distinct : `INDEXATION_EN_ATTENTE`, `INDEXE`, `INDEXATION_ECHEC`.

## 11.5. Statuts des tâches techniques

- `EN_ATTENTE` ;
- `EN_COURS` ;
- `RETRY_PROGRAMME` ;
- `REUSSI` ;
- `BLOQUE` ;
- `ECHEC_DEFINITIF`.

Le statut de la tâche est distinct du statut métier du fichier ou de la réception. Les missions de l'agent suivent les statuts du § 7.12.

## 11.6. Idempotence et absence de perte

Chaque événement entrant est enregistré avant le traitement lourd. Une clé d'idempotence est construite à partir des identifiants fournis par WhatsApp et du contexte du message ; lorsqu'un identifiant fournisseur est absent, une empreinte technique stable du payload utile est utilisée avec prudence.

Les contraintes d'unicité en base empêchent la création d'une seconde réception logique pour un même événement. Les appels n8n, les opérations Drive, les envois et les exécutions de tâches programmées peuvent être rejoués sans créer de copies involontaires.

Toute tentative, erreur et reprise est historisée avec date, étape, code d'erreur exploitable et résultat.

## 11.7. Nommage Drive

Structure cible :

```text
[DRIVE DE L'ORGANISATION]
└── [DOSSIER RACINE ARCHIVES]
    └── [CODE CLIENT] - [NOM CLIENT]
        └── [CODE GROUPE] - [NOM GROUPE]
            └── [CATEGORIE]
                └── [ANNEE]
                    └── [MOIS]
                        └── [FICHIER ARCHIVE]
```

Les sous-dossiers sont créés à la demande, au premier fichier qui en a besoin. Il est inutile de créer toutes les catégories et périodes à l'avance. Les livrables de l'agent déposés dans Drive sont rangés dans un dossier dédié « Livrables » sous le client concerné, ou à la racine de l'organisation lorsqu'ils concernent plusieurs clients.

Le classement utilise la date de réception du système, dans le fuseau horaire configuré pour l'organisation. La date du message WhatsApp est conservée séparément lorsqu'elle est disponible. Le système ne déduit pas une date documentaire à partir du seul nom de fichier ; une date extraite du contenu par l'agent est enregistrée comme donnée extraite avec sa confiance, sans modifier le chemin d'archivage.

Le nom original est conservé dans la base. Le nom archivé peut suivre ce format :

`CODECLIENT_CODEGROUPE_YYYYMMDD_HHMMSS_NOMORIGINAL`

Les caractères interdits, chemins relatifs, séparateurs et noms excessivement longs sont neutralisés. Une collision entraîne l'ajout d'un suffixe déterministe ; aucun fichier existant n'est écrasé.

## 11.8. Conservation et suppression

Les documents archivés dans Drive ne sont pas supprimés automatiquement. La suppression d'un client ou d'un groupe est logique et conserve les liens documentaires.

La suppression d'une archive Drive est une action explicite, autorisée, confirmée et auditée, jamais déléguée à l'agent. La politique de conservation des journaux, des traces de l'agent, des payloads techniques et des fichiers temporaires est configurée avant la mise en production.

# 12. Intégrations externes et contraintes de faisabilité

## 12.1. WhatsApp Business Platform

**Conversation directe (canal principal).** L'agent est joignable par conversation directe sur un numéro Cloud API. Le numéro partagé de la plateforme sert par défaut ; un numéro dédié est proposé à l'offre supérieure (§ 9.3.2). Les utilisateurs appairés y envoient instructions, messages vocaux et fichiers, et y reçoivent réponses et livrables. Contraintes à respecter : fenêtre de service de 24 heures pour les réponses libres, modèles de messages approuvés pour les envois initiés par l'entreprise hors fenêtre, limites de débit et de taille de média imposées par Meta. Ces conditions sont revérifiées au moment de l'intégration.

**Collecte depuis les groupes.** La collecte directe depuis les groupes passe par l'intégration officielle. Elle ne signifie pas que l'application peut surveiller n'importe quel groupe classique déjà existant.

La documentation Groups API consultée décrit notamment :

- un numéro professionnel fonctionnant avec Cloud API, et non simplement avec l'application WhatsApp Business ;
- un compte entreprise soumis à des conditions d'éligibilité spécifiques ;
- la création de groupes via l'API et l'utilisation de liens d'invitation ;
- des webhooks dédiés aux événements de cycle de vie, de participants, de paramètres et de statut des groupes ;
- la permission `whatsapp_business_messaging` et l'abonnement de l'application au compte WhatsApp Business concerné.

La documentation indique une exigence d'Official Business Account (OBA) et un niveau de messagerie d'au moins 100 000 conversations initiées par l'entreprise sur une fenêtre glissante de 24 heures. Cette condition est revalidée directement dans le compte Meta et la documentation officielle au moment du test, car les critères et limites peuvent évoluer. Les groupes Groups API suivent un parcours d'invitation et d'adhésion ; on ne présume pas qu'un groupe classique existant peut être connecté par son nom ou son lien.

### Phase de preuve obligatoire

Avant de développer l'intégration complète des groupes, réaliser un test avec les comptes destinés à la production :

1. vérifier le statut du compte Meta Business et son éligibilité OBA ;
2. vérifier le niveau de messagerie et les autorisations disponibles ;
3. vérifier que le numéro est opérationnel sur Cloud API ;
4. configurer l'endpoint webhook et les événements requis ;
5. créer ou raccorder un groupe selon le parcours officiellement autorisé ;
6. faire rejoindre les participants concernés ;
7. envoyer depuis un participant réel un fichier représentatif ;
8. vérifier la réception du webhook, l'identifiant du groupe et les métadonnées média ;
9. télécharger le fichier ;
10. le déposer dans le Drive cible ;
11. confirmer la provenance, l'intégrité et l'accès au fichier.

**Critère GO :** un fichier envoyé dans un groupe réellement utilisé ou migré de manière acceptée est reçu, identifié et archivé de bout en bout sans intervention manuelle.

**Critère NO-GO :** si l'organisation n'est pas éligible ou si les groupes nécessaires ne peuvent pas être utilisés dans le cadre officiel, le développement de la collecte par groupes est suspendu **sans impact sur le reste de HESYD ONE** (conversation directe, dépôt web, dossier surveillé, agent). Aucune lecture non officielle de WhatsApp Web n'est présentée comme alternative.

La fiche d'un groupe peut exister avant ce test, mais son état reste `EN_VERIFICATION` et il n'est jamais affiché comme opérationnel.

## 12.2. Google Drive — propriété, OAuth et autorisations

Le stockage est réalisé dans le Drive de l'organisation abonnée. L'application utilise OAuth 2.0 côté serveur afin que l'organisation autorise explicitement l'accès nécessaire. Les jetons d'accès et de renouvellement sont conservés chiffrés dans un stockage de secrets ; ils ne sont jamais exposés au navigateur ni dans les journaux.

L'accès hors connexion est prévu pour les traitements automatiques, avec gestion du renouvellement des jetons. Une autorisation révoquée, expirée ou insuffisante désactive le traitement dépendant de Drive et déclenche une alerte de reconnexion guidée. Les autorisations sont demandées au moment où la fonctionnalité en a besoin, selon le principe du moindre privilège.

### Choix My Drive / Shared Drive

- **My Drive** : les fichiers appartiennent à l'utilisateur Google propriétaire du Drive.
- **Shared Drive** : lorsque l'organisation dispose d'une édition Google Workspace compatible, les fichiers peuvent appartenir à l'organisation et être gérés collectivement.
- Un compte Google personnel `@gmail.com` ne peut pas créer de Shared Drive ; son usage passe normalement par My Drive ou par une appartenance externe à un Shared Drive existant si l'organisation l'autorise.

Le choix réel est effectué pendant le cadrage de chaque organisation.

### Droits des employés dans Drive

Le fait qu'un employé dispose d'un compte dans l'application ne lui donne pas automatiquement accès aux fichiers Google Drive. Les comptes Google des employés concernés doivent disposer de droits adaptés sur le dossier racine ou sur les dossiers concernés.

L'application n'implémente pas de proxy de téléchargement contournant les permissions Google. Si l'employé n'a pas les droits Drive, l'application affiche une erreur d'accès compréhensible et indique qu'une autorisation Drive est nécessaire.

### Upload et vérification

Pour les fichiers volumineux ou les connexions susceptibles d'être interrompues, utiliser l'upload Drive reprenable (`resumable upload`). Après dépôt, récupérer et enregistrer l'identifiant Drive, le nom, le dossier parent et les métadonnées utiles. Vérifier l'existence du fichier dans le dossier attendu avant de passer à `ARCHIVE`.

Le dossier racine et les mappings client/groupe sont conservés par identifiants Drive, pas uniquement par noms visibles. Un dossier renommé ne casse pas l'association si son identifiant reste valide. Un dossier supprimé ou inaccessible déclenche une anomalie et non une création automatique incontrôlée d'un nouveau dossier.

## 12.3. Autres clouds de stockage

L'accès au stockage passe par une **interface de connecteur de stockage** (lister, lire les métadonnées, déposer, créer un dossier, vérifier l'existence). Google Drive est le premier connecteur livré. D'autres clouds (par exemple Dropbox, OneDrive, stockage compatible S3) pourront être ajoutés ensuite sans modifier le cœur ; ils suivent les mêmes règles de confirmation, d'idempotence et de permissions.

## 12.4. Modèle IA

Fournisseur choisi par la couche d'abstraction (§ 7.15), avec modèle de repli. Les limites, quotas, tarifs et conditions de traitement des données du fournisseur sont revérifiés avant engagement.

## 12.5. Limites de stockage temporaire

Le VPS héberge une zone temporaire de traitement, mais ne constitue pas le stockage documentaire définitif. Les fichiers temporaires sont protégés, non exposés publiquement et supprimés après confirmation d'archivage, sauf lorsqu'ils doivent être conservés pour une reprise ou une investigation autorisée.

La capacité disque est surveillée. En cas de seuil critique, le système suspend les nouveaux téléchargements non essentiels et alerte l'administrateur plutôt que saturer le serveur.

# 13. Architecture technique cible

## 13.1. Architecture générale

Architecture recommandée : un backend métier central en TypeScript, une base de données relationnelle et n8n comme orchestrateur. Pas de microservices.

```text
Utilisateur (Web / WhatsApp / Voix)
        │
        ▼
┌───────────────────────────────────────────────┐
│ Next.js (TypeScript) — interface et API         │
│ • UI, streaming, Agent Workbench                │
│ • Authentification, permissions, organisations  │
│ • Webhooks (WhatsApp, Google, n8n, paiement)    │
│ • Exécution de l'agent (tâches courtes)         │
│ • Approbations                                  │
└──────────────┬──────────────────────────────────┘
               │ appels signés
               ▼
        n8n (workflows, planifications, reprises)
               │
   ┌───────────┼─────────────┬────────────────┐
   ▼           ▼             ▼                ▼
PostgreSQL   Google Drive   WhatsApp      Modèle IA
(+ pgvector) (connecteur    Business      (OCR, extraction,
              de stockage)  Platform      embeddings)

[Optionnel, uniquement si besoin démontré :
 worker de traitements longs consommant la file PostgreSQL]
```

| Composant | Technologie cible | Responsabilité |
|---|---|---|
| Interface web et backend métier | Next.js (TypeScript), mode Node auto-hébergé | Écrans, API, authentification, permissions, webhooks, règles métier, agent, approbations |
| Base de données | PostgreSQL + pgvector | Source de vérité : référentiel, réceptions, documents, index, missions, journaux |
| Orchestration | **n8n** | Workflows, planifications, déclencheurs, reprises, contrôles planifiés |
| Collecte | WhatsApp Business Platform | Conversation directe ; groupes après preuve d'éligibilité |
| Archivage | Google Drive API (connecteur de stockage) | Dossiers et dépôt des fichiers |
| Modèles IA | Via couche d'abstraction | Compréhension, extraction, OCR/vision, génération, embeddings |
| Génération de fichiers | Bibliothèques PDF / Excel / Word côté serveur | Livrables |
| Validation des données | Schémas typés (Zod ou équivalent) | Entrées, sorties d'outils, formulaires |
| Accès base de données | ORM TypeScript avec migrations versionnées | Modèle, requêtes, transactions |
| Stockage temporaire et livrables | Disque protégé du VPS, éventuellement stockage objet compatible S3 | Fichiers en cours de traitement, livrables avant dépôt |
| Paiement et facturation | Prestataire de paiement par abonnement (webhooks signés) | Encaissement, abonnements, packs, factures, relances |
| Hébergement | VPS Linux | Exécution des services |
| Reverse proxy | Nginx | HTTPS, routage et exposition contrôlée |

La version de Node.js (LTS), de Next.js et des bibliothèques est figée ensemble au démarrage du développement et couverte par la CI.

## 13.2. Responsabilités

### Next.js

- interface utilisateur, navigation, formulaires, tableaux, filtres, pagination ;
- authentification, sessions et contrôle centralisé des permissions ;
- API métier et réception/validation des webhooks ;
- enregistrement durable des événements ;
- identification client/groupe, gestion des fichiers, réceptions et doublons ;
- exécution de l'agent pour les missions courtes, avec état persisté avant et après chaque étape ;
- intégration Google Drive, gestion des tâches, statuts, reprises et journaux ;
- approbations, abonnement et mesure d'usage.

Aucun secret WhatsApp, Google ou modèle n'est envoyé au navigateur.

### PostgreSQL

Source de vérité des données métier et de l'état des traitements : organisations, clients, groupes, fichiers, réceptions, événements, tâches, missions, étapes, appels d'outils, livrables, index, utilisateurs, notifications, imports, abonnements et audits.

### n8n

Orchestre les actions automatisées : planifications et déclencheurs, téléchargement ou transfert contrôlé, opérations Drive, notifications, reprises et vérifications périodiques. Les workflows sont documentés, exportés et versionnés dans le dépôt. **n8n n'est pas la source de vérité** : une exécution n8n n'est considérée comme réussie que lorsque le backend a enregistré et vérifié le résultat correspondant. Aucune logique métier critique n'existe uniquement dans n8n.

### Nginx

Reverse proxy, HTTPS, routage et règles d'exposition. Il ne remplace ni le backend, ni la base de données, ni le moteur de traitement asynchrone. n8n n'est jamais exposé publiquement sans protection ; son accès est restreint.

## 13.3. Traitement asynchrone, sans worker par défaut

Le webhook reste rapide : validation, enregistrement durable de l'événement et programmation d'une tâche, puis réponse au fournisseur. Le téléchargement, le contrôle, le classement et l'archivage ont lieu après cette étape.

Le backend crée une tâche persistée en base. n8n est déclenché ou récupère les tâches éligibles. Un contrôle planifié identifie les tâches non démarrées, expirées ou bloquées et les remet dans le circuit de reprise. Le mécanisme exact de distribution des tâches est implémenté, surveillé et testé ; « utiliser n8n » seul ne suffit pas à garantir la reprise.

**Aucun worker indépendant par défaut.** Les missions courtes de l'agent, l'archivage, l'indexation d'un document et les rapports de taille normale sont exécutés par le backend Next.js (mode Node auto-hébergé) orchestré par n8n, avec état persisté et reprise à la dernière étape confirmée.

**Worker de traitements longs (conditionnel).** Un processus Node/TypeScript distinct, dans le même dépôt, n'est ajouté que si les mesures démontrent qu'une opération dépasse ce que le backend peut tenir de façon fiable (par exemple indexation ou OCR de milliers de documents, rapport couvrant un très grand volume, mission durant une à plusieurs heures). Il consomme alors une file durable adossée à PostgreSQL, avec verrous et heartbeats (une tâche appartient à un seul worker à la fois ; sans heartbeat, elle est reprise), publie la progression vers l'interface et ne porte aucune logique métier propre. Cette décision est prise après mesure et documentée.

## 13.4. Contrat Next.js ↔ n8n

- appels du backend vers n8n signés (secret partagé, horodatage, protection contre le rejeu) ;
- rappels de n8n vers le backend signés et authentifiés ;
- identifiant de corrélation unique par exécution ;
- workflows idempotents, documentés, exportés et versionnés ;
- un résultat n8n n'est accepté qu'après validation par le backend.

## 13.5. Isolation multi-organisation

Chaque enregistrement porte l'identifiant d'organisation. L'isolation est appliquée côté serveur par une couche d'accès centralisée, doublée si possible par des politiques de sécurité au niveau des lignes PostgreSQL. Les index de recherche, la mémoire, les connecteurs, les secrets et les workflows n8n (paramétrés par organisation) sont isolés. Tout test de recette inclut une tentative d'accès inter-organisations, y compris par l'agent.

## 13.6. Principes de conception technique

- application modulaire, monolithique au départ (monorepo TypeScript) ;
- API versionnée et documentée ;
- transactions base de données pour les étapes critiques ;
- clés d'idempotence et contraintes d'unicité ;
- délais d'attente et reprises avec temporisation progressive ;
- limites de concurrence et respect des quotas fournisseurs ;
- séparation des environnements de développement, test, démonstration et production ;
- migrations de base versionnées ;
- tests automatiques en CI ;
- configuration par variables d'environnement et coffre de secrets ;
- aucun secret ni fichier documentaire exposé dans les dépôts Git.

# 14. Modèle de données cible

Le schéma détaillé sera produit pendant la conception technique, mais les entités et contraintes suivantes sont obligatoires. **Chaque table métier porte `organization_id`.**

## 14.1. `organizations`, `memberships` et abonnement

`organizations` (nom, pays, fuseau horaire, langue, statut), `memberships` (utilisateur, organisation, rôle, permissions), `invitations` (lien signé, rôle, expiration), `pairing_codes` (code à usage unique, utilisateur, expiration, état), `whatsapp_pairings` (numéro, utilisateur, organisation, état), `onboarding_progress` (étapes et dates), `plans` (offre, quotas, options, prix, devise), `subscriptions` (offre, statut, période, essai, résiliation), `billing_customers` (identifiant chez le prestataire, coordonnées de facturation), `subscription_events` (webhooks du prestataire, clé d'idempotence), `invoices` (référence externe, montant, statut), `usage_metering` (organisation, utilisateur, nature, quantité, coût), `credit_ledger` (crédits accordés, achetés, consommés, expiration), `platform_admins` (opérateurs de la plateforme), `support_access_grants` (consentement, durée, consultations).

## 14.2. `clients`

Champs principaux : `id`, `organization_id`, `code`, `name`, `contact_information`, `status`, `drive_folder_id`, `created_at`, `updated_at`, `archived_at`.

Contraintes : code unique par organisation ; suppression logique ; aucun effacement en cascade des fichiers.

## 14.3. `whatsapp_groups`

Champs principaux : `id`, `organization_id`, `client_id`, `code`, `name`, `source_type`, `whatsapp_group_id`, `collection_status`, `drive_folder_id`, `status`, `last_event_at`, `created_at`, `updated_at`.

Contraintes : `client_id` référence un client existant ; relation plusieurs groupes vers un client ; code interne unique ; identifiant WhatsApp externe unique lorsqu'il est présent ; aucune dépendance au nom pour l'identification technique.

## 14.4. `webhook_events`

Champs principaux : `id`, `organization_id`, `provider`, `provider_event_key`, `external_group_id`, `external_message_id`, `event_type`, `received_at`, `payload_reference` ou payload minimal expurgé, `signature_valid`, `processing_status`, `created_at`.

Contraintes : unicité de la clé fournisseur ou de la clé d'idempotence ; conservation des événements rejetés pour diagnostic limité ; exclusion des secrets et des données inutiles.

## 14.5. `files`

Champs principaux : `id`, `organization_id`, `client_id`, `group_id`, `original_filename`, `stored_filename`, `mime_type`, `extension`, `category`, `size_bytes`, `sha256`, `drive_file_id`, `drive_url`, `status`, `index_status`, `detected_type`, `detected_type_confidence`, `source`, `created_at`, `updated_at`.

`client_id` et `group_id` peuvent rester non renseignés tant qu'une réception n'est pas identifiée ; ils deviennent obligatoires avant archivage. La cohérence entre client et groupe est vérifiée par le backend et, lorsque possible, par une contrainte ou un contrôle transactionnel.

## 14.6. `file_receptions`

Champs principaux : `id`, `organization_id`, `file_id` nullable, `webhook_event_id`, `client_id` nullable, `group_id` nullable, `external_group_id`, `whatsapp_message_id`, `media_id`, `sender_id` facultatif, `message_timestamp` facultatif, `received_at`, `caption` facultative, `source`, `status`, `created_by` pour les imports manuels.

Une réception peut exister avant l'identification définitive du groupe ou avant la création du fichier documentaire. Plusieurs réceptions peuvent référencer le même `file_id`.

## 14.7. `processing_jobs` et `processing_logs`

`processing_jobs` : `id`, `organization_id`, `reception_id`, `file_id`, `job_type`, `status`, `attempt_count`, `next_retry_at`, `locked_at`, `locked_by`, `last_error_code`, `last_error_message`, `started_at`, `finished_at`, `created_at`.

Contraintes : empêcher deux exécutions simultanées non contrôlées d'une même tâche ; conserver les tentatives ; rendre les tâches reprenables après redémarrage.

`processing_logs` : `id`, `job_id`, `file_id`, `reception_id`, `step`, `result`, `details_sanitized`, `created_at`. Les détails sont expurgés des tokens, données sensibles et contenus complets des documents.

## 14.8. `users`

Champs principaux : `id`, `name`, `email`, `password_hash` ou référence d'authentification, `status`, `last_login_at`, `created_at`, `updated_at` ; le rôle et les permissions sont portés par `memberships`.

## 14.9. `notifications`

Champs principaux : `id`, `organization_id`, `user_id`, `type`, `title`, `message`, `related_entity`, `related_entity_id`, `read_at`, `created_at`.

## 14.10. `audit_logs`

Champs principaux : `id`, `organization_id`, `user_id`, `action`, `entity_type`, `entity_id`, `before_data`, `after_data`, `reason`, `created_at`.

## 14.11. `import_batches` et `import_rows`

Le lot conserve le fichier source, le demandeur, la date, le statut et le résumé. Les lignes conservent le numéro de ligne, les valeurs utiles, le résultat et le motif de rejet afin de permettre un rapport exploitable.

## 14.12. `integration_connections` et `drive_folder_mappings`

Les connexions externes et leurs états sont représentés explicitement. Les tokens ne sont pas stockés en clair dans ces tables. Les mappings Drive conservent les identifiants de dossiers et leur type : racine, client ou groupe.

## 14.13. Entités de l'agent

- `conversations` (canal, utilisateur, statut, résumé) et `messages` (rôle, contenu, pièces jointes, canal, identifiant externe) ;
- `agent_tasks` (objectif, statut, limites, coût, utilisateur, déclencheur) ;
- `task_plans` et `task_steps` (étape, outil prévu, statut, tentative, preuve de réussite) ;
- `tool_calls` (outil, paramètres expurgés, résultat structuré, durée, erreur, identifiant de corrélation) ;
- `clarification_requests` et `form_submissions` (schéma, lien, expiration, réponses) ;
- `approvals` (action précise, niveau de risque, demandeur, décideur, décision, expiration) ;
- `deliverables` (type, version, sources, emplacement, statut, lien) ;
- `agent_runs` (version de l'invite, modèle, jetons, coût, latence) ;
- `steering_events` (interruptions et redirections) ;
- `tool_registry` et `tool_policies` (définitions, niveau de risque, rôles autorisés) ;
- `memory_items` (portée, contenu, source, date, statut) ;
- `eval_cases` et `eval_runs` ;
- `demo_scenarios` et `demo_runs`.

## 14.14. Entités de connaissance

`document_chunks` (texte, page, zone, embedding), `extractions` (champ, valeur, confiance, source), `index_jobs`.

## 14.15. Entités d'automatisation

`automations` (règle structurée, déclencheurs, statut), `automation_runs` (créneau, clé d'idempotence, résultat), `storage_connectors` (type, état, portée).

## 14.16. Relations principales

- `organizations` 1 — N `clients`, `users` (via `memberships`), `integration_connections` ;
- `clients` 1 — N `whatsapp_groups` ;
- `whatsapp_groups` 1 — N `files` ;
- `files` 1 — N `file_receptions` ;
- `files` 1 — N `document_chunks` et `extractions` ;
- `webhook_events` 1 — 0..N `file_receptions` selon la structure réelle du payload ;
- `file_receptions` 1 — N `processing_jobs` ;
- `processing_jobs` 1 — N `processing_logs` ;
- `agent_tasks` 1 — N `task_steps`, `tool_calls`, `approvals`, `deliverables` ;
- `automations` 1 — N `automation_runs` ;
- `users` 1 — N `audit_logs`, notifications et opérations manuelles.

Les contraintes d'unicité couvrent notamment les codes métier par organisation, les identifiants externes WhatsApp, les événements fournisseur, les clés d'idempotence des exécutions programmées et la combinaison `(organization_id, group_id, sha256)` pour la déduplication documentaire au sein d'un même groupe.

# 15. Sécurité, confidentialité et conformité opérationnelle

## 15.1. Sécurité des accès

- HTTPS obligatoire ;
- mots de passe hachés avec un algorithme adapté ; authentification multifacteur disponible ;
- limitation des tentatives de connexion et protection contre les sessions volées ;
- contrôle serveur de chaque permission ;
- expiration et révocation des sessions lors de la désactivation d'un compte ;
- protection contre CSRF, XSS, injections SQL, requêtes forgées côté serveur (SSRF) et accès directs non autorisés ;
- validation de toutes les entrées et des fichiers reçus.

## 15.2. Secrets et intégrations

Les secrets Meta, OAuth, clés API, clés du fournisseur de modèle et informations de connexion n8n sont conservés dans un stockage sécurisé, chiffré au repos, et accessibles uniquement aux composants qui en ont besoin. Ils ne sont jamais présents dans le navigateur, les messages d'erreur, les exports, les journaux ni les invites envoyées au modèle. Les accès Google suivent le principe du moindre privilège. Aucune donnée de carte bancaire n'est collectée ni stockée par HESYD ONE : elle reste chez le prestataire de paiement. Les webhooks du prestataire sont vérifiés par signature et traités de façon idempotente. La console de l'opérateur exige l'authentification multifacteur et n'expose aucun contenu documentaire sans accès accordé par le client (§ 4.9).

## 15.3. Protection des fichiers

Les fichiers sont stockés temporairement hors du répertoire public. Le type MIME est contrôlé à partir du contenu réel. Les fichiers suspects sont isolés et ne sont pas ouverts automatiquement. Les noms sont neutralisés pour éviter les traversées de répertoires et les collisions. Aucun contenu n'est exécuté.

## 15.4. Données envoyées aux modèles

Minimisation : seuls les extraits nécessaires sont transmis. Option d'expurgation des données sensibles avant envoi. Réglages et contrats du fournisseur excluant l'entraînement sur les données de l'organisation. Journal des données envoyées (références, pas contenu complet).

## 15.5. Confidentialité

L'application ne collecte que les métadonnées nécessaires à l'archivage : identifiants source disponibles, date, groupe, expéditeur si utile, nom, type, taille et commentaire du message associé au fichier si le besoin est confirmé. Les messages sans fichier ne sont pas archivés par la collecte ; les échanges avec l'agent sont conservés comme historique de conversation avec une durée de conservation configurable. Le contenu intégral des groupes n'est pas aspiré.

Avant la mise en production, chaque organisation doit valider l'information des membres des groupes, la finalité du traitement documentaire, la durée de conservation et les responsabilités applicables. Le produit est conçu pour faciliter la conformité à la loi marocaine 09-08 et au RGPD lorsque des données de résidents européens sont traitées. Le présent cahier ne remplace pas une validation juridique ou de conformité.

## 15.6. Sauvegardes et restauration

- sauvegarde automatisée de PostgreSQL ;
- sauvegarde ou export versionné des workflows n8n ;
- conservation d'une copie chiffrée hors du VPS ;
- procédure de restauration documentée ;
- test de restauration avant mise en production puis périodiquement ;
- contrôle de l'intégrité et des résultats après restauration.

**Objectifs opérationnels de départ proposés :** perte maximale de données métier de 24 heures (RPO) et remise en service en 8 heures (RTO), sous réserve de validation du budget, de l'hébergement et de la fréquence réelle de sauvegarde. Ces objectifs ne sont pas réputés atteints tant qu'un exercice de restauration n'a pas été réussi.

# 16. Exigences non fonctionnelles et exploitation

## 16.1. Disponibilité et cohérence

Le système affiche l'état réel de ses composants. Il n'annonce un archivage réussi qu'après confirmation Drive, et un succès de mission qu'après vérification des preuves. Une interruption WhatsApp, Drive, n8n ou du modèle IA ne supprime aucun événement ni aucune tâche déjà enregistrés.

## 16.2. Performance

Les listes sont paginées côté serveur. Les recherches utilisent des index sur les codes, noms, statuts, dates et clés de provenance, et sur les vecteurs pour la recherche sémantique. Les appels Drive, les téléchargements, l'indexation et la génération de livrables ne sont pas exécutés de manière bloquante dans une requête d'interface. Les réponses de l'agent sont diffusées en continu.

Le volume attendu (organisations, clients, groupes, réceptions quotidiennes, taille maximale des médias, employés simultanés, documents indexés, missions par jour) est mesuré pendant le cadrage afin de dimensionner le VPS et les limites de traitement. Aucune capacité chiffrée n'est promise sans ce dimensionnement.

## 16.3. Observabilité

Les erreurs sont corrélables par identifiant d'événement, réception, fichier, tâche, mission et appel d'outil. Les journaux sont structurés, horodatés et expurgés. Métriques minimales : nombre de tâches en attente, âge de la plus ancienne tâche, taux d'échec par outil, temps de traitement, jetons et coût par mission, espace disque disponible, derniers succès WhatsApp / Drive / modèle, état de n8n. Alertes sur tâches bloquées, boucles de l'agent, coûts anormaux et connecteurs déconnectés.

## 16.4. Reprise automatique

Les erreurs temporaires (timeout, indisponibilité réseau, quota temporaire) sont retentées avec délai croissant et nombre maximal configurable. Les erreurs définitives (permission insuffisante, groupe non autorisé, fichier invalide) sont dirigées vers une action humaine ou un rejet justifié. Le système évite les boucles de reprise infinies et conserve le motif de l'arrêt automatique. Si le modèle principal est indisponible, bascule vers le modèle de repli ou message clair avec mise en file.

## 16.5. Environnements et livraison

Au minimum quatre environnements séparés : développement, recette, démonstration et production ; ni secrets ni bases partagés. L'environnement de recette est identique à la production et utilise des comptes et services réels dédiés. Migrations versionnées ; déploiements avec procédure de retour arrière compatible avec l'état des données.

## 16.6. Accessibilité et internationalisation

Interface accessible (navigation clavier, contrastes), français par défaut, architecture prête pour l'anglais et l'arabe, formats de date et de devise localisés, fuseau horaire par organisation.

# 17. Critères de recette et conditions d'acceptation

La livraison ne peut être acceptée sur la seule base d'une interface visuellement terminée. Les scénarios suivants sont exécutés et documentés.

## 17.1. Principe : aucun test simulé

Les tests d'acceptation s'exécutent sur de vrais services : vrai modèle IA, vrai numéro WhatsApp Business de test, vrais comptes Google dédiés, vraie instance n8n. Aucune réponse de service n'est simulée ni préenregistrée. Les données de test sont de vrais documents représentatifs et non confidentiels (PDF natifs et scannés, tableurs, images). Les pannes sont provoquées réellement (coupure réseau, arrêt de n8n, redémarrage du serveur, révocation d'autorisation). Les résultats sont mesurés et consignés. Un scénario critique est répété au moins dix fois consécutives sans échec. Les tests unitaires de logique pure restent autorisés mais ne constituent jamais une preuve de recette fonctionnelle. Aucun résultat simulé en développement ne remplace un test réel.

## 17.2. Clients et groupes

- créer un client sans groupe ;
- lui ajouter un groupe ;
- lui ajouter trois groupes supplémentaires ;
- vérifier que chaque groupe possède son propre statut et son propre dossier ;
- suspendre un groupe et vérifier que les autres continuent ;
- réactiver le groupe et reprendre les éléments en attente ;
- vérifier l'unicité des codes et des identifiants externes.

## 17.3. WhatsApp réel

- confirmer l'éligibilité du compte et du numéro ;
- appairer un numéro ; un numéro non appairé n'a aucun accès ;
- conversation directe : instruction texte, message vocal transcrit, fichier joint traité, livrable renvoyé dans la conversation ;
- recevoir un événement réel d'un groupe compatible (si GO) ;
- identifier le groupe et le client exacts ;
- recevoir et télécharger un média ;
- vérifier les identifiants et dates disponibles ;
- tester plusieurs fichiers envoyés dans le groupe ;
- rejouer un webhook dupliqué ;
- vérifier qu'un événement provenant d'un groupe inconnu reste non attribué ;
- vérifier qu'un groupe suspendu ne déclenche pas d'archivage normal ;
- groupe WhatsApp : test avec un vrai groupe compatible, sans quoi la collecte par groupes n'est pas validée (le reste du produit n'en dépend pas).

## 17.4. Documents et doublons

- tester un échantillon représentatif de PDF, tableurs, documents, images et autres formats réellement utilisés ;
- tester fichier trop volumineux, fichier incomplet et fichier corrompu ;
- tester même nom avec contenu différent ;
- tester même contenu reçu plusieurs fois dans un groupe ;
- tester même contenu reçu dans deux groupes distincts ;
- vérifier l'empreinte SHA-256 et l'absence d'écrasement ;
- vérifier la conservation de chaque réception.

## 17.5. Google Drive

- connecter le compte réel de l'organisation ;
- créer les dossiers client et groupe ;
- archiver un fichier ;
- vérifier le dossier parent, l'identifiant Drive et l'accès ;
- tester un upload reprenable ;
- provoquer une coupure réseau ;
- révoquer l'autorisation et vérifier l'alerte ;
- déplacer ou supprimer un dossier et vérifier la détection ;
- vérifier qu'un employé autorisé dans l'application mais non autorisé dans Drive reçoit un message d'accès explicite.

## 17.6. À traiter et corrections

- groupe inconnu ;
- client suspendu ;
- groupe suspendu ;
- erreur Drive temporaire ;
- erreur Drive définitive ;
- prise en charge par un opérateur ;
- tentative de prise en charge concurrente ;
- correction du client/groupe ;
- conservation de l'ancienne association et de la justification ;
- relance sans duplication ;
- rejet avec motif ;
- extraction à faible confiance dirigée vers la vérification.

## 17.7. Import

- import valide ;
- code client dupliqué ;
- code groupe dupliqué ;
- client existant avec nouveau groupe ;
- colonne obligatoire manquante ;
- ligne invalide ;
- import partiel après aperçu ;
- rapport exact des créations, ignorés et erreurs.

## 17.8. Agent et connaissances

- question simple, mission multi-étapes, mission avec information manquante ;
- réponse citant fichier et page ; information absente → réponse « introuvable » et non invention ;
- recherche exacte, plein texte, sémantique et hybride ;
- documents scannés (OCR), tableaux, comparaison de versions ;
- calculs vérifiés (totaux cohérents avec les sources) ;
- plan affiché, exécuté, vérifié ; statut final conforme aux preuves ;
- échec d'un outil : reprise, contournement ou escalade ;
- redémarrage du serveur en cours de mission : reprise sans doublon d'effet ;
- limites d'étapes, de durée et de coût respectées ; détection de boucle avec compte rendu honnête ;
- interruption, redirection et ajout d'information en cours de mission pris en compte et confirmés ;
- clarification : question simple, formulaire web, WhatsApp Flows si disponible, repli automatique, lien expiré ou rejoué, reprise au bon point du plan ;
- arrêt d'urgence d'une mission et d'un outil ;
- évaluation par trajectoire : une exécution au bon résultat mais au mauvais chemin est signalée ;
- mémoire consultable, corrigeable et supprimable.

## 17.9. Livrables

- PDF, Excel et Word générés, ouverts et contrôlés ;
- chiffres cohérents avec les sources ;
- versions successives conservées ;
- liens sécurisés expirant ;
- dépôt Drive et envoi WhatsApp conformes à la politique d'approbation.

## 17.10. Approbations et sécurité de l'agent

- actions faible, moyen, élevé, critique : comportement conforme à la politique ;
- approbation liée à l'action exacte, invalidée si l'action change ;
- appel d'API direct sans permission refusé ;
- **injection de consignes** via document, message et fichier : aucun outil déclenché ;
- triple condition (contenu non fiable, données privées, canal de sortie) : validation exigée ;
- **accès inter-organisations impossible**, y compris par l'agent et par la recherche ;
- aucun secret dans les réponses, journaux, invites ou exports.

## 17.11. Automatisations et tâches programmées

- règle décrite en langage naturel, transformée en règle structurée et validée ;
- déclencheur planning (intervalle court), événement et condition ;
- collecte et classement périodiques d'un dossier surveillé sans doublon ;
- rapport hebdomadaire créé et envoyé sur WhatsApp ;
- n8n arrêté pendant l'exécution puis reprise sans oubli ni doublon ;
- désactivation après échecs répétés et alerte.

## 17.12. Parcours client, abonnement et paiement

- **parcours complet avec un compte neuf, sans aide d'un développeur** : inscription, création de l'organisation, connexion réelle de Google Drive (consentement, tests, révocation puis reconnexion), appairage WhatsApp (code valide, expiré, réutilisé, numéro déjà rattaché à une autre organisation), premier document archivé et première réponse sourcée ; le délai est mesuré (objectif : moins de 10 minutes) ;
- invitation d'un collègue (lien valide, expiré, révoqué), accès Drive manquant signalé clairement ;
- numéro non appairé : réponse standard, aucune donnée exposée ;
- client « Général » et groupe « Dépôts directs » créés automatiquement ;
- essai : quotas d'essai appliqués, rappels à J-7, J-3, J-1, conversion avec conservation des données, fin d'essai sans paiement (accès limité, export possible, purge à l'échéance, documents du Drive intacts) ;
- paiement avec le prestataire retenu : d'abord dans son environnement de test officiel, puis par une transaction réelle de faible montant avant l'ouverture des ventes ; abonnement activé uniquement par webhook signé, webhook rejoué sans double effet, webhook falsifié rejeté ;
- montée et descente d'offre (prorata, refus de descente si l'usage dépasse l'offre cible), achat d'un pack de crédits, facture téléchargeable ;
- échec de paiement : notification, période de grâce, `IMPAYE`, `SUSPENDU`, réactivation après règlement sans perte ;
- quotas : alertes à 80 % et 100 %, archivage maintenu au dépassement, analyse et agent mis en attente puis repris après achat ou renouvellement, aucune donnée perdue ;
- mesure d'usage cohérente avec la consommation réelle (comparaison avec les coûts du fournisseur de modèle) ;
- résiliation, export complet, purge à l'échéance et attestation de suppression ; jetons Google révoqués ;
- console opérateur : accès refusé sans authentification multifacteur, aucun accès au contenu documentaire sans autorisation du client, chaque consultation journalisée.

## 17.13. Sécurité et exploitation

- accès propriétaire, administrateur, employé et lecteur ;
- désactivation d'un utilisateur ;
- arrêt de n8n pendant la réception puis reprise ;
- redémarrage du backend pendant un traitement et vérification de la reprise des tâches persistées ;
- restauration PostgreSQL à partir d'une sauvegarde ;
- alerte sur une tâche bloquée et sur un disque presque plein ;
- si un worker de traitements longs est ajouté : reprise après son redémarrage sans doublon d'effet.

## 17.14. Mode démonstration

- chaque scénario du § 7.17 réussit dix fois consécutives sur l'environnement de démonstration réel ;
- remise à l'état initial des comptes dédiés vérifiée ;
- bascule réelle vers le modèle de repli testée ;
- répétition générale d'un live complet sans intervention d'un développeur.

## 17.15. Définition de « prêt pour production et pour la vente »

Le produit est prêt uniquement lorsque :

- le scénario WhatsApp en conversation directe a réussi de bout en bout, et le scénario groupes a passé le GO ou est explicitement suspendu ;
- le dépôt Google Drive réel fonctionne avec les permissions définies ;
- les scénarios critiques de recette sont validés sur de vrais services ;
- le jeu d'évaluation de l'agent atteint le seuil convenu et aucune régression n'est ouverte ;
- les tests de sécurité (injection, isolation entre organisations) sont réussis ;
- aucun défaut bloquant ou critique connu ne subsiste ;
- les sauvegardes et la restauration ont été testées ;
- les comptes, permissions, quotas et l'abonnement sont configurés et testés ;
- les procédures de traitement des anomalies et de reconnexion sont disponibles ;
- l'administrateur et les employés pilotes ont reçu une prise en main ;
- la démonstration a été répétée avec succès ;
- le commanditaire a validé les résultats de la recette.

# 18. Plan de réalisation recommandé

Le plan livre une tranche verticale démontrable tôt, puis élargit. Aucune phase n'est close sans évaluation de non-régression et sans répétition de démonstration.

## Phase 0 — Faisabilité et preuves techniques

- audit du compte Meta, du numéro et des droits ; test de conversation directe ;
- vérification de l'éligibilité Groups API (indépendante, non bloquante) ;
- test d'un groupe compatible et d'un média réel, jusqu'au Drive ;
- audit du compte Google, des permissions et du dossier racine ;
- contrat signé Next.js ↔ n8n et reprise d'une tâche persistée ;
- boucle d'agent minimale avec un outil réel ; choix du modèle IA ;
- mesure du volume : nombre de clients, groupes, fichiers/jour, pics, tailles ; décision éventuelle sur le worker de traitements longs ;
- mesure du coût réel moyen d'un document traité et d'une mission pour fixer les offres, quotas et prix (§ 9.1) ;
- choix du prestataire de paiement selon le pays d'immatriculation de l'entreprise (§ 9.6) ;
- choix du périmètre d'autorisation Google minimal et de la procédure de vérification associée (§ 9.3.1).

**Livrable :** rapport GO / NO-GO, preuves techniques et liste des limites vérifiées. Aucun engagement de collecte par groupes n'est ferme avant ce livrable.

## Phase 1 — Socle applicatif

Projet Next.js (TypeScript), PostgreSQL et migrations, inscription, essai gratuit, assistant de démarrage, client et groupe par défaut, authentification, organisations et rôles, gestion clients et groupes, import Excel/CSV, écrans de base et tableau de bord.

**Livrable :** référentiel opérationnel, testé et administrable.

## Phase 2 — Collecte et archivage

Endpoint webhook, enregistrement idempotent, conversation directe et dépôt web, récupération média, validation des fichiers, classification technique, intégration Drive OAuth, création des dossiers, upload et confirmation, gestion des doublons et des reprises, workflows n8n.

**Livrable :** chaîne de collecte et d'archivage vérifiable. *Premier jalon démontrable.*

## Phase 3 — Exploitation quotidienne

Liste et fiches fichiers, recherche et filtres, historique des réceptions, file À traiter, correction, prise en charge et reprise, notifications et journaux.

**Livrable :** outil utilisable par les employés sans intervention permanente d'un développeur.

## Phase 4 — Agent documentaire

Lecture, OCR, extraction, indexation, recherche hybride, questions-réponses sourcées, génération de livrables (PDF, Excel, Word), Agent Workbench, clarification (questions, formulaires), niveaux d'autonomie et approbations, mémoire, évaluation de base.

**Livrable :** agent documentaire démontrable en direct sur de vrais documents.

## Phase 5 — Automatisations et canal WhatsApp complet

Tâches programmées et déclencheurs, règles en langage naturel, tâches prêtes à l'emploi, contrôle documentaire, messages vocaux, livraison de rapports sur WhatsApp, missions multi-étapes.

**Livrable :** tâches récurrentes fiables avec compte rendu honnête.

## Phase 6 — Abonnement et durcissement

Intégration du prestataire de paiement (abonnements, packs de crédits, factures, relances d'impayés), offres et quotas, mesure d'usage, back-office de l'opérateur, tests fonctionnels et de sécurité, tests de panne et restauration, supervision et alertes, déploiement VPS, Nginx et HTTPS, organisation et scénarios de démonstration, formation courte, recette et mise en production.

**Livrable :** produit déployé, documenté, vendable et accepté.

Les évolutions (autres clouds de stockage, e-mail comme canal, API publique, widget) sont étudiées après la phase 6, selon les besoins commerciaux confirmés.

# 19. Livrables attendus

1. application Next.js fonctionnelle et code source ;
2. dépôt structuré avec instructions d'installation ;
3. schéma de base de données et migrations versionnées ;
4. documentation des API et du catalogue d'outils de l'agent ;
5. workflows n8n exportés, documentés et versionnés ;
6. configuration d'environnement sans secrets en clair ;
7. procédure de connexion WhatsApp et de renouvellement des accès ;
8. procédure de connexion Google Drive et de reconnexion OAuth ;
9. procédure de reprise d'un traitement ou d'une mission et de correction d'une anomalie ;
10. procédure de sauvegarde et de restauration ; procédure d'arrêt d'urgence ;
11. jeu d'évaluation de l'agent et rapport de résultats ;
12. scénarios et jeux de données de démonstration ;
13. rapport de tests, rapport de tests de sécurité et procès-verbal de recette ;
14. guide d'utilisation administrateur et employé, guide de présentation de démonstration ;
15. liste des limites connues et feuille de route ;
16. procédures d'abonnement : ouverture d'une offre, échec de paiement, remboursement, résiliation, export et suppression ;
17. documents juridiques et commerciaux : conditions générales, politique de confidentialité, accord de traitement des données, liste des sous-traitants, grille des offres.

# 20. Décisions et informations à confirmer

Les choix suivants ne sont pas inventés par l'équipe de développement. Ils sont confirmés pendant le cadrage ou la phase 0.

| Point | À confirmer | Conséquence si non confirmé |
|---|---|---|
| Sens de « sauvegarde » | Collecte et copie périodiques d'un dossier source vers l'archive, sauvegarde des documents vers un second stockage, ou les deux | Définition des tâches programmées (§ 8.2) à ajuster |
| Éligibilité WhatsApp | OBA, niveau de messagerie, Cloud API, Flows, Groups API | Pas de GO pour la collecte par groupes ; conversation directe inchangée |
| Groupes utilisés | Groupes classiques existants ou groupes compatibles Groups API | Risque d'impossibilité de raccordement direct |
| Google Drive | My Drive ou Shared Drive ; compte et propriétaire | Connexion et modèle de permissions à adapter |
| Accès Drive des employés | Comptes Google ou groupe Google autorisés | Lien Drive non ouvrable pour certains employés |
| Fournisseur de modèle IA | Modèle principal, repli, budget, localisation des données | Coûts, performances et conformité à ajuster |
| Premiers autres clouds | Lesquels après Google Drive | Ordre de la feuille de route |
| Client cible | Indépendants, petites entreprises, cabinets | Quotas, offres et vocabulaire à adapter |
| Charge initiale | Organisations, clients, groupes, fichiers/jour, pics, taille maximale | Dimensionnement VPS, décision sur le worker de traitements longs |
| Formats prioritaires | Types et tailles réellement échangés | Liste finale de compatibilité et de test |
| Politiques par défaut de l'agent | Niveaux d'approbation de chaque outil, liste blanche d'envoi | Risque d'actions non souhaitées |
| Prestataire de paiement | Pays d'immatriculation de l'entreprise exploitante, moyens de paiement des clients visés, prise en charge de la TVA et des factures | Choix du prestataire et du parcours d'encaissement impossible ; ventes bloquées |
| Grille des offres | Prix, quotas, crédits, remise annuelle, devises, validité des packs, fixés après mesure du coût réel (§ 9.1) | Offres et facturation à finaliser avant la vente |
| Essai gratuit | Durée proposée de 14 jours, sans moyen de paiement, quotas d'essai | Taux de conversion et risque d'abus à arbitrer |
| Délais de grâce et de rétention | Grâce de 7 jours, impayé de 30 jours, rétention de 30 jours après résiliation (valeurs proposées) | Comportement des relances et des purges à figer |
| Numéro WhatsApp | Numéro partagé de la plateforme (par défaut) et conditions du numéro dédié | Parcours d'appairage et offre supérieure à ajuster |
| Périmètre Google | Autorisation limitée aux fichiers créés ou désignés, ou périmètre plus large avec vérification Google | Complexité et délai de mise en production à revoir |
| Hébergement des données | Pays, fournisseur, exigences de conformité | Choix de l'infrastructure |
| Langues | Français seul au lancement ou plus | Effort d'internationalisation |
| Conservation | Durée des journaux, traces de l'agent, conversations, fichiers en échec | Paramétrage de rétention avant production |
| Politique de confidentialité | Information des participants et règles internes | Validation de conformité nécessaire |
| Objectifs de reprise | Confirmation du RPO/RTO proposés et budget de sauvegarde | Niveau de service à ajuster |

# 21. Conclusion et engagement de périmètre

HESYD ONE est un agent documentaire par abonnement. Il reçoit les documents, les identifie, les classe, les archive dans le Drive de l'organisation avec confirmation, les comprend, répond aux questions avec des sources, produit des rapports et exécute des tâches programmées, avec un compte rendu honnête de chaque opération.

Le périmètre est volontairement spécialisé : tout ce que fait l'agent concerne les documents et les opérations qui en découlent. La gestion de plusieurs groupes par client, l'accès global des employés autorisés dans l'organisation, l'organisation Drive par client et groupe, la conservation de chaque réception, la reprise des erreurs, la traçabilité, les approbations et l'isolation entre organisations constituent des exigences obligatoires. n8n est obligatoire ; la stack est Next.js (TypeScript), PostgreSQL et n8n, sans worker dédié par défaut.

Le parcours client fait partie du produit au même titre que ses fonctions : de l'inscription au premier document archivé en moins de 10 minutes, puis à l'abonnement, au paiement et à la résiliation sans perte de documents.

**La collecte par groupes WhatsApp reste conditionnée à la réussite de la preuve de la phase 0.** Cette condition protège contre le développement d'une intégration qui ne pourrait pas fonctionner avec les comptes réels. La conversation directe avec l'agent, le dépôt web et les dossiers surveillés n'en dépendent pas.

---

::: {.pagebreak}
:::

# Annexe A — Références techniques à revérifier

Les conditions des fournisseurs évoluent : toute exigence dépendant d'un tiers est revérifiée dans les comptes de production au moment de l'intégration.

1. **[Meta — WhatsApp Groups API, documentation de référence](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/reference)**
   **[Guide de démarrage Groups API — miroir documentaire, mise à jour indiquée au 14 novembre 2025](https://github.com/kapso-meta-docs/documentation/blob/main/documentation/whatsapp/groups/get-started.mdx)**
2. Documentation WhatsApp Business Platform : Cloud API, fenêtre de 24 heures et modèles de messages, WhatsApp Flows.
3. **[Google — OAuth 2.0 pour applications serveur](https://developers.google.com/identity/protocols/oauth2/web-server)**
4. **[Google — Vue d'ensemble des Shared Drives](https://developers.google.com/workspace/drive/api/guides/about-shareddrives)**
5. **[Google — Téléversement des fichiers Drive et upload reprenable](https://developers.google.com/workspace/drive/api/guides/manage-uploads)**
6. Documentation Next.js : déploiement Node auto-hébergé, Route Handlers, streaming.
7. Documentation n8n : webhooks, authentification, planification, gestion des erreurs.
8. Documentation du fournisseur de modèle : appels d'outils, sorties structurées, vision, embeddings, tarification.
9. Référentiels de sécurité des applications à base de modèles de langage (injection de consignes, droits des agents).
10. Loi marocaine 09-08 et RGPD, selon les données traitées.

# Annexe B — Définitions

| Terme | Définition dans le projet |
|---|---|
| Organisation | Espace de travail abonné, isolé, avec ses utilisateurs, connecteurs, données et facturation |
| Client | Entité suivie par l'organisation et possédant un ou plusieurs groupes |
| Groupe | Groupe WhatsApp (ou canal de dépôt équivalent) rattaché à un seul client et identifié dans l'application |
| Réception | Transmission unique d'un fichier ou média depuis une source, avec sa date et sa provenance |
| Fichier documentaire | Document logique conservé et classé pour un groupe donné |
| Événement webhook | Notification technique reçue d'un fournisseur externe |
| Idempotence | Capacité à rejouer un événement ou une tâche sans créer d'effet métier en double |
| Drive racine | Dossier Google Drive sélectionné comme point de départ de l'archive documentaire |
| À traiter | File regroupant les réceptions et traitements nécessitant une intervention humaine |
| Agent | Système qui comprend une demande, planifie, appelle des outils documentaires, vérifie et livre un résultat |
| Outil | Capacité technique typée, permissionnée et vérifiable exposée à l'agent |
| Mission | Unité de travail confiée à l'agent, avec plan, étapes, preuves et statut |
| Livrable | Résultat identifiable produit par l'agent (rapport, tableau, document) |
| Approbation | Validation humaine d'une action précise avant exécution |
| Ancrage | Obligation de fonder une réponse sur des sources citées |
| Agent Workbench | Écran montrant en temps réel plan, outils, sources et résultat d'une mission |
| Injection de consignes | Tentative de détourner l'agent par du contenu externe contenant des instructions |
| Connecteur de stockage | Interface commune permettant de brancher Google Drive puis d'autres clouds |
| n8n | Outil d'orchestration ; il n'est pas la source de vérité des données métier |
| Worker de traitements longs | Processus optionnel pour les opérations durant de longues durées, ajouté seulement si le besoin est démontré |
| Offre | Formule d'abonnement (Essai, Standard, Entreprise) définissant les quotas et options |
| Crédit de traitement | Unité interne pondérant le coût réel des analyses, questions, missions et livrables |
| Appairage | Rattachement d'un numéro WhatsApp à un utilisateur par code à usage unique |
| Période de grâce | Délai après un échec de paiement pendant lequel l'organisation reste pleinement utilisable |
| Opérateur de la plateforme | Équipe interne qui exploite et vend HESYD ONE, via une console distincte |
| RPO | Perte maximale de données acceptable mesurée en durée |
| RTO | Durée cible maximale de remise en service après incident |

---

**Fin du cahier des charges — Version 1.0 — HESYD ONE**
