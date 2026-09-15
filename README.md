# MYF Candidature 2.2 — Frontend Render, backend et base Hetzner

Cette archive corrige la répartition des services : **l’interface reste sur Render**, tandis que **l’API, la clé Groq, les utilisateurs et leur base de données sont sur Hetzner**. Aucune base Neon n’est nécessaire.

## Architecture retenue

```text
Navigateur
    |
    v
Render — Static Site (interface HTML/CSS/JS et exports)
    |
    | /api/* : réécriture HTTPS, sans redirection du navigateur
    v
Hetzner — Caddy HTTPS → backend Node.js
                         |          |
                         v          v
                    SQLite       API Groq
                volume persistant
```

Le backend est le programme qui gère les comptes et appelle Groq. La base est le stockage des comptes et compteurs. Tous deux tournent sur Hetzner. SQLite suffit ici pour une instance ; elle n’est pas exposée sur Internet. Le navigateur ne contacte jamais directement une base de données.

Les appels restent sur l’adresse Render visible du navigateur, par exemple `https://mon-site.onrender.com/api/login`. Render les transmet à `https://api.mon-domaine.fr/api/login`. Les cookies de session restent liés au frontend, sans dépendre des cookies tiers. Les réponses API portent `Cache-Control: no-store`.

## Les deux adresses à renseigner

| Emplacement | Valeur à adapter |
| --- | --- |
| `render.yaml`, `routes.destination` | `https://api.VOTRE-DOMAINE/api/*`, le domaine HTTPS du backend Hetzner |
| `.env` sur Hetzner, `DOMAIN` | Le même domaine backend, sans `https://` ni chemin |
| `.env` sur Hetzner, `APP_ORIGIN` | L’origine exacte du frontend Render, avec `https://` et **sans slash final** |

Exemple : `DOMAIN=api.mon-domaine.fr` et `APP_ORIGIN=https://myf-candidature-frontend.onrender.com`. Remplacer cet exemple par l’URL réellement attribuée par Render. Si vous utilisez un domaine personnalisé sur Render, utilisez ce domaine dans `APP_ORIGIN` et ouvrez toujours le site à cette adresse. Cette version autorise une origine frontend précise.

Votre domaine Hetzner n’a pas été fourni : `api.votre-domaine.fr` dans l’archive est un emplacement à remplacer, pas un service déjà configuré.

## 1. Préparer le frontend Render

1. Décompresser l’archive. Mettre **le contenu du dossier du projet à la racine d’un dépôt GitHub**, y compris `render.yaml`, `package-lock.json`, `scripts`, `src` et `public`.
2. Dans `render.yaml`, remplacer `https://api.votre-domaine.fr/api/*` par l’adresse réelle du backend Hetzner. Conserver le suffixe `/api/*` et l’action **rewrite**. Une redirection ne convient pas.
3. Render → **New → Blueprint** → sélectionner le dépôt. Le fichier crée un **Static Site**, nommé `myf-candidature-frontend`, et non un serveur Node Render.
4. Noter l’adresse HTTPS fournie par Render et la renseigner dans `APP_ORIGIN` sur Hetzner.

Paramètres si vous créez le Static Site manuellement :

- Build : `npm ci --include=dev && npm run build`
- Publish Directory : `public`
- Node : `24.15.0`
- Redirects/Rewrites : source `/api/*`, destination `https://api.mon-domaine.fr/api/*`, action **Rewrite**.
- Headers : reprendre ceux de `render.yaml`, en particulier `Cache-Control: no-store` pour `/api/*`.

**Ne mettre aucun secret sur Render** : ni clé Groq, ni mot de passe administrateur, ni `APP_SECRET`, ni `DATABASE_URL`. Le build Render ne génère que les bibliothèques et fichiers publics. Seul le dossier `public` est publié.

Si le frontend apparaît avant que Hetzner soit prêt, la connexion ne fonctionnera pas encore : terminer l’étape suivante.

## 2. Installer le backend et la base sur Hetzner

Prévoir un serveur Linux avec Docker Engine et Docker Compose. Un petit serveur avec 2 Go de RAM ou plus laisse une marge au système. Le modèle Groq n’est pas exécuté localement.

