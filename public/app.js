const APP_DB_KEY = "lifeControlCenter.v2.database";
const APP_SETTINGS_KEY = "lifeControlCenter.v2.settings";
const LEGACY_KEY = "nonNegotiablesDashboardV1";

let selectedWeekStart = getStartOfWeek(new Date());
let database = { version: 2, weeks: {} };
let settings = { version: 3, dayTemplates: null };
let achievements = [];
let saveTimer = null;
let editingDayIndex = null;

// ===== THEMES =====
const THEMES = [
  { id: 'true-black', name: 'True Black', preview: '#030305', gradient: 'linear-gradient(135deg, #38bdf8, #8b5cf6)' },
  { id: 'crimson-night', name: 'Crimson Night', preview: '#120208', gradient: 'linear-gradient(135deg, #ec4899, #a855f7)' },
  { id: 'deep-forest', name: 'Deep Forest', preview: '#021a07', gradient: 'linear-gradient(135deg, #22c55e, #14b8a6)' },
  { id: 'warm-ember', name: 'Warm Ember', preview: '#1a0a02', gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)' },
  { id: 'royal-purple', name: 'Royal Purple', preview: '#0c0520', gradient: 'linear-gradient(135deg, #a78bfa, #e879f9)' },
  { id: 'midnight', name: 'Midnight', preview: '#060c1a', gradient: 'linear-gradient(135deg, #38bdf8, #818cf8)' },
  { id: 'nord', name: 'Nord', preview: '#0e1320', gradient: 'linear-gradient(135deg, #88c0d0, #b48ead)' },
  { id: 'synthwave', name: 'Synthwave', preview: '#0d0418', gradient: 'linear-gradient(135deg, #ec4899, #22d3ee)' },
  { id: 'aurora', name: 'Aurora', preview: '#04140f', gradient: 'linear-gradient(135deg, #2dd4bf, #818cf8)' },
];

// ===== DEVICE DETECTION =====
function isMobile() {
  return window.innerWidth <= 768;
}

function getTodayDayIndex() {
  return new Date().getDay(); // 0=Sunday matches dayNames() order
}

// ===== DATE UTILITIES =====
const defaultDailyBlueprint = {
  Sunday: ["Wake up by 6:00 AM", "Morning cardio or movement", "Shower", "Brush teeth", "Work prep / plan the day", "Work / main responsibility", "Weights or active recovery", "2 hours certification study", "Read", "Sleep by 12:00 AM"],
  Monday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
  Tuesday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
  Wednesday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
  Thursday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
  Friday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
  Saturday: ["Wake up by 6:00 AM", "Workout or recovery", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Read", "Sleep by 12:00 AM"]
};

const defaultWorkouts = [
  ["Monday", "Upper Body / Push-Pull"],
  ["Tuesday", "Lower Body + Core"],
  ["Wednesday", "Cardio + Mobility"],
  ["Thursday", "Upper Body"],
  ["Friday", "Lower Body + Full Body"],
  ["Saturday", "Optional Cardio / Recovery"],
  ["Sunday", "Reset / Light Cardio"]
];
function getWorkouts() { return settings.workouts || defaultWorkouts; }

function getStartOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0,0,0,0);
  return d;
}
function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function fmt(date) { return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function iso(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function weekKey() { return iso(selectedWeekStart); }
function dayNames() { return Object.keys(defaultDailyBlueprint); }

// ===== DATA LOADING =====
async function loadDatabase() {
  try {
    const res = await fetch('/api/database');
    database = await res.json();
  } catch (e) {
    console.error("Failed to load database from server, trying localStorage", e);
    try { database = JSON.parse(localStorage.getItem(APP_DB_KEY)) || { version: 2, weeks: {} }; }
    catch { database = { version: 2, weeks: {} }; }
  }
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    settings = await res.json();
  } catch (e) {
    console.error("Failed to load settings from server, trying localStorage", e);
    try {
      const data = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY)) || {};
      settings = { version: 3, dayTemplates: data.dayTemplates || null };
    } catch { settings = { version: 3, dayTemplates: null }; }
  }
}

async function loadAchievements() {
  try {
    const res = await fetch('/api/achievements');
    achievements = await res.json();
  } catch (e) {
    console.error("Failed to load achievements", e);
    achievements = [];
  }
}

async function persistDatabase() {
  const key = weekKey();
  const weekData = database.weeks[key];
  if (!weekData) return;

  // Persist to server
  try {
    await fetch(`/api/week/${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(weekData)
    });
  } catch (e) {
    console.error("Failed to persist to server", e);
  }

  // Fallback to localStorage
  localStorage.setItem(APP_DB_KEY, JSON.stringify(database));
}

async function persistSettings() {
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
  } catch (e) {
    console.error("Failed to persist settings to server", e);
  }
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
}

function getWeekData() {
  const key = weekKey();
  if (!database.weeks[key]) database.weeks[key] = { fields: {}, checks: {}, createdAt: new Date().toISOString(), schemaVersion: 2 };
  if (!database.weeks[key].fields) database.weeks[key].fields = {};
  if (!database.weeks[key].checks) database.weeks[key].checks = {};
  return database.weeks[key];
}

function getDailyBlueprint() {
  return settings.dayTemplates || defaultDailyBlueprint;
}

function taskId(dayIndex, taskText) {
  const slug = String(taskText).toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    .slice(0, 58) || "task";
  return `day-${dayIndex}-${slug}`;
}

async function migrateLegacyIfNeeded() {
  if (database.migratedFromV1) return;
  const legacy = localStorage.getItem(LEGACY_KEY);
  const currentInLocalStorage = localStorage.getItem(APP_DB_KEY);

  // If we have data in localStorage but server is empty, upload everything
  if (currentInLocalStorage && Object.keys(database.weeks).length === 0) {
    try {
      const localDb = JSON.parse(currentInLocalStorage);
      for (const [key, data] of Object.entries(localDb.weeks)) {
        await fetch(`/api/week/${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      }
      await loadDatabase(); // Refresh
    } catch(e) {}
  }

  if (!legacy) return;
  try {
    const old = JSON.parse(legacy);
    const wk = getWeekData();
    Object.entries(old.checks || {}).forEach(([k,v]) => wk.checks[k] = v);
    Object.entries(old.fields || {}).forEach(([k,v]) => wk.fields[k] = v);
    database.migratedFromV1 = true;
    persistDatabase();
  } catch {}
}

function categoryFor(text) {
  const t = text.toLowerCase();
  if (t.includes("workout") || t.includes("cardio") || t.includes("weights") || t.includes("movement") || t.includes("recovery")) return "training";
  if (t.includes("study") || t.includes("certification")) return "study";
  if (t.includes("protein") || t.includes("cook")) return "protein";
  if (t.includes("project")) return "project";
  return "discipline";
}

