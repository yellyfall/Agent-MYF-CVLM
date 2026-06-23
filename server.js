const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────
// DOSSIERS / BASE SQLite
// ─────────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const GENERATED_DIR = path.join(PUBLIC_DIR, "generated");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(GENERATED_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "myf.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT DEFAULT NULL,
  role       TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_at INTEGER NOT NULL,
  last_seen  TEXT DEFAULT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS usage_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT,
  user_id    TEXT,
  route      TEXT,
  created_at INTEGER NOT NULL
);
`);

// ─────────────────────────────────────────────────────────────
// MIDDLEWARES
// ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "35mb" }));
app.use(express.static(PUBLIC_DIR));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key, X-Session-Token, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ─────────────────────────────────────────────────────────────
// HELPERS GÉNÉRAUX
// ─────────────────────────────────────────────────────────────
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

function id() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function adminSecret() {
  // Priorité à la variable d'environnement Render.
  // On nettoie les espaces/guillemets pour éviter "clé admin incorrecte"
  // à cause d'un espace copié-collé ou d'une valeur saisie avec guillemets.
  const envKey = String(process.env.ADMIN_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();

  if (envKey) return envKey;

  const dbKey = String(getConfig("admin_key") || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();

  return dbKey || null;
}

function splitKeys(value) {
  return String(value || "")
    .split(/[\n,;|]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function keyHash(key) {
  return sha256(key).slice(0, 16);
}

// ─────────────────────────────────────────────────────────────
// SESSIONS SÉCURISÉES
// ─────────────────────────────────────────────────────────────
function createSession(userId, role = "user", ttlHours = 12) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const expiresAt = Date.now() + ttlHours * 60 * 60 * 1000;

  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, role, expires_at, last_seen)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
  `).run(tokenHash, userId || null, role, expiresAt);

  return {
    token,
    role,
    expires_at: new Date(expiresAt).toISOString(),
  };
}

function suppliedToken(req) {
  return String(
    req.headers["x-session-token"] ||
    req.headers["x-admin-key"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    req.body?.session_token ||
    ""
  ).trim();
}

function readSession(req) {
  const token = suppliedToken(req);
  if (!token) return null;

  const tokenHash = sha256(token);
  const row = db.prepare("SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0").get(tokenHash);
  if (!row) return null;

  if (Number(row.expires_at) < Date.now()) {
    db.prepare("UPDATE sessions SET revoked = 1 WHERE token_hash = ?").run(tokenHash);
    return null;
  }

  db.prepare("UPDATE sessions SET last_seen = datetime('now','localtime') WHERE token_hash = ?").run(tokenHash);
  return { ...row, token_hash: tokenHash };
}

function requireSession(req, res) {
  const s = readSession(req);
  if (!s) {
    fail(res, "Session invalide ou expirée. Veuillez vous reconnecter.", 401);
    return null;
  }
  req.session = s;
  return s;
}

function requireAdmin(req, res) {
  const session = readSession(req);
  if (session && session.role === "admin") {
    req.session = session;
    return true;
  }

  const key = String(req.headers["x-admin-key"] || req.body?.admin_key || "").trim();
  const stored = adminSecret();

  if (!stored) return fail(res, "Aucune clé admin configurée.", 401), false;
  if (key !== stored) return fail(res, "Non autorisé.", 401), false;

  return true;
}

function requireAppAccess(req, res) {
  const session = requireSession(req, res);
  if (!session) return false;

  const now = Date.now();
  const since = now - 60 * 60 * 1000;
  const limit = Number(process.env.MYF_SESSION_HOURLY_LIMIT || 80);

  const count = db.prepare(`
    SELECT COUNT(*) AS n FROM usage_log
    WHERE token_hash = ? AND created_at > ?
  `).get(session.token_hash, since).n;

  if (count >= limit) {
    fail(res, "Limite d'utilisation atteinte pour cette session. Réessayez plus tard.", 429);
    return false;
  }

  db.prepare(`
    INSERT INTO usage_log (token_hash, user_id, route, created_at)
    VALUES (?, ?, ?, ?)
  `).run(session.token_hash, session.user_id || null, req.path, now);

  if (Math.random() < 0.02) {
    db.prepare("DELETE FROM usage_log WHERE created_at < ?").run(now - 7 * 24 * 60 * 60 * 1000);
  }

  return true;
}

// ─────────────────────────────────────────────────────────────
// CLÉS MISTRAL CÔTÉ SERVEUR UNIQUEMENT
// ─────────────────────────────────────────────────────────────
function storedMistralKeys() {
  const raw = getConfig("mistral_keys");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).map((v) => v.trim()).filter(Boolean);
  } catch (_) {}
  return splitKeys(raw);
}

function mistralKeys() {
  const keys = [
    ...splitKeys(process.env.MISTRAL_API_KEYS),
    ...splitKeys(process.env.MISTRAL_API_KEY),
    ...storedMistralKeys(),
  ];
  return unique(keys);
}

function isRateLimit(message) {
  return /(429|rate\s*limit|quota|too\s*many|limite)/i.test(String(message || ""));
}

async function parseResponse(response) {
  const raw = await response.text();
  try {
    return { json: JSON.parse(raw), raw };
  } catch (_) {
    return { json: null, raw };
  }
}