1. Faire pointer le DNS du domaine backend, par exemple `api.mon-domaine.fr`, vers l’IP publique du serveur Hetzner.
2. Autoriser TCP 80 et 443 pour HTTPS et les certificats Caddy, ainsi que votre accès SSH. Ne pas exposer le port Node 3000 ni un port de base de données.
3. Copier le projet sur Hetzner. Dans son dossier, copier `.env.example` en `.env` et remplir :

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=un-mot-de-passe-long-unique
APP_SECRET=un-secret-aleatoire-de-64-caracteres
GROQ_API_KEY=votre-cle-groq
GROQ_MODEL=openai/gpt-oss-120b
DOMAIN=api.mon-domaine.fr
APP_ORIGIN=https://adresse-reelle-du-frontend.onrender.com
MAX_CONCURRENT_GENERATIONS=2
DAILY_GENERATION_LIMIT=20
```

Générer réellement `APP_SECRET`, par exemple avec `openssl rand -hex 32`. Le mot de passe administrateur doit contenir au moins 12 caractères. Ne pas utiliser les valeurs illustratives ci-dessus.

4. Démarrer :

```sh
chmod 600 .env
docker compose up -d --build
docker compose logs --tail=80 app
```

Le backend utilise `API_ONLY=true` et refuse de démarrer sans une `APP_ORIGIN` HTTPS valide. Caddy obtient le certificat si le DNS et les ports sont corrects. La base est créée automatiquement dans le volume `app-data` ; aucune `DATABASE_URL` n’est nécessaire.

5. Tester `https://api.mon-domaine.fr/api/health` : réponse attendue `{"ok":true}`. La racine `/` du backend renvoie volontairement 404 : l’interface est sur Render.
6. Tester `https://adresse-du-frontend.onrender.com/api/health` : même réponse. Cela confirme le passage Render → Hetzner.
7. Ouvrir **l’adresse du frontend Render**, se connecter avec `admin` et le mot de passe défini sur Hetzner, puis créer les utilisateurs.

Le Dockerfile du backend installe uniquement les dépendances de production. Il ne compile et ne sert pas le frontend. L’application est limitée à 384 Mo dans Compose et Caddy à 128 Mo ; le tas JavaScript est limité à 192 Mo. Ces limites n’incluent pas l’ensemble du système d’exploitation.

## 3. Vérifier avant de basculer les utilisateurs

- Se connecter depuis le frontend Render et consulter la liste des utilisateurs.
- Créer un compte test, se connecter avec ce compte et lancer une vraie génération Groq.
- Exporter un PDF et un DOCX.
- Redémarrer le backend : `docker compose restart app`. Vérifier que les comptes sont toujours présents.
- Suspendre le compte test et vérifier que ses sessions sont bloquées.

Si vous aviez déjà déployé l’ancienne version, **sauvegarder ses comptes avant toute bascule**. Le volume SQLite dépend du projet Compose et de son dossier/nom : réutiliser le volume existant ou restaurer une sauvegarde, ne pas supposer qu’un nouveau dossier récupérera automatiquement la base. Une éventuelle ancienne base Neon/PostgreSQL nécessite une migration spécifique vers SQLite ; cette archive ne la réalise pas et n’efface aucune base.

Une fois la nouvelle installation validée et les données sauvegardées, vous pourrez arrêter l’ancien Web Service Render pour éviter sa facturation. Le Static Site remplace son rôle d’interface ; modifier son fichier YAML ne déplace pas automatiquement les données ni ne résilie un ancien service.

## Sauvegarder la base sur Hetzner

Les CV ne sont pas stockés en base ; celle-ci contient les utilisateurs, mots de passe hachés, statuts et compteurs. Sauvegarder la base et `.env` dans un endroit privé, hors du serveur.

Copie cohérente avec une courte interruption :

```sh
mkdir -p backups
docker compose stop app
docker compose cp app:/app/data ./backups/data
# Redémarrer même si la copie échoue.
docker compose start app
```

Utiliser un dossier de sauvegarde daté pour les sauvegardes suivantes. Pour une restauration, arrêter l’application, conserver une copie de l’état actuel, remplacer les fichiers du volume par la sauvegarde et conserver les permissions de l’utilisateur `node`. Tester une restauration sur une copie d’abord. `docker compose down` conserve les volumes ; **`docker compose down -v` supprime la base**.

## Fonctionnalités conservées

- Création, suspension, expiration, réinitialisation du mot de passe et suppression des utilisateurs.
- Mots de passe hachés par scrypt ; sessions de huit heures dans des cookies HttpOnly, Secure et SameSite=Strict en production. Suspension et changement de mot de passe invalident les sessions. La déconnexion invalide toutes les sessions du compte.
- Changement du mot de passe administrateur : modifier `ADMIN_PASSWORD` sur Hetzner puis redémarrer. Garder le même `ADMIN_USERNAME` pour ne pas créer un second administrateur.
- Import PDF texte, DOCX, TXT dans le navigateur ; limite de 5 Mo, 15 pages PDF et 24 000 caractères de CV. Faire un OCR avant import pour les scans sans texte.
- Génération CV + lettre via Groq, bilan des mots-clés, relecture et édition.
- PDF avec vrai texte, DOCX natif et TXT, mise en page à une colonne. Pour le PDF, sélectionner « Enregistrer au format PDF » en A4 et désactiver les en-têtes/pieds de page du navigateur.
- Brouillon téléchargé localement en JSON, à réimporter pour reprendre une candidature. Pas de sauvegarde automatique des documents après fermeture de la page.