// ===== THEME SYSTEM =====
function applyTheme(themeId) {
  document.documentElement.setAttribute('data-theme', themeId);
  settings.theme = themeId;
  // Update meta theme-color for PWA
  const meta = document.querySelector('meta[name="theme-color"]');
  const theme = THEMES.find(t => t.id === themeId);
  if (meta && theme) meta.setAttribute('content', theme.preview);
}

function renderThemeGrid() {
  const grid = document.getElementById('themeGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const currentTheme = settings.theme || 'true-black';
  THEMES.forEach(theme => {
    const swatch = document.createElement('button');
    swatch.className = `theme-swatch ${currentTheme === theme.id ? 'active' : ''}`;
    swatch.style.background = `${theme.gradient}, ${theme.preview}`;
    swatch.innerHTML = `<span>${theme.name}</span>`;
    swatch.onclick = () => {
      applyTheme(theme.id);
      renderThemeGrid();
    };
    grid.appendChild(swatch);
  });
}

// ===== TROPHY CASE =====
function renderTrophyCase() {
  const list = document.getElementById('trophyList');
  if (!list) return;

  if (achievements.length === 0) {
    list.innerHTML = `
      <div class="trophy-empty">
        <div class="trophy-empty-icon">🏆</div>
        <p>No achievements yet.</p>
        <p class="hint">Complete a certification or goal and archive it here!</p>
      </div>`;
    return;
  }

  list.innerHTML = achievements.map(a => {
    const icon = a.category === 'certification' ? '🏆' : a.category === 'fitness' ? '💪' : a.category === 'project' ? '🚀' : '⭐';
    return `
    <div class="trophy-item">
      <div class="trophy-icon">${icon}</div>
      <div class="trophy-details">
        <strong>${escapeHtml(a.title)}</strong>
        <span class="hint">${new Date(a.completed_at).toLocaleDateString()} · ${escapeHtml(a.category)}</span>
        ${a.notes ? `<p class="hint" style="margin-top:4px;">${escapeHtml(a.notes)}</p>` : ''}
      </div>
      <button class="icon-btn delete-trophy" data-trophy-id="${a.id}" title="Remove" style="width:28px;height:28px;font-size:12px;">✕</button>
    </div>`;
  }).join('');

  // Bind delete buttons
  list.querySelectorAll('.delete-trophy').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Remove this achievement?')) return;
      try {
        await fetch(`/api/achievements/${btn.dataset.trophyId}`, { method: 'DELETE' });
        await loadAchievements();
        renderTrophyCase();
      } catch (err) { alert('Failed to delete: ' + err.message); }
    };
  });
}

async function addAchievement(title, category, notes) {
  try {
    await fetch('/api/achievements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        category,
        notes,
        completed_at: new Date().toISOString(),
        week_key: weekKey()
      })
    });
    await loadAchievements();
    renderTrophyCase();
  } catch (err) { alert('Failed to save: ' + err.message); }
}

// ===== RENDERING =====
function renderStatic() {
  renderScoreboard();
  renderStudyAreas();
  renderDiet();
  renderProjectChecks();
  renderReview();
  bindEvents();
}

function calculateWeekScoreData(weekData) {
  if (!weekData || !weekData.checks) return 0;
  const blueprint = getDailyBlueprint();
  let validKeys = new Set();
  for (let i = 0; i < 7; i++) {
    validKeys.add(`workout-${i}`);
    const dayName = Object.keys(blueprint)[i];
    if (blueprint[dayName]) {
      blueprint[dayName].forEach(task => validKeys.add(taskId(i, task)));
    }
  }
  let done = 0;
  validKeys.forEach(k => { if (weekData.checks[k]) done++; });
  return validKeys.size > 0 ? Math.round((done / validKeys.size) * 100) : 0;
}

