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

// Dossier public pour stocker les images générées
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
app.use(express.json({ limit: "10mb" }));
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
    res.status(401).json({ success: false, message: "Aucune clé admin configurée." });
    return false;
  }

  if (key !== stored) {
    res.status(401).json({ success: false, message: "Non autorisé." });
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
      message: "Non autorisé. Connectez-vous avant d'utiliser la génération d'image.",
      data: {},
    });
    return false;
  }

  return true;
}

function getMistralKey() {
  // Priorité : variable Render, puis clé Mistral dédiée en DB, puis clé admin déjà configurée
  return process.env.MISTRAL_API_KEY || getConfig("mistral_api_key") || getConfig("admin_key");
}

function safeImageParam(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// ── HELPERS MISTRAL IMAGE ───────────────────────────────────────────────────
async function mistralJson(pathname, options = {}) {
  const method = options.method || "GET";
  const body = options.body || null;
  const apiKey = options.apiKey || getMistralKey();

  if (!apiKey) {
    const err = new Error("Clé API Mistral introuvable.");
    err.status = 500;
    throw err;
  }

  const response = await fetch("https://api.mistral.ai" + pathname, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (e) {
    data = { raw };
  }

  if (!response.ok) {
    const message =
      (data && (data.message || data.detail || (data.error && data.error.message))) ||
      raw ||
      "Erreur Mistral HTTP " + response.status;
    const err = new Error(typeof message === "string" ? message : JSON.stringify(message));
    err.status = response.status;
    err.payload = data;
    throw err;
  }

  return data;
}

async function ensureMistralImageAgent(preferredModel) {
  const wantedModel = preferredModel || process.env.MISTRAL_IMAGE_AGENT_MODEL || "mistral-medium-latest";
  const cachedId = getConfig("mistral_image_agent_id");
  const cachedModel = getConfig("mistral_image_agent_model");

  if (cachedId && cachedModel === wantedModel) {
    return { id: cachedId, model: wantedModel };
  }

  const agent = await mistralJson("/v1/agents", {
    method: "POST",
    body: {
      model: wantedModel,
      name: "MYF Image Generation Agent",
      description: "Agent utilisé pour générer des images.",
      instructions:
        "When the user requests an image, use the image_generation tool to generate exactly one image matching the request. Keep any textual response very short.",
      tools: [{ type: "image_generation" }],
      completion_args: {
        temperature: 0.3,
        top_p: 0.95,
      },
    },
  });

  const agentId = agent && agent.id;
  if (!agentId) {
    const err = new Error("Impossible de créer l'agent image Mistral.");
    err.status = 502;
    throw err;
  }

  setConfig("mistral_image_agent_id", agentId);
  setConfig("mistral_image_agent_model", wantedModel);

  return { id: agentId, model: wantedModel };
}

function findToolFileChunk(node) {
  let found = null;

  (function walk(value) {
    if (found || value == null) return;

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    if (typeof value === "object") {
      if ((value.type === "tool_file" || value.object === "tool_file") && value.file_id) {
        found = value;
        return;
      }
      if (value.file_id && (value.file_name || value.file_type || value.id)) {
        found = value;
        return;
      }
      Object.keys(value).forEach((k) => walk(value[k]));
    }
  })(node);

  return found;
}

function collectTextChunks(node, out = []) {
  if (node == null) return out;

  if (Array.isArray(node)) {
    node.forEach((item) => collectTextChunks(item, out));
    return out;
  }

  if (typeof node === "object") {
    if (node.type === "text" && typeof node.text === "string") out.push(node.text);
    if (typeof node.content === "string") out.push(node.content);
    Object.keys(node).forEach((k) => collectTextChunks(node[k], out));
  }

  return out;
}

function guessExtension(fileName, fileType, contentType) {
  const lowerName = (fileName || "").toLowerCase();
  const lowerType = (fileType || "").toLowerCase();
  const lowerContentType = (contentType || "").toLowerCase();

  if (lowerName.endsWith(".png") || lowerType.includes("png") || lowerContentType.includes("png")) return "png";
  if (
    lowerName.endsWith(".jpg") ||
    lowerName.endsWith(".jpeg") ||
    lowerType.includes("jpg") ||
    lowerType.includes("jpeg") ||
    lowerContentType.includes("jpeg")
  ) {
    return "jpg";
  }
  if (lowerName.endsWith(".webp") || lowerType.includes("webp") || lowerContentType.includes("webp")) return "webp";
  if (lowerName.endsWith(".gif") || lowerType.includes("gif") || lowerContentType.includes("gif")) return "gif";

  return "png";
}

async function saveMistralFileLocally(fileId, preferredName, preferredType) {
  const urlInfo = await mistralJson("/v1/files/" + encodeURIComponent(fileId) + "/url", {
    method: "GET",
  });

  const signedUrl = urlInfo && urlInfo.url;
  if (!signedUrl) {
    const err = new Error("Impossible d'obtenir l'URL signée du fichier image.");
    err.status = 502;
    throw err;
  }

  const fileResponse = await fetch(signedUrl);
  if (!fileResponse.ok) {
    const err = new Error("Téléchargement du fichier image impossible (HTTP " + fileResponse.status + ").");
    err.status = fileResponse.status;
    throw err;
  }

  let buffer;
  if (typeof fileResponse.buffer === "function") {
    buffer = await fileResponse.buffer();
  } else {
    buffer = Buffer.from(await fileResponse.arrayBuffer());
  }

  const contentType = fileResponse.headers.get("content-type") || "image/png";
  const ext = guessExtension(preferredName, preferredType, contentType);
  const filename = "image-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
  const filepath = path.join(GENERATED_DIR, filename);
  fs.writeFileSync(filepath, buffer);

  return {
    filename,
    filepath,
    ext,
    mime: contentType,
    image_url: "/generated/" + filename,
    download_url: "/generated/" + filename,
  };
}

// ── ROUTES ───────────────────────────────────────────────────────────────────

// Santé
app.get("/api/health", (req, res) => {
  const configured = !!getConfig("admin_key");
  return ok(res, { configured, version: "1.1.0-mistral-image" });
});

// Admin : configurer / vérifier la clé API Mistral principale
app.post("/api/admin/setup", async (req, res) => {
  const { key } = req.body;
  if (!key) return fail(res, "Clé API manquante.");

  try {
    const response = await fetch("https://api.mistral.ai/v1/models", {
      headers: { Authorization: "Bearer " + key },
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg = errData.message || errData.detail || "Clé invalide (HTTP " + response.status + ")";
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
  if (!key) return fail(res, "Clé API manquante.");

  const stored = getConfig("admin_key");

  // Première connexion : stocker la clé après vérification Mistral
  if (!stored) {
    try {
      const response = await fetch("https://api.mistral.ai/v1/models", {
        headers: { Authorization: "Bearer " + key },
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg = errData.message || errData.detail || "Clé invalide (HTTP " + response.status + ")";
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

// Admin : enregistrer une clé Mistral dédiée pour l'image (optionnel)
// Recommandé sur Render : utilisez plutôt la variable d'environnement MISTRAL_API_KEY.
app.post("/api/admin/mistral-key", async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  const { key } = req.body;
  if (!key) return fail(res, "Clé Mistral manquante.");

  try {
    const response = await fetch("https://api.mistral.ai/v1/models", {
      headers: { Authorization: "Bearer " + key },
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg = errData.message || errData.detail || "Clé Mistral invalide (HTTP " + response.status + ")";
      return fail(res, typeof msg === "string" ? msg : JSON.stringify(msg));
    }
  } catch (e) {
    return fail(res, "Impossible de joindre api.mistral.ai : " + e.message);
  }

  setConfig("mistral_api_key", key);
  return ok(res, {}, "Clé Mistral enregistrée avec succès.");
});

// Admin : liste des utilisateurs
app.get("/api/admin/users", (req, res) => {
  if (!checkAdminKey(req, res)) return;
  const users = db
    .prepare("SELECT id, username, fullname, status, expires_at, created_at, last_login FROM users ORDER BY created_at DESC")
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
  if (existing) return fail(res, "Ce nom d'utilisateur existe déjà.");

  const hashed = bcrypt.hashSync(password, 10);
  const id = generateId();
  const now = new Date().toLocaleDateString("fr-FR");

  db.prepare(
    "INSERT INTO users (id, username, password, fullname, status, expires_at, created_at) VALUES (?, ?, ?, ?, 'active', ?, ?)"
  ).run(id, username.trim(), hashed, fullname || username.trim(), expires_at || null, now);

  return ok(res, { id }, "Utilisateur créé avec succès.");
});

// Admin : modifier un utilisateur
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
  if (!username || !password) return fail(res, "Identifiants manquants.");

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
    return fail(res, "Votre accès est temporairement suspendu. Contactez l'administrateur.", 403);
  }

  if (user.expires_at) {
    const expDate = new Date(user.expires_at);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (expDate < now) {
      return fail(
        res,
        "Votre accès a expiré le " + expDate.toLocaleDateString("fr-FR") + ". Contactez l'administrateur.",
        403
      );
    }
  }

  db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?").run(user.id);

  return ok(res, {
    username: user.username,
    fullname: user.fullname || user.username,
    role: "user",
    api_key: adminKey,
  });
});

// IA : génération d'image via Mistral Agents + outil image_generation
app.post("/api/generate-image", async (req, res) => {
  if (!checkAppAccess(req, res)) return;

  const mistralKey = getMistralKey();
  if (!mistralKey) {
    return fail(
      res,
      "Aucune clé Mistral n'est configurée. Ajoutez MISTRAL_API_KEY dans Render ou configurez la clé admin Mistral.",
      500
    );
  }

  try {
    const prompt = (req.body.prompt || "").trim();
    if (!prompt) return fail(res, "Prompt image manquant.");
    if (prompt.length > 4000) return fail(res, "Prompt trop long. Limitez-le à 4000 caractères.");

    const requestedModel = req.body.model || process.env.MISTRAL_IMAGE_AGENT_MODEL || "mistral-medium-latest";
    const requestedSize = safeImageParam(req.body.size, ["auto", "1024x1024", "1536x1024", "1024x1536"], "auto");
    const requestedQuality = safeImageParam(req.body.quality, ["auto", "low", "medium", "high"], "auto");
    const requestedFormat = safeImageParam(req.body.output_format, ["png", "jpeg", "webp"], "png");
    const requestedBackground = safeImageParam(req.body.background, ["auto", "transparent", "opaque"], "auto");

    let agent = await ensureMistralImageAgent(requestedModel);

    const conversationPrompt = [
      "Generate exactly one image for this request:",
      prompt,
      "Preferred output format: " + requestedFormat + ".",
      "Preferred size hint: " + requestedSize + ".",
      "Preferred quality hint: " + requestedQuality + ".",
      "Preferred background hint: " + requestedBackground + ".",
      "Do not ask follow-up questions. Generate the image directly.",
    ].join("\n");

    let convo;
    try {
      convo = await mistralJson("/v1/conversations", {
        method: "POST",
        apiKey: mistralKey,
        body: {
          agent_id: agent.id,
          inputs: conversationPrompt,
          store: false,
        },
      });
    } catch (e) {
      // Si l'agent stocké n'existe plus, on le recrée automatiquement
      if (e.status === 404 || /agent/i.test(e.message || "")) {
        setConfig("mistral_image_agent_id", "");
        setConfig("mistral_image_agent_model", "");
        agent = await ensureMistralImageAgent(requestedModel);
        convo = await mistralJson("/v1/conversations", {
          method: "POST",
          apiKey: mistralKey,
          body: {
            agent_id: agent.id,
            inputs: conversationPrompt,
            store: false,
          },
        });
      } else {
        throw e;
      }
    }

    const fileChunk = findToolFileChunk(convo);
    if (!fileChunk || !fileChunk.file_id) {
      const assistantText = collectTextChunks(convo).join(" ").trim();
      return fail(
        res,
        "Mistral n'a pas renvoyé de fichier image exploitable." +
          (assistantText ? " Réponse : " + assistantText.slice(0, 300) : ""),
        502
      );
    }

    const saved = await saveMistralFileLocally(fileChunk.file_id, fileChunk.file_name, fileChunk.file_type);
    const caption = collectTextChunks(convo).join(" ").trim();

    return ok(res, {
      file_id: fileChunk.file_id,
      agent_id: agent.id,
      model: agent.model || requestedModel,
      requested: {
        size: requestedSize,
        quality: requestedQuality,
        output_format: requestedFormat,
        background: requestedBackground,
      },
      filename: saved.filename,
      mime: saved.mime,
      image_url: saved.image_url,
      download_url: saved.download_url,
      caption,
    });
  } catch (e) {
    return fail(res, "Erreur génération image Mistral : " + e.message, e.status || 500);
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
});
