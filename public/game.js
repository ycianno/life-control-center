/* ===========================================================================
 * game.js — Life RPG progression layer for Life Control Center
 * ---------------------------------------------------------------------------
 * Purely additive. Loaded BEFORE app.js so window.Game exists when app.js
 * init() runs. All references to app.js globals (database, settings,
 * getDailyBlueprint, taskId, categoryFor, weekKey, iso, addDays,
 * getStartOfWeek) are resolved lazily at call time, after app.js has loaded.
 *
 * Nothing here writes to the database — XP, levels and attributes are derived
 * entirely from the checks/hours the user already records each week.
 * ======================================================================== */
(function () {
  "use strict";

  // ----- Inline SVG icons (shared with fx.js via window.ICONS) -------------
  const ICONS = {
    pencil: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24" class="ic"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24" class="ic"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m17 9 5 6"/><path d="m22 9-5 6"/></svg>',
  };
  window.ICONS = ICONS;

  // ----- XP economy --------------------------------------------------------
  // XP per completed check, by category (categoryFor() in app.js).
  const XP_BY_CAT = {
    discipline: 10,
    training: 30,
    study: 25,
    protein: 12,
    project: 30,
    other: 8,
  };
  const STUDY_HOUR_XP = 8;     // per certification study hour logged
  const PROJECT_HOUR_XP = 12;  // per project hour logged

  // Diet & project check ids are derived at runtime from the editable lists in
  // app.js (getDietItems/dietId, getProjectChecks/projId).

  // ----- Attributes (the RPG stat sheet) -----------------------------------
  const ATTR_OF_CAT = {
    discipline: "Discipline",
    training: "Body",
    study: "Mind",
    protein: "Vitality",
    project: "Craft",
  };
  const ATTRS = [
    { key: "Discipline", color: "#38bdf8" },
    { key: "Body",       color: "#fb7185" },
    { key: "Mind",       color: "#a78bfa" },
    { key: "Vitality",   color: "#34d399" },
    { key: "Craft",      color: "#fbbf24" },
  ];

  // ----- Rank tiers --------------------------------------------------------
  const RANKS = [
    { min: 1,  name: "Bronze" },
    { min: 8,  name: "Silver" },
    { min: 16, name: "Gold" },
    { min: 26, name: "Platinum" },
    { min: 40, name: "Diamond" },
    { min: 60, name: "Master" },
  ];
  function rankFor(level) {
    let r = RANKS[0], idx = 0;
    for (let i = 0; i < RANKS.length; i++) {
      if (level >= RANKS[i].min) { r = RANKS[i]; idx = i; }
    }
    // Tier within band: I..III based on progress to next band
    const next = RANKS[idx + 1];
    const span = next ? next.min - r.min : 24;
    const tierNum = Math.min(3, 1 + Math.floor(((level - r.min) / span) * 3));
    return { name: r.name, tier: ["I", "II", "III"][tierNum - 1] || "I", pips: idx + 1 };
  }

  // ----- Level curve -------------------------------------------------------
  // XP needed to advance FROM `level` to level+1. Cheap early, ~18% growth.
  function xpForLevel(level) {
    const base = (typeof settings !== "undefined" && settings && settings.gameBase) ? settings.gameBase : 100;
    return Math.round(base * Math.pow(1.18, level - 1));
  }
  function levelFromXp(totalXp) {
    let level = 1, acc = 0;
    while (level < 999) {
      const need = xpForLevel(level);
      if (acc + need > totalXp) break;
      acc += need;
      level++;
    }
    return { level, xpIntoLevel: Math.max(0, totalXp - acc), xpForNext: xpForLevel(level) };
  }

  // ----- Profile computation ----------------------------------------------
  function safeBlueprint() {
    try { return getDailyBlueprint(); } catch (e) { return null; }
  }
  function dayNameList() {
    try { return Object.keys(getDailyBlueprint()); } catch (e) {
      return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    }
  }

  // Sum XP for a single week object, accumulating into attrTotals.
  function addWeekXp(week, attrTotals) {
    if (!week) return 0;
    let xp = 0;
    const checks = week.checks || {};
    const fields = week.fields || {};
    const blueprint = safeBlueprint();
    const names = dayNameList();

    function award(cat, amount) {
      xp += amount;
      const attr = ATTR_OF_CAT[cat];
      if (attr && attrTotals) attrTotals[attr] += amount;
    }

    // Daily blueprint tasks
    if (blueprint) {
      for (let i = 0; i < names.length; i++) {
        const tasks = blueprint[names[i]] || [];
        for (const task of tasks) {
          const id = taskId(i, task);
          if (checks[id]) {
            const cat = categoryFor(task);
            award(cat, XP_BY_CAT[cat] || XP_BY_CAT.other);
          }
        }
      }
    }
    // Workout table (training -> Body)
    for (let i = 0; i < 7; i++) {
      if (checks["workout-" + i]) award("training", XP_BY_CAT.training);
    }
    // Diet checks (protein -> Vitality) — ids derived from editable diet list
    if (typeof getDietItems === "function" && typeof dietId === "function") {
      for (const item of getDietItems()) if (checks[dietId(item)]) award("protein", XP_BY_CAT.protein);
    }
    // Project checks (project -> Craft) — ids derived from editable project list
    if (typeof getProjectChecks === "function" && typeof projId === "function") {
      for (const item of getProjectChecks()) if (checks[projId(item)]) award("project", XP_BY_CAT.project);
    }

    // Hours logged
    let studyHours = 0;
    for (const k in fields) {
      if (k.indexOf("hours-study-") === 0) studyHours += Number(fields[k] || 0);
    }
    if (studyHours > 0) award("study", Math.round(studyHours * STUDY_HOUR_XP));
    const projHours = Number(fields.projectHours || 0);
    if (projHours > 0) award("project", Math.round(projHours * PROJECT_HOUR_XP));

    return xp;
  }

  function computeProfile() {
    const attrTotals = {};
    ATTRS.forEach(a => attrTotals[a.key] = 0);

    const db = (typeof database !== "undefined") ? database : null;
    const weeks = (db && db.weeks) ? db.weeks : {};

    let lifetimeXp = 0;
    let activeWeeks = 0;
    let lifetimeStudyHours = 0;
    let bestWeekPct = 0;
    for (const key in weeks) {
      const wk = weeks[key];
      const before = lifetimeXp;
      lifetimeXp += addWeekXp(wk, attrTotals);
      if (lifetimeXp > before) activeWeeks++;
      if (wk && wk.fields) {
        for (const k in wk.fields) if (k.indexOf("hours-study-") === 0) lifetimeStudyHours += Number(wk.fields[k] || 0);
      }
      if (wk && typeof calculateWeekScoreData === "function") {
        const pct = calculateWeekScoreData(wk);
        if (pct > bestWeekPct) bestWeekPct = pct;
      }
    }

    // XP for the currently selected week
    let weeklyXp = 0;
    try { weeklyXp = addWeekXp(weeks[weekKey()], null); } catch (e) {}

    const lv = levelFromXp(lifetimeXp);
    const rank = rankFor(lv.level);

    // Each attribute gets its own level from its own XP pool
    const attrs = ATTRS.map(a => {
      const al = levelFromXp(attrTotals[a.key]);
      return {
        key: a.key, color: a.color, xp: attrTotals[a.key], level: al.level,
        pct: Math.round((al.xpIntoLevel / al.xpForNext) * 100),
      };
    });

    const ds = computeDayStreak();
    return {
      lifetimeXp, weeklyXp, activeWeeks,
      level: lv.level, xpIntoLevel: lv.xpIntoLevel, xpForNext: lv.xpForNext,
      rank, attrs,
      lifetimeStudyHours: Math.round(lifetimeStudyHours),
      bestWeekPct, currentStreak: computeStreak(), dayStreak: ds.streak, streakUsed: ds.used,
    };
  }

  // Consecutive days (ending today, today optional) at >= 50% of that day's quests
  function dayCompletion(date) {
    if (typeof getStartOfWeek !== "function" || typeof getDailyBlueprint !== "function") return 0;
    const db = (typeof database !== "undefined") ? database : null;
    if (!db || !db.weeks) return 0;
    const wk = db.weeks[iso(getStartOfWeek(date))];
    if (!wk || !wk.checks) return 0;
    const di = date.getDay();
    const names = Object.keys(getDailyBlueprint());
    const tasks = getDailyBlueprint()[names[di]] || [];
    if (!tasks.length) return 0;
    let done = 0;
    tasks.forEach(t => { if (wk.checks[taskId(di, t)]) done++; });
    return Math.round(done / tasks.length * 100);
  }
  function computeDayStreak() {
    const thr = 50;
    const grace = (typeof settings !== "undefined" && settings && settings.streakFreeze != null) ? settings.streakFreeze : 1;
    const today = new Date();
    let d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let streak = 0, used = 0;
    if (dayCompletion(d) >= thr) streak++;        // today counts once it's met
    d.setDate(d.getDate() - 1);
    while (true) {
      if (dayCompletion(d) >= thr) { streak++; }
      else if (used < grace) { used++; }          // a rest day / freeze bridges one gap
      else break;
      d.setDate(d.getDate() - 1);
    }
    return { streak: streak, used: used };
  }

  function computeStreak() {
    if (typeof calculateWeekScoreData !== "function" || typeof getStartOfWeek !== "function") return 0;
    const db = (typeof database !== "undefined") ? database : null;
    if (!db || !db.weeks) return 0;
    const grade = (typeof settings !== "undefined" && settings && settings.streakGrade) ? settings.streakGrade : 75;
    let streak = 0;
    let d = getStartOfWeek(new Date());
    const cur = db.weeks[iso(d)] ? calculateWeekScoreData(db.weeks[iso(d)]) : 0;
    if (cur >= grade) streak++;
    d = addDays(d, -7);
    while (true) {
      const wk = db.weeks[iso(d)];
      const s = wk ? calculateWeekScoreData(wk) : 0;
      if (s >= grade) { streak++; d = addDays(d, -7); } else break;
    }
    return streak;
  }

  // ----- Rendering ---------------------------------------------------------
  let lastLevel = null;

  function setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }

  function attrRadarSvg(attrs) {
    const W = 272, H = 232, cx = 136, cy = 108, R = 82, gap = 20;
    const n = attrs.length;
    const maxLevel = Math.max(1, ...attrs.map(a => a.level));
    const ang = i => (-90 + (360 / n) * i) * Math.PI / 180;
    const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];

    let grid = "";
    [0.34, 0.67, 1].forEach(f => {
      const pts = attrs.map((_, i) => pt(i, R * f).map(v => v.toFixed(1)).join(",")).join(" ");
      grid += `<polygon points="${pts}" fill="none" stroke="var(--line)" stroke-width="1"/>`;
    });
    let spokes = "", labels = "";
    attrs.forEach((a, i) => {
      const [x, y] = pt(i, R);
      spokes += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
      const [lx, ly] = pt(i, R + gap);
      const anchor = lx < cx - 3 ? "end" : lx > cx + 3 ? "start" : "middle";
      const dy = ly < cy - 3 ? "-1" : ly > cy + 3 ? "11" : "4";
      labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" dy="${dy}" text-anchor="${anchor}" class="radar-label" fill="${a.color}">${a.key}</text>`;
    });
    const norm = a => 0.2 + 0.8 * (a.level / maxLevel);
    const dataPts = attrs.map((a, i) => pt(i, R * norm(a)).map(v => v.toFixed(1)).join(",")).join(" ");
    let dots = "";
    attrs.forEach((a, i) => {
      const [x, y] = pt(i, R * norm(a));
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.8" fill="${a.color}" stroke="var(--bg-2)" stroke-width="1.2"/>`;
    });

    return `<svg viewBox="0 0 ${W} ${H}" class="attr-radar-svg" aria-hidden="true">
      ${grid}${spokes}
      <polygon points="${dataPts}" style="fill:var(--accent-primary);fill-opacity:0.22;stroke:var(--accent-primary);stroke-width:2;stroke-linejoin:round;filter:drop-shadow(0 0 5px var(--accent-primary))"/>
      ${dots}${labels}
    </svg>`;
  }

  function render() {
    const host = document.getElementById("charScreen");
    if (!host) return;
    const p = computeProfile();

    setText("lvlNum", p.level);
    setText("charSubline", p.rank.name + " · Tier " + p.rank.tier);
    if (!editingCallsign) renderCallsign();
    const orb = document.getElementById("lvlOrb");
    if (orb) orb.style.setProperty("--xp-deg", ((p.xpIntoLevel / p.xpForNext) * 360).toFixed(1) + "deg");
    setText("lifetimeXp", p.lifetimeXp.toLocaleString());
    setText("weeklyXp", "+" + p.weeklyXp.toLocaleString());
    setText("weeksActive", p.activeWeeks);
    setText("dayStreak", p.dayStreak + (p.streakUsed > 0 ? " 🛡️" : ""));
    setText("xpText", p.xpIntoLevel.toLocaleString() + " / " + p.xpForNext.toLocaleString() + " XP");
    setText("xpNextLabel", "to Level " + (p.level + 1));

    const fill = document.getElementById("xpBarFill");
    if (fill) fill.style.width = Math.round((p.xpIntoLevel / p.xpForNext) * 100) + "%";

    // Rank pips
    const pipWrap = document.getElementById("rankPips");
    if (pipWrap) pipWrap.innerHTML = Array.from({ length: 6 }, (_, i) =>
      `<span class="rank-pip ${i < p.rank.pips ? "on" : ""}"></span>`).join("");

    // Radar + legend
    const radar = document.getElementById("attrRadar");
    if (radar) radar.innerHTML = attrRadarSvg(p.attrs);
    const legend = document.getElementById("attrLegend");
    if (legend) legend.innerHTML = p.attrs.map(a =>
      `<div class="attr-row">
        <span class="attr-dot" style="background:${a.color}"></span>
        <span class="attr-name">${a.key}</span>
        <span class="attr-prog"><span class="attr-prog-fill" style="width:${a.pct}%;background:${a.color}"></span></span>
        <span class="attr-lvl">Lv ${a.level}</span>
      </div>`).join("");

    // Level-up celebration — prefer the rich FX layer if present
    if (lastLevel !== null && p.level > lastLevel) {
      if (window.FX && FX.levelUp) FX.levelUp(p.level, p.rank);
      else levelUpToast(p.level);
    }
    lastLevel = p.level;
    checkBadgeUnlocks(p);
    checkStreakMilestones(p);
  }

  // XP a single checkbox is worth (used by the FX layer for "+N XP" pops)
  function checkXp(el) {
    const cat = (el && el.dataset) ? el.dataset.cat : null;
    return XP_BY_CAT[cat] || XP_BY_CAT.other;
  }
  function xpForCat(cat) { return XP_BY_CAT[cat] || XP_BY_CAT.other; }
  function attrColorForCat(cat) {
    const a = ATTRS.find(x => x.key === ATTR_OF_CAT[cat]);
    return a ? a.color : "#38bdf8";
  }

  function levelUpToast(level) {
    const orb = document.getElementById("lvlOrb");
    if (orb) { orb.classList.remove("levelup"); void orb.offsetWidth; orb.classList.add("levelup"); }
    let t = document.getElementById("lvlToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "lvlToast";
      t.className = "lvl-toast";
      document.body.appendChild(t);
    }
    t.innerHTML = `<span class="lvl-toast-k">LEVEL UP</span><span class="lvl-toast-v">Level ${level}</span>`;
    t.classList.remove("show"); void t.offsetWidth; t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ----- Editable callsign -------------------------------------------------
  let editingCallsign = false;
  function callsignName() {
    return (typeof settings !== "undefined" && settings && settings.callsign) ? settings.callsign : "Player One";
  }
  function renderCallsign() {
    const wrap = document.getElementById("callsign");
    if (!wrap) return;
    wrap.innerHTML =
      `<span class="callsign-text">${escapeHtml(callsignName())}</span>` +
      `<button class="callsign-edit" id="callsignEdit" aria-label="Rename operator" title="Rename">${ICONS.pencil}</button>`;
    const btn = document.getElementById("callsignEdit");
    if (btn) btn.onclick = startCallsignEdit;
  }
  function startCallsignEdit() {
    const wrap = document.getElementById("callsign");
    if (!wrap || wrap.querySelector("input")) return;
    editingCallsign = true;
    wrap.innerHTML = `<input id="callsignInput" class="callsign-input" maxlength="28" value="${escapeHtml(callsignName())}">`;
    const inp = document.getElementById("callsignInput");
    inp.focus(); inp.select();
    const commit = (save) => {
      editingCallsign = false;
      if (save && typeof settings !== "undefined" && settings) {
        settings.callsign = inp.value.trim() || "Operator";
        if (typeof persistSettings === "function") persistSettings();
      }
      renderCallsign();
    };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      else if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    inp.addEventListener("blur", () => commit(true));
  }

  // ----- Badges & achievements 2.0 ----------------------------------------
  const RARITY = { common: "#94a3b8", rare: "#38bdf8", epic: "#a78bfa", legendary: "#fbbf24" };
  function attrLvl(p, key) { const a = p.attrs.find(x => x.key === key); return a ? a.level : 0; }
  const BADGES = [
    { id: "first-steps", name: "First Steps", rarity: "common", req: "Reach Level 2", icon: "M5 12h14M13 6l6 6-6 6", test: p => p.level >= 2 },
    { id: "disciplined", name: "Disciplined", rarity: "common", req: "Discipline Lv 3", icon: "M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z", test: p => attrLvl(p, "Discipline") >= 3 },
    { id: "bookworm", name: "Bookworm", rarity: "common", req: "Mind Lv 3", icon: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z", test: p => attrLvl(p, "Mind") >= 3 },
    { id: "flawless-week", name: "Flawless Week", rarity: "rare", req: "Hit a 100% week", icon: "M20 6 9 17l-5-5", test: p => p.bestWeekPct >= 100 },
    { id: "on-fire", name: "On Fire", rarity: "rare", req: "4-week streak", icon: "M12 2c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 1-3 0 2 3 2 3 0 0-2-1-3 0-5z", test: p => p.currentStreak >= 4 },
    { id: "iron-body", name: "Iron Body", rarity: "rare", req: "Body Lv 5", icon: "M4 7l3-3 3 3-3 3zM17 14l3 3-3 3-3-3zM7.5 7.5l9 9", test: p => attrLvl(p, "Body") >= 5 },
    { id: "scholar", name: "Scholar", rarity: "rare", req: "Log 50 study hours", icon: "M22 10 12 5 2 10l10 5 10-5zM6 12v5c0 1 3 2 6 2s6-1 6-2v-5", test: p => p.lifetimeStudyHours >= 50 },
    { id: "centurion", name: "Centurion", rarity: "epic", req: "Reach Level 10", icon: "M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5z", test: p => p.level >= 10 },
    { id: "polymath", name: "Polymath", rarity: "epic", req: "All attributes Lv 3+", icon: "M12 2l3 7h7l-5.5 4 2 7L12 17l-6.5 3 2-7L2 9h7z", test: p => p.attrs.every(a => a.level >= 3) },
    { id: "maker", name: "Maker", rarity: "epic", req: "Craft Lv 5", icon: "M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 1 5.4-5.4z", test: p => attrLvl(p, "Craft") >= 5 },
    { id: "relentless", name: "Relentless", rarity: "legendary", req: "12-week streak", icon: "M12 2c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 1-3 0 2 3 2 3 0 0-2-1-3 0-5z", test: p => p.currentStreak >= 12 },
    { id: "ascendant", name: "Ascendant", rarity: "legendary", req: "Reach Level 20", icon: "M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5z", test: p => p.level >= 20 },
  ];

  function checkBadgeUnlocks(p) {
    if (typeof settings === "undefined" || !settings) return;
    const first = !settings.badges;            // first-ever run → backfill silently
    const owned = settings.badges || {};
    let changed = false;
    const now = new Date().toISOString();
    BADGES.forEach(b => {
      let pass = false;
      try { pass = b.test(p); } catch (e) {}
      if (pass && !owned[b.id]) {
        owned[b.id] = now; changed = true;
        if (!first && window.FX && FX.badge) FX.badge(b.name, b.rarity, RARITY[b.rarity]);
      }
    });
    if (changed || first) {
      settings.badges = owned;
      if (typeof persistSettings === "function") persistSettings();
      renderBadgeWall();
    }
  }

  function renderBadgeWall() {
    const wall = document.getElementById("badgeWall");
    if (!wall) return;
    const owned = (settings && settings.badges) ? settings.badges : {};
    const countEl = document.getElementById("badgeCount");
    if (countEl) countEl.textContent = `${BADGES.filter(b => owned[b.id]).length} / ${BADGES.length}`;
    wall.innerHTML = BADGES.map(b => {
      const on = !!owned[b.id];
      const ic = on
        ? `<svg viewBox="0 0 24 24" class="ic"><path d="${b.icon}"/></svg>`
        : `<svg viewBox="0 0 24 24" class="ic"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
      return `<div class="badge-tile ${on ? "unlocked" : "locked"}" title="${escapeHtml(b.name)} — ${escapeHtml(b.req)}" style="${on ? `--bc:${RARITY[b.rarity]}` : ""}">
        <span class="badge-ic">${ic}</span>
        <span class="badge-name">${on ? escapeHtml(b.name) : "Locked"}</span>
        <span class="badge-req">${escapeHtml(on ? b.rarity : b.req)}</span>
      </div>`;
    }).join("");
  }

  // ----- Day-streak milestones -----
  const DAY_STREAK_MILESTONES = [7, 14, 30, 60, 100, 200, 365];
  function checkStreakMilestones(p) {
    if (typeof settings === "undefined" || !settings) return;
    const first = !settings.seenStreaks;
    const seen = settings.seenStreaks || [];
    let changed = false;
    DAY_STREAK_MILESTONES.forEach((m) => {
      if (p.dayStreak >= m && seen.indexOf(m) === -1) {
        seen.push(m); changed = true;
        if (!first && window.FX && FX.streakMilestone) FX.streakMilestone(m);
      }
    });
    if (changed || first) {
      settings.seenStreaks = seen;
      if (typeof persistSettings === "function") persistSettings();
    }
  }

  // XP earned in a single week (for the trends view)
  function weekXp(week) { return addWeekXp(week, {}); }

  window.Game = { render, computeProfile, levelFromXp, xpForLevel, rankFor, checkXp, xpForCat, attrColorForCat, renderBadgeWall, weekXp, calcWeekScore: (w) => (typeof calculateWeekScoreData === "function" ? calculateWeekScoreData(w) : 0) };
})();
