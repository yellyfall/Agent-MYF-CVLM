# Installer cette version en conservant l’interface et les comptes

L’archive ZIP contient un dossier livraison-render-hetzner-groq. Garder ce nom et votre emplacement actuel sur Hetzner : /opt/cv-lm/livraison-render-hetzner-groq. Cela conserve le nom du projet Docker et ses volumes.

## 1. Envoyer l’archive depuis PowerShell sur votre PC

```powershell
scp -i "$env:USERPROFILE\.ssh\hetzner_cv_lm" "$env:USERPROFILE\Downloads\Codes HTML\VF\CV-LM-Interface-Originale-Groq-Hetzner.zip" root@46.224.141.132:/root/
ssh -i "$env:USERPROFILE\.ssh\hetzner_cv_lm" root@46.224.141.132
```

Utiliser la même clé SSH que lors de votre connexion précédente si son nom diffère. Une fois le terminal root@cv-lm-backend affiché, les commandes suivantes sont des commandes Linux, pas PowerShell.

## 2. Sauvegarder l’installation actuelle sur Hetzner

```bash
cd /opt/cv-lm/livraison-render-hetzner-groq
backup="/root/cv-lm-sauvegarde-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -a . "$backup/projet"
```

Si l’application a déjà été lancée avec Docker, sauvegarder également sa base avant remplacement :

```bash
docker compose stop app
docker compose cp app:/app/data "$backup/data"
```

Vérifier que la copie a réussi avant de continuer. Si seul hello-world a été lancé et que l’application n’a jamais démarré, ces deux commandes ne sont pas nécessaires. Ne pas supprimer les volumes Docker.

## 3. Extraire les fichiers mis à jour

```bash
apt-get update
apt-get install -y unzip
unzip -o /root/CV-LM-Interface-Originale-Groq-Hetzner.zip -d /opt/cv-lm
cd /opt/cv-lm/livraison-render-hetzner-groq
```

L’archive ne contient ni .env ni base de comptes : votre fichier .env et les volumes existants sont conservés.

Si aucun .env n’existe encore :

```bash
cp -n .env.example .env
```

Puis :

```bash
nano .env
```

Vérifier ou compléter ces valeurs, sans doublons :

```dotenv
DOMAIN=46-224-141-132.sslip.io
APP_ORIGIN=https://myf-candidature-frontend.onrender.com
GROQ_API_KEY=VOTRE_CLE_GROQ
GROQ_MODEL=openai/gpt-oss-120b
ADMIN_PASSWORD=VOTRE_MOT_DE_PASSE_ADMINISTRATEUR
MAX_CONCURRENT_GENERATIONS=2
DAILY_GENERATION_LIMIT=20
```

La clé Groq et le mot de passe sont à saisir uniquement dans ce fichier sur Hetzner. Dans nano : Ctrl+O, Entrée, Ctrl+X. Conserver les éventuelles autres variables de votre .env ; APP_SECRET et ADMIN_USERNAME de la précédente version ne sont plus nécessaires pour cette interface.

## 4. Démarrer le backend HTTPS

Le nom gratuit 46-224-141-132.sslip.io correspond à l’IP de votre serveur. Il dépend du service DNS tiers sslip.io ; aucun achat de domaine n’est nécessaire pour cette configuration. Si votre IP change, adapter DOMAIN et la destination du proxy Render.

Dans le pare-feu Hetzner, autoriser TCP 80 et 443 en entrée, en conservant votre accès SSH TCP 22. Appliquer aussi ces ouvertures si vous avez activé un pare-feu local Ubuntu. Ne pas exposer directement le port 3000.

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=60 app caddy
curl -f https://46-224-141-132.sslip.io/api/health
```

Caddy demande automatiquement un certificat HTTPS. La réponse health doit contenir success:true, configured:true et groq_keys_available supérieur à zéro. Ce dernier nombre indique une clé configurée, pas sa validité auprès de Groq. Si HTTPS échoue, contrôler le DNS, les ports 80/443 et les journaux Caddy avant de configurer Render.

## 5. Remettre le frontend original sur Render

Mettre à jour le dépôt connecté à Render avec le contenu du dossier livraison-render-hetzner-groq de cette archive, notamment public/index.html, public/app_v18.js et render.yaml. Ne pas envoyer .env.

Dans votre service myf-candidature-frontend, garder le type Static Site. Les chemins ci-dessous supposent que package.json et public sont à la racine du dépôt ; sinon renseigner Root Directory avec le dossier qui les contient.

- Build Command : `node -e "console.log('Frontend original prêt')"`
- Publish Directory : `public`
- Aucune clé API ni commande de démarrage Node pour le frontend.

Dans Redirects/Rewrites, ajouter ou mettre à jour la règle suivante, avant une éventuelle règle générale :

| Source | Destination | Action |
| --- | --- | --- |
| /api/* | https://46-224-141-132.sslip.io/api/* | Rewrite |

Il faut Rewrite, afin de conserver les appels du navigateur sur l’origine Render. render.yaml contient aussi cette règle ; pour un service déjà configuré manuellement, vérifier le tableau de bord car le fichier seul ne modifie pas nécessairement ses paramètres.

Lancer Manual Deploy → Deploy latest commit. Actualiser ensuite votre site avec Ctrl+F5. Les menus et écrans d’origine doivent réapparaître.

## 6. Vérifier la liaison complète

Ouvrir https://myf-candidature-frontend.onrender.com/api/health : la même réponse JSON que sur Hetzner doit apparaître.

Ouvrir le site, choisir l’onglet Administrateur et saisir ADMIN_PASSWORD dans le champ de connexion d’origine. Créer un utilisateur de test depuis la gestion habituelle, se déconnecter, puis essayer son compte. Lancer enfin une génération avec des données de test pour vérifier la clé et le quota Groq. Cette dernière étape utilise votre compte Groq.

## Retour à la version précédente

Conserver la sauvegarde annoncée à l’étape 2 et l’ancien dépôt/frontend jusqu’à validation. En cas d’échec, restaurer le code du dossier sauvegardé, puis relancer docker compose up -d --build dans le même dossier de déploiement. La migration ne modifie pas candidature.db ; les comptes créés ensuite dans myf.db ne seront cependant pas visibles dans l’ancienne version. Restaurer aussi l’ancien frontend Render si vous revenez à l’ancien backend.
