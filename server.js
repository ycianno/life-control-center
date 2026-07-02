const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const webpush = require('web-push');

// Load a local .env file if present (zero-dependency). Real environment
// variables always win; this just makes a bare-metal `npm start` pick up the
// password written by install.sh. Docker passes env directly, so .env is absent
// there and this is a no-op.
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
} catch (e) { /* ignore malformed .env */ }

const ENV_APP_PASSWORD = process.env.APP_PASSWORD || '';
const APP_PASSWORD = ENV_APP_PASSWORD || 'changeme';
const UNSAFE_PASSWORDS = new Set([
  '',
  'admin',
  'changeme',
  'change-me',
  'change-this-password',
  'password',
  'please-change-me',
  'replace-me',
  'replace-me-with-a-long-password',
  'the-forge',
]);
const isUnsafePassword = (value) => UNSAFE_PASSWORDS.has(String(value || '').trim().toLowerCase());
const PASSWORD_HASH_KEY = 'password_hash_v1';
const PASSWORD_MIN_LENGTH = 10;
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const hasSafeEnvPassword = () => Boolean(ENV_APP_PASSWORD) && !isUnsafePassword(ENV_APP_PASSWORD);

const app = express();
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
if (TRUST_PROXY) app.set('trust proxy', 1);
const port = process.env.PORT || 3007;
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'database.sqlite');

// Ensure data directory exists
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new Database(dbPath);
try {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
} catch (e) {
  console.warn(`SQLite runtime tuning skipped: ${e.message}`);
}

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS weeks (
    week_key TEXT PRIMARY KEY,
    data TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'certification',
    completed_at TEXT NOT NULL,
    notes TEXT,
    week_key TEXT
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    sub TEXT,
    created_at TEXT
  );
`);

// Idempotent schema migration: add the richer Record columns if they don't exist.
// All new columns are nullable / defaulted so existing rows are untouched. `meta`
// is a JSON catch-all so future record kinds need no further migration.
(function migrate() {
  const cols = db.prepare('PRAGMA table_info(achievements)').all().map((c) => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE achievements ADD COLUMN ${ddl}`); };
  add('value', 'value REAL');
  add('unit', 'unit TEXT');
  add('tags', 'tags TEXT');
  add('pinned', 'pinned INTEGER DEFAULT 0');
  add('source', "source TEXT DEFAULT 'manual'");
  add('ext_key', 'ext_key TEXT');
  add('meta', 'meta TEXT');
})();

// Persisted random secret used to sign the session cookie (survives restarts).
function getSessionSecret() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'session_secret'").get();
  if (row && row.value) return row.value;
  const secret = require('crypto').randomBytes(48).toString('hex');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('session_secret', ?)").run(secret);
  return secret;
}
const SESSION_SECRET = process.env.SESSION_SECRET || getSessionSecret();

// Persisted VAPID keys for Web Push (generated once, survive restarts).
function getVapid() {
  const pub = db.prepare("SELECT value FROM settings WHERE key = 'vapid_public'").get();
  const priv = db.prepare("SELECT value FROM settings WHERE key = 'vapid_private'").get();
  if (pub && priv) return { publicKey: pub.value, privateKey: priv.value };
  const keys = webpush.generateVAPIDKeys();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_public', ?)").run(keys.publicKey);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vapid_private', ?)").run(keys.privateKey);
  return keys;
}
const VAPID = getVapid();
webpush.setVapidDetails('mailto:forge@example.com', VAPID.publicKey, VAPID.privateKey);

