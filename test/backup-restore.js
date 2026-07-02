const assert = require('assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PASSWORD = 'correct horse battery staple';

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

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-backup-'));
  const port = await freePort();
  const logs = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      APP_PASSWORD: PASSWORD,
      DB_PATH: path.join(dir, 'database.sqlite'),
      PORT: String(port),
      SESSION_SECRET: 'test-session-secret',
      TRUST_PROXY: '',
      PUBLIC_ORIGIN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base, child, logs);
  return {
    base,
    stop: async () => {
      if (child.exitCode == null) {
        child.kill('SIGTERM');
        await new Promise((resolve) => child.once('exit', resolve));
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function login(base) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

async function req(base, cookie, method, route, body) {
  const headers = { Cookie: cookie };
  const opts = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(`${base}${route}`, opts);
}

async function expectStatus(res, status) {
  const text = await res.text();
  assert.equal(res.status, status, text);
  return text ? JSON.parse(text) : {};
}

const weekA = {
  checks: { 'day-0-first': true },
  fields: { grade: 'A', wins: 'Imported cleanly' },
  createdAt: '2026-07-05T00:00:00.000Z',
  schemaVersion: 2,
};
const weekB = {
  checks: { 'day-0-second': true },
  fields: { grade: 'B' },
  createdAt: '2026-07-12T00:00:00.000Z',
  schemaVersion: 2,
};

(async () => {
  const srv = await startServer();
  try {
    const cookie = await login(srv.base);

    const fullBackup = {
      exportedAt: '2026-07-01T00:00:00.000Z',
      app: 'The Forge',
      version: 3,
      database: { version: 2, weeks: { '2026-07-05': weekA } },
      settings: { version: 3, dayTemplates: null, callsign: 'Backup Tester' },
      achievements: [{
        id: 7,
        title: 'Passed exam',
        category: 'certification',
        completed_at: '2026-07-01T12:00:00.000Z',
        notes: 'Clean pass',
        week_key: '2026-07-05',
        value: 1,
        unit: 'exam',
        tags: 'certification',
        pinned: true,
      }],
    };

    let imported = await expectStatus(await req(srv.base, cookie, 'POST', '/api/backup', fullBackup), 200);
    assert.equal(imported.imported.weeks, 1);
    assert.equal(imported.settings.callsign, 'Backup Tester');
    assert.equal(imported.achievements.length, 1);
    assert.equal(imported.achievements[0].id, 7);

    await expectStatus(await req(srv.base, cookie, 'POST', '/api/backup', {
      database: { version: 2, weeks: { 'not-a-date': weekB } },
      settings: { version: 3, callsign: 'Should not write' },
      achievements: [],
    }), 400);

    let snapshot = await expectStatus(await req(srv.base, cookie, 'GET', '/api/backup'), 200);
    assert.deepEqual(Object.keys(snapshot.database.weeks), ['2026-07-05']);
    assert.equal(snapshot.settings.callsign, 'Backup Tester');
    assert.equal(snapshot.achievements.length, 1);

    imported = await expectStatus(await req(srv.base, cookie, 'POST', '/api/backup', {
      version: 2,
      weeks: { '2026-07-12': weekB },
    }), 200);
    assert.deepEqual(Object.keys(imported.database.weeks), ['2026-07-12']);
    assert.equal(imported.settings.callsign, 'Backup Tester');
    assert.equal(imported.achievements.length, 1);

    imported = await expectStatus(await req(srv.base, cookie, 'POST', '/api/backup', {
      database: { version: 2, weeks: { '2026-07-05': weekA } },
      settings: { version: 3, dayTemplates: null, callsign: 'Cleared Records' },
      achievements: [],
    }), 200);
    assert.deepEqual(Object.keys(imported.database.weeks), ['2026-07-05']);
    assert.equal(imported.settings.callsign, 'Cleared Records');
    assert.deepEqual(imported.achievements, []);
  } finally {
    await srv.stop();
  }

  console.log('Backup restore: OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
