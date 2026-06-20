# Agent IA de MYF

Générateur de lettres de motivation et CV optimisés par IA (Mistral).

## Structure des fichiers

```
myf-agent/
├── server.js          ← Backend Node.js (API + BDD SQLite)
├── package.json       ← Dépendances Node
├── render.yaml        ← Config Render (déploiement automatique)
├── .gitignore
├── README.md
└── public/
    └── index.html     ← Frontend (interface utilisateur)
```

## Déploiement sur Render (étapes exactes)

### 1. Pousser sur GitHub
```bash
git add .
git commit -m "Agent IA de MYF v2 - auth serveur SQLite"
git push
```

### 2. Créer le service sur Render
1. Aller sur https://render.com → **New** → **Web Service**
2. Connecter votre dépôt GitHub
3. Remplir les champs :
   - **Name** : `agent-ia-myf`
   - **Environment** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `node server.js`
   - **Plan** : Free (ou Starter pour plus de stabilité)

### 3. ⚠️ IMPORTANT — Ajouter le disque persistant
Sans disque persistant, la base SQLite est effacée à chaque redéploiement !

1. Dans votre service Render → onglet **Disks**
2. Cliquer **Add Disk**
3. Remplir :
   - **Name** : `myf-database`
   - **Mount Path** : `/data`
   - **Size** : 1 GB
4. Sauvegarder

### 4. Variable d'environnement (optionnel, déjà dans render.yaml)
- `DATA_DIR` = `/data`
- `NODE_ENV` = `production`

### 5. Déployer
Cliquer **Deploy** → attendre 2-3 minutes.

---

## Utilisation

### Première connexion Admin
1. Aller sur votre URL Render
2. Onglet **Administrateur**
3. Saisir votre clé API Mistral → **Connexion Administrateur**
4. La clé est vérifiée auprès de Mistral et stockée dans la BDD

### Créer des utilisateurs
1. Bouton **⚙ Admin** (header)
2. Remplir : nom d'utilisateur, mot de passe (ou générer), date d'expiration optionnelle
3. Cliquer **Créer l'accès**
4. Partager les identifiants avec vos utilisateurs

### Gestion des utilisateurs (actions disponibles)
- **Suspendre** : bloque temporairement l'accès
- **Réactiver** : restore l'accès
- **Réinit. mdp** : change le mot de passe
- **Expiration** : définir/modifier la date d'expiration
- **Supprimer** : suppression définitive

### Connexion utilisateur
1. Onglet **Utilisateur**
2. Identifiant + mot de passe fournis par l'admin
3. Accès immédiat à l'agent IA (utilise la clé API de l'admin en arrière-plan)

---

## Architecture technique

```
Render (cloud)
├── Node.js (Express) — server.js
│   ├── GET  /api/health              → statut serveur
│   ├── POST /api/admin/login         → connexion admin
│   ├── GET  /api/admin/users         → liste utilisateurs
│   ├── POST /api/admin/users         → créer utilisateur
│   ├── PATCH /api/admin/users/:id    → modifier (pause/resume/expiry/mdp)
│   ├── DELETE /api/admin/users/:id   → supprimer
│   └── POST /api/login               → connexion utilisateur
├── SQLite (better-sqlite3)
│   ├── Table config  → clé API admin
│   └── Table users   → utilisateurs + hash bcrypt
└── /data/myf.db      → disque persistant Render
```

## Sécurité
- Mots de passe hachés avec **bcrypt** (salt rounds = 10)
- Clé API jamais exposée côté client (envoyée uniquement à la connexion réussie pour les appels Mistral directs)
- Header `x-admin-key` vérifié sur chaque route admin