// ===== DAILY CONTRIBUTION HEATMAP =====
function dayPctInfo(date) {
  const wk = database.weeks[iso(getStartOfWeek(date))];
  if (!wk || !wk.checks) return null;
  const di = date.getDay();
  const tasks = getDailyBlueprint()[Object.keys(getDailyBlueprint())[di]] || [];
  if (!tasks.length) return null;
  let done = 0;
  tasks.forEach(t => { if (wk.checks[taskId(di, t)]) done++; });
  return { pct: Math.round(done / tasks.length * 100), done, total: tasks.length, tasks, di, wk };
}
function hmLevel(pct) {
  if (pct == null || pct === 0) return 0;
  if (pct < 50) return 1;
  if (pct < 75) return 2;
  if (pct < 100) return 3;
  return 4;
}
function openDayInsights(date, info) {
  document.getElementById("insightsTitle").textContent =
    date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  let html;
  if (!info) {
    html = "No data recorded for this day.";
  } else {
    html = `<strong>Completion:</strong> ${info.pct}% &nbsp;(${info.done}/${info.total} quests)<br><br>`;
    html += info.tasks.map(t =>
      `${info.wk.checks[taskId(info.di, t)] ? "✅" : "▫️"} ${escapeHtml(t)}`).join("<br>");
  }
  document.getElementById("insightsContent").innerHTML = html;
  document.getElementById("insightsModal").classList.add("active");
}
function renderHeatmap() {
  const grid = document.getElementById("heatmapGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const months = document.getElementById("hmMonths");
  if (months) months.innerHTML = "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startWeek = addDays(getStartOfWeek(today), -51 * 7); // 52 weeks incl. current
  let lastMonth = -1;
  for (let col = 0; col < 52; col++) {
    const colDate = addDays(startWeek, col * 7);
    if (months) {
      const lbl = document.createElement("span");
      lbl.className = "hm-month";
      const m = colDate.getMonth();
      if (m !== lastMonth) { lbl.textContent = colDate.toLocaleDateString(undefined, { month: "short" }); lastMonth = m; }
      months.appendChild(lbl);
    }
    for (let row = 0; row < 7; row++) {
      const date = addDays(startWeek, col * 7 + row);
      const cell = document.createElement("div");
      if (date > today) { cell.className = "hm-cell future"; grid.appendChild(cell); continue; }
      const info = dayPctInfo(date);
      cell.className = `hm-cell d${hmLevel(info ? info.pct : null)}`;
      const dstr = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      cell.title = info ? `${dstr} — ${info.pct}% (${info.done}/${info.total})` : `${dstr} — no data`;
      cell.onclick = () => openDayInsights(date, info);
      grid.appendChild(cell);
    }
  }
}

function updateStreakAndHeatmap() {
  const grade = settings.streakGrade || 75;
  renderHeatmap();

  let streak = 0;
  let currentWeekStart = getStartOfWeek(new Date());
  let currentKey = iso(currentWeekStart);
  let currentScore = database.weeks[currentKey] ? calculateWeekScoreData(database.weeks[currentKey]) : 0;
  
  if (currentScore >= grade) streak++;

  let date = addDays(currentWeekStart, -7);
  while (true) {
    let key = iso(date);
    let data = database.weeks[key];
    let score = data ? calculateWeekScoreData(data) : 0;
    if (score >= grade) { streak++; date = addDays(date, -7); }
    else break;
  }
  
  const badge = document.getElementById("streakBadge");
  const count = document.getElementById("streakCount");
  if (badge && count) {
    count.textContent = streak;
    const unit = document.getElementById("streakUnit");
    if (unit) unit.textContent = streak === 1 ? "Week" : "Weeks";
    badge.style.display = streak > 0 ? "inline-flex" : "none";
  }
}

const defaultMetrics = [
  ["discipline", "Daily Discipline", "Basics completed", "0%"],
  ["training", "Training", "Workout and movement", "0%"],
  ["protein", "Protein / Diet", "Nutrition floor", "0%"],
  ["study", "Daily Study", "2 hrs/day target", "0%"],
  ["career-hours", "Certification Hours", "14 hrs/week", "0%"],
  ["projects-hours", "Projects", "2 hrs/week", "0%"],
  ["projects-bonus", "Project Bonus", "3 hrs stretch", "0%"],
  ["review", "Weekly Review", "Reflection completed", "0%"]
];
function getMetrics() { return settings.metrics || defaultMetrics; }

const defaultStudyAreas = [
  "Certification",
  "Skill Practice",
  "Reading List",
  "Language Learning"
];
function getStudyAreas() { return settings.studyAreas || defaultStudyAreas; }

function renderStudyAreas() {
  const tbody = document.getElementById("studyRows");
  if (!tbody) return;
  tbody.innerHTML = "";
  getStudyAreas().forEach((area, i) => {
    tbody.insertAdjacentHTML("beforeend", `<tr>
      <td>${area}</td>
      <td><input id="goal-study-${i}" data-save type="text" placeholder="Goal..."></td>
      <td><input id="hours-study-${i}" class="small-input" data-save data-hours="study" type="number" min="0" step="0.25" value="0"> hrs</td>
      <td><select id="status-study-${i}" data-save><option>Planned</option><option>In Progress</option><option>Ready for Exam</option><option>Completed</option><option>Paused</option></select></td>
    </tr>`);
  });
}

// ===== EDITABLE LISTS: Diet / Project / Review =====
function slugify(text) {
  return String(text).toLowerCase().trim().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "item";
}

const defaultDietItems = [
  "Protein backup ready for the week",
  "Weekend protein option planned",
  "Protein groceries available",
  "Hydration handled most days",
  "No full junk mode",
  "At least one protein meal prepped"
];
function getDietItems() { return settings.dietItems || defaultDietItems; }
function dietId(text) { return `diet-${slugify(text)}`; }
function renderDiet() {
  const wrap = document.getElementById("dietRows");
  if (!wrap) return;
  wrap.innerHTML = "";
  const xp = (window.Game && Game.xpForCat) ? Game.xpForCat("protein") : 12;
  getDietItems().forEach(item => {
    wrap.insertAdjacentHTML("beforeend", `<label class="check quest"><input id="${dietId(item)}" type="checkbox" data-cat="protein" data-save><span class="q-text">${escapeHtml(item)}</span><span class="q-xp">+${xp}</span></label>`);
  });
}

const defaultProjectChecks = [
  "Code, workflow, documentation, or plan created",
  "Progress documented",
  "Next action is clear"
];
function getProjectChecks() { return settings.projectChecks || defaultProjectChecks; }
function projId(text) { return `project-${slugify(text)}`; }
function renderProjectChecks() {
  const wrap = document.getElementById("projectChecks");
  if (!wrap) return;
  wrap.innerHTML = "";
  const xp = (window.Game && Game.xpForCat) ? Game.xpForCat("project") : 30;
  getProjectChecks().forEach(item => {
    wrap.insertAdjacentHTML("beforeend", `<label class="check quest"><input id="${projId(item)}" type="checkbox" data-cat="project" data-save><span class="q-text">${escapeHtml(item)}</span><span class="q-xp">+${xp}</span></label>`);
  });
}

const defaultReviewPrompts = [
  "Wins this week",
  "Missed habits / friction",
  "What needs to change next week?",
  "One thing I refuse to drop"
];
function getReviewPrompts() { return settings.reviewPrompts || defaultReviewPrompts; }
function renderReview() {
  const ids = ["lblWins", "lblMisses", "lblChanges", "lblRefuse"];
  const prompts = getReviewPrompts();
  ids.forEach((id, i) => { const el = document.getElementById(id); if (el && prompts[i]) el.textContent = prompts[i]; });
}

function renderScoreboard() {
  const wrap = document.getElementById("scoreboardGrid");
  wrap.innerHTML = "";
  getMetrics().forEach(([id, title, subtitle, val]) => {
    wrap.insertAdjacentHTML("beforeend", `<div class="metric"><div class="top"><div><div class="metric-title">${title}</div><p class="hint">${subtitle}</p></div><span class="metric-number" id="metric-${id}">${val}</span></div><div class="bar"><div class="bar-fill" id="bar-${id}"></div></div></div>`);
  });
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";
  const todayIso = iso(new Date());
  dayNames().forEach((name, idx) => {
    const date = addDays(selectedWeekStart, idx);
    const dateIso = iso(date);
    grid.insertAdjacentHTML("beforeend", `<div class="calendar-cell ${dateIso === todayIso ? "today" : ""}"><div class="dow">${name}</div><div class="date">${fmt(date)}</div><div class="bar"><div class="bar-fill" id="calBar-${idx}"></div></div><p class="hint" id="calText-${idx}">0% complete</p></div>`);
  });
}

function renderDays() {
  const wrap = document.getElementById("daysGrid");
  const blueprint = getDailyBlueprint();
  const wk = getWeekData();
  wrap.innerHTML = "";

  const todayIndex = getTodayDayIndex();
  const entries = Object.entries(blueprint);
  
  // On mobile, render today first, then others collapsed
  let orderedEntries;
  if (isMobile()) {
    orderedEntries = [];
    // Today first
    orderedEntries.push({ entry: entries[todayIndex], dayIndex: todayIndex, isToday: true });
    // Then the rest in order
    for (let i = 0; i < entries.length; i++) {
      if (i !== todayIndex) {
        orderedEntries.push({ entry: entries[i], dayIndex: i, isToday: false });
      }
    }
  } else {
    orderedEntries = entries.map((entry, i) => ({ entry, dayIndex: i, isToday: i === todayIndex }));
  }

  orderedEntries.forEach(({ entry: [day, tasks], dayIndex, isToday }) => {
    const date = addDays(selectedWeekStart, dayIndex);
    const card = document.createElement("details");
    card.className = "day-card" + (isToday ? " today" : "");
    // On mobile: only today open. On desktop: all open.
    card.open = isMobile() ? isToday : true;
    const pencil = (window.ICONS && window.ICONS.pencil) || "✎";
    card.innerHTML = `<summary class="day-summary"><div><div class="day-title">${day}${isToday ? '<span class="today-tag">Today</span>' : ''}</div><div class="date-tag">${fmt(date)}</div></div><div class="day-actions"><span class="badge" id="dayBadge-${dayIndex}">0/0</span><button class="icon-btn edit-day-btn" type="button" data-day-index="${dayIndex}" title="Edit ${day} checklist">${pencil}</button></div></summary><div class="day-content"><div class="bar"><div class="bar-fill" id="dayBar-${dayIndex}"></div></div><div class="task-group"></div></div>`;
    const group = card.querySelector(".task-group");
    tasks.forEach((task, taskIndex) => {
      const id = taskId(dayIndex, task);
      const legacyId = `day-${dayIndex}-task-${taskIndex}`;
      if (wk.checks[id] === undefined && wk.checks[legacyId] !== undefined) wk.checks[id] = wk.checks[legacyId];
      const cat = categoryFor(task);
      const xp = (window.Game && Game.xpForCat) ? Game.xpForCat(cat) : 10;
      group.insertAdjacentHTML("beforeend", `<label class="check quest"><input id="${id}" type="checkbox" data-cat="${cat}" data-day="${dayIndex}" data-save><span class="q-text">${escapeHtml(task)}</span><span class="q-xp">+${xp}</span></label>`);
    });
    wrap.appendChild(card);
  });
}

function renderWorkouts() {
  const body = document.getElementById("workoutRows");
  body.innerHTML = "";
  getWorkouts().forEach(([day, plan], i) => {
    body.insertAdjacentHTML("beforeend", `<tr><td>${day}</td><td>${plan}</td><td><label class="check"><input id="workout-${i}" type="checkbox" data-cat="training" data-save><span>Done</span></label></td><td><input id="workout-note-${i}" type="text" placeholder="Example: 20 lb DB, 3x10, felt strong..." data-save></td></tr>`);
  });
}

function applyWeekToUI() {
  const weekRange = `${fmt(selectedWeekStart)} – ${fmt(addDays(selectedWeekStart, 6))}`;
  const todayStr = new Date().toLocaleDateString(undefined, { weekday:"long", month:"short", day:"numeric" });
  
  document.getElementById("weekRangeText").textContent = weekRange;
  document.getElementById("todayText").textContent = todayStr;
  
  // Update mobile context bar
  const mobileWeek = document.getElementById("mobileWeekRange");
  const mobileToday = document.getElementById("mobileTodayName");
  if (mobileWeek) mobileWeek.textContent = `${fmt(selectedWeekStart)} – ${fmt(addDays(selectedWeekStart, 6))}`;
  if (mobileToday) mobileToday.textContent = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  
  renderCalendar();
  renderDays();
  renderWorkouts();
  loadWeekFields();
  updateProgress();
  updateStreakAndHeatmap();
  if (window.Game) Game.render();
  applySectionVisibility();

  // Apply mobile smart layout after rendering
  applyMobileSmartLayout();
}

// ===== MOBILE SMART LAYOUT =====
function applyMobileSmartLayout() {
  if (!isMobile()) return;
  
  // On mobile, auto-collapse non-essential sections
  const sectionsToCollapse = ['scoreboard', 'calendar', 'workout', 'diet', 'study', 'projects', 'review'];
  sectionsToCollapse.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.tagName === 'DETAILS') el.open = false;
  });
  
  // Keep Daily open
  const daily = document.getElementById('daily');
  if (daily) daily.open = true;
}