Les consignes demandent à l’IA de conserver les faits et d’ignorer les instructions contenues dans les CV/offres. Les citations des mots-clés sont vérifiées textuellement, sans garantir leur pertinence sémantique. Relire avant envoi : aucune garantie de réussite à tous les ATS ni de sélection par un employeur.

## Coûts et données

Render héberge uniquement les fichiers statiques, dans les limites de son offre applicable. Le serveur Hetzner reste payant, ainsi que le domaine si vous devez en acheter un. L’API Groq peut être facturée séparément.

Le texte des CV et des offres transite par Render, Hetzner puis Groq lors de la génération. L’application ne stocke pas ces documents en base et ne les écrit pas dans ses logs. Les politiques des fournisseurs restent applicables. Les fichiers brouillons locaux contiennent des données personnelles en clair.

Limites par défaut : deux générations simultanées, une par compte, vingt tentatives par compte et par jour UTC, délai maximal de 90 secondes. Les tentatives échouées/annulées après réservation comptent dans le quota. Il s’agit d’un garde-fou d’usage, pas d’un plafond de dépense global. Une réponse 429 demande d’attendre ou indique un quota atteint.

## Dépannage

- **502/504 depuis Render** : tester `/api/health` directement sur le backend, vérifier le DNS, le certificat, les ports et les logs Caddy/app. Vérifier la destination de la réécriture et son suffixe `/api/*`.
- **403 Origine non autorisée** : `APP_ORIGIN` ne correspond pas à l’adresse du frontend utilisée. Corriger puis exécuter `docker compose up -d` pour recréer le conteneur avec la nouvelle variable.
- **401 après connexion** : vérifier que la règle est une réécriture, pas une redirection, et que les appels restent sur l’URL HTTPS du frontend. Vérifier les cookies du navigateur.
- **Erreur Groq** : configurer `GROQ_API_KEY` sur Hetzner, contrôler le quota et l’accès au modèle. Ne jamais placer la clé dans le code frontend.
- **Comptes absents après redéploiement** : vérifier que le bon volume `app-data` est monté et qu’il n’a pas été supprimé.

## Tests et limites de validation

```sh
npm ci
npm run build
npm test
```

Les tests couvrent les comptes, quotas, persistance SQLite et contrôles d’accès. Des tests supplémentaires vérifient le backend sans frontend, le passage par un proxy séparé, les cookies, le refus d’une origine étrangère, la création d’utilisateur et la génération simulée.

L’architecture séparée est testée localement avec un proxy représentant la réécriture Render. Le vrai proxy Render et votre serveur Hetzner restent à vérifier après renseignement des domaines. Aucun compte d’hébergement n’a été modifié et aucune clé Groq réelle n’a été fournie. Les contrôles d’exports de la version précédente restent valables : les fonctions d’édition/export du frontend n’ont pas été modifiées pour cette séparation.

Documentation : [Static Sites Render](https://render.com/docs/static-sites), [réécritures vers une URL externe](https://render.com/docs/redirects-rewrites), [Blueprint Render](https://render.com/docs/blueprint-spec), [installation Docker](https://docs.docker.com/engine/install/ubuntu/). Vérification des instructions Render : 14 septembre 2026.


## Passage à Groq

Cette version utilise exclusivement `GROQ_API_KEY` et `GROQ_MODEL`. Sur Hetzner, remplacer les anciennes variables du fournisseur précédent par :

```dotenv
GROQ_API_KEY=votre-cle-groq
GROQ_MODEL=openai/gpt-oss-120b
```

Le modèle par défaut, `openai/gpt-oss-120b`, est hébergé par **Groq** : aucune clé OpenAI n’est nécessaire. `openai/gpt-oss-20b` est une autre option compatible avec le format JSON strict. Si vous choisissez un autre modèle dans `GROQ_MODEL`, vérifier sa compatibilité avec `json_schema` et `strict: true` avant utilisation. Les paramètres de raisonnement bas sont appliqués aux deux modèles GPT-OSS précités pour limiter les tokens de raisonnement.

Le backend appelle `https://api.groq.com/openai/v1/chat/completions` avec `max_completion_tokens` et valide les documents reçus. Les sorties tronquées restent refusées. La clé est uniquement envoyée à Groq depuis Hetzner ; elle n’est jamais placée dans les fichiers publics ou sur Render.

Pour mettre à jour une installation existante, sauvegarder le volume puis remplacer le code **dans le même projet Compose**, mettre à jour `.env` et exécuter `docker compose up -d --build`. Ne pas supprimer les volumes. Redéployer aussi le frontend Render pour actualiser les textes de consentement et les messages. Les comptes et leurs mots de passe restent dans la même base ; aucun changement de schéma n’est nécessaire.

Documentation officielle vérifiée : [sorties structurées Groq](https://console.groq.com/docs/structured-outputs), [référence API](https://console.groq.com/docs/api-reference). Le budget et les limites de votre compte Groq restent applicables. L’intégration est vérifiée avec des réponses simulées ; aucun appel réel n’a été effectué sans votre clé.