async function mistralJson(pathname, options, apiKey) {
  const response = await fetch("https://api.mistral.ai" + pathname, {
    method: options?.method || "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
      ...(options?.headers || {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const parsed = await parseResponse(response);

  if (!response.ok) {
    const msg = parsed.json?.message || parsed.json?.detail || parsed.json?.error?.message || parsed.raw || "Erreur Mistral";
    const err = new Error(msg);
    err.status = response.status;
    throw err;
  }

  return parsed.json;
}

async function openMistralStream(payload) {
  const keys = mistralKeys();
  if (!keys.length) {
    const err = new Error("Aucune clé Mistral configurée côté serveur. Ajoutez MISTRAL_API_KEYS sur Render.");
    err.status = 503;
    throw err;
  }

  let lastError = null;

  for (const key of keys) {
    try {
      const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + key,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) return response;

      const parsed = await parseResponse(response);
      const msg = parsed.json?.message || parsed.json?.detail || parsed.json?.error?.message || parsed.raw || "Erreur Mistral " + response.status;
      lastError = new Error(msg);
      lastError.status = response.status;

      if ([401, 403, 429].includes(response.status)) continue;
      break;
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error("Impossible d'ouvrir le flux Mistral.");
}

function sanitizeModel(model) {
  const allowed = [
    "mistral-large-latest",
    "mistral-medium-latest",
    "mistral-small-latest",
    "open-mistral-nemo",
    "codestral-latest",
  ];
  return allowed.includes(model) ? model : "mistral-large-latest";
}

function clamp(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, x));
}

// ─────────────────────────────────────────────────────────────
// IMAGE MISTRAL
// ─────────────────────────────────────────────────────────────
function collectText(node, bag = []) {
  if (!node) return bag;
  if (Array.isArray(node)) {
    node.forEach((x) => collectText(x, bag));
    return bag;
  }
  if (typeof node === "object") {
    if (node.type === "text" && typeof node.text === "string") bag.push(node.text);
    Object.keys(node).forEach((k) => collectText(node[k], bag));
  }
  return bag;
}

function findToolFile(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const x of node) {
      const found = findToolFile(x);
      if (found) return found;
    }
  }
  if (typeof node === "object") {
    if (node.type === "tool_file" && node.file_id) return node;
    for (const k of Object.keys(node)) {
      const found = findToolFile(node[k]);
      if (found) return found;
    }
  }
  return null;
}

async function ensureImageAgent(apiKey) {
  const cfgKey = "mistral_image_agent_id_" + keyHash(apiKey);
  const cached = getConfig(cfgKey);

  if (cached) {
    try {
      const agent = await mistralJson("/v1/agents/" + encodeURIComponent(cached), {}, apiKey);
      if (agent?.id) return agent.id;
    } catch (_) {}
  }

  const agent = await mistralJson("/v1/agents", {
    method: "POST",
    body: {
      model: process.env.MISTRAL_IMAGE_AGENT_MODEL || "mistral-medium-latest",
      name: "MYF Image Agent",
      description: "Agent image sécurisé côté serveur pour Agent IA de MYF.",
      instructions: "Use the image_generation tool only when the user explicitly asks for an image, logo, poster, photo, visual, illustration or realistic rendering.",
      tools: [{ type: "image_generation" }],
      completion_args: { temperature: 0.3, top_p: 0.95 },
    },
  }, apiKey);

  if (!agent?.id) throw new Error("Création de l'agent image Mistral impossible.");
  setConfig(cfgKey, agent.id);
  return agent.id;
}

async function downloadMistralFile(fileId, apiKey) {
  const response = await fetch("https://api.mistral.ai/v1/files/" + encodeURIComponent(fileId) + "/content", {
    headers: { Authorization: "Bearer " + apiKey },
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(raw || "Téléchargement image Mistral impossible.");

  let base64 = raw.trim();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") base64 = parsed;
  } catch (_) {}

  return Buffer.from(base64, "base64");
}

async function generateImageWithKey(prompt, apiKey) {
  const agentId = await ensureImageAgent(apiKey);
  const data = await mistralJson("/v1/conversations", {
    method: "POST",
    body: { agent_id: agentId, inputs: prompt, store: false },
  }, apiKey);

  const file = findToolFile(data);
  if (!file?.file_id) {
    throw new Error(collectText(data).join(" ").trim() || "Aucune image retournée par Mistral.");
  }

  const bytes = await downloadMistralFile(file.file_id, apiKey);
  const ext = file.file_type === "jpeg" ? "jpg" : (file.file_type || "png");
  const filename = "image-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex") + "." + ext;
  fs.writeFileSync(path.join(GENERATED_DIR, filename), bytes);

  return {
    filename,
    image_url: "/generated/" + filename,
    download_url: "/generated/" + filename,
    mime: "image/" + (ext === "jpg" ? "jpeg" : ext),
    provider: "mistral",
    key_used: keyHash(apiKey),
  };
}

async function generateImage(prompt) {
  const keys = mistralKeys();
  if (!keys.length) throw new Error("Clé API Mistral introuvable côté serveur.");

  let last = null;
  let rateLimited = 0;

  for (const key of keys) {
    try {
      return await generateImageWithKey(prompt, key);
    } catch (e) {
      last = e;
      if (e.status === 429 || isRateLimit(e.message)) rateLimited++;
      continue;
    }
  }

  if (rateLimited >= keys.length) {
    const err = new Error("Limite génération image atteint");
    err.status = 429;
    throw err;
  }

  throw last || new Error("Impossible de générer l'image.");
}

// ─────────────────────────────────────────────────────────────
// WEB TEMPS RÉEL
// ─────────────────────────────────────────────────────────────
function htmlDecode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(html, max = 9000) {
  let text = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<\/(p|div|section|article|header|footer|li|br|h1|h2|h3|h4|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  text = htmlDecode(text)
    .replace(/\r/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > max ? text.slice(0, max) + "\n… [contenu tronqué]" : text;
}

function pageTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1], 180).replace(/\s+/g, " ") : "";
}

