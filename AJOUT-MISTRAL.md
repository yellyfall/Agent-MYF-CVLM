# Version 3.1.0 — Groq et Mistral

Le menu Modèle conserve les modèles Groq et ajoute un groupe Mistral dans les trois interfaces : candidature (lettre et CV), chat, recruteur. Choisir Mistral utilise uniquement la clé Mistral. Choisir Groq utilise uniquement la clé Groq. Une seule clé suffit si vous sélectionnez le fournisseur correspondant. Aucun basculement automatique entre fournisseurs, notamment en cas de quota.

Les connexions, comptes, thèmes, longueurs, tons et exports sont conservés. Les clés restent côté serveur. La gestion admin historique des clés Groq reste réservée à Groq ; ajouter Mistral dans le .env du serveur comme ci-dessous.

## 1. PowerShell sur votre PC

```powershell
scp -i "$env:USERPROFILE\.ssh\hetzner_cv_lm" "$env:USERPROFILE\Downloads\Codes HTML\VF\CV-LM-Groq-Et-Mistral.zip" root@46.224.141.132:/root/
ssh -i "$env:USERPROFILE\.ssh\hetzner_cv_lm" root@46.224.141.132
```

## 2. Sur Hetzner après connexion SSH

Sauvegarder avant de remplacer le code :

```bash
cd /opt/cv-lm/livraison-render-hetzner-groq
backup="/root/cv-lm-sauvegarde-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -a . "$backup/projet"
docker compose stop app
docker compose cp app:/app/data "$backup/data"
```

Si une sauvegarde échoue, ne pas poursuivre ; relancer docker compose start app et examiner l'erreur. Ne jamais supprimer les volumes avec down -v.

Après sauvegarde réussie :

```bash
unzip -o /root/CV-LM-Groq-Et-Mistral.zip -d /opt/cv-lm
cd /opt/cv-lm/livraison-render-hetzner-groq
nano .env
```

Conserver les variables déjà présentes, notamment GROQ_API_KEY, DOMAIN, APP_ORIGIN et ADMIN_PASSWORD. Ajouter ou modifier les lignes suivantes (une seule occurrence chacune), en remplaçant la valeur d'exemple par votre clé :

```dotenv
MISTRAL_API_KEY=VOTRE_CLE_MISTRAL
MISTRAL_MODEL=mistral-small-latest
```

Ne pas transmettre votre clé dans le chat, dans Git ou sur le frontend Render. Enregistrer dans nano : Ctrl+O, Entrée, Ctrl+X. Si vous souhaitez utiliser uniquement Mistral, vous pouvez laisser GROQ_API_KEY vide et sélectionner Mistral dans l'application.

```bash
docker compose up -d --build
docker compose ps
curl -f https://46-224-141-132.sslip.io/api/health
```

La version attendue est 3.1.0-groq-mistral. mistral_keys_available doit être supérieur à zéro ; cela confirme la présence de la clé, pas sa validité auprès de Mistral. Si nécessaire : docker compose logs --tail=80 app caddy.

Le nom du dossier et les volumes Docker ne changent pas. L'archive ne contient ni .env réel ni base utilisateurs.

## 3. Sur Render

Remplacer tout le dossier public dans votre dépôt connecté à Render par celui de l'archive, enregistrer et envoyer au dépôt distant. Lancer Manual Deploy > Deploy latest commit. Le dossier publié reste public, et la réécriture /api/* vers https://46-224-141-132.sslip.io/api/* reste inchangée.

Recharger le site avec Ctrl+F5. Dans Modèle IA, sélectionner Mistral Small, Mistral Large ou Mistral (défaut serveur). Cette dernière option utilise MISTRAL_MODEL. Pour Groq, sélectionner un modèle du groupe Groq. Mettre à jour le backend avant le frontend pour que les nouvelles options soient reconnues.

## Vérifications et limites

14 tests automatisés réussis : authentification, fournisseurs séparés, paramètres max_tokens pour Mistral / max_completion_tokens pour Groq, configuration Mistral seule, clés absentes, quota 429 et Retry-After sans fuite d'informations ni changement de fournisseur.
17 scénarios navigateur avec Groq simulé et les mêmes 17 avec Mistral simulé, incluant les trois interfaces et les exports. 8 scénarios de quota existants réussis. Aucun appel à une clé réelle n'a été effectué ; tester une génération après déploiement pour valider les droits et le quota de votre compte.

Référence officielle utilisée : https://docs.mistral.ai/api/endpoint/chat
