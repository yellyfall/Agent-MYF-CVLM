const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ── BASE DE DONNÉES SQLite ──────────────────────────────────────────────────
// Sur Render : monter un disque persistant sur /data
// En local   : utilise ./data/myf.db
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "myf.db");
const db = new Database(DB_PATH);

// Dossier public pour stocker temporairement les images générées
const PUBLIC_DIR = path.join(__dirname, "public");
const GENERATED_DIR = path.join(PUBLIC_DIR, "generated");
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

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
app.use(express.json({ limit: "35mb" }));
app.use(express.static(path.join(__dirname, "public")));

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── HELPERS GÉNÉRAUX ────────────────────────────────────────────────────────
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
    res.status(401).json({
      success: false,
      message: "Aucune clé admin configurée.",
    });
    return false;
  }

  if (key !== stored) {
    res.status(401).json({
      success: false,
      message: "Non autorisé.",
    });
    return false;
  }

  return true;
}

function checkAppAccess(req, res) {
  const supplied =
    req.headers["x-admin-key"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    req.body?.api_key;

  const stored = getConfig("admin_key");

  if (!stored) {
    res.status(503).json({
      success: false,
      message: "L'administrateur n'a pas encore configuré l'accès principal.",
      data: {},
    });
    return false;
  }

  if (supplied !== stored) {
    res.status(401).json({
      success: false,
      message: "Non autorisé. Connectez-vous avant d'utiliser l'IA.",
      data: {},
    });
    return false;
  }

  return true;
}

// ── HELPERS MISTRAL / ROTATION DE CLÉS ──────────────────────────────────────
function splitKeys(value) {
  return String(value || "")
    .split(/[\n,;|]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function uniqueKeys(keys) {
  const seen = new Set();
  const out = [];

  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  return out;
}

function getStoredMistralKeys() {
  const raw = getConfig("mistral_keys");
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(String).map((k) => k.trim()).filter(Boolean);
    }
  } catch (e) {}

  return splitKeys(raw);
}

function getMistralKeys() {
  return uniqueKeys([
    ...splitKeys(process.env.MISTRAL_API_KEYS),
    ...splitKeys(process.env.MISTRAL_API_KEY),
    ...getStoredMistralKeys(),
    ...splitKeys(getConfig("mistral_api_key")),
    ...splitKeys(getConfig("admin_key")),
  ]);
}

function keyHash(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

function isRateLimitError(message) {
  return /(rate\s*limit|quota|too\s*many\s*requests|429|image_generation\s+rate\s+limit\s+reached|limite)/i.test(
    String(message || "")
  );
}

function isAuthKeyError(message) {
  return /(unauthorized|invalid\s+api\s+key|forbidden|401|403|cl[eé]\s+invalide|non\s+autorisé)/i.test(
    String(message || "")
  );
}

async function parseJsonSafe(response) {
  const raw = await response.text();

  try {
    return {
      ok: true,
      data: JSON.parse(raw),
      raw,
    };
  } catch (e) {
    return {
      ok: false,
      data: null,
      raw,
    };
  }
}

async function mistralJson(pathname, options = {}, apiKey) {
  if (!apiKey) {
    throw new Error("Clé API Mistral introuvable.");
  }

  const response = await fetch("https://api.mistral.ai" + pathname, {
    method: options.method || "GET",
    headers: Object.assign(
      {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      options.headers || {}
    ),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const parsed = await parseJsonSafe(response);

  if (!response.ok) {
    const msg =
      parsed.data?.message ||
      parsed.data?.detail ||
      parsed.data?.error?.message ||
      parsed.raw ||
      "Erreur Mistral HTTP " + response.status;

    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = response.status;
    throw err;
  }

  if (!parsed.ok) {
    throw new Error("Réponse JSON Mistral illisible.");
  }

  return parsed.data;
}

async function ensureMistralImageAgent(apiKey) {
  const hash = keyHash(apiKey);
  const cfgKey = "mistral_image_agent_id_" + hash;
  const cached = getConfig(cfgKey);

  if (cached) {
    try {
      const agent = await mistralJson("/v1/agents/" + encodeURIComponent(cached), {}, apiKey);
      if (agent && agent.id) return agent.id;
    } catch (e) {
      // Agent supprimé ou inaccessible : on le recrée.
    }
  }

  const agent = await mistralJson(
    "/v1/agents",
    {
      method: "POST",
      body: {
        model: process.env.MISTRAL_IMAGE_AGENT_MODEL || "mistral-medium-latest",
        name: "MYF Image Agent",
        description: "Agent de génération d'images pour l'application MYF.",
        instructions:
          "You are an image generation agent. Use the image_generation tool only when the user explicitly asks for an image, photo, visual, logo, poster, illustration or artistic rendering. Do not generate images for text diagrams, one-line electrical diagrams, sketches, chemistry mechanisms or technical schemas unless the user explicitly asks for an image file.",
        tools: [{ type: "image_generation" }],
        completion_args: {
          temperature: 0.3,
          top_p: 0.95,
        },
      },
    },
    apiKey
  );

  if (!agent || !agent.id) {
    throw new Error("Création de l'agent image Mistral impossible.");
  }

  setConfig(cfgKey, agent.id);
  return agent.id;
}

function findToolFileChunk(node) {
  if (!node) return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findToolFileChunk(item);
      if (found) return found;
    }

    return null;
  }

  if (typeof node === "object") {
    if (node.type === "tool_file" && node.file_id) return node;

    for (const key of Object.keys(node)) {
      const found = findToolFileChunk(node[key]);
      if (found) return found;
    }
  }

  return null;
}

function collectTextChunks(node, bag = []) {
  if (!node) return bag;

  if (Array.isArray(node)) {
    node.forEach((item) => collectTextChunks(item, bag));
    return bag;
  }

  if (typeof node === "object") {
    if (node.type === "text" && typeof node.text === "string") {
      bag.push(node.text);
    }

    for (const key of Object.keys(node)) {
      collectTextChunks(node[key], bag);
    }
  }

  return bag;
}

async function downloadMistralFileContent(fileId, apiKey) {
  if (!apiKey) {
    throw new Error("Clé API Mistral introuvable.");
  }

  const response = await fetch(
    "https://api.mistral.ai/v1/files/" + encodeURIComponent(fileId) + "/content",
    {
      headers: {
        Authorization: "Bearer " + apiKey,
      },
    }
  );

  const raw = await response.text();

  if (!response.ok) {
    let msg = raw;

    try {
      const j = JSON.parse(raw);
      msg = j.message || j.detail || j.error?.message || raw;
    } catch (e) {}

    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = response.status;
    throw err;
  }

  let base64Data = raw.trim();

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") base64Data = parsed;
  } catch (e) {}

  return Buffer.from(base64Data, "base64");
}

async function runMistralImageJobWithKey(prompt, apiKey) {
  const agentId = await ensureMistralImageAgent(apiKey);

  const data = await mistralJson(
    "/v1/conversations",
    {
      method: "POST",
      body: {
        agent_id: agentId,
        inputs: prompt,
        store: false,
      },
    },
    apiKey
  );

  const fileChunk = findToolFileChunk(data);

  if (!fileChunk || !fileChunk.file_id) {
    const txt = collectTextChunks(data).join(" ").trim();
    throw new Error(txt || "Aucun fichier image n'a été retourné par Mistral.");
  }

  const bytes = await downloadMistralFileContent(fileChunk.file_id, apiKey);

  const ext =
    fileChunk.file_type === "jpeg"
      ? "jpg"
      : fileChunk.file_type || "png";

  const filename =
    "image-" +
    Date.now() +
    "-" +
    Math.random().toString(36).slice(2, 8) +
    "." +
    ext;

  const filepath = path.join(GENERATED_DIR, filename);
  fs.writeFileSync(filepath, bytes);

  const assistantText = collectTextChunks(data).join("\n").trim();

  return {
    filename,
    mime: "image/" + (ext === "jpg" ? "jpeg" : ext),
    image_url: "/generated/" + filename,
    download_url: "/generated/" + filename,
    revised_prompt: assistantText,
    provider: "mistral",
    key_used: keyHash(apiKey),
    file_id: fileChunk.file_id,
    file_name: fileChunk.file_name || filename,
    file_type: fileChunk.file_type || ext,
  };
}

async function runMistralImageJob(prompt) {
  const keys = getMistralKeys();

  if (!keys.length) {
    throw new Error("Clé API Mistral introuvable.");
  }

  let lastError = null;
  let rateLimitCount = 0;

  for (const apiKey of keys) {
    try {
      return await runMistralImageJobWithKey(prompt, apiKey);
    } catch (e) {
      lastError = e;

      const msg = e && e.message ? e.message : String(e);

      // Si cette clé est en limite, on essaye automatiquement la suivante.
      if (e.status === 429 || isRateLimitError(msg)) {
        rateLimitCount++;
        continue;
      }

      // Si cette clé est invalide/interdite, on essaye la suivante aussi.
      if (e.status === 401 || e.status === 403 || isAuthKeyError(msg)) {
        continue;
      }

      // Autre erreur : on essaye aussi la clé suivante s'il y en a une.
      continue;
    }
  }

  if (rateLimitCount >= keys.length) {
    const err = new Error("Limite génération image atteint");
    err.status = 429;
    throw err;
  }

  throw lastError || new Error("Impossible de générer l'image.");
}

// ── ROUTES ───────────────────────────────────────────────────────────────────

// Santé
app.get("/api/health", (req, res) => {
  const configured = !!getConfig("admin_key");

  return ok(res, {
    configured,
    image_keys_available: getMistralKeys().length,
    version: "1.0.0-mistral-image-key-rotation",
  });
});

// Admin : configurer / vérifier la clé API Mistral principale
app.post("/api/admin/setup", async (req, res) => {
  const { key } = req.body;

  if (!key) {
    return fail(res, "Clé API manquante.");
  }

  try {
    const response = await fetch("https://api.mistral.ai/v1/models", {
      headers: {
        Authorization: "Bearer " + key,
      },
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg =
        errData.message ||
        errData.detail ||
        "Clé invalide (HTTP " + response.status + ")";

      return fail(res, typeof msg === "string" ? msg : JSON.stringify(msg));
    }
  } catch (e) {
    return fail(res, "Impossible de joindre api.mistral.ai : " + e.message);
  }

  setConfig("admin_key", key);

  return ok(res, {}, "Clé API vérifiée et sauvegardée.");
});

// Admin : connexion
app.post("/api/admin/login", async (req, res) => {
  const { key } = req.body;

  if (!key) {
    return fail(res, "Clé API manquante.");
  }

  const stored = getConfig("admin_key");

  if (!stored) {
    try {
      const response = await fetch("https://api.mistral.ai/v1/models", {
        headers: {
          Authorization: "Bearer " + key,
        },
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg =
          errData.message ||
          errData.detail ||
          "Clé invalide (HTTP " + response.status + ")";

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

// Admin : enregistrer plusieurs clés Mistral de secours
// Body attendu : { keys: ["clé1", "clé2"] } ou { keys: "clé1,clé2" }
app.post("/api/admin/mistral-keys", async (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const incoming = Array.isArray(req.body.keys)
    ? req.body.keys
    : splitKeys(req.body.keys || "");

  const keys = uniqueKeys(incoming.map(String).map((k) => k.trim()).filter(Boolean));

  if (!keys.length) {
    setConfig("mistral_keys", JSON.stringify([]));
    return ok(res, { count: 0 }, "Clés Mistral secondaires supprimées.");
  }

  // On vérifie au moins que les clés peuvent interroger /models.
  const valid = [];
  const invalid = [];

  for (const key of keys) {
    try {
      const response = await fetch("https://api.mistral.ai/v1/models", {
        headers: {
          Authorization: "Bearer " + key,
        },
      });

      if (response.ok) {
        valid.push(key);
      } else {
        invalid.push(keyHash(key));
      }
    } catch (e) {
      invalid.push(keyHash(key));
    }
  }

  setConfig("mistral_keys", JSON.stringify(valid));

  return ok(
    res,
    {
      count: valid.length,
      invalid,
    },
    valid.length
      ? "Clés Mistral secondaires enregistrées."
      : "Aucune clé secondaire valide enregistrée."
  );
});

// Admin : liste des utilisateurs
app.get("/api/admin/users", (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const users = db
    .prepare(
      "SELECT id, username, fullname, status, expires_at, created_at, last_login FROM users ORDER BY created_at DESC"
    )
    .all();

  return ok(res, { users });
});

// Admin : créer un utilisateur
app.post("/api/admin/users", (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const { username, password, fullname, expires_at } = req.body;

  if (!username || !password) {
    return fail(res, "Nom d'utilisateur et mot de passe requis.");
  }

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);

  if (existing) {
    return fail(res, "Ce nom d'utilisateur existe déjà.");
  }

  const hashed = bcrypt.hashSync(password, 10);
  const id = generateId();
  const now = new Date().toLocaleDateString("fr-FR");

  db.prepare(
    "INSERT INTO users (id, username, password, fullname, status, expires_at, created_at) VALUES (?, ?, ?, ?, 'active', ?, ?)"
  ).run(
    id,
    username.trim(),
    hashed,
    fullname || username.trim(),
    expires_at || null,
    now
  );

  return ok(res, { id }, "Utilisateur créé avec succès.");
});

// Admin : modifier un utilisateur
app.patch("/api/admin/users/:id", (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const { id } = req.params;
  const { op, expires_at, new_password } = req.body;

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);

  if (!user) {
    return fail(res, "Utilisateur introuvable.", 404);
  }

  if (op === "pause") {
    db.prepare("UPDATE users SET status = 'paused' WHERE id = ?").run(id);
  } else if (op === "resume") {
    db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(id);
  } else if (op === "set_expiry") {
    db.prepare("UPDATE users SET expires_at = ? WHERE id = ?").run(expires_at || null, id);
  } else if (op === "reset_password") {
    if (!new_password) {
      return fail(res, "Nouveau mot de passe requis.");
    }

    const hashed = bcrypt.hashSync(new_password, 10);
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashed, id);
  } else {
    return fail(res, "Opération inconnue.");
  }

  return ok(res, {}, "Mise à jour effectuée.");
});

// Admin : supprimer un utilisateur
app.delete("/api/admin/users/:id", (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const { id } = req.params;
  db.prepare("DELETE FROM users WHERE id = ?").run(id);

  return ok(res, {}, "Utilisateur supprimé.");
});

// Utilisateur : connexion
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return fail(res, "Identifiants manquants.");
  }

  const adminKey = getConfig("admin_key");

  if (!adminKey) {
    return fail(
      res,
      "L'administrateur n'a pas encore configuré son accès. Veuillez le contacter.",
      503
    );
  }

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username.trim());

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return fail(res, "Nom d'utilisateur ou mot de passe incorrect.", 401);
  }

  if (user.status === "paused") {
    return fail(
      res,
      "Votre accès est temporairement suspendu. Contactez l'administrateur.",
      403
    );
  }

  if (user.expires_at) {
    const expDate = new Date(user.expires_at);
    const now = new Date();

    now.setHours(0, 0, 0, 0);

    if (expDate < now) {
      return fail(
        res,
        "Votre accès a expiré le " +
          expDate.toLocaleDateString("fr-FR") +
          ". Contactez l'administrateur.",
        403
      );
    }
  }

  db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?").run(
    user.id
  );

  return ok(res, {
    username: user.username,
    fullname: user.fullname || user.username,
    role: "user",
    api_key: adminKey,
  });
});

// IA : génération d'image Mistral
app.post("/api/generate-image", async (req, res) => {
  if (!checkAppAccess(req, res)) return;

  try {
    const prompt = (req.body.prompt || "").trim();

    if (!prompt) {
      return fail(res, "Prompt image manquant.");
    }

    if (prompt.length > 6000) {
      return fail(res, "Prompt trop long. Limitez-le à 6000 caractères.");
    }

    const result = await runMistralImageJob(prompt);

    return ok(res, result);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);

    if (e.status === 429 || isRateLimitError(msg) || msg === "Limite génération image atteint") {
      return fail(res, "Limite génération image atteint", 429);
    }

    return fail(res, msg, 500);
  }
});

// Fallback SPA
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── DÉMARRAGE ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("✅ Agent IA de MYF — Serveur démarré sur le port " + PORT);
  console.log("📂 Base de données : " + DB_PATH);
  console.log("🔑 Clés Mistral disponibles pour l'image : " + getMistralKeys().length);
});