function safeUrl(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;

    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host.endsWith(".local")) return null;

    const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ip) {
      const a = Number(ip[1]);
      const b = Number(ip[2]);
      if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return null;
    }

    return url.toString();
  } catch (_) {
    return null;
  }
}

async function fetchTimeout(url, options = {}, timeout = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readUrl(rawUrl, maxChars = 9000) {
  const url = safeUrl(rawUrl);
  if (!url) throw new Error("URL invalide ou non autorisée.");

  const response = await fetchTimeout(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; MYF-AI/1.0)",
      "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7",
    },
    redirect: "follow",
  }, 10000);

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!response.ok) throw new Error("Lecture impossible HTTP " + response.status);

  return {
    url,
    title: pageTitle(raw),
    content_type: contentType,
    text: stripHtml(raw, maxChars),
    fetched_at: new Date().toISOString(),
  };
}

function normalizeResultUrl(url) {
  try {
    let u = htmlDecode(String(url || "").trim());
    if (!u) return "";
    if (u.startsWith("//")) u = "https:" + u;

    if (u.includes("duckduckgo.com/l/") || u.startsWith("/l/")) {
      const parsed = new URL(u, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    }

    return new URL(u).toString();
  } catch (_) {
    return "";
  }
}

async function braveSearch(query, maxResults) {
  const key = process.env.BRAVE_SEARCH_API_KEY || getConfig("brave_search_api_key");
  if (!key) return [];

  const url = "https://api.search.brave.com/res/v1/web/search?q=" + encodeURIComponent(query) +
    "&count=" + Math.min(maxResults || 6, 10) + "&country=fr&search_lang=fr&ui_lang=fr-FR";

  const response = await fetchTimeout(url, {
    headers: { "Accept": "application/json", "X-Subscription-Token": key },
  }, 9000);

  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  const rows = data.web?.results || [];

  return rows.map((r) => ({
    title: htmlDecode(r.title || ""),
    url: normalizeResultUrl(r.url || ""),
    snippet: stripHtml(r.description || "", 700),
    source: "Brave Search",
  })).filter((r) => r.url);
}

async function duckDuckGoSearch(query, maxResults) {
  const results = [];

  try {
    const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
    const response = await fetchTimeout(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MYF-AI/1.0)" },
    }, 9000);

    const html = await response.text();
    const blocks = html.split(/<div class="result/i).slice(1);

    for (const block of blocks) {
      if (results.length >= maxResults) break;
      const a = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!a) continue;

      const url = normalizeResultUrl(a[1]);
      if (!url || results.some((r) => r.url === url)) continue;

      const sn = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//i);
      results.push({
        title: stripHtml(a[2], 250),
        url,
        snippet: sn ? stripHtml(sn[1], 700) : "",
        source: "DuckDuckGo",
      });
    }
  } catch (_) {}

  return results;
}

async function gdeltSearch(query, maxResults) {
  try {
    const url = "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent(query) +
      "&mode=ArtList&format=json&maxrecords=" + Math.min(maxResults || 6, 10) + "&sort=HybridRel";

    const response = await fetchTimeout(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MYF-AI/1.0)" },
    }, 9000);

    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    return (data.articles || []).map((a) => ({
      title: a.title || "",
      url: normalizeResultUrl(a.url || ""),
      snippet: [a.seendate, a.domain].filter(Boolean).join(" · "),
      source: "GDELT News",
      published_at: a.seendate || "",
    })).filter((r) => r.url);
  } catch (_) {
    return [];
  }
}