function loadWeekFields() {
  const wk = getWeekData();
  document.querySelectorAll("[data-save]").forEach(el => {
    const id = el.id;
    if (!id) return;
    if (el.type === "checkbox") el.checked = !!wk.checks[id];
    else if (wk.fields[id] !== undefined) el.value = wk.fields[id];
    else if (el.tagName === "SELECT") el.selectedIndex = 0;
    else if (el.type === "number") el.value = el.defaultValue || 0;
    else if (el.tagName === "TEXTAREA") el.value = "";
  });
}

function saveWeekField(el) {
  const wk = getWeekData();
  if (!el.id) return;
  if (el.type === "checkbox") wk.checks[el.id] = el.checked;
  else wk.fields[el.id] = el.value;
  wk.updatedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { persistDatabase(); updateStreakAndHeatmap(); if (window.Game) Game.render(); }, 80);
}

function percent(done, total) { return total ? Math.round((done / total) * 100) : 0; }
function setMetric(id, value) {
  const safe = Math.max(0, Math.min(value, 100));
  const bar = document.getElementById(`bar-${id}`);
  const metric = document.getElementById(`metric-${id}`);
  if (bar) bar.style.width = safe + "%";
  if (metric) metric.textContent = safe + "%";
}

function updateProgress() {
  const workoutMin = settings.workoutMin || 5;
  const proteinMin = settings.proteinMin || 7;
  const studyTarget = settings.studyTarget || 14;
  const projectTarget = settings.projectTarget || 2;
  const projectStretch = projectTarget + 1;

  const pillW = document.getElementById("pillWorkout"); if (pillW) pillW.textContent = `${workoutMin} sessions minimum`;
  const pillD = document.getElementById("pillDiet"); if (pillD) pillD.textContent = `${proteinMin} protein days`;
  const pillS = document.getElementById("pillStudy"); if (pillS) pillS.textContent = `${studyTarget} hours/week minimum`;
  const pillP = document.getElementById("pillProject"); if (pillP) pillP.textContent = `${projectTarget} hrs minimum · ${projectStretch} bonus`;
  const hintP = document.getElementById("hintProject"); if (hintP) hintP.textContent = `Minimum target: ${projectTarget} hrs`;
  const ptVal = document.getElementById("projectTargetValue"); if (ptVal) ptVal.textContent = projectTarget;

  const checks = [...document.querySelectorAll('input[type="checkbox"][data-cat]')];
  const done = checks.filter(x => x.checked).length;
  const total = checks.length;
  const overall = percent(done, total);
  document.getElementById("scoreValue").textContent = overall + "%";
  document.getElementById("scoreRing").style.background = `conic-gradient(var(--accent-success) ${overall * 3.6}deg, rgba(255,255,255,0.075) 0deg)`;
  document.getElementById("statusLine").textContent = overall >= 85 ? "Strong week. Maintain pressure." : overall >= 60 ? "Structure is active. Tighten execution." : "Structure is weak. Protect the basics first.";

  // Update mobile score ring
  const mobileRing = document.getElementById("mobileScoreRing");
  const mobileVal = document.getElementById("mobileScoreValue");
  if (mobileRing) mobileRing.style.background = `conic-gradient(var(--accent-success) ${overall * 3.6}deg, rgba(255,255,255,0.08) 0deg)`;
  if (mobileVal) mobileVal.textContent = overall + "%";

  ["discipline", "training", "protein", "study"].forEach(cat => {
    const items = checks.filter(x => x.dataset.cat === cat);
    setMetric(cat, percent(items.filter(x => x.checked).length, items.length));
  });

  for (let d = 0; d < 7; d++) {
    const items = checks.filter(x => x.dataset.day === String(d));
    const dayDone = items.filter(x => x.checked).length;
    const p = percent(dayDone, items.length);
    const badge = document.getElementById(`dayBadge-${d}`);
    const bar = document.getElementById(`dayBar-${d}`);
    const calBar = document.getElementById(`calBar-${d}`);
    const calText = document.getElementById(`calText-${d}`);
    if (badge) badge.textContent = `${dayDone}/${items.length}`;
    if (bar) bar.style.width = p + "%";
    if (calBar) calBar.style.width = p + "%";
    if (calText) calText.textContent = `${p}% complete`;
  }

  const studyHours = [...document.querySelectorAll('[data-hours="study"]')].reduce((sum, el) => sum + Number(el.value || 0), 0);
  setMetric("career-hours", Math.round((studyHours / studyTarget) * 100));

  const projectHours = Number(document.getElementById("projectHours")?.value || 0);
  document.getElementById("projectHoursValue").textContent = projectHours;
  document.getElementById("projectBar").style.width = Math.min(100, Math.round((projectHours / projectTarget) * 100)) + "%";
  setMetric("projects-hours", Math.round((projectHours / projectTarget) * 100));
  setMetric("projects-bonus", Math.round((projectHours / projectStretch) * 100));

  const reviewDone = ["wins", "misses", "changes", "refuseDrop"].filter(id => document.getElementById(id)?.value.trim()).length;
  setMetric("review", percent(reviewDone, 4));
}

