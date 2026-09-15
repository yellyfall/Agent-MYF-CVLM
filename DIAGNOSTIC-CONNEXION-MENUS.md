# Correctif connexion, thèmes et menus — 15 septembre 2026

Le site publié renvoyait une politique Content-Security-Policy avec script-src 'self'. L'ancien HTML contenait les fonctions JavaScript directement dans la page et les clics dans des attributs onclick. Le navigateur les bloquait : setTheme et loginAdmin étaient absentes. Les bibliothèques PDF/Word/Excel/PowerPoint et Google Fonts externes étaient bloquées également.

Le contrôle /api/health a répondu HTTP 200 sur Render et directement sur Hetzner, avec configured:true et une clé Groq configurée. Cela confirme la liaison et la configuration, sans valider la clé auprès de Groq.

La lecture des liens avait également une erreur backend : htmlDecode était absente. Elle est rétablie. La météo passe maintenant par la route authentifiée /api/read-url, au lieu de connexions directes du navigateur.

## Correction livrée

- Fonctions d'origine déplacées vers public/interface-1.js et public/interface-2.js.
- Clics et changements reliés par public/interface-events.js, sans eval ni autorisation unsafe-inline pour JavaScript.
- Bibliothèques versionnées et polices copiées dans public/vendor, avec les URLs d'origine dans VENDOR-SOURCES.txt.
- Politique de sécurité stricte conservée dans render.yaml. Aucun assouplissement nécessaire dans Render.
- CSS, menus, couleurs, dispositions et exports d'origine conservés. Bouton de génération d'image toujours retiré.

## Déployer le correctif sur votre installation actuelle

1. Extraire CV-LM-Correctif-Connexion-Themes-Menus.zip sur votre PC.
2. Dans le dépôt GitHub connecté à myf-candidature-frontend, remplacer TOUT le dossier public par celui de l'archive. Inclure impérativement les trois fichiers interface-*.js et le dossier vendor. Remplacer index.html seul casserait le chargement.
3. Remplacer aussi render.yaml et enregistrer le commit. Garder votre Root Directory actuel, le Publish Directory public et la règle Rewrite /api/* vers https://46-224-141-132.sslip.io/api/*.
4. Dans Render : Manual Deploy, puis Deploy latest commit (ou vider le cache de compilation et déployer si l'ancien contenu persiste).
5. Actualiser le site avec Ctrl+F5. Cliquer Administrateur puis saisir ADMIN_PASSWORD dans le champ prévu. Les utilisateurs créés passent par l'onglet Utilisateur.

## Mettre à jour Hetzner pour réparer la lecture Web

La correction des clics se trouve dans le frontend. Pour corriger également la lecture Web et le contexte météo, mettre à jour le backend avec cette même archive.

Dans PowerShell sur votre PC :

```powershell
scp -i "$env:USERPROFILE\.ssh\hetzner_cv_lm" "$env:USERPROFILE\Downloads\Codes HTML\VF\CV-LM-Correctif-Connexion-Themes-Menus.zip" root@46.224.141.132:/root/
ssh -i "$env:USERPROFILE\.ssh\hetzner_cv_lm" root@46.224.141.132
```

Puis dans le terminal root@cv-lm-backend :

```bash
cd /opt/cv-lm/livraison-render-hetzner-groq
cp -a server.js "server.js.avant-correctif-$(date +%Y%m%d-%H%M%S)"
unzip -o /root/CV-LM-Correctif-Connexion-Themes-Menus.zip -d /opt/cv-lm
docker compose up -d --build
curl -f https://46-224-141-132.sslip.io/api/health
```

Le ZIP ne remplace pas .env et ne contient aucune base utilisateur. Les volumes existants sont conservés. Aucun déploiement distant n'a été effectué automatiquement.

## Diagnostic des parcours

Tests dans Chrome avec l'en-tête de sécurité exact du site publié. Vrais clics sur les boutons, backend local réel et SQLite temporaire. Seules les réponses du fournisseur Groq sont simulées ; aucun compte réel modifié et aucun quota Groq consommé.

| Parcours | Résultat |
| --- | --- |
| Chargement PDF, Word, Excel et autres bibliothèques sous CSP stricte | OK |
| Cinq thèmes par clic | OK |
| Onglet Administrateur et afficher/masquer le mot de passe | OK |
| Connexion administrateur via API | OK |
| Menu candidat, onglets Texte/URL/Fichier, modèle et ton | OK |
| Fenêtre admin et création de compte | OK |
| Suspension et réactivation depuis les boutons dynamiques | OK |
| Expiration, réinitialisation du mot de passe et suppression de compte | OK |
| Génération CV et lettre via backend, réponses IA simulées | OK |
| Lettre : aperçu, texte brut, TXT, DOC et PDF téléchargés | OK |
| CV : aperçu, texte brut, TXT, DOC et PDF téléchargés | OK |
| Import du PDF généré et suppression du fichier joint | OK |
| Menu recruteur, onglets, seuil et analyse simulée | OK |
| Menu chat, interrupteur Web, pièce jointe et retrait | OK |
| Contexte météo via backend authentifié sous CSP stricte, données simulées | OK |
| Envoi d'un message au chat et effacement | OK |
| Connexion utilisateur, accès aux trois interfaces, admin masqué et déconnexion | OK |

Aucune erreur JavaScript ni violation CSP pendant ces dix-sept vérifications. Les six tests automatisés d'API, migration et flux IA passent aussi.

Limites : les appels Groq réels, la pertinence des contenus générés, les recherches Web externes et la météo n'ont pas été validés en production. L'interrupteur Web et le raccordement existant aux routes /api sont conservés. La lecture Web et le routage météo ont été vérifiés avec des données simulées ; la disponibilité des services externes reste à vérifier après déploiement. La génération d'images reste indisponible.

Sources : https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src
