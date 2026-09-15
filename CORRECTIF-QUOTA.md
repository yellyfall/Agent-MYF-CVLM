# Correctif quota Groq et conservation de la lettre — version 3.0.1-quota

## Cause

La lettre et le CV utilisent deux appels Groq successifs. Le code précédent masquait toute la zone de résultats en cas d'échec, y compris la lettre pourtant terminée. Le serveur imposait aussi un maximum de sortie d'au moins 6 500 tokens, même lorsque l'interface demandait 3 000 tokens.

Une erreur Groq 429 correspond à une limite atteinte ; elle n'indique pas nécessairement un crédit épuisé. Les limites peuvent porter sur le nombre de requêtes ou de tokens par minute ou par jour. Les limites exactes dépendent de votre organisation Groq. Changer de clé au sein de la même organisation ne les réinitialise pas.

## Changements

- Lettre terminée conservée à l'écran et téléchargeable si l'optimisation du CV échoue.
- Même bouton, avec le libellé temporaire « Réessayer l’optimisation du CV ».
- Une nouvelle tentative ne régénère pas la lettre si le CV source, l'offre et les paramètres de rédaction sont inchangés. Le modèle du CV peut être changé.
- Toute modification des données ou des consignes invalide la reprise pour éviter de réutiliser une lettre qui ne correspond plus à la demande.
- Délai Retry-After fourni par Groq transmis à l'interface. Un clic trop tôt ne renvoie pas de demande au même modèle. Pas de boucle de tentatives automatiques ni de rotation des clés sur une erreur 429.
- Le backend respecte le plafond demandé (actuellement 3 000 tokens pour chaque document), au lieu de le relever systématiquement à 6 500. Le modèle GPT-OSS reste en raisonnement faible. Cela ne garantit pas qu'une demande volumineuse ou un quota déjà consommé soit accepté.
- Une réponse tronquée n'est pas présentée comme un CV terminé. La lettre reste conservée et la reprise du CV demeure possible.
- Messages distincts pour les demandes trop volumineuses, limites quotidiennes et limites de débit lorsque Groq fournit les informations correspondantes.

La conservation se fait uniquement dans la page ouverte, sans stockage permanent de vos documents. Téléchargez la lettre avant de fermer ou actualiser la page. Aucun rendu graphique ni menu remanié.

## Installer sur Hetzner

Dans PowerShell sur votre PC :

```powershell
scp -i "$env:USERPROFILE\.ssh\hetzner_cv_lm" "$env:USERPROFILE\Downloads\Codes HTML\VF\CV-LM-Correctif-Quota-Lettre-Conservee.zip" root@46.224.141.132:/root/
ssh -i "$env:USERPROFILE\.ssh\hetzner_cv_lm" root@46.224.141.132
```

Dans le terminal du serveur :

```bash
cd /opt/cv-lm/livraison-render-hetzner-groq
cp -a server.js "server.js.avant-quota-$(date +%Y%m%d-%H%M%S)"
unzip -o /root/CV-LM-Correctif-Quota-Lettre-Conservee.zip -d /opt/cv-lm
docker compose up -d --build
curl -f https://46-224-141-132.sslip.io/api/health
```

La version renvoyée doit être `3.0.1-quota`. Le ZIP ne remplace ni .env ni les bases. Conserver les volumes existants.

## Installer sur Render

Mettre à jour le dépôt connecté à Render avec le contenu de l'archive : conserver tout public, y compris interface-1.js, interface-2.js, interface-events.js et vendor. Mettre à jour aussi render.yaml. Ne pas envoyer .env.

Dans Render : Manual Deploy → Deploy latest commit. Après téléchargement de vos éventuels résultats déjà présents, actualiser le site avec Ctrl+F5. Aucune nouvelle variable ni modification de la clé Groq nécessaire pour installer le correctif.

## Vérifications

- 9 tests automatisés : API, migration, lecture Web, plafond de sortie, métadonnées 429, absence de rotation des clés lors d'un refus Groq.
- 17 contrôles des parcours d'interface précédents sous CSP stricte.
- 8 contrôles de régression spécifiques : CV refusé après lettre réussie, téléchargement de la lettre conservée, clic avant Retry-After sans requête supplémentaire, reprise du CV seul, données modifiées, changement de modèle, CV tronqué puis repris, erreur avant achèvement de la lettre.

Tests exécutés avec une base locale temporaire et des réponses Groq simulées. Aucun quota réel consommé et aucun déploiement distant effectué. Le correctif ne peut pas augmenter les limites de votre compte Groq.

Documentation : https://console.groq.com/docs/rate-limits