// ===== SETTINGS TABS =====
function initSettingsTabs() {
  const tabs = document.querySelectorAll('.settings-tab');
  const panels = document.querySelectorAll('.settings-panel');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.settingsTab;
      
      // Deactivate all tabs
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Show target panel, hide others
      panels.forEach(p => {
        p.style.display = p.dataset.panel === target ? 'block' : 'none';
      });
      
      // Render content for specific tabs
      if (target === 'appearance') renderThemeGrid();
      if (target === 'archive') { renderTrophyCase(); if (window.Game && Game.renderBadgeWall) Game.renderBadgeWall(); }
    });
  });
}

// ===== MOBILE TAB BAR =====
function initMobileTabBar() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const moreDrawer = document.getElementById('moreDrawer');
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      
      // Handle "More" drawer toggle
      if (target === 'more') {
        moreDrawer.classList.toggle('active');
        // Update tab active state
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        return;
      }
      
      // Close more drawer if open
      moreDrawer.classList.remove('active');
      
      // Update active tab
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Scroll to target section
      const targetEl = document.getElementById(target);
      if (targetEl) {
        if (targetEl.tagName === 'DETAILS' && !targetEl.open) targetEl.open = true;
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
  
  // More drawer items
  const moreActions = {
    'moreReportsBtn': () => { moreDrawer.classList.remove('active'); document.getElementById('reportsModal').classList.add('active'); },
    'moreSettingsBtn': () => { moreDrawer.classList.remove('active'); openSettings(); },
    'moreProjectsBtn': () => { moreDrawer.classList.remove('active'); scrollToSection('projects'); },
    'moreDietBtn': () => { moreDrawer.classList.remove('active'); scrollToSection('diet'); },
    'moreReviewBtn': () => { moreDrawer.classList.remove('active'); scrollToSection('review'); },
    'moreCalendarBtn': () => { moreDrawer.classList.remove('active'); scrollToSection('calendar'); },
    'moreExpandBtn': () => { moreDrawer.classList.remove('active'); document.querySelectorAll("details.section-card").forEach(d => d.open = true); },
    'moreCollapseBtn': () => { moreDrawer.classList.remove('active'); document.querySelectorAll("details.section-card").forEach(d => d.open = false); },
  };
  
  Object.entries(moreActions).forEach(([id, handler]) => {
    const el = document.getElementById(id);
    if (el) el.onclick = handler;
  });
  
  // Close more drawer when clicking outside
  document.addEventListener('click', (e) => {
    if (moreDrawer.classList.contains('active') && 
        !moreDrawer.contains(e.target) && 
        !e.target.closest('.tab-btn[data-target="more"]')) {
      moreDrawer.classList.remove('active');
    }
  });
}

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) {
    if (el.tagName === 'DETAILS' && !el.open) el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ===== SETTINGS MODAL =====
// ===== SECTION VISIBILITY =====
const SECTIONS = [
  ["scoreboard", "Scoreboard"], ["calendar", "Calendar"], ["daily", "Daily"],
  ["workout", "Training"], ["diet", "Diet"], ["study", "Study"],
  ["projects", "Projects"], ["review", "Review"]
];
function getHiddenSections() { return settings.hiddenSections || []; }
function applySectionVisibility() {
  const hidden = getHiddenSections();
  SECTIONS.forEach(([id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = hidden.includes(id) ? "none" : "";
  });
}
function renderSectionToggles() {
  const wrap = document.getElementById("sectionToggles");
  if (!wrap) return;
  const hidden = getHiddenSections();
  wrap.innerHTML = SECTIONS.map(([id, name]) =>
    `<label class="check"><input type="checkbox" data-section="${id}" ${hidden.includes(id) ? "" : "checked"}><span>${name}</span></label>`
  ).join("");
}

function openSettings() {
  document.getElementById("cfgWorkoutMin").value = settings.workoutMin || 5;
  document.getElementById("cfgProteinMin").value = settings.proteinMin || 7;
  document.getElementById("cfgProjectTarget").value = settings.projectTarget || 2;
  document.getElementById("cfgStudyTarget").value = settings.studyTarget || 14;
  const dif = document.getElementById("cfgDifficulty"); if (dif) dif.value = String(settings.gameBase || 100);
  const sg = document.getElementById("cfgStreakGrade"); if (sg) sg.value = settings.streakGrade || 75;
  const cs = document.getElementById("cfgCallsign"); if (cs) cs.value = settings.callsign || "";
  renderSectionToggles();
  renderThemeGrid();
  renderTrophyCase();
  if (window.Game && Game.renderBadgeWall) Game.renderBadgeWall();
  document.getElementById("settingsModal").classList.add("active");
}

// ===== EVENT BINDING =====
function bindEvents() {
  document.addEventListener("input", e => { if (e.target.matches("[data-save]")) { saveWeekField(e.target); updateProgress(); } });
  document.addEventListener("change", e => { 
    if (e.target.matches("[data-save]")) { 
      saveWeekField(e.target); 
      updateProgress(); 
      
      // Auto-archive: detect study completion
      if (e.target.id?.startsWith('status-study-') && e.target.value === 'Completed') {
        const idx = parseInt(e.target.id.split('-').pop());
        const area = getStudyAreas()[idx];
        if (area && confirm(`🏆 Archive "${area}" as a completed certification?`)) {
          addAchievement(area, 'certification', `Completed during week of ${document.getElementById('weekRangeText').textContent}`);
        }
      }
    } 
  });
  document.addEventListener("click", e => {
    const btn = e.target.closest(".edit-day-btn");
    if (btn) { e.preventDefault(); e.stopPropagation(); openDayEditor(Number(btn.dataset.dayIndex)); }
  });
  document.getElementById("prevWeekBtn").onclick = () => { selectedWeekStart = addDays(selectedWeekStart, -7); applyWeekToUI(); };
  document.getElementById("nextWeekBtn").onclick = () => { selectedWeekStart = addDays(selectedWeekStart, 7); applyWeekToUI(); };
  document.getElementById("currentWeekBtn").onclick = () => { selectedWeekStart = getStartOfWeek(new Date()); applyWeekToUI(); };
  document.getElementById("resetBtn").onclick = resetThisWeek;
  document.getElementById("copyBtn").onclick = copySummary;
  document.getElementById("exportBtn").onclick = exportBackup;
  document.getElementById("importFile").onchange = importBackup;
  document.getElementById("expandAllBtn").onclick = () => document.querySelectorAll("details.section-card").forEach(d => d.open = true);
  document.getElementById("collapseAllBtn").onclick = () => document.querySelectorAll("details.section-card").forEach(d => d.open = false);
  document.getElementById("cancelDayEditBtn").onclick = closeDayEditor;
  document.getElementById("saveDayTemplateBtn").onclick = saveDayTemplate;
  document.getElementById("resetDayTemplateBtn").onclick = resetDayTemplate;
  document.getElementById("editDayModal").addEventListener("click", e => { if (e.target.id === "editDayModal") closeDayEditor(); });

  document.querySelectorAll(".nav a[href^='#']").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const targetId = link.getAttribute("href").substring(1);
      scrollToSection(targetId);
    });
  });

  // Settings Modal
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  if (openSettingsBtn) openSettingsBtn.onclick = openSettings;
  
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");
  if (closeSettingsBtn) closeSettingsBtn.onclick = () => document.getElementById("settingsModal").classList.remove("active");
  const closeSettingsTopBtn = document.getElementById("closeSettingsTopBtn");
  if (closeSettingsTopBtn) closeSettingsTopBtn.onclick = () => document.getElementById("settingsModal").classList.remove("active");
  
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  if (saveSettingsBtn) {
    saveSettingsBtn.onclick = async () => {
      settings.workoutMin = Number(document.getElementById("cfgWorkoutMin").value);
      settings.proteinMin = Number(document.getElementById("cfgProteinMin").value);
      settings.projectTarget = Number(document.getElementById("cfgProjectTarget").value);
      settings.studyTarget = Number(document.getElementById("cfgStudyTarget").value);
      const dif = document.getElementById("cfgDifficulty"); if (dif) settings.gameBase = Number(dif.value) || 100;
      const sg = document.getElementById("cfgStreakGrade"); if (sg) settings.streakGrade = Math.min(100, Math.max(1, Number(sg.value) || 75));
      const cs = document.getElementById("cfgCallsign"); if (cs && cs.value.trim()) settings.callsign = cs.value.trim();
      settings.hiddenSections = [...document.querySelectorAll('#sectionToggles input[data-section]')].filter(c => !c.checked).map(c => c.dataset.section);
      await persistSettings();
      document.getElementById("settingsModal").classList.remove("active");
      applySectionVisibility();
      updateProgress();
      updateStreakAndHeatmap();
      if (window.Game) Game.render();
    };
  }
  
  // Settings Data Tab actions
  const settingsExportBtn = document.getElementById("settingsExportBtn");
  if (settingsExportBtn) settingsExportBtn.onclick = exportBackup;
  const settingsImportFile = document.getElementById("settingsImportFile");
  if (settingsImportFile) settingsImportFile.onchange = importBackup;
  const settingsResetBtn = document.getElementById("settingsResetBtn");
  if (settingsResetBtn) settingsResetBtn.onclick = resetThisWeek;
  
  // Close settings modal on backdrop click
  document.getElementById("settingsModal")?.addEventListener("click", e => {
    if (e.target.id === "settingsModal") document.getElementById("settingsModal").classList.remove("active");
  });

  // Trophy Case
  const addTrophyBtn = document.getElementById("addTrophyBtn");
  const addTrophyForm = document.getElementById("addTrophyForm");
  if (addTrophyBtn && addTrophyForm) {
    addTrophyBtn.onclick = () => {
      addTrophyForm.classList.toggle('active');
      addTrophyBtn.style.display = addTrophyForm.classList.contains('active') ? 'none' : 'block';
    };
  }
  const cancelTrophyBtn = document.getElementById("cancelTrophyBtn");
  if (cancelTrophyBtn) {
    cancelTrophyBtn.onclick = () => {
      addTrophyForm.classList.remove('active');
      addTrophyBtn.style.display = 'block';
    };
  }
  const saveTrophyBtn = document.getElementById("saveTrophyBtn");
  if (saveTrophyBtn) {
    saveTrophyBtn.onclick = async () => {
      const title = document.getElementById("trophyTitle").value.trim();
      if (!title) { alert("Please enter a title."); return; }
      const category = document.getElementById("trophyCategory").value;
      const notes = document.getElementById("trophyNotes").value.trim();
      await addAchievement(title, category, notes);
      // Reset form
      document.getElementById("trophyTitle").value = '';
      document.getElementById("trophyNotes").value = '';
      document.getElementById("trophyCategory").selectedIndex = 0;
      addTrophyForm.classList.remove('active');
      addTrophyBtn.style.display = 'block';
    };
  }

  // Edit Metrics
  const editMetricsBtn = document.querySelector(".edit-metrics-btn");
  if (editMetricsBtn) {
    editMetricsBtn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const txt = getMetrics().map(m => `${m[1]} | ${m[2]}`).join("\n");
      document.getElementById("editMetricsTextarea").value = txt;
      document.getElementById("editMetricsModal").classList.add("active");
    };
  }
  const cancelMetricsBtn = document.getElementById("cancelMetricsBtn");
  if (cancelMetricsBtn) cancelMetricsBtn.onclick = () => document.getElementById("editMetricsModal").classList.remove("active");
  const saveMetricsBtn = document.getElementById("saveMetricsBtn");
  if (saveMetricsBtn) {
    saveMetricsBtn.onclick = async () => {
      const lines = document.getElementById("editMetricsTextarea").value.split("\n").map(l => l.trim()).filter(Boolean);
      const newMetrics = structuredCloneSafe(getMetrics());
      for (let i = 0; i < Math.min(lines.length, newMetrics.length); i++) {
        const parts = lines[i].split("|").map(x => x.trim());
        if (parts.length >= 1) newMetrics[i][1] = parts[0];
        if (parts.length >= 2) newMetrics[i][2] = parts[1];
      }
      settings.metrics = newMetrics;
      await persistSettings();
      document.getElementById("editMetricsModal").classList.remove("active");
      renderScoreboard();
      updateProgress();
    };
  }

  // Edit Workouts
  const editWorkoutsBtn = document.querySelector(".edit-workouts-btn");
  if (editWorkoutsBtn) {
    editWorkoutsBtn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      document.getElementById("editWorkoutsTextarea").value = getWorkouts().map(w => `${w[0]}: ${w[1]}`).join("\n");
      document.getElementById("editWorkoutsModal").classList.add("active");
    };
  }
  const cancelWorkoutsBtn = document.getElementById("cancelWorkoutsBtn");
  if (cancelWorkoutsBtn) cancelWorkoutsBtn.onclick = () => document.getElementById("editWorkoutsModal").classList.remove("active");
  const saveWorkoutsBtn = document.getElementById("saveWorkoutsBtn");
  if (saveWorkoutsBtn) {
    saveWorkoutsBtn.onclick = async () => {
      const lines = document.getElementById("editWorkoutsTextarea").value.split("\n").map(l => l.trim()).filter(Boolean);
      const newWorkouts = lines.map(l => {
        const parts = l.split(":");
        if (parts.length >= 2) return [parts[0].trim(), parts.slice(1).join(":").trim()];
        return ["Day", l];
      });
      settings.workouts = newWorkouts;
      await persistSettings();
      document.getElementById("editWorkoutsModal").classList.remove("active");
      renderWorkouts();
      loadWeekFields();
    };
  }

  // Edit Study
  const editStudyBtn = document.querySelector(".edit-study-btn");
  if (editStudyBtn) {
    editStudyBtn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      document.getElementById("editStudyTextarea").value = getStudyAreas().join("\n");
      document.getElementById("editStudyModal").classList.add("active");
    };
  }
  const cancelStudyBtn = document.getElementById("cancelStudyBtn");
  if (cancelStudyBtn) cancelStudyBtn.onclick = () => document.getElementById("editStudyModal").classList.remove("active");
  const saveStudyBtn = document.getElementById("saveStudyBtn");
  if (saveStudyBtn) {
    saveStudyBtn.onclick = async () => {
      const lines = document.getElementById("editStudyTextarea").value.split("\n").map(l => l.trim()).filter(Boolean);
      settings.studyAreas = lines;
      await persistSettings();
      document.getElementById("editStudyModal").classList.remove("active");
      renderStudyAreas();
      loadWeekFields();
    };
  }

  // Editable lists: Diet / Project / Review
  function wireListEditor(opts) {
    const btn = document.querySelector(opts.btnSel);
    if (btn) btn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      document.getElementById(opts.textareaId).value = opts.get().join("\n");
      document.getElementById(opts.modalId).classList.add("active");
    };
    const cancel = document.getElementById(opts.cancelId);
    if (cancel) cancel.onclick = () => document.getElementById(opts.modalId).classList.remove("active");
    const save = document.getElementById(opts.saveId);
    if (save) save.onclick = async () => {
      const lines = document.getElementById(opts.textareaId).value.split("\n").map(l => l.trim()).filter(Boolean);
      if (!lines.length) { alert("Keep at least one item."); return; }
      opts.set(lines);
      await persistSettings();
      document.getElementById(opts.modalId).classList.remove("active");
      opts.rerender();
      loadWeekFields();
      updateProgress();
      if (window.Game) Game.render();
    };
  }
  wireListEditor({ btnSel: ".edit-diet-btn", modalId: "editDietModal", textareaId: "editDietTextarea", cancelId: "cancelDietBtn", saveId: "saveDietBtn", get: getDietItems, set: (l) => { settings.dietItems = l; }, rerender: renderDiet });
  wireListEditor({ btnSel: ".edit-project-btn", modalId: "editProjectModal", textareaId: "editProjectTextarea", cancelId: "cancelProjectBtn", saveId: "saveProjectBtn", get: getProjectChecks, set: (l) => { settings.projectChecks = l; }, rerender: renderProjectChecks });
  wireListEditor({ btnSel: ".edit-review-btn", modalId: "editReviewModal", textareaId: "editReviewTextarea", cancelId: "cancelReviewBtn", saveId: "saveReviewBtn", get: getReviewPrompts, set: (l) => { settings.reviewPrompts = l; }, rerender: renderReview });

  // Insights Modal
  const closeInsightsBtn = document.getElementById("closeInsightsBtn");
  if (closeInsightsBtn) closeInsightsBtn.onclick = () => document.getElementById("insightsModal").classList.remove("active");

  // Reports Modal
  const openReportBtn = document.getElementById("openReportBtn");
  if (openReportBtn) openReportBtn.onclick = () => {
    document.getElementById("reportContent").textContent = "Select an option above to generate a report.";
    document.getElementById("reportsModal").classList.add("active");
  };
  const closeReportBtn = document.getElementById("closeReportBtn");
  if (closeReportBtn) closeReportBtn.onclick = () => document.getElementById("reportsModal").classList.remove("active");
  
  const genReport = (weeksBack) => {
    let currentWeekStart = getStartOfWeek(new Date());
    let totalScore = 0;
    let validWeeks = 0;
    let wins = [];
    let friction = [];
    
    for (let i = 0; i < weeksBack; i++) {
      let key = iso(addDays(currentWeekStart, -i * 7));
      let data = database.weeks[key];
      if (data && data.checks && Object.keys(data.checks).length > 0) {
        validWeeks++;
        totalScore += calculateWeekScoreData(data);
        if (data.fields.wins) wins.push(`- ` + data.fields.wins.replace(/\n/g, ' '));
        if (data.fields.misses) friction.push(`- ` + data.fields.misses.replace(/\n/g, ' '));
      }
    }
    
    let avg = validWeeks > 0 ? Math.round(totalScore / validWeeks) : 0;
    let html = `
      <div class="report-visual">
        <div class="report-stats">
          <div class="report-stat">
            <div class="report-stat-value">${weeksBack}</div>
            <div class="report-stat-label">Weeks Lookback</div>
          </div>
          <div class="report-stat">
            <div class="report-stat-value">${validWeeks}</div>
            <div class="report-stat-label">Active Weeks</div>
          </div>
          <div class="report-stat">
            <div class="report-stat-value">${avg}%</div>
            <div class="report-stat-label">Avg Score</div>
          </div>
        </div>
        
        <div class="report-section">
          <div class="report-section-title">Wins & Highlights</div>
          <div class="report-section-body">
            ${wins.length > 0 ? '<ul>' + wins.map(w => '<li>' + escapeHtml(w.substring(2)) + '</li>').join('') + '</ul>' : '<div class="report-empty">No wins recorded in this period.</div>'}
          </div>
        </div>
        
        <div class="report-section">
          <div class="report-section-title">Recurring Friction</div>
          <div class="report-section-body">
            ${friction.length > 0 ? '<ul>' + friction.map(f => '<li>' + escapeHtml(f.substring(2)) + '</li>').join('') + '</ul>' : '<div class="report-empty">No friction recorded in this period.</div>'}
          </div>
        </div>
      </div>
    `;
    
    document.getElementById("reportContent").innerHTML = html;
  };
  
  const genMonth = document.getElementById("genMonthReportBtn");
  if (genMonth) genMonth.onclick = () => genReport(4);
  const genYear = document.getElementById("genYearReportBtn");
  if (genYear) genYear.onclick = () => genReport(52);
  const copyRep = document.getElementById("copyReportBtn");
  if (copyRep) copyRep.onclick = () => navigator.clipboard.writeText(document.getElementById("reportContent").innerText).then(() => alert("Report copied."));

  // Init settings tabs
  initSettingsTabs();
  
  // Init mobile tab bar
  initMobileTabBar();
  
  // Handle window resize to re-apply layout
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // Re-render days when crossing mobile/desktop threshold
    }, 250);
  });
}