function isNewsQuery(q) {
  return /(actualité|actualités|actu|news|aujourd'hui|récent|recent|derni[eè]re|latest|breaking|maintenant)/i.test(String(q || ""));
}

async function liveSearch(query, options = {}) {
  const maxResults = Math.max(1, Math.min(Number(options.max_results || 6), 10));
  let results = [];

  results = results.concat(await braveSearch(query, maxResults));
  if (isNewsQuery(query)) results = results.concat(await gdeltSearch(query, maxResults));
  if (results.length < maxResults) results = results.concat(await duckDuckGoSearch(query, maxResults));

  const seen = new Set();
  results = results.filter((r) => {
    if (!r.url || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  }).slice(0, maxResults);

  if (options.deep !== false) {
    for (let i = 0; i < Math.min(results.length, Number(options.read_top || 4)); i++) {
      try {
        const page = await readUrl(results[i].url, 5000);
        results[i].page_title = page.title || results[i].title;
        results[i].page_text = page.text;
        results[i].checked_at = page.fetched_at;
      } catch (e) {
        results[i].read_error = e.message;
      }
    }
  }

  return { query, checked_at: new Date().toISOString(), results };
}

function timeContext(client = {}) {
  const lines = ["Date/heure serveur ISO : " + new Date().toISOString()];
  if (client.timezone) lines.push("Fuseau horaire utilisateur : " + client.timezone);
  if (client.local_time) lines.push("Date/heure locale utilisateur : " + client.local_time);
  if (client.locale) lines.push("Locale navigateur : " + client.locale);
  return lines.join("\n");
}

function formatWebContext(payload, clientContext) {
  const lines = [
    "Recherche web temps réel",
    "Requête : " + payload.query,
    "Vérifié le : " + payload.checked_at,
    clientContext ? "Contexte utilisateur : " + clientContext : "",
    "",
  ].filter(Boolean);

  if (!payload.results.length) {
    lines.push("Aucun résultat web exploitable trouvé.");
    return lines.join("\n");
  }

  payload.results.forEach((r, i) => {
    lines.push("SOURCE " + (i + 1));
    lines.push("Titre : " + (r.page_title || r.title || "Sans titre"));
    lines.push("URL : " + r.url);
    if (r.published_at) lines.push("Date source : " + r.published_at);
    if (r.snippet) lines.push("Extrait recherche : " + r.snippet);
    if (r.page_text) lines.push("Contenu vérifié : " + r.page_text.slice(0, 5000));
    if (r.read_error) lines.push("Lecture page : impossible (" + r.read_error + ")");
    lines.push("");
  });

  return lines.join("\n");
}


// ─────────────────────────────────────────────────────────────
// V31 — RECHERCHE WEB AVANCÉE / MULTI-SOURCES / SPORT
// ─────────────────────────────────────────────────────────────

function advNorm(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function advUniqueByUrl(rows) {
  const seen = new Set();
  const out = [];

  for (const r of rows || []) {
    const url = normalizeResultUrl(r.url || "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(Object.assign({}, r, { url }));
  }

  return out;
}

function advIsWorldCupQuery(query) {
  const q = advNorm(query);
  return /(coupe du monde|world cup|fifa|mondial|qualification coupe du monde|resultats? des matchs?|matches? a venir|calendrier des matchs?|classement groupe|phase de groupes)/.test(q);
}

function advIsSportsQuery(query) {
  const q = advNorm(query);
  return advIsWorldCupQuery(q) || /(football|soccer|ligue des champions|euro|can|premier league|liga|serie a|bundesliga|ligue 1|classement|resultats? sportifs?|score|matchs? a venir)/.test(q);
}

function advIsNewsOrResearchQuery(query) {
  const q = advNorm(query);
  return /(actualite|actualites|actu|news|aujourd'hui|maintenant|temps reel|recent|derniere|dernier|mise a jour|en ce moment|verifie|verification|sources?|rapport|synthese|analyse avancee|veille|regroupe|compare|resume)/.test(q);
}

function advDateYYYYMMDD(date) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return "" + y + m + day;
}

function advDateRangeDays(daysBefore, daysAfter) {
  const now = new Date();
  const dates = [];

  for (let i = -daysBefore; i <= daysAfter; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    dates.push(advDateYYYYMMDD(d));
  }

  return dates;
}

function advBuildQueryVariants(query) {
  const q = String(query || "").trim();
  const variants = [q];

  if (advIsWorldCupQuery(q)) {
    variants.push("Coupe du Monde FIFA résultats matchs passés matchs à venir classement groupes site:fifa.com");
    variants.push("FIFA World Cup latest scores fixtures standings results");
    variants.push("Coupe du Monde calendrier résultats classement groupes site:lequipe.fr");
    variants.push("World Cup scores fixtures standings ESPN");
  } else if (advIsNewsOrResearchQuery(q)) {
    variants.push(q + " actualités récentes sources officielles");
    variants.push(q + " site officiel communiqué");
    variants.push(q + " analyse synthèse dernières informations");
  } else {
    variants.push(q + " sources officielles");
    variants.push(q + " vérification données récentes");
  }

  const seen = new Set();
  return variants.filter((v) => {
    const n = advNorm(v);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  }).slice(0, 5);
}

async function newsApiSearch(query, maxResults) {
  const key = process.env.NEWSAPI_KEY || getConfig("newsapi_key");
  if (!key) return [];

  try {
    const url = "https://newsapi.org/v2/everything?q=" +
      encodeURIComponent(query) +
      "&language=fr&sortBy=publishedAt&pageSize=" +
      Math.min(maxResults || 6, 10);

    const response = await fetchTimeout(url, {
      headers: {
        "X-Api-Key": key,
        "User-Agent": "MYF-AI/1.0",
      },
    }, 9000);

    if (!response.ok) return [];

    const data = await response.json().catch(() => ({}));

    return (data.articles || []).map((a) => ({
      title: a.title || "",
      url: normalizeResultUrl(a.url || ""),
      snippet: stripHtml(a.description || a.content || "", 900),
      source: a.source?.name ? "NewsAPI - " + a.source.name : "NewsAPI",
      published_at: a.publishedAt || "",
    })).filter((r) => r.url);
  } catch (_) {
    return [];
  }
}

async function gNewsSearch(query, maxResults) {
  const key = process.env.GNEWS_API_KEY || getConfig("gnews_api_key");
  if (!key) return [];

  try {
    const url = "https://gnews.io/api/v4/search?q=" +
      encodeURIComponent(query) +
      "&lang=fr&country=fr&max=" +
      Math.min(maxResults || 6, 10) +
      "&apikey=" + encodeURIComponent(key);

    const response = await fetchTimeout(url, {
      headers: {
        "User-Agent": "MYF-AI/1.0",
      },
    }, 9000);

    if (!response.ok) return [];

    const data = await response.json().catch(() => ({}));

    return (data.articles || []).map((a) => ({
      title: a.title || "",
      url: normalizeResultUrl(a.url || ""),
      snippet: stripHtml(a.description || a.content || "", 900),
      source: a.source?.name ? "GNews - " + a.source.name : "GNews",
      published_at: a.publishedAt || "",
    })).filter((r) => r.url);
  } catch (_) {
    return [];
  }
}

async function advMultiSearch(query, maxResults) {
  const variants = advBuildQueryVariants(query);
  let results = [];

  for (const v of variants) {
    const wanted = Math.max(4, Math.ceil(maxResults / 2));

    try { results = results.concat(await braveSearch(v, wanted)); } catch (_) {}
    if (advIsNewsOrResearchQuery(query) || advIsWorldCupQuery(query)) {
      try { results = results.concat(await gdeltSearch(v, wanted)); } catch (_) {}
      try { results = results.concat(await newsApiSearch(v, wanted)); } catch (_) {}
      try { results = results.concat(await gNewsSearch(v, wanted)); } catch (_) {}
    }
    try { results = results.concat(await duckDuckGoSearch(v, wanted)); } catch (_) {}
  }

  return advUniqueByUrl(results).slice(0, maxResults);
}

async function espnWorldCupScoreboard() {
  // API publique ESPN. Selon la compétition, certaines dates peuvent être vides.
  const leagues = [
    "fifa.world",
    "fifa.wwc",
    "fifa.worldq",
    "uefa.euro",
  ];

  const dates = advDateRangeDays(14, 14);
  const events = [];
  const seen = new Set();

  for (const league of leagues) {
    for (const d of dates) {
      try {
        const url = "https://site.api.espn.com/apis/site/v2/sports/soccer/" +
          encodeURIComponent(league) +
          "/scoreboard?dates=" + d;

        const response = await fetchTimeout(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; MYF-AI/1.0)",
            "Accept": "application/json",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7",
          },
        }, 6000);

        if (!response.ok) continue;

        const data = await response.json().catch(() => ({}));
        const rows = Array.isArray(data.events) ? data.events : [];

        for (const ev of rows) {
          const id = ev.id || ev.uid || (ev.name + ev.date);
          if (!id || seen.has(id)) continue;
          seen.add(id);

          const comp = ev.competitions && ev.competitions[0] ? ev.competitions[0] : {};
          const competitors = comp.competitors || [];

          const teams = competitors.map((c) => ({
            name: c.team?.displayName || c.team?.name || c.team?.shortDisplayName || "",
            abbreviation: c.team?.abbreviation || "",
            score: c.score !== undefined && c.score !== null ? String(c.score) : "",
            homeAway: c.homeAway || "",
            winner: !!c.winner,
          }));

          events.push({
            id: String(id),
            league,
            name: ev.name || ev.shortName || teams.map((t) => t.name).join(" vs "),
            date: ev.date || comp.date || "",
            status: comp.status?.type?.description || comp.status?.type?.name || ev.status?.type?.description || "",
            state: comp.status?.type?.state || ev.status?.type?.state || "",
            completed: !!(comp.status?.type?.completed || ev.status?.type?.completed),
            venue: comp.venue?.fullName || "",
            teams,
            source_url: ev.links && ev.links[0] ? ev.links[0].href : "",
          });
        }
      } catch (_) {}
    }
  }

  events.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const now = Date.now();

  const past = events.filter((e) => {
    const ts = Date.parse(e.date);
    return e.completed || (Number.isFinite(ts) && ts < now);
  }).slice(-12);

  const upcoming = events.filter((e) => {
    const ts = Date.parse(e.date);
    return !e.completed && Number.isFinite(ts) && ts >= now;
  }).slice(0, 12);

  const live = events.filter((e) => {
    const s = advNorm(e.state + " " + e.status);
    return /in|live|halftime|progress|1st|2nd/.test(s) && !e.completed;
  });

  return {
    source: "ESPN public scoreboard",
    checked_at: new Date().toISOString(),
    past,
    live,
    upcoming,
    events_count: events.length,
  };
}

async function footballDataWorldCup(query) {
  const key = process.env.FOOTBALL_DATA_API_KEY || getConfig("football_data_api_key");
  if (!key) return null;

  try {
    const matchesRes = await fetchTimeout("https://api.football-data.org/v4/competitions/WC/matches", {
      headers: { "X-Auth-Token": key },
    }, 9000);

    const standingsRes = await fetchTimeout("https://api.football-data.org/v4/competitions/WC/standings", {
      headers: { "X-Auth-Token": key },
    }, 9000);

    const matches = matchesRes.ok ? await matchesRes.json().catch(() => ({})) : {};
    const standings = standingsRes.ok ? await standingsRes.json().catch(() => ({})) : {};

    return {
      source: "football-data.org",
      checked_at: new Date().toISOString(),
      matches: matches.matches || [],
      standings: standings.standings || [],
    };
  } catch (_) {
    return null;
  }
}

async function advSportsData(query) {
  if (!advIsSportsQuery(query)) return null;

  const out = {
    kind: advIsWorldCupQuery(query) ? "world_cup_or_football" : "sports",
    checked_at: new Date().toISOString(),
    sources: [],
  };

  if (advIsWorldCupQuery(query)) {
    const espn = await espnWorldCupScoreboard();
    if (espn && (espn.past.length || espn.live.length || espn.upcoming.length)) {
      out.sources.push(espn);
    }

    const fd = await footballDataWorldCup(query);
    if (fd) out.sources.push(fd);
  }

  return out.sources.length ? out : null;
}

function advFormatMatch(e) {
  const teams = e.teams || [];
  const left = teams[0] || {};
  const right = teams[1] || {};
  const scoreReady = left.score !== "" || right.score !== "";

  const score = scoreReady
    ? (left.name || left.abbreviation || "Équipe 1") + " " + left.score + " - " + right.score + " " + (right.name || right.abbreviation || "Équipe 2")
    : (left.name || left.abbreviation || "Équipe 1") + " vs " + (right.name || right.abbreviation || "Équipe 2");

  return [
    score,
    e.date ? "Date : " + e.date : "",
    e.status ? "Statut : " + e.status : "",
    e.venue ? "Lieu : " + e.venue : "",
    e.source_url ? "URL : " + e.source_url : "",
  ].filter(Boolean).join(" | ");
}

function advFormatSportsData(sports) {
  if (!sports || !sports.sources || !sports.sources.length) return "";

  const lines = [
    "DONNÉES SPORTIVES STRUCTURÉES",
    "Vérifié le : " + sports.checked_at,
    "Consigne : utiliser ces données structurées en priorité pour les scores, calendriers, matchs passés et à venir. Si elles sont vides ou incomplètes, compléter avec les sources web lues.",
    "",
  ];

  for (const src of sports.sources) {
    lines.push("SOURCE SPORT : " + src.source);
    lines.push("Contrôle : " + (src.checked_at || sports.checked_at));

    if (src.live && src.live.length) {
      lines.push("Matchs en direct :");
      src.live.forEach((e) => lines.push("- " + advFormatMatch(e)));
    }

    if (src.past && src.past.length) {
      lines.push("Derniers matchs terminés :");
      src.past.forEach((e) => lines.push("- " + advFormatMatch(e)));
    }

    if (src.upcoming && src.upcoming.length) {
      lines.push("Matchs à venir :");
      src.upcoming.forEach((e) => lines.push("- " + advFormatMatch(e)));
    }

    if (src.matches && src.matches.length) {
      lines.push("Matches football-data.org : " + src.matches.length + " match(s) récupéré(s).");
      src.matches.slice(0, 20).forEach((m) => {
        lines.push("- " + [
          m.utcDate,
          m.homeTeam?.name,
          m.score?.fullTime ? (m.score.fullTime.home + "-" + m.score.fullTime.away) : "vs",
          m.awayTeam?.name,
          m.status,
        ].filter(Boolean).join(" "));
      });
    }

    if (src.standings && src.standings.length) {
      lines.push("Classements football-data.org récupérés : " + src.standings.length + " groupe(s)/table(s).");
    }

    lines.push("");
  }

  return lines.join("\n");
}

// Remplacement avancé de liveSearch : multi-sources + lecture + sport.
async function liveSearch(query, options = {}) {
  const maxResults = Math.max(4, Math.min(Number(options.max_results || 10), 15));
  const readTop = Math.max(3, Math.min(Number(options.read_top || 7), 10));

  let results = await advMultiSearch(query, maxResults);

  const seen = new Set();
  results = results.filter((r) => {
    const u = normalizeResultUrl(r.url || "");
    if (!u || seen.has(u)) return false;
    seen.add(u);
    r.url = u;
    return true;
  }).slice(0, maxResults);

  if (options.deep !== false) {
    for (let i = 0; i < Math.min(results.length, readTop); i++) {
      try {
        const page = await readUrl(results[i].url, advIsWorldCupQuery(query) ? 6500 : 8000);
        results[i].page_title = page.title || results[i].title;
        results[i].page_text = page.text;
        results[i].checked_at = page.fetched_at;
      } catch (e) {
        results[i].read_error = e.message;
      }
    }
  }

  const sports = await advSportsData(query);

  return {
    query,
    checked_at: new Date().toISOString(),
    mode: "advanced_multi_source",
    classification: {
      sports: advIsSportsQuery(query),
      world_cup: advIsWorldCupQuery(query),
      news_or_research: advIsNewsOrResearchQuery(query),
    },
    sports,
    results,
  };
}

// Remplacement avancé de formatWebContext : synthèse guidée + regroupement.
function formatWebContext(payload, clientContext) {
  const lines = [
    "RECHERCHE WEB AVANCÉE MULTI-SOURCES",
    "Requête : " + payload.query,
    "Mode : " + (payload.mode || "advanced"),
    "Vérifié le : " + payload.checked_at,
    clientContext ? "Contexte utilisateur : " + clientContext : "",
    "",
    "RÈGLES DE SYNTHÈSE POUR L'IA :",
    "- Regrouper les informations par thème : résultats, calendrier, classement, faits clés, sources, limites.",
    "- Pour les actualités : distinguer faits confirmés, informations récentes, incertitudes et sources consultées.",
    "- Pour le sport : séparer matchs passés, matchs en direct, matchs à venir, classement si disponible.",
    "- Croiser les sources lorsque plusieurs sources donnent la même information.",
    "- Signaler clairement les contradictions ou l'absence de données fiables.",
    "- Citer les URLs importantes utilisées.",
    "",
  ].filter(Boolean);

  const sportsBlock = advFormatSportsData(payload.sports);
  if (sportsBlock) {
    lines.push(sportsBlock);
    lines.push("");
  }

  if (!payload.results || !payload.results.length) {
    lines.push("Aucun résultat web exploitable trouvé par la recherche générale.");
    return lines.join("\n");
  }

  lines.push("SOURCES WEB LUES / CONSULTÉES :");

  payload.results.forEach((r, i) => {
    lines.push("SOURCE WEB " + (i + 1));
    lines.push("Titre : " + (r.page_title || r.title || "Sans titre"));
    lines.push("URL : " + r.url);
    lines.push("Moteur/source : " + (r.source || "Web"));
    if (r.published_at) lines.push("Date source : " + r.published_at);
    if (r.snippet) lines.push("Extrait recherche : " + r.snippet);
    if (r.page_text) lines.push("Contenu lu : " + r.page_text.slice(0, 7000));
    if (r.read_error) lines.push("Lecture page : impossible (" + r.read_error + ")");
    lines.push("");
  });

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// ROUTES PUBLIQUES / ADMIN / UTILISATEUR
// ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  ok(res, {
    configured: !!adminSecret(),
    mistral_keys_available: mistralKeys().length,
    version: "3.1.0-secure-advanced-web-research",
  });
});


