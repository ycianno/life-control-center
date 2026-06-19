const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');

const APP_PASSWORD = process.env.APP_PASSWORD || 'changeme';

const app = express();
const port = process.env.PORT || 3007;
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'database.sqlite');

// Ensure data directory exists
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new Database(dbPath);

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

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser(SESSION_SECRET));

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

// Unauthenticated liveness probe (Docker HEALTHCHECK / orchestrators).
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

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
  if (password === APP_PASSWORD) {
    loginAttempts.delete(clientIp(req));
    res.cookie('auth_token', 'ok', { signed: true, httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 }); // 30 days, signed
    res.json({ success: true });
  } else {
    const ip = clientIp(req);
    const rec = loginAttempts.get(ip);
    if (rec) rec.count++; else loginAttempts.set(ip, { count: 1, first: Date.now() });
    res.status(401).json({ success: false, message: 'Invalid password' });
  }
});

app.get('/api/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/login.html');
});

// Middleware to protect routes
const requireAuth = (req, res, next) => {
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

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/index.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use('/api/', requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoints
app.get('/api/database', (req, res) => {
  const rows = db.prepare('SELECT week_key, data FROM weeks').all();
  const weeks = {};
  rows.forEach(row => {
    weeks[row.week_key] = JSON.parse(row.data);
  });
  res.json({ version: 2, weeks });
});

app.post('/api/week/:key', (req, res) => {
  const { key } = req.params;
  const data = JSON.stringify(req.body);
  const info = db.prepare('INSERT OR REPLACE INTO weeks (week_key, data) VALUES (?, ?)').run(key, data);
  res.json({ success: true, changes: info.changes });
});

app.get('/api/settings', (req, res) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('app_settings');
  res.json(row ? JSON.parse(row.value) : { version: 3, dayTemplates: null });
});

app.post('/api/settings', (req, res) => {
  const value = JSON.stringify(req.body);
  const info = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('app_settings', value);
  res.json({ success: true, changes: info.changes });
});

// Runtime hints for the UI (authenticated). Used to nag about the default password.
app.get('/api/config', (req, res) => {
  res.json({ defaultPassword: APP_PASSWORD === 'changeme' });
});

// Achievement endpoints
app.get('/api/achievements', (req, res) => {
  const rows = db.prepare('SELECT * FROM achievements ORDER BY completed_at DESC').all();
  res.json(rows);
});

app.post('/api/achievements', (req, res) => {
  const { title, category, completed_at, notes, week_key } = req.body;
  const info = db.prepare(
    'INSERT INTO achievements (title, category, completed_at, notes, week_key) VALUES (?, ?, ?, ?, ?)'
  ).run(title, category || 'certification', completed_at || new Date().toISOString(), notes || '', week_key || '');
  res.json({ success: true, id: info.lastInsertRowid });
});

app.delete('/api/achievements/:id', (req, res) => {
  db.prepare('DELETE FROM achievements WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===== Web Push =====
app.get('/api/push/key', (req, res) => {
  res.json({ key: VAPID.publicKey });
});
app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'invalid subscription' });
  db.prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, sub, created_at) VALUES (?, ?, ?)")
    .run(sub.endpoint, JSON.stringify(sub), new Date().toISOString());
  res.json({ success: true });
});
app.post('/api/push/unsubscribe', (req, res) => {
  if (req.body && req.body.endpoint) {
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(req.body.endpoint);
  }
  res.json({ success: true });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`The Forge running at http://0.0.0.0:${port}`);
});