function openDayEditor(dayIndex) {
  editingDayIndex = dayIndex;
  const name = dayNames()[dayIndex];
  const tasks = getDailyBlueprint()[name] || [];
  document.getElementById("editDayTitle").textContent = `Edit ${name} Checklist`;
  document.getElementById("editDayTextarea").value = tasks.join("\n");
  document.getElementById("editDayModal").classList.add("active");
  document.getElementById("editDayModal").setAttribute("aria-hidden", "false");
  setTimeout(() => document.getElementById("editDayTextarea").focus(), 20);
}

function closeDayEditor() {
  editingDayIndex = null;
  document.getElementById("editDayModal").classList.remove("active");
  document.getElementById("editDayModal").setAttribute("aria-hidden", "true");
}

async function saveDayTemplate() {
  if (editingDayIndex === null) return;
  const name = dayNames()[editingDayIndex];
  const tasks = document.getElementById("editDayTextarea").value.split("\n").map(x => x.trim()).filter(Boolean);
  if (!tasks.length) { alert("Keep at least one task in the day."); return; }
  const templates = structuredCloneSafe(getDailyBlueprint());
  templates[name] = tasks;
  settings.dayTemplates = templates;
  await persistSettings();
  closeDayEditor();
  applyWeekToUI();
}

async function resetDayTemplate() {
  if (editingDayIndex === null) return;
  if (!confirm("Reset this day's checklist back to the default template?")) return;
  const name = dayNames()[editingDayIndex];
  const templates = structuredCloneSafe(getDailyBlueprint());
  templates[name] = [...defaultDailyBlueprint[name]];
  settings.dayTemplates = templates;
  await persistSettings();
  closeDayEditor();
  applyWeekToUI();
}