// Diagnostic admin sans exposer la clé.
// Utile si Render dit "clé admin incorrecte".
app.get("/api/admin/status", (req, res) => {
  const hasEnvAdmin = !!String(process.env.ADMIN_KEY || "").trim();
  const hasDbAdmin = !!String(getConfig("admin_key") || "").trim();

  ok(res, {
    configured: !!adminSecret(),
    source: hasEnvAdmin ? "ENV_ADMIN_KEY" : (hasDbAdmin ? "SQLITE_CONFIG" : "NONE"),
    admin_key_length: adminSecret() ? adminSecret().length : 0,
    note: "La clé n'est jamais affichée pour des raisons de sécurité."
  });
});

app.post("/api/admin/setup", (req, res) => {
  const key = String(req.body?.key || "").trim().replace(/^[\"\']|[\"\']$/g, "").trim();
  if (!key || key.length < 8) return fail(res, "Clé admin manquante ou trop courte. Minimum 8 caractères.");
  if (adminSecret()) return fail(res, "L'accès admin est déjà configuré.", 409);

  setConfig("admin_key", key);
  const session = createSession("admin", "admin", 12);
  ok(res, { role: "admin", session_token: session.token, expires_at: session.expires_at }, "Accès administrateur configuré.");
});

app.post("/api/admin/login", (req, res) => {
  const key = String(req.body?.key || "").trim().replace(/^[\"\']|[\"\']$/g, "").trim();
  if (!key) return fail(res, "Clé admin manquante.");

  const stored = adminSecret();
  if (!stored) setConfig("admin_key", key);
  else if (key !== stored) return fail(res, "Clé admin incorrecte.", 401);

  const session = createSession("admin", "admin", 12);
  ok(res, { role: "admin", session_token: session.token, expires_at: session.expires_at });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (!username || !password) return fail(res, "Identifiants manquants.");
  if (!adminSecret()) return fail(res, "L'administrateur n'a pas encore configuré son accès. Veuillez le contacter.", 503);

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) return fail(res, "Nom d'utilisateur ou mot de passe incorrect.", 401);
  if (user.status === "paused") return fail(res, "Votre accès est temporairement suspendu. Contactez l'administrateur.", 403);

  if (user.expires_at) {
    const exp = new Date(user.expires_at);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (exp < today) return fail(res, "Votre accès a expiré le " + exp.toLocaleDateString("fr-FR") + ". Contactez l'administrateur.", 403);
  }

  db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?").run(user.id);
  const session = createSession(user.id, "user", Number(process.env.MYF_USER_SESSION_HOURS || 12));

  ok(res, {
    username: user.username,
    fullname: user.fullname || user.username,
    role: "user",
    session_token: session.token,
    expires_at: session.expires_at,
  });
});

app.get("/api/admin/users", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = db.prepare(`
    SELECT id, username, fullname, status, expires_at, created_at, last_login
    FROM users ORDER BY created_at DESC
  `).all();
  ok(res, { users });
});

app.post("/api/admin/users", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const fullname = String(req.body?.fullname || username).trim();
  const expiresAt = req.body?.expires_at || null;

  if (!username || !password) return fail(res, "Nom d'utilisateur et mot de passe requis.");
  if (db.prepare("SELECT id FROM users WHERE username = ?").get(username)) return fail(res, "Ce nom d'utilisateur existe déjà.");

  const userId = id();
  db.prepare(`
    INSERT INTO users (id, username, password, fullname, status, expires_at)
    VALUES (?, ?, ?, ?, 'active', ?)
  `).run(userId, username, bcrypt.hashSync(password, 10), fullname, expiresAt);

  ok(res, { id: userId }, "Utilisateur créé avec succès.");
});

app.patch("/api/admin/users/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const userId = req.params.id;
  const op = req.body?.op;

  if (!db.prepare("SELECT id FROM users WHERE id = ?").get(userId)) return fail(res, "Utilisateur introuvable.", 404);

  if (op === "pause") db.prepare("UPDATE users SET status = 'paused' WHERE id = ?").run(userId);
  else if (op === "resume") db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(userId);
  else if (op === "set_expiry") db.prepare("UPDATE users SET expires_at = ? WHERE id = ?").run(req.body?.expires_at || null, userId);
  else if (op === "reset_password") {
    if (!req.body?.new_password) return fail(res, "Nouveau mot de passe requis.");
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(bcrypt.hashSync(String(req.body.new_password), 10), userId);
  } else return fail(res, "Opération inconnue.");

  ok(res, {}, "Mise à jour effectuée.");
});

