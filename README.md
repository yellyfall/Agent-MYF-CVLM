# MYF — interface originale, Groq, Render + Hetzner

Cette livraison repart du fichier « CV & LM.rar » fourni. Elle conserve la structure HTML, les feuilles de style, les menus, les cinq thèmes, les écrans de connexion, les espaces candidat/recruteur/chat, la gestion des utilisateurs et les exports d’origine. Seuls les noms du fournisseur et des modèles changent dans l’interface.

Le frontend reste un site statique Render. L’API Node.js et SQLite tournent sur Hetzner. La clé Groq reste sur Hetzner. Le serveur diffuse les réponses progressivement et limite la concurrence, la taille des requêtes et la durée des générations. Node 24 utilise SQLite intégré : pas de compilation de better-sqlite3 ni de navigateur installé dans le backend.

## Déploiement

Suivre DEPLOIEMENT.md. Les adresses sont déjà renseignées pour votre installation :
- Frontend : https://myf-candidature-frontend.onrender.com
- Backend prévu : https://46-224-141-132.sslip.io

## Connexion et données

Dans l’onglet Administrateur d’origine, saisir ADMIN_PASSWORD dans le champ « clé admin ». Ce mot de passe est distinct de GROQ_API_KEY. Les utilisateurs se connectent avec les comptes créés dans la fenêtre de gestion habituelle. Une suspension, une suppression ou une réinitialisation de mot de passe révoque leurs sessions.

Conserver le volume Docker app-data et le même dossier de déploiement. Si candidature.db de la précédente version est présent dans ce volume, les comptes utilisateurs sont importés une seule fois dans myf.db avec leurs mots de passe et dates d’expiration. La base source reste intacte. Les comptes déjà présents dans myf.db ont priorité en cas de collision de nom ou d’identifiant. Les anciennes sessions nécessitent une reconnexion. Le mot de passe administrateur vient du fichier .env. Cette migration concerne la précédente installation SQLite ; un éventuel PostgreSQL nécessite un export séparé.

## IA et CV

GPT-OSS 120B est le modèle par défaut. GPT-OSS 20B et Qwen sont également proposés ; Qwen est un modèle en préversion chez Groq. Les instructions renforcent la fidélité du CV : ne pas inventer diplômes, dates, compétences ou réalisations. Les exports PDF textuels d’origine restent inchangés ; cela favorise l’extraction du texte mais ne garantit ni score ATS ni sélection par une entreprise. Les scores affichés par l’interface sont des estimations de l’IA.

Limite fonctionnelle : l’API de génération de texte Groq utilisée ici ne remplace pas la génération d’images Mistral. Le bouton de génération d’images et sa suggestion ont été retirés à votre demande. Les anciens historiques enregistrés localement dans le navigateur ne sont pas supprimés.

DAILY_GENERATION_LIMIT=20 compte les appels IA par compte et par jour UTC : CV, lettre et chat consomment chacun un appel. Une demande CV + lettre peut en utiliser plusieurs. MAX_CONCURRENT_GENERATIONS=2 limite les générations simultanées sur le serveur. Ces valeurs se règlent dans .env. Les limites du compte Groq s’appliquent en plus.

## Vérification locale

Node.js 24 requis : npm ci puis npm test. Pour tester l’application complète localement, définir ADMIN_PASSWORD et GROQ_API_KEY dans .env, puis npm start ; ouvrir http://localhost:3000. Pour ce test local, enlever APP_ORIGIN ou le définir à http://localhost:3000 ; ne pas définir API_ONLY=true.

Tests effectués : contrat API original, création/connexion/suspension des comptes, migration du mot de passe scrypt, révocation des sessions, acheminement du flux Groq simulé, rejet des adresses privées pour la recherche Web, analyse syntaxique des scripts. Comparaison des styles et du HTML hors scripts avec l’archive originale ; seules les étiquettes fournisseur/modèles diffèrent. Six vues ouvertes dans Chrome sans erreur JavaScript et cinq thèmes vérifiés.

Pas de déploiement distant ni de génération réelle facturée effectués lors de cette livraison. La mémoire est plafonnée par Docker, sans mesure de charge sur votre serveur. Les polices et bibliothèques CDN d’origine sont conservées.

Documentation vérifiée le 15 septembre 2026 :
- https://render.com/docs/redirects-rewrites
- https://console.groq.com/docs/models
- https://caddyserver.com/docs/automatic-https
