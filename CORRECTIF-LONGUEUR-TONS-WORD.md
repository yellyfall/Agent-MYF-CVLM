# Version 3.0.4 — Longueur, tons et police Word

## Changements
La longueur n'était définie que par un nombre de paragraphes. Les objectifs sont désormais mesurables, pour le corps de la lettre uniquement :
- Concise : 150–220 mots, 3 paragraphes centrés sur l'essentiel.
- Standard : 300–400 mots, 4–5 paragraphes développés.
- Détaillée : 550–700 mots, 6–7 paragraphes, avec contexte, actions/méthodes, résultat ou apprentissage attesté, et lien avec les missions du poste.

Chaque ton possède une consigne spécifique. Plusieurs tons sont combinés ; le ton professionnel ne masque plus les autres. La longueur ne doit pas être réduite par le ton sobre. Les consignes interdisent d'inventer des chiffres ou des expériences pour allonger le texte.

Un contrôle compte les mots et les paragraphes. Si nécessaire, une seule révision est demandée à Groq. Cela peut consommer un appel supplémentaire ; aucune boucle illimitée. Si la révision échoue (quota compris) ou reste hors objectif, le premier résultat est conservé avec un message explicite. Seul le corps est remplacé lors d'une révision réussie, les coordonnées et autres champs étant préservés. La qualité du style reste dépendante du modèle et des informations fournies.

L'export Word est désormais un véritable fichier .docx, et non du HTML renommé .doc. Les trois polices Gelasio (normal, gras, italique), identiques aux fichiers utilisés dans l'aperçu et le PDF, sont intégrées au document. Le corps est justifié, les paragraphes distincts, et le destinataire/signature alignés à droite. Les lecteurs qui ignorent les polices intégrées peuvent toujours substituer une police ; la vérification a été faite dans Microsoft Word pour Windows. Les menus, thèmes et interfaces restent inchangés.

## Déploiement : Render uniquement
1. Extraire CV-LM-Correctif-Longueur-Tons-Word.zip.
2. Dans le dépôt connecté à Render, remplacer tout le dossier public par celui de livraison-render-hetzner-groq/public fourni.
3. Enregistrer et envoyer les modifications au dépôt distant.
4. Dans Render : Manual Deploy > Deploy latest commit, puis attendre la réussite.
5. Recharger avec Ctrl+F5 et générer une nouvelle lettre. Tester les trois longueurs et télécharger PDF et Word.

Conserver les fichiers vendor, letter-layout.css, letter-pdf.js et les nouveaux letter-generation.js et letter-word.js. Ne pas remplacer uniquement index.html. Ne pas envoyer de .env ou de clé Groq sur Render.

Aucune commande Hetzner ni modification de la base des comptes n'est nécessaire. Le correctif n'est pas déployé automatiquement sur votre compte Render.

## Vérifications
- 13 tests automatisés du serveur et des règles de génération, dont toutes les options de ton.
- 17 scénarios d'interface, 8 scénarios de quota, 6 contrôles navigateur dédiés aux longueurs/révisions.
- Téléchargement Word via la fonction réelle dans le navigateur avec la CSP stricte.
- DOCX ouvert par Microsoft Word, converti en PDF et deux pages inspectées visuellement ; les polices embarquées sont utilisées. Le moteur LibreOffice du script render_docx.py est absent sur ce poste : validation visuelle effectuée avec Word installé.
- Comparaison des fichiers de police intégrés avec les fichiers utilisés par l'aperçu/PDF.
- Les réponses Groq des tests sont simulées : aucun appel payant de validation ni comparaison éditoriale réelle entre modèles n'a été effectué.

Référence technique des polices intégrées : https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/ea097c57-5794-4624-b08e-017b47051b1d
Licence de la police incluse dans public/vendor/letter-font-OFL.txt.