async function resetThisWeek() {
  if (!confirm("Reset only this selected week? Other weeks, templates, and exported backups will not be touched.")) return;
  database.weeks[weekKey()] = { fields: {}, checks: {}, createdAt: new Date().toISOString(), schemaVersion: 2 };
  await persistDatabase();
  applyWeekToUI();
}

function copySummary() {
  const studyHours = [...document.querySelectorAll('[data-hours="study"]')].reduce((sum, el) => sum + Number(el.value || 0), 0);
  const summary = `LIFE CONTROL CENTER WEEKLY SUMMARY\n\nWeek: ${document.getElementById("weekRangeText").textContent}\nMission: ${document.getElementById("mission").value}\nWeekly Completion: ${document.getElementById("scoreValue").textContent}\nCertification Study Hours: ${studyHours}/14\nProject Hours: ${document.getElementById("projectHours").value}/2 minimum, 3 bonus\nWeekly Grade: ${document.getElementById("grade").value}\n\nCurrent Project Focus:\n${document.getElementById("projectFocus").value}\n\nWins:\n${document.getElementById("wins").value}\n\nMissed Habits / Friction:\n${document.getElementById("misses").value}\n\nChanges for Next Week:\n${document.getElementById("changes").value}\n\nOne Thing I Refuse To Drop:\n${document.getElementById("refuseDrop").value}`;
  navigator.clipboard.writeText(summary).then(() => alert("Weekly summary copied."));
}

