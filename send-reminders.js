/* Forge — push reminder sender.
 * Run inside the container on a ~15-min cron. Reads settings.reminders + today's
 * quest completion, and fires a morning "quests waiting" ping and/or an evening
 * "don't break your streak" nudge (only if the day isn't done). Dedupes per day
 * via a small state file; prunes dead subscriptions.
 */
const Database = require('better-sqlite3');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const WINDOW = 15; // minutes — must match the cron cadence
const dbPath = process.env.DB_PATH || '/app/data/database.sqlite';
const STATE = path.join(path.dirname(dbPath), 'reminder-state.json');

const db = new Database(dbPath);
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };

const pub = get('vapid_public'), priv = get('vapid_private');
if (!pub || !priv) process.exit(0);
webpush.setVapidDetails('mailto:forge@example.com', pub, priv);

const settings = JSON.parse(get('app_settings') || '{}');
const rem = settings.reminders || {};
if (!rem.enabled) process.exit(0);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_BLUEPRINT = {
  Sunday: ["Wake up by 6:00 AM", "Morning cardio or movement", "Shower", "Brush teeth", "Work prep / plan the day", "Work / main responsibility", "Weights or active recovery", "2 hours certification study", "Read", "Sleep by 12:00 AM"],
  Monday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
  Tuesday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
  Wednesday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
  Thursday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
  Friday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
  Saturday: ["Wake up by 6:00 AM", "Workout or recovery", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Read", "Sleep by 12:00 AM"],
};
function slug(t) {
  return String(t).toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 58) || 'task';
}
const taskId = (i, t) => `day-${i}-${slug(t)}`;
function weekKey(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

const today = new Date();
const di = today.getDay();
const blueprint = settings.dayTemplates || DEFAULT_BLUEPRINT;
const tasks = blueprint[DAY_NAMES[di]] || [];
const wkRow = db.prepare('SELECT data FROM weeks WHERE week_key = ?').get(weekKey(today));
const checks = wkRow ? (JSON.parse(wkRow.data).checks || {}) : {};
const total = tasks.length;
const done = tasks.filter((t) => checks[taskId(di, t)]).length;
const left = total - done;

const mins = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return h * 60 + (m || 0); };
const nowM = today.getHours() * 60 + today.getMinutes();
const dateStr = today.toISOString().slice(0, 10);
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) {}

const mAt = mins(rem.morning || '08:00');
const eAt = mins(rem.evening || '19:00');
let slot = null, body = '', tag = '';

if (nowM >= mAt && nowM < mAt + WINDOW && state.morning !== dateStr) {
  slot = 'morning'; tag = 'forge-morning';
  body = total ? `${left > 0 ? left : total} quest${(left > 0 ? left : total) === 1 ? '' : 's'} on today's board. ⚔️` : "A fresh day. Set today's quests.";
} else if (nowM >= eAt && nowM < eAt + WINDOW && state.evening !== dateStr) {
  if (total > 0 && left > 0) {
    slot = 'evening'; tag = 'forge-evening';
    body = `${left} quest${left === 1 ? '' : 's'} left — don't break your streak. 🔥`;
  } else {
    state.evening = dateStr; fs.writeFileSync(STATE, JSON.stringify(state)); process.exit(0);
  }
}
if (!slot) process.exit(0);

const subs = db.prepare('SELECT endpoint, sub FROM push_subscriptions').all();
const payload = JSON.stringify({ title: 'Forge', body, url: '/', tag });
Promise.allSettled(subs.map((row) =>
  webpush.sendNotification(JSON.parse(row.sub), payload).catch((err) => {
    if (err && (err.statusCode === 404 || err.statusCode === 410)) {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint);
    }
  })
)).then(() => {
  state[slot] = dateStr;
  fs.writeFileSync(STATE, JSON.stringify(state));
  console.log(`[reminders] ${new Date().toISOString()} ${slot}: ${subs.length} sub(s), ${done}/${total} done`);
  process.exit(0);
});