app.delete("/api/admin/users/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  ok(res, {}, "Utilisateur supprimé.");
});

app.post("/api/admin/mistral-keys", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const incoming = Array.isArray(req.body?.keys) ? req.body.keys : splitKeys(req.body?.keys || "");
  const keys = unique(incoming.map(String).map((v) => v.trim()).filter(Boolean));

  if (!keys.length) {
    setConfig("mistral_keys", JSON.stringify([]));
    return ok(res, { count: 0 }, "Clés Mistral secondaires supprimées.");
  }

  const valid = [];
  const invalid = [];

  for (const key of keys) {
    try {
      const response = await fetch("https://api.mistral.ai/v1/models", { headers: { Authorization: "Bearer " + key } });
      if (response.ok) valid.push(key);
      else invalid.push(keyHash(key));
    } catch (_) {
      invalid.push(keyHash(key));
    }
  }

  setConfig("mistral_keys", JSON.stringify(valid));
  ok(res, { count: valid.length, invalid }, "Clés Mistral mises à jour.");
});

// ─────────────────────────────────────────────────────────────
// ROUTES IA PROTÉGÉES
// ─────────────────────────────────────────────────────────────
app.post("/api/ai-stream", async (req, res) => {
  if (!requireAppAccess(req, res)) return;

  try {
    const model = sanitizeModel(req.body?.model);
    const system = String(req.body?.system || "").slice(0, 30000);
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const clean = messages
      .filter((m) => m && ["user", "assistant", "system"].includes(m.role) && typeof m.content === "string")
      .slice(-20)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 30000) }));

    const finalMessages = [];
    if (system) finalMessages.push({ role: "system", content: system });
    finalMessages.push(...clean);

    if (!finalMessages.length) return fail(res, "Message IA manquant.");

    const mistralResponse = await openMistralStream({
      model,
      messages: finalMessages,
      max_tokens: clamp(req.body?.max_tokens, 128, 4000, 2600),
      temperature: clamp(req.body?.temperature, 0, 1.2, 0.7),
      stream: true,
    });

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    mistralResponse.body.on("data", (chunk) => res.write(chunk));
    mistralResponse.body.on("end", () => res.end());
    mistralResponse.body.on("error", (err) => {
      try { res.write("data: " + JSON.stringify({ error: err.message || String(err) }) + "\n\n"); } catch (_) {}
      res.end();
    });
  } catch (e) {
    fail(res, e.message || "Erreur IA.", e.status || 500);
  }
});

