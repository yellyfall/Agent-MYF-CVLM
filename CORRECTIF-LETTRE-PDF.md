# Correction de la lettre PDF

Le PDF fourni présentait des mots étirés ou superposés, des caractères mal encodés et une deuxième page contenant seulement la formule de politesse et la signature.

Le nouvel export utilise Inter intégrée au PDF : corps 11 points, expéditeur 12 points, coordonnées 9,5 à 10 points, objet et signature en gras. Marges A4 de 20 mm, alignement à gauche, interlignage régulier, suppression de la justification manuelle mot par mot. Les espaces insécables et tirets Unicode sont normalisés. La formule de politesse est regroupée avec la signature et, lors d'une pagination, avec la fin du dernier paragraphe.

La lettre fournie a été corrigée sans réécriture de son contenu ; les espaces abîmés par l'ancien export ont été rétablis et la date du document a été conservée. Elle tient sur une page. Les longs courriers peuvent toujours occuper plusieurs pages, avec un corps de 11 points plutôt qu'une réduction illisible de la police.

## Render : installation de la correction PDF

1. Extraire CV-LM-Correctif-Lettre-PDF.zip.
2. Dans le dépôt connecté à Render, remplacer TOUT le dossier public de l'application par celui de l'archive. Inclure notamment le nouveau fichier letter-pdf.js, index.html et vendor/. L'export précédent dans interface-2.js est remplacé à l'exécution par le nouveau module externe.
3. Enregistrer le commit puis lancer Manual Deploy → Deploy latest commit dans Render.
4. Actualiser le site avec Ctrl+F5, générer une lettre et télécharger le PDF.

Aucun changement CSS des menus ou des écrans de connexion. Aucune modification de la clé Groq nécessaire.

## Hetzner : seulement si le correctif quota précédent n'est pas encore installé

La correction PDF seule ne nécessite pas de mise à jour Hetzner. Cette archive inclut néanmoins le correctif quota précédent (backend 3.0.1-quota). Pour le mettre à jour si ce n'est pas déjà fait :

Dans PowerShell sur le PC :

```powershell
scp -i "$env:USERPROFILE\.ssh\hetzner_cv_lm" "$env:USERPROFILE\Downloads\Codes HTML\VF\CV-LM-Correctif-Lettre-PDF.zip" root@46.224.141.132:/root/
ssh -i "$env:USERPROFILE\.ssh\hetzner_cv_lm" root@46.224.141.132
```

Puis sur Hetzner :

```bash
cd /opt/cv-lm/livraison-render-hetzner-groq
cp -a server.js "server.js.avant-pdf-$(date +%Y%m%d-%H%M%S)"
unzip -o /root/CV-LM-Correctif-Lettre-PDF.zip -d /opt/cv-lm
docker compose up -d --build
curl -f https://46-224-141-132.sslip.io/api/health
```

Le contrôle doit annoncer 3.0.1-quota. Aucun .env ni fichier de base de données n'est inclus dans l'archive. Les volumes restent conservés.

## Vérifications

PDF corrigé rendu en image et inspecté : une page, aucun débordement, aucun caractère CID indéchiffrable, texte sélectionnable. Scénarios supplémentaires : texte long sur trois pages et texte avec accents, ligatures, espaces insécables et tirets non sécables. Export du site testé sous la CSP stricte de Render. Les tests API et les parcours connexion, thèmes, candidat, recruteur, chat et téléchargements passent également.

Le module est prévu pour les caractères latins, français notamment, couverts par Inter. Il ne garantit pas la prise en charge des écritures arabe ou CJK. Aucun déploiement distant effectué automatiquement.