function getStoredPasswordHash() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(PASSWORD_HASH_KEY);
  if (!row || !row.value) return null;
  try { return JSON.parse(row.value); } catch (_) { return null; }
}
function hasStoredPassword() {
  return Boolean(getStoredPasswordHash());
}
function setupRequired() {
  return !hasSafeEnvPassword() && !hasStoredPassword();
}
function passwordSetupError(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > 256) return 'Password is too long.';
  if (isUnsafePassword(password)) return 'Choose a unique password, not a setup placeholder.';
  return '';
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { alg: 'scrypt', salt, hash };
}
function safeStringEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function verifyStoredPassword(password, record) {
  if (!record || record.alg !== 'scrypt' || !record.salt || !record.hash) return false;
  const expected = Buffer.from(record.hash, 'hex');
  const actual = crypto.scryptSync(password, record.salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function verifyPassword(password) {
  if (typeof password !== 'string') return false;
  if (hasSafeEnvPassword() && safeStringEqual(password, ENV_APP_PASSWORD)) return true;
  const stored = getStoredPasswordHash();
  return verifyStoredPassword(password, stored);
}
function authCookieOptions(req) {
  return {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_MAX_AGE_MS,
  };
}
function clearAuthCookieOptions(req) {
  const opts = authCookieOptions(req);
  delete opts.maxAge;
  return opts;
}

const MAX_WEEK_BYTES = 1024 * 1024;
const MAX_SETTINGS_BYTES = 2 * 1024 * 1024;
const MAX_PUSH_BYTES = 32 * 1024;
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const MAX_BACKUP_WEEKS = 2000;
const MAX_BACKUP_ACHIEVEMENTS = 5000;
const JSON_BODY_LIMIT = '12mb';
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PUBLIC_ORIGIN = normalizeOrigin(process.env.PUBLIC_ORIGIN || '');
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function normalizeOrigin(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value).trim());
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return '';
  }
}
function isValidDateKey(value) {
  if (typeof value !== 'string') return false;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
function hasUnsafeKeys(value, depth = 0) {
  if (depth > 30) return true;
  if (Array.isArray(value)) return value.some((item) => hasUnsafeKeys(item, depth + 1));
  if (!isPlainObject(value)) return false;
  return Object.keys(value).some((key) => UNSAFE_OBJECT_KEYS.has(key) || hasUnsafeKeys(value[key], depth + 1));
}
function jsonByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
function validationError(res, message) {
  return res.status(400).json({ error: message });
}
function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}
function optionalString(value, max, field) {
  if (value == null) return '';
  if (typeof value !== 'string') return `${field} must be a string.`;
  if (value.length > max) return `${field} is too long.`;
  return '';
}
function validateWeekPayload(key, body) {
  if (!isValidDateKey(key)) return 'week key must be a valid YYYY-MM-DD date.';
  if (!isPlainObject(body)) return 'week payload must be an object.';
  if (hasUnsafeKeys(body)) return 'payload contains unsafe object keys.';
  if (jsonByteLength(body) > MAX_WEEK_BYTES) return 'week payload is too large.';
  if ('checks' in body && !isPlainObject(body.checks)) return 'checks must be an object.';
  if ('fields' in body && !isPlainObject(body.fields)) return 'fields must be an object.';
  for (const [id, value] of Object.entries(body.checks || {})) {
    if (typeof id !== 'string' || id.length > 180) return 'check ids must be short strings.';
    if (typeof value !== 'boolean') return 'check values must be booleans.';
  }
  for (const [id, value] of Object.entries(body.fields || {})) {
    if (typeof id !== 'string' || id.length > 180) return 'field ids must be short strings.';
    if (!(value == null || ['string', 'number', 'boolean'].includes(typeof value))) return 'field values must be primitive.';
    if (typeof value === 'number' && !Number.isFinite(value)) return 'field numbers must be finite.';
    if (typeof value === 'string' && value.length > 20000) return 'field values are too long.';
  }
  return '';
}
function validateSettingsPayload(body) {
  if (!isPlainObject(body)) return 'settings payload must be an object.';
  if (hasUnsafeKeys(body)) return 'settings contain unsafe object keys.';
  if (jsonByteLength(body) > MAX_SETTINGS_BYTES) return 'settings payload is too large.';
  if ('version' in body && !(typeof body.version === 'number' && Number.isFinite(body.version))) return 'settings version must be a number.';
  return '';
}
function validateIdParam(id) {
  return /^\d+$/.test(String(id || ''));
}
function validateAchievementPayload(body, partial = false) {
  if (!isPlainObject(body)) return 'record payload must be an object.';
  if (hasUnsafeKeys(body)) return 'record contains unsafe object keys.';
  if (!partial || 'title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim()) return 'title is required.';
    if (body.title.length > 160) return 'title is too long.';
  }
  for (const [field, max] of [['category', 64], ['notes', 20000], ['unit', 32], ['tags', 1000], ['source', 32], ['ext_key', 240], ['meta', 20000]]) {
    const err = optionalString(body[field], max, field);
    if (err) return err;
  }
  if ('completed_at' in body && body.completed_at != null) {
    if (typeof body.completed_at !== 'string' || Number.isNaN(Date.parse(body.completed_at))) return 'completed_at must be a valid date.';
  }
  if ('week_key' in body && body.week_key) {
    if (!isValidDateKey(body.week_key)) return 'week_key must be a valid YYYY-MM-DD date.';
  }
  if ('value' in body && body.value !== '' && body.value != null && !Number.isFinite(Number(body.value))) return 'value must be numeric.';
  if ('pinned' in body && !(typeof body.pinned === 'boolean' || body.pinned === 0 || body.pinned === 1)) return 'pinned must be a boolean.';
  return '';
}
function validatePushSubscription(sub) {
  if (!isPlainObject(sub)) return 'subscription must be an object.';
  if (hasUnsafeKeys(sub)) return 'subscription contains unsafe object keys.';
  if (jsonByteLength(sub) > MAX_PUSH_BYTES) return 'subscription payload is too large.';
  if (typeof sub.endpoint !== 'string' || sub.endpoint.length > 2048) return 'subscription endpoint is invalid.';
  try {
    const url = new URL(sub.endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) return 'subscription endpoint is invalid.';
  } catch (_) {
    return 'subscription endpoint is invalid.';
  }
  if (!isPlainObject(sub.keys)) return 'subscription keys are required.';
  for (const key of ['p256dh', 'auth']) {
    if (typeof sub.keys[key] !== 'string' || !sub.keys[key] || sub.keys[key].length > 512) return 'subscription keys are invalid.';
  }
  return '';
}
function getAppSettings() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('app_settings');
  const value = row ? parseJson(row.value) : null;
  return isPlainObject(value) ? value : { version: 3, dayTemplates: null };
}
function readWeeksSnapshot() {
  const rows = db.prepare('SELECT week_key, data FROM weeks ORDER BY week_key').all();
  const weeks = {};
  const invalidWeeks = [];
  rows.forEach((row) => {
    const value = parseJson(row.data);
    if (isPlainObject(value)) weeks[row.week_key] = value;
    else invalidWeeks.push(row.week_key);
  });
  return { weeks, invalidWeeks };
}
function readAchievementsSnapshot() {
  return db.prepare('SELECT * FROM achievements ORDER BY completed_at DESC').all();
}
function buildBackupSnapshot(extra = {}) {
  const { weeks, invalidWeeks } = readWeeksSnapshot();
  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'The Forge',
    version: 3,
    backupVersion: 1,
    database: { version: 2, weeks },
    settings: getAppSettings(),
    achievements: readAchievementsSnapshot(),
    ...extra,
  };
  if (invalidWeeks.length) payload.invalidWeeks = invalidWeeks;
  return payload;
}
function normalizeBackupPayload(payload) {
  if (!isPlainObject(payload)) return { error: 'backup payload must be an object.' };
  if (hasUnsafeKeys(payload)) return { error: 'backup contains unsafe object keys.' };
  if (jsonByteLength(payload) > MAX_BACKUP_BYTES) return { error: 'backup payload is too large.' };

  const incomingDb = payload.database || payload;
  if (!isPlainObject(incomingDb) || !isPlainObject(incomingDb.weeks)) return { error: 'backup database.weeks must be an object.' };
  const weekEntries = Object.entries(incomingDb.weeks);
  if (weekEntries.length > MAX_BACKUP_WEEKS) return { error: 'backup contains too many weeks.' };
  const weeks = {};
  for (const [key, data] of weekEntries) {
    const invalid = validateWeekPayload(key, data);
    if (invalid) return { error: `backup week ${key}: ${invalid}` };
    weeks[key] = data;
  }

  let settings = null;
  if ('settings' in payload) {
    if (!isPlainObject(payload.settings)) return { error: 'backup settings must be an object.' };
    settings = { version: 3, dayTemplates: null, ...payload.settings };
    const invalid = validateSettingsPayload(settings);
    if (invalid) return { error: `backup settings: ${invalid}` };
  }

  let achievements = null;
  if ('achievements' in payload) {
    if (!Array.isArray(payload.achievements)) return { error: 'backup achievements must be an array.' };
    if (payload.achievements.length > MAX_BACKUP_ACHIEVEMENTS) return { error: 'backup contains too many records.' };
    achievements = [];
    const ids = new Set();
    for (const item of payload.achievements) {
      const invalid = validateAchievementPayload(item);
      if (invalid) return { error: `backup record: ${invalid}` };
      if ('id' in item && item.id != null) {
        const numericId = Number(item.id);
        if (!validateIdParam(item.id) || !Number.isSafeInteger(numericId) || numericId < 1) return { error: 'backup record id is invalid.' };
        const id = String(numericId);
        if (ids.has(id)) return { error: 'backup record ids must be unique.' };
        ids.add(id);
      }
      achievements.push(item);
    }
  }

  return { weeks, settings, achievements };
}
const importBackupTransaction = db.transaction(({ weeks, settings, achievements }) => {
  db.prepare('DELETE FROM weeks').run();
  const insertWeek = db.prepare('INSERT INTO weeks (week_key, data) VALUES (?, ?)');
  for (const [key, data] of Object.entries(weeks)) insertWeek.run(key, JSON.stringify(data));

  if (settings) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('app_settings', JSON.stringify(settings));
  }

  if (achievements) {
    db.prepare('DELETE FROM achievements').run();
    const insertAchievement = db.prepare(
      `INSERT INTO achievements (id, title, category, completed_at, notes, week_key, value, unit, tags, pinned, source, ext_key, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const a of achievements) {
      insertAchievement.run(
        a.id || null,
        a.title,
        a.category || 'certification',
        a.completed_at || new Date().toISOString(),
        a.notes || '',
        a.week_key || '',
        (a.value === '' || a.value == null) ? null : Number(a.value),
        a.unit || null,
        a.tags || null,
        a.pinned ? 1 : 0,
        a.source || 'manual',
        a.ext_key || null,
        a.meta || null
      );
    }
  }
});
function originAllowed(req) {
  const originHeader = req.get('origin');
  if (!originHeader) return true;
  const origin = normalizeOrigin(originHeader);
  if (!origin) return false;
  if (PUBLIC_ORIGIN && origin === PUBLIC_ORIGIN) return true;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const requestHost = String(req.get('host') || '').toLowerCase();
    return Boolean(requestHost) && originHost === requestHost;
  } catch (_) {
    return false;
  }
}
function sameOriginWriteGuard(req, res, next) {
  if (!WRITE_METHODS.has(req.method) || originAllowed(req)) return next();
  return res.status(403).json({ error: 'Cross-origin write requests are not allowed.' });
}

// Security headers (no external deps). style-src keeps 'unsafe-inline' because the
// UI relies on inline style attributes; scripts are all same-origin files.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  next();
});

app.use(sameOriginWriteGuard);
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON request body.' });
  }
  return next(err);
});
app.use(cookieParser(SESSION_SECRET));

// Unauthenticated liveness probe (Docker HEALTHCHECK / orchestrators).
app.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch (_) {
    res.status(503).json({ status: 'error' });
  }
});

// --- Brute-force protection for /api/login (in-memory, per source IP) ---
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const loginAttempts = new Map(); // ip -> { count, first }
const clientIp = (req) => req.socket.remoteAddress || 'unknown';
function loginLimiter(req, res, next) {
  const ip = clientIp(req);
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (rec && now - rec.first > LOGIN_WINDOW_MS) loginAttempts.delete(ip);
  const cur = loginAttempts.get(ip);
  if (cur && cur.count >= LOGIN_MAX_ATTEMPTS) {
    const retry = Math.ceil((LOGIN_WINDOW_MS - (now - cur.first)) / 1000);
    res.setHeader('Retry-After', String(retry));
    return res.status(429).json({ success: false, message: `Too many attempts. Try again in ${Math.ceil(retry / 60)} min.` });
  }
  next();
}

app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  if (setupRequired()) {
    return res.status(428).json({ success: false, setupRequired: true, message: 'Password setup required' });
  }
  if (verifyPassword(password)) {
    loginAttempts.delete(clientIp(req));
    res.cookie('auth_token', 'ok', authCookieOptions(req));
    res.json({ success: true });
  } else {
    const ip = clientIp(req);
    const rec = loginAttempts.get(ip);
    if (rec) rec.count++; else loginAttempts.set(ip, { count: 1, first: Date.now() });
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

app.get('/api/logout', (req, res) => {
  res.clearCookie('auth_token', clearAuthCookieOptions(req));
  res.redirect('/login.html');
});

// Middleware to protect routes
const requireAuth = (req, res, next) => {
  if (setupRequired()) {
    if (req.path.startsWith('/api/')) {
      return res.status(428).json({ error: 'Setup required', setupRequired: true });
    }
    return res.redirect('/setup.html');
  }
  if (req.signedCookies.auth_token === 'ok') {
    next();
  } else {
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Unauthorized' });
    } else {
      res.redirect('/login.html');
    }
  }
};

// The shell HTML must always revalidate, or clients stay pinned to a stale
// index that references old asset versions (the cause of "fixes don't show").
const noHtmlCache = (res) => res.set('Cache-Control', 'no-cache, must-revalidate');
app.get('/', requireAuth, (req, res) => {
  noHtmlCache(res);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/index.html', requireAuth, (req, res) => {
  noHtmlCache(res);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// The service worker must NEVER be cached (Cloudflare/browser) — a stale sw.js
// keeps the whole app pinned to old cached assets. no-store keeps it off every
// cache layer so deploys propagate immediately.
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.get('/setup.html', (req, res) => {
  noHtmlCache(res);
  if (!setupRequired()) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});
app.get('/login.html', (req, res) => {
  noHtmlCache(res);
  if (setupRequired()) return res.redirect('/setup.html');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/api/setup/status', (req, res) => {
  res.json({
    setupRequired: setupRequired(),
    envPasswordConfigured: hasSafeEnvPassword(),
    storedPasswordConfigured: hasStoredPassword(),
    minLength: PASSWORD_MIN_LENGTH,
  });
});

app.post('/api/setup', (req, res) => {
  if (!setupRequired()) {
    return res.status(409).json({ success: false, message: 'Setup is already complete.' });
  }
  const { password } = req.body || {};
  const error = passwordSetupError(password);
  if (error) return res.status(400).json({ success: false, message: error });
  const value = JSON.stringify(hashPassword(password));
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(PASSWORD_HASH_KEY, value);
  res.cookie('auth_token', 'ok', authCookieOptions(req));
  res.json({ success: true });
});

app.use('/api/', requireAuth);
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // HTML (e.g. login.html) revalidates; manifest stays fresh. Versioned
    // ?v= assets (css/js/png) keep the default and are busted on each deploy.
    if (filePath.endsWith('.html') || filePath.endsWith('manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

// API Endpoints
app.get('/api/database', (req, res) => {
  const { weeks, invalidWeeks } = readWeeksSnapshot();
  const payload = { version: 2, weeks };
  if (invalidWeeks.length) payload.invalidWeeks = invalidWeeks;
  res.json(payload);
});

app.post('/api/week/:key', (req, res) => {
  const { key } = req.params;
  const invalid = validateWeekPayload(key, req.body);
  if (invalid) return validationError(res, invalid);
  const data = JSON.stringify(req.body);
  const info = db.prepare('INSERT OR REPLACE INTO weeks (week_key, data) VALUES (?, ?)').run(key, data);
  res.json({ success: true, changes: info.changes });
});

app.get('/api/settings', (req, res) => {
  res.json(getAppSettings());
});

app.post('/api/settings', (req, res) => {
  const invalid = validateSettingsPayload(req.body);
  if (invalid) return validationError(res, invalid);
  const value = JSON.stringify(req.body);
  const info = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('app_settings', value);
  res.json({ success: true, changes: info.changes });
});

app.get('/api/backup', (req, res) => {
  res.json(buildBackupSnapshot());
});

app.post('/api/backup', (req, res) => {
  const normalized = normalizeBackupPayload(req.body);
  if (normalized.error) return validationError(res, normalized.error);
  importBackupTransaction(normalized);
  res.json({ success: true, ...buildBackupSnapshot({
    imported: {
      weeks: Object.keys(normalized.weeks).length,
      settings: Boolean(normalized.settings),
      achievements: Array.isArray(normalized.achievements) ? normalized.achievements.length : null,
    },
  }) });
});

// Runtime hints for the UI (authenticated). Used to nag about the default password.
app.get('/api/config', (req, res) => {
  const needsSetup = setupRequired();
  res.json({
    defaultPassword: needsSetup && APP_PASSWORD === 'changeme',
    insecurePassword: needsSetup,
    setupRequired: needsSetup,
    envPasswordConfigured: hasSafeEnvPassword(),
    storedPasswordConfigured: hasStoredPassword(),
  });
});

// Achievement endpoints
app.get('/api/achievements', (req, res) => {
  res.json(readAchievementsSnapshot());
});

app.post('/api/achievements', (req, res) => {
  const invalid = validateAchievementPayload(req.body);
  if (invalid) return validationError(res, invalid);
  const { title, category, completed_at, notes, week_key, value, unit, tags, pinned, source, ext_key, meta } = req.body;
  // Auto records carry an ext_key and must never duplicate (server-side dedup).
  if (ext_key) {
    const dup = db.prepare('SELECT id FROM achievements WHERE ext_key = ?').get(ext_key);
    if (dup) return res.json({ success: true, id: dup.id, deduped: true });
  }
  const info = db.prepare(
    `INSERT INTO achievements (title, category, completed_at, notes, week_key, value, unit, tags, pinned, source, ext_key, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    title, category || 'certification', completed_at || new Date().toISOString(), notes || '', week_key || '',
    (value === '' || value == null) ? null : Number(value), unit || null, tags || null,
    pinned ? 1 : 0, source || 'manual', ext_key || null, meta || null
  );
  res.json({ success: true, id: info.lastInsertRowid });
});

// Edit a record (also used for pin toggle). Only updates fields that are sent.
app.put('/api/achievements/:id', (req, res) => {
  if (!validateIdParam(req.params.id)) return validationError(res, 'record id is invalid.');
  const invalid = validateAchievementPayload(req.body, true);
  if (invalid) return validationError(res, invalid);
  const allowed = ['title', 'category', 'completed_at', 'notes', 'value', 'unit', 'tags', 'pinned', 'meta'];
  const sets = [], vals = [];
  for (const k of allowed) {
    if (!(k in req.body)) continue;
    let v = req.body[k];
    if (k === 'pinned') v = v ? 1 : 0;
    if (k === 'value') v = (v === '' || v == null) ? null : Number(v);
    sets.push(`${k} = ?`); vals.push(v);
  }
  if (!sets.length) return res.json({ success: true, unchanged: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE achievements SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ success: true });
});

app.delete('/api/achievements/:id', (req, res) => {
  if (!validateIdParam(req.params.id)) return validationError(res, 'record id is invalid.');
  db.prepare('DELETE FROM achievements WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===== Web Push =====
app.get('/api/push/key', (req, res) => {
  res.json({ key: VAPID.publicKey });
});
app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  const invalid = validatePushSubscription(sub);
  if (invalid) return validationError(res, invalid);
  db.prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, sub, created_at) VALUES (?, ?, ?)")
    .run(sub.endpoint, JSON.stringify(sub), new Date().toISOString());
  res.json({ success: true });
});
app.post('/api/push/unsubscribe', (req, res) => {
  if (req.body && req.body.endpoint) {
    if (typeof req.body.endpoint !== 'string' || req.body.endpoint.length > 2048) return validationError(res, 'subscription endpoint is invalid.');
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(req.body.endpoint);
  }
  res.json({ success: true });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(err);
  const status = err.status || err.statusCode || 500;
  const message = status >= 500 ? 'Internal server error' : (err.message || 'Request failed');
  if (req.path.startsWith('/api/') || req.path === '/healthz') {
    return res.status(status).json({ error: message });
  }
  return res.status(status).type('text/plain').send(message);
});

const server = app.listen(port, '0.0.0.0', () => {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const amber = (s) => paint('38;5;208', s);
  const cyan = (s) => paint('36', s);
  const dim = (s) => paint('2', s);
  const bold = (s) => paint('1', s);
  console.log('');
  console.log('  ' + amber('⚒  T H E   F O R G E'));
  console.log('  ' + dim('─────────────────────────────────────'));
  console.log('  ' + bold('▸') + ' Open    ' + cyan(`http://localhost:${port}`));
  console.log('  ' + bold('▸') + ' Data    ' + dim(dbPath));
  console.log('  ' + bold('▸') + ' Stop    ' + dim('Ctrl+C'));
  if (setupRequired()) {
    console.log('');
    console.log('  ' + paint('33', '⚠  First-run setup required — open the app to create a password.'));
  } else if (!hasSafeEnvPassword() && isUnsafePassword(APP_PASSWORD)) {
    console.log('');
    console.log('  ' + paint('33', '⚠  Unsafe APP_PASSWORD ignored — using the stored setup password.'));
  }
  console.log('');
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
