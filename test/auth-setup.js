const assert = require('assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForHealth(base, child, logs) {
  for (let i = 0; i < 40; i++) {
    if (child.exitCode != null) throw new Error(`server exited early\n${logs.join('')}`);
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not become healthy\n${logs.join('')}`);
}

async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-auth-'));
  const port = await freePort();
  const dbPath = path.join(dir, 'database.sqlite');
  const logs = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      APP_PASSWORD: '',
      DB_PATH: dbPath,
      PORT: String(port),
      SESSION_SECRET: 'test-session-secret',
      TRUST_PROXY: '',
      PUBLIC_ORIGIN: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base, child, logs);
  return {
    base,
    dbPath,
    stop: async () => {
      if (child.exitCode == null) {
        child.kill('SIGTERM');
        await new Promise((resolve) => child.once('exit', resolve));
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function json(res) {
  return res.json().catch(() => ({}));
}

(async () => {
  const password = 'correct horse battery staple';
  let srv = await startServer();
  try {
    let res = await fetch(`${srv.base}/api/setup/status`);
    let body = await json(res);
    assert.equal(res.status, 200);
    assert.equal(body.setupRequired, true);
    assert.equal(body.storedPasswordConfigured, false);

    res = await fetch(`${srv.base}/`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/setup.html');

    res = await fetch(`${srv.base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    body = await json(res);
    assert.equal(res.status, 428);
    assert.equal(body.setupRequired, true);

    res = await fetch(`${srv.base}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'password' }),
    });
    assert.equal(res.status, 400);

    res = await fetch(`${srv.base}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    body = await json(res);
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.match(res.headers.get('set-cookie') || '', /auth_token=/);

    res = await fetch(`${srv.base}/api/setup/status`);
    body = await json(res);
    assert.equal(body.setupRequired, false);
    assert.equal(body.storedPasswordConfigured, true);

    res = await fetch(`${srv.base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    body = await json(res);
    assert.equal(res.status, 200);
    assert.equal(body.success, true);

    const db = new Database(srv.dbPath, { readonly: true });
    const row = db.prepare("SELECT value FROM settings WHERE key = 'password_hash_v1'").get();
    db.close();
    assert.ok(row && row.value);
    assert.equal(row.value.includes(password), false);
    assert.equal(JSON.parse(row.value).alg, 'scrypt');

    res = await fetch(`${srv.base}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'another strong password' }),
    });
    assert.equal(res.status, 409);
  } finally {
    await srv.stop();
  }

  srv = await startServer({ APP_PASSWORD: password });
  try {
    const res = await fetch(`${srv.base}/api/setup/status`);
    const body = await json(res);
    assert.equal(body.setupRequired, false);
    assert.equal(body.envPasswordConfigured, true);

    const login = await fetch(`${srv.base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    assert.equal(login.status, 200);
  } finally {
    await srv.stop();
  }

  srv = await startServer({ APP_PASSWORD: password, TRUST_PROXY: '1' });
  try {
    const login = await fetch(`${srv.base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify({ password }),
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie') || '', /;\s*Secure/i);
  } finally {
    await srv.stop();
  }

  console.log('Auth setup: OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