async function exportBackup() {
  await persistDatabase();
  await persistSettings();
  const payload = { exportedAt: new Date().toISOString(), app: "Life Control Center", version: 3, database, settings, achievements };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `life-control-center-backup-${iso(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const payload = JSON.parse(reader.result);
      const incomingDb = payload.database || payload;
      if (!incomingDb.weeks) throw new Error("Invalid backup file");
      database = incomingDb;
      database.version = database.version || 2;
      if (payload.settings) settings = { version: 3, dayTemplates: payload.settings.dayTemplates || null, ...payload.settings };

      // Upload all weeks to server
      for (const [key, data] of Object.entries(database.weeks)) {
        await fetch(`/api/week/${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      }
      await persistSettings();
      
      // Import achievements if present
      if (payload.achievements && Array.isArray(payload.achievements)) {
        for (const a of payload.achievements) {
          await fetch('/api/achievements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(a)
          });
        }
        await loadAchievements();
      }
      
      applyWeekToUI();
      alert("Backup imported and synced to server successfully.");
    } catch (err) { alert("Could not import backup: " + err.message); }
    e.target.value = "";
  };
  reader.readAsText(file);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
}
function structuredCloneSafe(obj) { return JSON.parse(JSON.stringify(obj)); }

// ===== INIT =====
async function init() {
  await loadDatabase();
  await loadSettings();
  await loadAchievements();
  await migrateLegacyIfNeeded();
  
  // Apply saved theme
  if (settings.theme) {
    applyTheme(settings.theme);
  }
  
  renderStatic();
  applyWeekToUI();
}

init();