app.post("/api/generate-image", async (req, res) => {
  if (!requireAppAccess(req, res)) return;

  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return fail(res, "Prompt image manquant.");
    if (prompt.length > 6000) return fail(res, "Prompt trop long. Limitez-le à 6000 caractères.");

    ok(res, await generateImage(prompt));
  } catch (e) {
    if (e.status === 429 || isRateLimit(e.message)) return fail(res, "Limite génération image atteint", 429);
    fail(res, e.message || "Erreur image.", 500);
  }
});

app.post("/api/live-time", (req, res) => {
  if (!requireAppAccess(req, res)) return;
  const client = req.body?.client || {};
  ok(res, { server_iso: new Date().toISOString(), context: timeContext(client) });
});

app.post("/api/read-url", async (req, res) => {
  if (!requireAppAccess(req, res)) return;

  try {
    ok(res, await readUrl(req.body?.url, Number(req.body?.max_chars || 9000)));
  } catch (e) {
    fail(res, "Lecture URL impossible : " + e.message, 400);
  }
});

app.post("/api/live-search", async (req, res) => {
  if (!requireAppAccess(req, res)) return;

  try {
    const query = String(req.body?.query || "").trim();
    if (!query) return fail(res, "Requête web manquante.");

    const payload = await liveSearch(query, {
      max_results: req.body?.max_results || 6,
      read_top: req.body?.read_top || 4,
      deep: req.body?.deep !== false,
    });

    const ctx = timeContext(req.body?.client || {});
    ok(res, {
      query,
      checked_at: payload.checked_at,
      results: payload.results,
      context_text: formatWebContext(payload, ctx),
      time_context: ctx,
      provider: process.env.BRAVE_SEARCH_API_KEY ? "Brave Search + fallback" : "DuckDuckGo/GDELT fallback",
    });
  } catch (e) {
    fail(res, "Recherche web impossible : " + e.message, 500);
  }
});

// ─────────────────────────────────────────────────────────────
// FALLBACK SPA + DÉMARRAGE
// ─────────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log("✅ Agent IA de MYF — serveur sécurisé démarré sur le port " + PORT);
  console.log("📂 Base SQLite : " + DB_PATH);
  console.log("🔑 Clés Mistral côté serveur : " + mistralKeys().length);
});
