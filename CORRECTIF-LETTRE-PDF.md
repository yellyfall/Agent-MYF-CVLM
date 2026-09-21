# Correctif 3.0.3 — Lettre PDF justifiée

## Diagnostic du 21 septembre 2026
Le fichier letter-pdf.js récupéré sur le site Render utilisait Inter et des blocs alignés à gauche, alors que l'aperçu utilisait Georgia, des paragraphes justifiés et des blocs destinataire/signature à droite. Le PDF fourni contient bien InterLetter : il ne s'agit donc pas simplement d'un cache navigateur. Le correctif précédent ne respectait pas la présentation demandée.

## Correction
- Même police serif embarquée pour la lettre à l'écran et le PDF : Gelasio, proche de Georgia. Les polices de l'interface et les menus restent inchangés.
- Corps justifié ; dernière ligne de chaque paragraphe à gauche.
- Paragraphes séparés par des lignes vides, retours explicites conservés.
- Destinataire, date et signature à droite ; expéditeur à gauche.
- Objet en italique, libellé en gras, trait séparateur.
- Taille de corps 11 points ; interligne 6 mm ; espacement entre paragraphes 7 mm ; marges latérales 20 mm.
- Pagination A4 sans réduction automatique de police. Les paragraphes ordinaires restent groupés ; les paragraphes plus hauts qu'une page peuvent se poursuivre sur la suivante.
- Texte sélectionnable et accents conservés ; aucune capture d'écran dans le PDF, aucun appel Groq pendant le téléchargement.

La lettre de Massy est longue : elle occupe deux pages. Les retours de ligne exacts peuvent différer d'un aperçu continu à l'écran, notamment à cause du format A4 et de la césure automatique du navigateur.

## Installation sur Render seulement
1. Extraire l'archive et ouvrir livraison-render-hetzner-groq.
2. Remplacer le dossier public dans le dépôt connecté à votre site Render par le dossier public fourni, puis enregistrer les changements dans Git et les envoyer au dépôt distant.
3. Dans Render, ouvrir myf-candidature-frontend puis lancer Manual Deploy > Deploy latest commit (ou laisser le déploiement automatique se terminer).
4. Recharger le site avec Ctrl+F5. Générer une lettre et télécharger à nouveau son PDF. Un ancien PDF téléchargé ne sera pas modifié automatiquement.

Le dossier public doit être complet : index.html, letter-pdf.js, nouveau letter-layout.css et les trois fichiers vendor/letter-*.ttf, avec leur licence. Le dossier à publier reste public. Conserver la configuration CSP et la réécriture /api/* existantes.

Sur Hetzner : aucune commande ni reconstruction Docker n'est nécessaire pour ce correctif d'export. Ne pas modifier .env, la clé Groq ou la base des utilisateurs.

## Validation locale
- Lettre réelle de Massy : cinq paragraphes inchangés, texte intégral, deux pages A4 ; inspection visuelle des deux pages.
- 36 lignes contrôlées avec les deux bords alignés ; accents et limites de page vérifiés.
- Cas long de cinq pages, cas Unicode, police commune de l'aperçu et export par la fonction de téléchargement réelle.
- 9 tests serveur, 17 scénarios d'interface et 8 scénarios de quota réussis.
- Aucun déploiement sur les comptes Render/Hetzner n'a été effectué depuis cette session.

Police : https://github.com/google/fonts/tree/main/ofl/gelasio — SIL Open Font License, copie incluse dans public/vendor/letter-font-OFL.txt. Instances statiques 400, 700 et italique 400 issues des polices variables officielles.
