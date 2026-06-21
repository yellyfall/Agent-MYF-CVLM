const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ── BASE DE DONNÉES SQLite ──────────────────────────────────────────────────
// Sur Render : monter un disque persistant sur /data
// En local   : utilise ./data/myf.db
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "myf.db");
const db = new Database(DB_PATH);

// Activation WAL pour meilleures performances
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── SCHÉMA ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    fullname   TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'active',
    expires_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    last_login TEXT DEFAULT NULL
  );
`);

// ── MIDDLEWARES ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// CORS (autorise toutes origines en prod Render)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── HELPERS ─────────────────────────────────────────────────────────────────
function ok(res, data = {}, message = "") {
  return res.json({ success: true, message, data });
}
function fail(res, message, status = 400) {
  return res.status(status).json({ success: false, message, data: {} });
}

function getConfig(key) {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key);
  return row ? row.value : null;
}
function setConfig(key, value) {
  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(key, value);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function checkAdminKey(req, res) {
  const key = req.headers["x-admin-key"] || req.body?.admin_key;
  const stored = getConfig("admin_key");

  if (!stored) {
    res.status(401).json({ success: false, message: "Aucune clé admin configurée." });
    return false;
  }

  if (key !== stored) {
    res.status(401).json({ success: false, message: "Non autorisé." });
    return false;
  }

  return true;
}

// ── ROUTES ───────────────────────────────────────────────────────────────────

// ── Santé
app.get("/api/health", (req, res) => {
  const configured = !!getConfig("admin_key");
  return ok(res, { configured, version: "1.0.0" });
});

// ── Admin : configurer / vérifier la clé API Mistral
app.post("/api/admin/setup", async (req, res) => {
  const { key } = req.body;
  if (!key) return fail(res, "Clé API manquante.");

  // Vérifier la clé auprès de Mistral
  try {
    const response = await fetch("https://api.mistral.ai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg = errData.message || errData.detail || `Clé invalide (HTTP ${response.status})`;
      return fail(res, typeof msg === "string" ? msg : JSON.stringify(msg));
    }
  } catch (e) {
    return fail(res, "Impossible de joindre api.mistral.ai : " + e.message);
  }

  setConfig("admin_key", key);
  return ok(res, {}, "Clé API vérifiée et sauvegardée.");
});

// ── Admin : connexion (vérifie que la clé correspond à celle stockée)
app.post("/api/admin/login", async (req, res) => {
  const { key } = req.body;
  if (!key) return fail(res, "Clé API manquante.");

  const stored = getConfig("admin_key");

  // Première connexion : stocker la clé après vérification Mistral
  if (!stored) {
    try {
      const response = await fetch("https://api.mistral.ai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg = errData.message || errData.detail || `Clé invalide (HTTP ${response.status})`;
        return fail(res, typeof msg === "string" ? msg : JSON.stringify(msg));
      }
    } catch (e) {
      return fail(res, "Impossible de joindre api.mistral.ai : " + e.message);
    }
    setConfig("admin_key", key);
    return ok(res, { role: "admin" }, "Première connexion : clé enregistrée.");
  }

  if (key !== stored) {
    return fail(res, "Clé API incorrecte.", 401);
  }
  return ok(res, { role: "admin" });
});

// ── Admin : liste des utilisateurs
app.get("/api/admin/users", (req, res) => {
  if (!checkAdminKey(req, res)) return;
  const users = db
    .prepare("SELECT id, username, fullname, status, expires_at, created_at, last_login FROM users ORDER BY created_at DESC")
    .all();
  return ok(res, { users });
});

// ── Admin : créer un utilisateur
app.post("/api/admin/users", (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const { username, password, fullname, expires_at } = req.body;
  if (!username || !password)
    return fail(res, "Nom d'utilisateur et mot de passe requis.");

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return fail(res, "Ce nom d'utilisateur existe déjà.");

  const hashed = bcrypt.hashSync(password, 10);
  const id = generateId();
  const now = new Date().toLocaleDateString("fr-FR");

  db.prepare(
    "INSERT INTO users (id, username, password, fullname, status, expires_at, created_at) VALUES (?, ?, ?, ?, 'active', ?, ?)"
  ).run(id, username.trim(), hashed, fullname || username.trim(), expires_at || null, now);

  return ok(res, { id }, "Utilisateur créé avec succès.");
});

// ── Admin : modifier un utilisateur (status / expiry / reset password)
app.patch("/api/admin/users/:id", (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const { id } = req.params;
  const { op, expires_at, new_password } = req.body;

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) return fail(res, "Utilisateur introuvable.", 404);

  if (op === "pause") {
    db.prepare("UPDATE users SET status = 'paused' WHERE id = ?").run(id);
  } else if (op === "resume") {
    db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(id);
  } else if (op === "set_expiry") {
    db.prepare("UPDATE users SET expires_at = ? WHERE id = ?").run(expires_at || null, id);
  } else if (op === "reset_password") {
    if (!new_password) return fail(res, "Nouveau mot de passe requis.");
    const hashed = bcrypt.hashSync(new_password, 10);
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashed, id);
  } else {
    return fail(res, "Opération inconnue.");
  }

  return ok(res, {}, "Mise à jour effectuée.");
});

// ── Admin : supprimer un utilisateur
app.delete("/api/admin/users/:id", (req, res) => {
  if (!checkAdminKey(req, res)) return;
  const { id } = req.params;
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  return ok(res, {}, "Utilisateur supprimé.");
});

// ── Utilisateur : connexion
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return fail(res, "Identifiants manquants.");

  const adminKey = getConfig("admin_key");
  if (!adminKey)
    return fail(
      res,
      "L'administrateur n'a pas encore configuré son accès. Veuillez le contacter.",
      503
    );

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password))
    return fail(res, "Nom d'utilisateur ou mot de passe incorrect.", 401);

  if (user.status === "paused")
    return fail(res, "Votre accès est temporairement suspendu. Contactez l'administrateur.", 403);

  if (user.expires_at) {
    const expDate = new Date(user.expires_at);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (expDate < now) {
      return fail(
        res,
        `Votre accès a expiré le ${expDate.toLocaleDateString("fr-FR")}. Contactez l'administrateur.`,
        403
      );
    }
  }

  // Mettre à jour last_login
  db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?").run(user.id);

  return ok(res, {
    username: user.username,
    fullname: user.fullname || user.username,
    role: "user",
    api_key: adminKey,
  });
});

// ── Fallback SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function cleanAIText(text) {
  return text
    .replace(/[*#`_~]/g, "")
    .replace(/[€&+]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

messageBox.innerText = cleanAIText(response);

// ── DÉMARRAGE ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Agent IA de MYF — Serveur démarré sur le port ${PORT}`);
  console.log(`📂 Base de données : ${DB_PATH}`);
});
