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
  // Hour/review XP rates now live in modules.js (the engine). game.js keeps only
  // XP_BY_CAT/ATTR_OF_CAT below, still used by the UI helpers (xpForCat, radar).

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
  // Forge-themed ladder — deliberately NOT metals, so it never collides with
  // the Bronze/Silver/Gold/Platinum trophy grades.
  const RANKS = [
    { min: 1,  name: "Initiate" },
    { min: 8,  name: "Apprentice" },
    { min: 16, name: "Journeyman" },
    { min: 26, name: "Artisan" },
    { min: 40, name: "Master" },
    { min: 60, name: "Forgemaster" },
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
  // Sum XP for a single week — delegated to the module engine (modules.js), the
  // single source of truth for ids/score/XP. Fills attrTotals (per-attribute)
  // and bySource (per-section, for the header chips) when provided.
  function modulesNow() {
    if (typeof getModules === "function") return getModules();
    return window.Forge ? Forge.migrateModules(typeof settings !== "undefined" ? settings : {}) : [];
  }
  function addWeekXp(week, attrTotals, bySource) {
    if (!week || !window.Forge) return 0;
    const r = Forge.weekXp(week, modulesNow());
    if (attrTotals) for (const k in r.byAttr) attrTotals[k] = (attrTotals[k] || 0) + r.byAttr[k];
    if (bySource) for (const k in r.bySource) bySource[k] = (bySource[k] || 0) + r.bySource[k];
    return r.xp;
  }

  // Per-section XP for one week, for the header chips. Mirrors addWeekXp's sources.
  function weekXpBySource(week) {
    const bs = {};
    try { addWeekXp(week, null, bs); } catch (e) {}
    return bs;
  }
  // Per-attribute XP for one week, for the Reports trend lines.
  function weekXpByAttr(week) {
    const at = {};
    try { addWeekXp(week, at); } catch (e) {}
    return at;
  }

  // ----- Seasons: aggregate one calendar month into a recap. -----------------
  // A "season" = a calendar month. Weeks are bucketed by their start date; XP,
  // per-attribute XP, best week, and trophies/insignias earned in the month are
  // summed. Drives the Season modal + the shareable recap card.
  function seasonSummary(monthStart) {
    const base = monthStart || new Date();
    const mStart = new Date(base.getFullYear(), base.getMonth(), 1);
    const mEnd = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    const inMonth = (d) => d && d >= mStart && d < mEnd;
    const weeks = (typeof database !== "undefined" && database && database.weeks) ? database.weeks : {};
    const mods = modulesNow();
    let xp = 0, weeksActive = 0, bestWeek = 0;
    const byAttr = {};
    for (const key in weeks) {
      const ws = (typeof parseYmd === "function") ? parseYmd(key) : null;
      if (!inMonth(ws)) continue;
      const wk = weeks[key];
      let r = { xp: 0, byAttr: {} };
      try { r = window.Forge ? Forge.weekXp(wk, mods) : r; } catch (e) {}
      if (r.xp > 0) weeksActive++;
      xp += r.xp;
      for (const a in r.byAttr) byAttr[a] = (byAttr[a] || 0) + r.byAttr[a];
      let pct = 0; try { pct = (typeof calculateWeekScoreData === "function") ? calculateWeekScoreData(wk) : 0; } catch (e) {}
      if (pct > bestWeek) bestWeek = pct;
    }
    // Mission + weekly-quest bonus tokens earned within the month
    const dm = (typeof settings !== "undefined" && settings && settings.dailyMissions) ? settings.dailyMissions : {};
    for (const k in dm) { if (inMonth(parseYmd(k))) xp += allDayXp(dm[k]); }
    const wq = (typeof settings !== "undefined" && settings && settings.weeklyQuests) ? settings.weeklyQuests : {};
    for (const k in wq) { if (inMonth(parseYmd(k))) xp += allDayXp(wq[k]); }
    // Top attribute by XP this season
    let topAttr = null, topVal = -1;
    for (const a in byAttr) if (byAttr[a] > topVal) { topVal = byAttr[a]; topAttr = a; }
    // Trophies + insignias whose earned timestamp falls in the month
    let trophies = 0;
    const T = (typeof settings !== "undefined" && settings && settings.trophies) ? settings.trophies : {};
    ["bronze", "silver", "gold", "platinum"].forEach(g => { const o = T[g] || {}; for (const k in o) { if (inMonth(parseYmd(String(o[k]).slice(0, 10)))) trophies++; } });
    let insignias = 0;
    const I = (typeof settings !== "undefined" && settings && settings.insignias) ? settings.insignias : {};
    for (const k in I) { if (inMonth(parseYmd(String(I[k]).slice(0, 10)))) insignias++; }
    const label = mStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const now = new Date();
    const isCurrent = mStart.getFullYear() === now.getFullYear() && mStart.getMonth() === now.getMonth();
    return { label, monthStart: mStart, xp, byAttr, topAttr, topAttrXp: Math.max(0, topVal), weeksActive, bestWeek, trophies, insignias, isCurrent };
  }

  // ----- Year in review: aggregate a whole year, with a per-month breakdown. --
  function yearSummary(year) {
    const y = year || new Date().getFullYear();
    const yStart = new Date(y, 0, 1), yEnd = new Date(y + 1, 0, 1);
    const inYear = (d) => d && d >= yStart && d < yEnd;
    const weeks = (typeof database !== "undefined" && database && database.weeks) ? database.weeks : {};
    const mods = modulesNow();
    let xp = 0, weeksActive = 0, bestWeek = 0;
    const byAttr = {}, monthly = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const key in weeks) {
      const ws = (typeof parseYmd === "function") ? parseYmd(key) : null;
      if (!inYear(ws)) continue;
      const wk = weeks[key];
      let r = { xp: 0, byAttr: {} };
      try { r = window.Forge ? Forge.weekXp(wk, mods) : r; } catch (e) {}
      if (r.xp > 0) weeksActive++;
      xp += r.xp; monthly[ws.getMonth()] += r.xp;
      for (const a in r.byAttr) byAttr[a] = (byAttr[a] || 0) + r.byAttr[a];
      let pct = 0; try { pct = (typeof calculateWeekScoreData === "function") ? calculateWeekScoreData(wk) : 0; } catch (e) {}
      if (pct > bestWeek) bestWeek = pct;
    }
    const dm = (typeof settings !== "undefined" && settings && settings.dailyMissions) ? settings.dailyMissions : {};
    for (const k in dm) { const d = parseYmd(k); if (inYear(d)) { const v = allDayXp(dm[k]); xp += v; monthly[d.getMonth()] += v; } }
    const wq = (typeof settings !== "undefined" && settings && settings.weeklyQuests) ? settings.weeklyQuests : {};
    for (const k in wq) { const d = parseYmd(k); if (inYear(d)) { const v = allDayXp(wq[k]); xp += v; monthly[d.getMonth()] += v; } }
    let topAttr = null, topVal = -1;
    for (const a in byAttr) if (byAttr[a] > topVal) { topVal = byAttr[a]; topAttr = a; }
    let bestMonthIndex = -1, bestMonthXp = 0;
    monthly.forEach((v, i) => { if (v > bestMonthXp) { bestMonthXp = v; bestMonthIndex = i; } });
    const monthsActive = monthly.filter(v => v > 0).length;
    let trophies = 0;
    const T = (typeof settings !== "undefined" && settings && settings.trophies) ? settings.trophies : {};
    ["bronze", "silver", "gold", "platinum"].forEach(g => { const o = T[g] || {}; for (const k in o) { if (inYear(parseYmd(String(o[k]).slice(0, 10)))) trophies++; } });
    let insignias = 0;
    const I = (typeof settings !== "undefined" && settings && settings.insignias) ? settings.insignias : {};
    for (const k in I) { if (inYear(parseYmd(String(I[k]).slice(0, 10)))) insignias++; }
    const now = new Date();
    return { year: y, xp, byAttr, topAttr, topAttrXp: Math.max(0, topVal), monthly, bestMonthIndex, bestMonthXp, monthsActive, weeksActive, bestWeek, trophies, insignias, isCurrent: y === now.getFullYear() };
  }

  // Per-week progress for ONE custom pursuit: did the user touch it (active) and
  // did they meet its weekly target (hit)? Type-aware, unit-independent — so a
  // "Pages" counter and a "Reading" checklist both reduce to active/hit weeks.
  function customWeekProgress(week, modules, m) {
    const F = window.Forge; if (!F) return { active: false, hit: false };
    const checks = (week && week.checks) || {};
    const fields = (week && week.fields) || {};
    if (m.type === "checklist") {
      const items = m.items || [];
      let done = 0; items.forEach(it => { if (checks[F.checklistId(m.idPrefix, it)]) done++; });
      return { active: done > 0, hit: items.length > 0 && done >= items.length };
    }
    if (m.type === "table") {
      const n = m.checkCount != null ? m.checkCount : (m.rows ? m.rows.length : 7);
      let done = 0; for (let i = 0; i < n; i++) if (checks[m.idPrefix + "-" + i]) done++;
      const tgt = (m.target && m.target.value) ? Number(m.target.value) : n;
      return { active: done > 0, hit: done >= tgt };
    }
    if (m.type === "counter") {
      const v = F.moduleCountValue(week, modules, m);
      const tgt = (m.target && m.target.value) ? Number(m.target.value) : 1;
      return { active: v > 0, hit: v >= tgt };
    }
    if (m.type === "notes") {
      const v = fields[m.field || (m.idPrefix + "-notes")];
      const filled = !!(v && String(v).trim());
      return { active: filled, hit: filled };
    }
    return { active: false, hit: false };
  }

  function computeProfile() {
    const attrTotals = {};
    ATTRS.forEach(a => attrTotals[a.key] = 0);

    const db = (typeof database !== "undefined") ? database : null;
    const weeks = (db && db.weeks) ? db.weeks : {};

    // Lifetime active/target-hit weeks per custom pursuit → drives its insignia chain.
    const allMods = modulesNow();
    const customMods = allMods.filter(m => m && m.custom);
    const cstats = {};
    customMods.forEach(m => { cstats[m.id] = { id: m.id, name: m.name, attr: m.attr, active: 0, hit: 0 }; });

    let lifetimeXp = 0;
    let activeWeeks = 0;
    let lifetimeStudyHours = 0;
    let bestWeekPct = 0;
    let lifetimeChecks = 0;
    for (const key in weeks) {
      const wk = weeks[key];
      const before = lifetimeXp;
      lifetimeXp += addWeekXp(wk, attrTotals);
      if (lifetimeXp > before) activeWeeks++;
      if (wk && wk.fields) {
        for (const k in wk.fields) if (k.indexOf("hours-study-") === 0) lifetimeStudyHours += Number(wk.fields[k] || 0);
      }
      if (wk && wk.checks) {
        for (const k in wk.checks) if (wk.checks[k]) lifetimeChecks++;
      }
      for (let ci = 0; ci < customMods.length; ci++) {
        const r = customWeekProgress(wk, allMods, customMods[ci]);
        if (r.active) cstats[customMods[ci].id].active++;
        if (r.hit) cstats[customMods[ci].id].hit++;
      }
      if (wk && typeof calculateWeekScoreData === "function") {
        const pct = calculateWeekScoreData(wk);
        if (pct > bestWeekPct) bestWeekPct = pct;
      }
    }

    // Daily-mission bonus XP — earned tokens banked in settings (never in the
    // database). Added to the lifetime pool so it counts toward level/rank, but
    // deliberately NOT attributed to any radar attribute: the radar stays an
    // honest picture of which habits were actually trained.
    lifetimeXp += missionXpTotal();
    lifetimeXp += wqXpTotal();   // weekly-quest bonus tokens (same banking model)

    // XP for the currently selected week
    let weeklyXp = 0;
    try { weeklyXp = addWeekXp(weeks[weekKey()], null); } catch (e) {}
    try { weeklyXp += missionXpForWeek(getStartOfWeek(parseYmd(weekKey()) || new Date())); } catch (e) {}
    try { weeklyXp += wqXpForWeek(getStartOfWeek(parseYmd(weekKey()) || new Date())); } catch (e) {}

    const lv = levelFromXp(lifetimeXp);
    const rank = rankFor(lv.level);

    // Each attribute gets its own level from its own XP pool
    const attrs = ATTRS.map(a => {
      const al = levelFromXp(attrTotals[a.key]);
      return {
        key: a.key,
        label: (typeof attrName === "function") ? attrName(a.key) : a.key,
        color: (typeof attrColor === "function") ? attrColor(a.key) : a.color,
        xp: attrTotals[a.key], level: al.level,
        into: al.xpIntoLevel, need: al.xpForNext,
        pct: Math.round((al.xpIntoLevel / al.xpForNext) * 100),
      };
    });

    const ds = computeDayStreak();
    return {
      lifetimeXp, weeklyXp, activeWeeks,
      level: lv.level, xpIntoLevel: lv.xpIntoLevel, xpForNext: lv.xpForNext,
      rank, attrs, heroClass: heroClass(attrs),
      lifetimeStudyHours: Math.round(lifetimeStudyHours),
      lifetimeChecks,
      customStats: Object.keys(cstats).map(k => cstats[k]),
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
    const W = 272, H = 232, cx = 136, cy = 118, R = 82, gap = 20;
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
      labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" dy="${dy}" text-anchor="${anchor}" class="radar-label" fill="${a.color}">${escapeHtml(a.label || a.key)}</text>`;
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
    checkMissions();              // bank today's mission XP before the profile is summed
    checkWeeklyQuests();          // bank cleared weekly quests too (same tick)
    const p = computeProfile();

    setText("lvlNum", p.level);
    // Merged identity: the class chip is the title; rank now shows only as Tier
    // + pips (the rank word, e.g. "Initiate", is dropped so it no longer doubles
    // up with the base class name). p.rank.name still drives the orb frame below.
    setText("charSubline", "· Tier " + p.rank.tier);
    host.dataset.rank = p.rank.name.toLowerCase();   // drives rank-tiered orb frame + aura
    renderClassChip(p);
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
        <div class="attr-row-head">
          <span class="attr-dot" style="background:${a.color}"></span>
          <span class="attr-name">${escapeHtml(a.label || a.key)}</span>
          <span class="attr-lvl" style="color:${a.color}">Lv ${a.level}</span>
        </div>
        <div class="attr-prog"><span class="attr-prog-fill" style="width:${a.pct}%;background:${a.color}"></span></div>
        <div class="attr-sub"><span>${Number(a.into).toLocaleString()} / ${Number(a.need).toLocaleString()} XP</span><span>${Number(a.xp).toLocaleString()} total</span></div>
      </div>`).join("");

    // Level-up celebration — prefer the rich FX layer if present
    if (lastLevel !== null && p.level > lastLevel) {
      if (window.FX && FX.levelUp) FX.levelUp(p.level, p.rank);
      else levelUpToast(p.level);
    }
    lastLevel = p.level;
    checkClass(p);               // seenClasses updated before insignias build class badges
    checkTrophies();
    checkInsignias(p);
    checkStreakMilestones(p);
    renderHeroTrophies(p);
    renderQuests();
    if (typeof checkAutoRecords === "function") checkAutoRecords(p); // auto-milestone Records (app.js)
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

  // ===========================================================================
  // TROPHIES — cadence/consistency rewards that accumulate forever.
  //   Bronze   = a perfect day (all of today's quests done)
  //   Silver   = a completed week (week score >= 85%)
  //   Gold     = a completed month (month completion >= 85%)
  //   Platinum = six consecutive Gold months
  // No backfill: only periods that complete on/after the epoch are ever awarded.
  // Stored in settings.trophies = { bronze:{}, silver:{}, gold:{}, platinum:{}, since }.
  // ===========================================================================
  const GRADE = { bronze: "#c17d3c", silver: "#9aa3ad", gold: "#d4a017", platinum: "#3bb6c9" };
  const GRADE_LABEL = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" };
  const TIER = { common: "#94a3b8", rare: "#38bdf8", epic: "#a78bfa", legendary: "#fbbf24", mythic: "#f43f5e" };
  const SILVER_GOAL = 85, GOLD_GOAL = 85, PLAT_RUN = 6;

  // Inline SVG path strings for insignia / trophy icons
  const IP = {
    asc: "M4 14l8-8 8 8M4 20l8-8 8 8",
    shield: "M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z",
    body: "M4 7l3-3 3 3-3 3zM17 14l3 3-3 3-3-3zM7.5 7.5l9 9",
    mind: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
    vit: "M12 21C7 17 3 13.8 3 9.2 3 6.3 5.3 4 8 4c1.7 0 3.2.9 4 2.3C12.8 4.9 14.3 4 16 4c2.7 0 5 2.3 5 5.2 0 4.6-4 7.8-9 11.8z",
    craft: "M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 1 5.4-5.4z",
    star: "M12 2l3 7h7l-5.5 4 2 7L12 17l-6.5 3 2-7L2 9h7z",
    flame: "M12 2c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 1-3 0 2 3 2 3 0 0-2-1-3 0-5z",
    boss: "M13 2 4 14h6l-1 8 9-12h-6z",
    study: "M22 10 12 5 2 10l10 5 10-5zM6 12v5c0 1 3 2 6 2s6-1 6-2v-5",
    check: "M20 6 9 17l-5-5",
    calendar: "M3 9h18M7 3v4M17 3v4M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
    cup: "M8 21h8M12 17v4M6 4h12v5a6 6 0 0 1-12 0V4zM6 6H3v1a3 3 0 0 0 3 3M18 6h3v1a3 3 0 0 1-3 3",
    gem: "M6 3h12l3 6-9 12L3 9z",
    lock: "M5 11h14v9H5zM8 11V7a4 4 0 0 1 8 0v4",
    sword: "M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2",
    leaf: "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10ZM2 21c0-3 1.85-5.36 5.08-6",
    hammer: "M15 12 6.5 20.5a2.12 2.12 0 1 1-3-3L12 9M17.64 15 22 10.64M20.91 11.7a1.78 1.78 0 0 0 0-2.52l-5.73-5.73a1.78 1.78 0 0 0-2.52 0L9.59 5l9.41 9.41z",
  };

  // ===========================================================================
  // HERO CLASS — "Soul Evolution". Your archetype is derived live from which of
  // the 5 attributes you actually train; it is never picked. Primary attribute
  // sets the path; a strong-enough secondary refines it. Purely computed from
  // p.attrs — nothing here is stored except which classes you've reached, for
  // the one-time celebration (settings.seenClasses) and the class badges.
  // ===========================================================================
  const CLASS_TABLE = {
    Body:       { _: "Warrior",  Discipline: "Paladin",   Mind: "Spellblade", Vitality: "Champion", Craft: "Gladiator" },
    Mind:       { _: "Mage",     Discipline: "Sage",      Body: "Battlemage", Vitality: "Seer",     Craft: "Artificer" },
    Discipline: { _: "Monk",     Body: "Guardian",        Mind: "Scholar",    Vitality: "Ascetic",  Craft: "Sentinel"  },
    Vitality:   { _: "Druid",    Body: "Berserker",       Mind: "Shaman",     Discipline: "Templar", Craft: "Ranger"   },
    Craft:      { _: "Artisan",  Body: "Forgewright",     Mind: "Alchemist",  Discipline: "Engineer", Vitality: "Naturalist" },
  };
  const CLASS_ICON = {
    Warrior: IP.sword, Paladin: IP.shield, Spellblade: IP.sword, Champion: IP.sword, Gladiator: IP.sword,
    Mage: IP.star, Sage: IP.mind, Battlemage: IP.sword, Seer: IP.star, Artificer: IP.hammer,
    Monk: IP.flame, Guardian: IP.shield, Scholar: IP.mind, Ascetic: IP.flame, Sentinel: IP.shield,
    Druid: IP.leaf, Berserker: IP.sword, Shaman: IP.star, Templar: IP.shield, Ranger: IP.leaf,
    Artisan: IP.hammer, Forgewright: IP.hammer, Alchemist: IP.star, Engineer: IP.hammer, Naturalist: IP.leaf,
    Polymath: IP.star, Initiate: IP.asc,
  };
  // Flat list of every reachable class (for the collectible class badges).
  const CLASS_LIST = (function () {
    const seen = {}, out = [];
    Object.keys(CLASS_TABLE).forEach(pri => Object.keys(CLASS_TABLE[pri]).forEach(sec => {
      const name = CLASS_TABLE[pri][sec];
      if (!seen[name]) { seen[name] = 1; out.push({ id: name.toLowerCase(), name, icon: CLASS_ICON[name] || IP.star }); }
    }));
    out.push({ id: "polymath", name: "Polymath", icon: IP.star });
    return out;
  })();
  const ATTR_COLOR = {};
  ATTRS.forEach(a => { ATTR_COLOR[a.key] = a.color; });

  function heroClass(attrs) {
    const base = { id: "initiate", name: "Initiate", icon: IP.asc, color: "#94a3b8", primary: null, secondary: null, blurb: "Begin your journey" };
    if (!attrs || !attrs.length) return base;
    const sorted = attrs.slice().sort((a, b) => b.level - a.level);
    const top = sorted[0], second = sorted[1];
    const maxL = top.level, minL = sorted[sorted.length - 1].level;
    if (maxL < 2) return base;
    if (maxL - minL <= 1 && minL >= 3) {
      return { id: "polymath", name: "Polymath", icon: IP.star, color: "#e2e8f0", primary: null, secondary: null, blurb: "Balanced across all" };
    }
    const primary = top.key;
    const hasSecondary = second && second.level >= 2 && second.level >= 0.6 * maxL;
    const secondary = hasSecondary ? second.key : null;
    const branch = CLASS_TABLE[primary] || {};
    const name = branch[secondary] || branch._;
    const nm = (k) => (typeof attrName === "function") ? attrName(k) : k;
    return {
      id: name.toLowerCase(), name, icon: CLASS_ICON[name] || IP.star,
      color: ((typeof attrColor === "function") ? attrColor(primary) : ATTR_COLOR[primary]) || "#38bdf8",
      primary, secondary,
      blurb: secondary ? (nm(primary) + " + " + nm(secondary)) : (nm(primary) + " focus"),
    };
  }

  function nowIso() { return new Date().toISOString(); }
  function parseYmd(s) { if (!s) return null; const a = String(s).split("-").map(Number); return new Date(a[0], (a[1] || 1) - 1, a[2] || 1); }
  function monthKey(y, m) { return y + "-" + String(m + 1).padStart(2, "0"); }
  function roman(n) { return ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"][n - 1] || ("#" + n); }
  function trophyIcon(g) { return `<svg viewBox="0 0 24 24" class="ic"><path d="${g === "platinum" ? IP.gem : IP.cup}"/></svg>`; }

  // ----- Per-period completion helpers -------------------------------------
  function blueprintDay(date) {
    if (typeof getDailyBlueprint !== "function") return [];
    const names = Object.keys(getDailyBlueprint());
    return getDailyBlueprint()[names[date.getDay()]] || [];
  }
  function weekChecks(date) {
    const db = (typeof database !== "undefined") ? database : null;
    if (!db || !db.weeks || typeof getStartOfWeek !== "function") return {};
    const wk = db.weeks[iso(getStartOfWeek(date))];
    return (wk && wk.checks) ? wk.checks : {};
  }
  // Blueprint quests only — matches the Daily tab + the day-cleared celebration.
  function dayQuest(date) {
    const tasks = blueprintDay(date), checks = weekChecks(date);
    let done = 0;
    tasks.forEach(t => { if (checks[taskId(date.getDay(), t)]) done++; });
    return { done, total: tasks.length };
  }
  // Quests + that day's workout slot — matches calculateWeekScoreData's units.
  function dayUnits(date) {
    const q = dayQuest(date), checks = weekChecks(date);
    return { done: q.done + (checks["workout-" + date.getDay()] ? 1 : 0), total: q.total + 1 };
  }
  function weekPct(weekStart) {
    const db = (typeof database !== "undefined") ? database : null;
    const wk = (db && db.weeks) ? db.weeks[iso(weekStart)] : null;
    return (wk && typeof calculateWeekScoreData === "function") ? calculateWeekScoreData(wk) : 0;
  }
  // Aggregate month completion, only counting days within [since, upto).
  function monthPct(y, m, since, upto) {
    let done = 0, total = 0;
    const last = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const dt = new Date(y, m, d);
      if (since && dt < since) continue;
      if (upto && dt >= upto) continue;
      const u = dayUnits(dt); done += u.done; total += u.total;
    }
    return total ? Math.round(done / total * 100) : 0;
  }

  function ensureTrophies() {
    if (typeof settings === "undefined" || !settings) return false;
    if (!settings.trophies) { settings.trophies = { bronze: {}, silver: {}, gold: {}, platinum: {}, since: iso(new Date()) }; return true; }
    return false;
  }
  function trophyCount(g) { const T = settings && settings.trophies; return (T && T[g]) ? Object.keys(T[g]).length : 0; }

  // Ordered completed months (those wholly before the current month) with gold flag.
  function completedMonths(since, today) {
    const arr = [];
    let y = since.getFullYear(), m = since.getMonth();
    const cy = today.getFullYear(), cm = today.getMonth();
    while (y < cy || (y === cy && m < cm)) {
      arr.push({ key: monthKey(y, m), gold: monthPct(y, m, since, today) >= GOLD_GOAL });
      m++; if (m > 11) { m = 0; y++; }
    }
    return arr;
  }

  function checkTrophies() {
    if (typeof settings === "undefined" || !settings) return;
    const first = ensureTrophies();
    const T = settings.trophies;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const since = parseYmd(T.since) || today;
    let changed = false;
    const fx = (g, big) => { if (!first && window.FX && FX.trophy) FX.trophy(g, big); };

    // Bronze — the moment today is perfect
    const tq = dayQuest(today), tk = iso(today);
    if (tq.total > 0 && tq.done >= tq.total && !T.bronze[tk]) { T.bronze[tk] = nowIso(); changed = true; fx("bronze"); }

    // Silver — each completed week since the epoch
    let ws = getStartOfWeek(since);
    while (addDays(ws, 6) < today) {
      const k = iso(ws);
      if (!T.silver[k] && weekPct(ws) >= SILVER_GOAL) { T.silver[k] = nowIso(); changed = true; fx("silver"); }
      ws = addDays(ws, 7);
    }

    // Gold — each completed month; Platinum — every 6 consecutive golds
    let run = 0;
    completedMonths(since, today).forEach(mo => {
      if (mo.gold && !T.gold[mo.key]) { T.gold[mo.key] = nowIso(); changed = true; fx("gold"); }
      if (mo.gold) { run++; if (run % PLAT_RUN === 0 && !T.platinum[mo.key]) { T.platinum[mo.key] = nowIso(); changed = true; fx("platinum", true); } }
      else run = 0;
    });

    if (changed && typeof persistSettings === "function") persistSettings();
  }

  // Live snapshot for the dashboard + cabinet (counts + current-period progress).
  function trophyState() {
    ensureTrophies();
    const T = settings.trophies;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const since = parseYmd(T.since) || today;
    const tq = dayQuest(today);
    let run = 0; completedMonths(since, today).forEach(mo => { run = mo.gold ? run + 1 : 0; });
    return {
      counts: { bronze: trophyCount("bronze"), silver: trophyCount("silver"), gold: trophyCount("gold"), platinum: trophyCount("platinum") },
      bronze: { done: tq.done, total: tq.total, pct: tq.total ? Math.round(tq.done / tq.total * 100) : 0 },
      silver: { pct: weekPct(getStartOfWeek(today)) },
      gold: { pct: monthPct(today.getFullYear(), today.getMonth(), since, addDays(today, 1)) },
      platinum: { run },
    };
  }

  // ===========================================================================
  // INSIGNIAS — one-off feats, difficulty-coloured, with open-ended (∞) series.
  // Everything derives from the existing profile + trophy counts — no tracking.
  // Stored in settings.insignias = { id: earnedISO }.
  // ===========================================================================
  function rungs(base, current, step, ahead) {
    const out = base.slice();
    let v = base[base.length - 1] + step;
    const cap = current + step * ahead;
    while (v <= cap) { out.push(v); v += step; }
    return out;
  }
  function gradeByVal(v, a, b, c) { return v <= a ? "common" : v <= b ? "rare" : v <= c ? "epic" : "legendary"; }

  function buildInsignias(p) {
    const out = [];
    const add = (id, name, req, tier, cat, icon, owned) => out.push({ id, name, req, tier, cat, icon, owned: !!owned });

    // Ascension (level) — named through 50, then ∞ every +10
    const lvlNames = { 2: "Initiate", 5: "Apprentice", 10: "Journeyman", 15: "Artisan", 20: "Veteran", 30: "Elite", 40: "Master", 50: "Grandmaster" };
    rungs([2, 5, 10, 15, 20, 30, 40, 50], p.level, 10, 2).forEach(L => {
      const nm = lvlNames[L] || ("Ascension " + roman(Math.floor((L - 50) / 10) + 1));
      add("lvl-" + L, nm, "Reach level " + L, gradeByVal(L, 5, 15, 30), "ascension", IP.asc, p.level >= L);
    });

    // Attribute mastery (×5) — flavorful chain per attribute. 3/5/10/15/20 named,
    // then ∞ rungs become "<Attr> Ascendant N".
    const attrIcon = { Discipline: IP.shield, Body: IP.body, Mind: IP.mind, Vitality: IP.vit, Craft: IP.craft };
    const ATTR_FLAVOR = {
      Body:       { 5: "Gym Rat",  10: "Ironborn", 15: "Juggernaut", 20: "Titan" },
      Mind:       { 5: "Bookworm", 10: "Scholar",  15: "Archmage",   20: "Omniscient" },
      Discipline: { 5: "Ironwill", 10: "Stoic",    15: "Unwavering", 20: "Unbreakable" },
      Vitality:   { 5: "Well-Fed", 10: "Vigorous", 15: "Lifebloom",  20: "Phoenix" },
      Craft:      { 5: "Tinkerer", 10: "Maker",    15: "Artisan",    20: "Masterwright" },
    };
    p.attrs.forEach(a => {
      const fl = ATTR_FLAVOR[a.key] || {};
      const lbl = a.label || a.key;
      rungs([3, 5, 10, 15, 20], a.level, 5, 1).forEach(L => {
        const nm = fl[L] || (L === 3 ? (lbl + " Initiate") : (lbl + " Ascendant " + roman(Math.floor((L - 20) / 5))));
        add("attr-" + a.key + "-" + L, nm, lbl + " level " + L, gradeByVal(L, 5, 10, 20), "attributes", attrIcon[a.key] || IP.star, a.level >= L);
      });
    });
    add("poly", "Jack of All", "All attributes level 3+", "epic", "attributes", IP.star, p.attrs.every(a => a.level >= 3));
    add("renai", "Renaissance", "All attributes level 5+", "epic", "attributes", IP.star, p.attrs.every(a => a.level >= 5));
    add("virt", "Virtuoso", "All attributes level 10+", "legendary", "attributes", IP.star, p.attrs.every(a => a.level >= 10));

    // Hero classes — collect every archetype you embody (Soul Evolution).
    const seenC = (settings && settings.seenClasses) ? settings.seenClasses.slice() : [];
    const embodied = {}; seenC.forEach(id => embodied[id] = 1);
    if (p.heroClass && p.heroClass.id !== "initiate") embodied[p.heroClass.id] = 1;
    CLASS_LIST.forEach(c => add("class-" + c.id, "Embodied: " + c.name, "Reach the " + c.name + " class", c.id === "polymath" ? "legendary" : "rare", "class", c.icon, embodied[c.id]));
    add("class-shift", "Shapeshifter", "Reach 3 different classes", "epic", "class", IP.star, Object.keys(embodied).length >= 3);

    // Daily missions — banked all-clear days (settings.dailyMissions[*].bonus).
    const md = (settings && settings.dailyMissions) ? settings.dailyMissions : null;
    let missionDays = 0; if (md) for (const k in md) { if (md[k] && md[k].bonus) missionDays++; }
    add("tm-1", "Mission Cleared", "Clear all of a day's missions", "common", "missions", IP.check, missionDays >= 1);
    const tmName = { 7: "Taskmaster I", 30: "Taskmaster II", 100: "Taskmaster III" };
    rungs([7, 30, 100], missionDays, 100, 1).forEach(N => add("tm-" + N, tmName[N] || ("Taskmaster " + roman(Math.floor((N - 100) / 100) + 3)), "Clear all daily missions on " + N + " days", gradeByVal(N, 30, 100, 300), "missions", IP.check, missionDays >= N));

    // Consistency — natural byproducts only (never rewards a miss)
    const pd = trophyCount("bronze"), cw = trophyCount("silver");
    const pdName = { 10: "Spotless", 30: "Immaculate", 100: "Flawless Hundred", 365: "Perfect Year" };
    rungs([10, 30, 100, 365], pd, 365, 1).forEach(N => add("pd-" + N, pdName[N] || ("Spotless " + roman(Math.floor((N - 365) / 365) + 1)), N + " perfect days earned", gradeByVal(N, 30, 100, 365), "consistency", IP.flame, pd >= N));
    const cwName = { 4: "Consistent", 13: "Quarterly", 26: "Half-Year", 52: "Yearlong" };
    rungs([4, 13, 26, 52], cw, 52, 1).forEach(N => add("cw-" + N, cwName[N] || ("Yearlong " + roman(Math.floor((N - 52) / 52) + 1)), N + " weeks completed", gradeByVal(N, 13, 26, 52), "consistency", IP.calendar, cw >= N));
    add("flaw", "Flawless Week", "Hit a 100% week", "rare", "consistency", IP.check, p.bestWeekPct >= 100);
    const dsName = { 7: "Kindling", 30: "Wildfire", 100: "Inferno", 365: "Eternal Flame" };
    rungs([7, 30, 100, 365], p.dayStreak, 365, 1).forEach(N => add("ds-" + N, dsName[N] || ("Eternal Flame " + roman(Math.floor((N - 365) / 365) + 1)), N + "-day streak reached", gradeByVal(N, 30, 100, 365), "consistency", IP.flame, p.dayStreak >= N));

    // Boss
    const boss = (settings && settings.bossDefeated) ? Object.keys(settings.bossDefeated).length : 0;
    add("boss-1", "Giant Slayer", "Defeat a weekly boss", "rare", "boss", IP.boss, boss >= 1);
    const bossName = { 5: "Dragonsbane", 25: "Worldbreaker" };
    rungs([5, 25], boss, 25, 1).forEach(N => add("boss-" + N, bossName[N] || ("Worldbreaker " + roman(Math.floor((N - 25) / 25) + 1)), "Defeat " + N + " weekly bosses", gradeByVal(N, 5, 25, 75), "boss", IP.boss, boss >= N));
    // Nemesis — the twice-a-year gauntlet. Escalates each time you conquer it.
    const nem = (settings && Array.isArray(settings.bossHistory)) ? settings.bossHistory.filter(r => r && r.nemesis && r.defeated).length : 0;
    add("nemesis-1", "Shadowbreaker", "Defeat the Nemesis", "epic", "boss", IP.boss, nem >= 1);
    rungs([3, 6], nem, 6, 1).forEach(N => add("nemesis-" + N, N >= 6 ? "Nemesis Undone" : "Shadowbreaker " + roman(N - 1), "Conquer " + N + " Nemesis months", gradeByVal(N, 3, 6, 12), "boss", IP.boss, nem >= N));

    // Study & focus (hour-based)
    const shName = { 10: "Apprentice Scholar", 50: "Dedicated", 100: "Centurion of Study", 250: "Erudite", 500: "Master Scholar", 1000: "Living Library" };
    rungs([10, 50, 100, 250, 500, 1000], p.lifetimeStudyHours, 500, 1).forEach(N => add("sh-" + N, shName[N] || ("Living Library " + roman(Math.floor((N - 1000) / 500) + 1)), "Log " + N + " study hours", gradeByVal(N, 50, 250, 1000), "study", IP.study, p.lifetimeStudyHours >= N));

    // Volume
    const checks = p.lifetimeChecks || 0;
    const qcName = { 100: "Grinder", 500: "Relentless", 1000: "Unstoppable", 5000: "The Machine" };
    rungs([100, 500, 1000, 5000], checks, 5000, 1).forEach(N => add("qc-" + N, qcName[N] || ("The Machine " + roman(Math.floor((N - 5000) / 5000) + 1)), N + " quests completed", gradeByVal(N, 500, 1000, 5000), "volume", IP.check, checks >= N));

    // Records — keepable real-life wins (manual + auto), read from app.js's list.
    const recs = (typeof achievements !== "undefined" && Array.isArray(achievements)) ? achievements : [];
    const recCount = recs.length;
    const rkName = { 1: "First Record", 10: "Record Keeper", 25: "Archivist", 50: "Curator" };
    rungs([1, 10, 25, 50], recCount, 50, 1).forEach(N => add("rec-" + N, rkName[N] || ("Curator " + roman(Math.floor((N - 50) / 50) + 1)), N + " record" + (N > 1 ? "s" : "") + " logged", gradeByVal(N, 10, 25, 50), "records", IP.star, recCount >= N));
    const byCat = c => recs.filter(r => r.category === c).length;
    add("rec-fit", "Iron PR", "Log a fitness record", "rare", "records", IP.body, byCat("fitness") >= 1);
    add("rec-learn", "Lifelong Learner", "Log 5 learning/certification records", "epic", "records", IP.mind, (byCat("learning") + byCat("certification")) >= 5);
    add("rec-ship", "Shipper", "Log 5 project records", "epic", "records", IP.craft, byCat("project") >= 5);
    add("rec-wealth", "Wealth Builder", "Log a finance record", "rare", "records", IP.gem, byCat("finance") >= 1);

    // Extra derived one-offs
    const lvls = p.attrs.map(a => a.level);
    add("balanced", "Balanced Forge", "All attributes within 2 levels and ≥ 5", "epic", "attributes", IP.star, lvls.length > 0 && Math.min.apply(null, lvls) >= 5 && (Math.max.apply(null, lvls) - Math.min.apply(null, lvls)) <= 2);
    const perfWorkoutWeek = (function () {
      const db = (typeof database !== "undefined") ? database : null;
      if (!db || !db.weeks) return false;
      for (const k in db.weeks) {
        const c = (db.weeks[k] || {}).checks || {};
        let all = true; for (let i = 0; i < 7; i++) { if (!c["workout-" + i]) { all = false; break; } }
        if (all) return true;
      }
      return false;
    })();
    add("pww", "Perfect Workout Week", "Check all 7 workouts in a week", "rare", "consistency", IP.body, perfWorkoutWeek);

    // Mythic capstones — the rarest feats.
    add("myth-forge", "Forgemaster", "Reach level 60", "mythic", "ascension", IP.gem, p.level >= 60);
    add("myth-legend", "Living Legend", "Reach level 75, or max every attribute", "mythic", "ascension", IP.gem, p.level >= 75 || p.attrs.every(a => a.level >= 20));
    add("myth-year", "Unbroken Year", "Reach a 365-day streak", "mythic", "consistency", IP.flame, p.dayStreak >= 365);
    add("myth-poly", "True Polymath", "Embody the Polymath class", "mythic", "class", IP.star, !!embodied.polymath);

    // Custom pursuits — every user-made pursuit earns its OWN milestone chain,
    // keyed to its stable module id (renaming the pursuit keeps earned insignias).
    // Chain rewards weeks you stayed active; capstones reward hitting its target.
    (p.customStats || []).forEach(cs => {
      const nm = cs.name || "Pursuit";
      const aw = cs.active || 0, tw = cs.hit || 0;
      const ic = attrIcon[cs.attr] || IP.star;
      const rankName = { 1: nm + ": First Step", 4: nm + " Devotee", 13: nm + " Adept", 26: nm + " Stalwart", 52: nm + " Master" };
      rungs([1, 4, 13, 26, 52], aw, 52, 1).forEach(N => add(
        "cust-" + cs.id + "-" + N,
        rankName[N] || (nm + " Eternal " + roman(Math.floor((N - 52) / 52) + 1)),
        N === 1 ? ("Log " + nm + " in any week") : ("Stay active in " + nm + " for " + N + " weeks"),
        gradeByVal(N, 4, 13, 52), "pursuits", ic, aw >= N));
      add("cust-" + cs.id + "-perfect", nm + " Perfected", "Hit the " + nm + " target in a week", "rare", "pursuits", ic, tw >= 1);
      add("cust-" + cs.id + "-flawless", nm + " Flawless", "Hit the " + nm + " target in 13 weeks", "epic", "pursuits", ic, tw >= 13);
    });

    return out;
  }

  function checkInsignias(p) {
    if (typeof settings === "undefined" || !settings) return;
    const first = !settings.insignias;       // first run → backfill already-true feats silently
    const owned = settings.insignias || {};
    let changed = false;
    buildInsignias(p).forEach(b => {
      if (b.owned && !owned[b.id]) {
        owned[b.id] = nowIso(); changed = true;
        if (!first && window.FX && FX.badge) FX.badge(b.name, b.tier, TIER[b.tier]);
      }
    });
    if (changed || first) {
      settings.insignias = owned;
      if (typeof persistSettings === "function") persistSettings();
      renderInsignias(p);
    }
  }

  // ----- Rendering: cabinet, hero summary ----------------------------------
  let insigniaFilter = "all";
  function renderInsignias(p) {
    const grid = document.getElementById("insigniaGrid");
    if (!grid) return;
    p = p || computeProfile();
    const owned = (settings && settings.insignias) ? settings.insignias : {};
    const list = buildInsignias(p);
    const have = list.filter(b => owned[b.id]).length, total = list.length;
    const cEl = document.getElementById("insigniaCount");
    if (cEl) cEl.textContent = have + " / " + total;

    // Completion bar + rarity legend
    const sum = document.getElementById("cabSummary");
    if (sum) {
      const pct = total ? Math.round(have / total * 100) : 0;
      const tiers = ["common", "rare", "epic", "legendary", "mythic"];
      const legend = tiers.map(t => `<span class="rl-item"><span class="rl-dot" style="background:${TIER[t]}"></span>${t[0].toUpperCase() + t.slice(1)}</span>`).join("");
      sum.innerHTML =
        `<div class="cab-prog"><div class="cab-prog-bar"><span style="width:${pct}%"></span></div><span class="cab-prog-txt">${pct}% complete</span></div>` +
        `<div class="rarity-legend">${legend}</div>`;
    }
    // Per-filter owned/total counts
    const chipWrap = document.getElementById("insigniaFilters");
    if (chipWrap) chipWrap.querySelectorAll("[data-filter]").forEach(ch => {
      const f = ch.dataset.filter;
      const items = f === "all" ? list : list.filter(b => b.cat === f);
      const o = items.filter(b => owned[b.id]).length;
      if (!ch.dataset.base) ch.dataset.base = ch.textContent.trim();
      ch.innerHTML = `${ch.dataset.base} <span class="ins-filter-n">${o}/${items.length}</span>`;
    });

    grid.innerHTML = list.filter(b => insigniaFilter === "all" || b.cat === insigniaFilter).map(b => {
      const on = !!owned[b.id];
      const ic = `<svg viewBox="0 0 24 24" class="ic"><path d="${on ? b.icon : IP.lock}"/></svg>`;
      return `<div class="badge-tile ${on ? "unlocked" : "locked"}" data-tier="${b.tier}" title="${escapeHtml(b.name)} — ${escapeHtml(b.req)}" style="${on ? `--bc:${TIER[b.tier]}` : ""}">
        <span class="badge-ic">${ic}</span>
        <span class="badge-name">${on ? escapeHtml(b.name) : escapeHtml(b.name)}</span>
        <span class="badge-req">${escapeHtml(on ? b.tier : b.req)}</span>
      </div>`;
    }).join("");
    const chips = document.getElementById("insigniaFilters");
    if (chips && !chips._wired) {
      chips._wired = true;
      chips.addEventListener("click", e => {
        const c = e.target.closest("[data-filter]"); if (!c) return;
        insigniaFilter = c.dataset.filter;
        chips.querySelectorAll("[data-filter]").forEach(x => x.classList.toggle("on", x === c));
        renderInsignias();
      });
    }
  }

  function tierCardHtml(g, count, pct, need) {
    return `<div class="tro-tier" style="--mc:${GRADE[g]}">
      <div class="tro-tier-top"><span class="tro-ic">${trophyIcon(g)}</span><span class="tro-count">${count}</span></div>
      <div class="tro-grade">${GRADE_LABEL[g]}</div>
      <div class="tro-bar"><span style="width:${Math.min(100, Math.max(0, Math.round(pct)))}%"></span></div>
      <div class="tro-need">${escapeHtml(need)}</div>
    </div>`;
  }
  function renderCabinet(p) {
    p = p || computeProfile();
    const show = document.getElementById("cabinetTrophies");
    if (show) {
      const s = trophyState();
      show.innerHTML =
        tierCardHtml("bronze", s.counts.bronze, s.bronze.pct, s.bronze.total ? (s.bronze.done + " / " + s.bronze.total + " quests today") : "no quests today") +
        tierCardHtml("silver", s.counts.silver, s.silver.pct, "week at " + s.silver.pct + "% · need " + SILVER_GOAL + "%") +
        tierCardHtml("gold", s.counts.gold, s.gold.pct, "month at " + s.gold.pct + "% · need " + GOLD_GOAL + "%") +
        tierCardHtml("platinum", s.counts.platinum, s.platinum.run / PLAT_RUN * 100, s.platinum.run + " / " + PLAT_RUN + " gold months");
    }
    renderInsignias(p);
  }

  function miniTier(g, count, pct, need) {
    return `<div class="ht-tier" style="--mc:${GRADE[g]}">
      <span class="ht-ic">${trophyIcon(g)}</span>
      <span class="ht-count">${count}</span>
      <span class="ht-grade">${GRADE_LABEL[g]}</span>
      <span class="ht-bar"><span style="width:${Math.min(100, Math.max(0, Math.round(pct)))}%"></span></span>
      <span class="ht-need">${escapeHtml(need)}</span>
    </div>`;
  }
  function todayAwards() {
    const out = [], tk = iso(new Date());
    const T = settings && settings.trophies;
    if (T) ["bronze", "silver", "gold", "platinum"].forEach(g => {
      const o = T[g] || {};
      Object.keys(o).forEach(k => { if (String(o[k]).slice(0, 10) === tk) out.push({ label: GRADE_LABEL[g] + " trophy", color: GRADE[g] }); });
    });
    const ins = settings && settings.insignias;
    if (ins) buildInsignias(computeProfile()).forEach(b => {
      if (ins[b.id] && String(ins[b.id]).slice(0, 10) === tk) out.push({ label: b.name, color: TIER[b.tier] });
    });
    return out.slice(0, 6);
  }
  function renderHeroTrophies(p) {
    const host = document.getElementById("heroTrophies");
    if (!host) return;
    const s = trophyState();
    const tiers = document.getElementById("htTiers");
    if (tiers) tiers.innerHTML =
      miniTier("bronze", s.counts.bronze, s.bronze.pct, s.bronze.total ? (s.bronze.done + " / " + s.bronze.total + " today") : "rest day") +
      miniTier("silver", s.counts.silver, s.silver.pct, s.silver.pct + "% this week") +
      miniTier("gold", s.counts.gold, s.gold.pct, s.gold.pct + "% this month") +
      miniTier("platinum", s.counts.platinum, s.platinum.run / PLAT_RUN * 100, s.platinum.run + " / " + PLAT_RUN + " months");
    const today = document.getElementById("htToday");
    if (today) {
      const items = todayAwards();
      today.innerHTML = '<span class="ht-today-k">Today</span>' + (items.length
        ? items.map(x => `<span class="ht-chip" style="--bc:${x.color}">${escapeHtml(x.label)}</span>`).join("")
        : '<span class="ht-today-none">Clear today’s quests to bank a bronze.</span>');
    }
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

  // ===========================================================================
  // HERO CLASS celebration + chip render (logic lives in heroClass() above).
  // ===========================================================================
  function checkClass(p) {
    if (typeof settings === "undefined" || !settings) return;
    const first = !settings.seenClasses;
    const seen = settings.seenClasses || [];
    const id = p.heroClass ? p.heroClass.id : null;
    let changed = false;
    if (id && id !== "initiate" && seen.indexOf(id) === -1) {
      seen.push(id); changed = true;
      if (!first && window.FX && FX.classUp) FX.classUp(p.heroClass.name, p.heroClass.color, p.heroClass.blurb);
    }
    if (changed || first) {
      settings.seenClasses = seen;
      if (typeof persistSettings === "function") persistSettings();
    }
  }
  function renderClassChip(p) {
    const chip = document.getElementById("classChip");
    if (!chip) return;
    const hc = p.heroClass || heroClass(p.attrs);
    chip.innerHTML = `<svg viewBox="0 0 24 24" class="ic"><path d="${hc.icon}"/></svg><span class="class-chip-name">${escapeHtml(hc.name)}</span>`;
    chip.style.setProperty("--cc", hc.color);
    chip.title = "Hero Class · " + hc.blurb;
  }

  // ===========================================================================
  // DAILY MISSIONS — 3 challenges chosen deterministically from today's date
  // (a date-seeded hash, like the weekly boss). Conditions derive from today's data; clearing
  // a mission banks REAL bonus XP as a token in settings.dailyMissions, which
  // computeProfile folds into the lifetime pool. Auto-resets at midnight (the
  // seed is the date) and never evaluates a past day.
  // ===========================================================================
  const MISSION_BONUS = 100; // awarded once when all of a day's missions clear
  const MISSION_ATTR_WORD = { Discipline: "Hold your Discipline", Body: "Push your Body", Mind: "Sharpen your Mind", Vitality: "Feed your Vitality", Craft: "Work your Craft" };
  const MISSION_ATTR_ICON = { Discipline: IP.shield, Body: IP.body, Mind: IP.mind, Vitality: IP.vit, Craft: IP.craft };

  function missionCtx() {
    const today = new Date();
    const q = dayQuest(today);     // blueprint quests {done,total}
    const u = dayUnits(today);     // quests + workout {done,total}
    const checks = weekChecks(today);
    const di = today.getDay();
    const cats = {};
    blueprintDay(today).forEach(t => {
      const cat = categoryFor(t);
      if (!cats[cat]) cats[cat] = { done: 0, total: 0 };
      cats[cat].total++; if (checks[taskId(di, t)]) cats[cat].done++;
    });
    return { qDone: q.done, qTotal: q.total, uDone: u.done, uTotal: u.total, workout: !!checks["workout-" + di], cats };
  }

  // The full pool available *today* (base missions + any category present today).
  function missionPool(ctx) {
    const pool = [
      { id: "q3",   label: "Complete 3 quests today",        xp: 60,  icon: IP.check, eval: c => c.qDone >= 3 },
      { id: "q5",   label: "Complete 5 quests today",        xp: 110, icon: IP.check, eval: c => c.qDone >= 5 },
      { id: "wk",   label: "Clear today's workout",          xp: 80,  icon: IP.body,  eval: c => c.workout },
      { id: "p60",  label: "Reach 60% of today's quests",    xp: 90,  icon: IP.flame, eval: c => c.qTotal > 0 && c.qDone / c.qTotal >= 0.6 },
      { id: "perf", label: "Perfect day — clear everything", xp: 150, icon: IP.star,  eval: c => c.uTotal > 0 && c.uDone >= c.uTotal },
    ];
    Object.keys(ctx.cats).forEach(cat => {
      const attr = ATTR_OF_CAT[cat];
      if (!attr) return;
      pool.push({
        id: "cat-" + cat,
        label: (MISSION_ATTR_WORD[attr] || ("Train " + attr)) + " today",
        xp: 70, icon: MISSION_ATTR_ICON[attr] || IP.star,
        eval: c => c.cats[cat] && c.cats[cat].done >= 1,
      });
    });
    return pool;
  }

  // Deterministic 3 from the pool, seeded by today's ISO date.
  function dailyMissions() {
    const ctx = missionCtx();
    const pool = missionPool(ctx);
    const key = iso(new Date());
    let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const order = pool.map((m, idx) => ({ idx, r: (h ^ ((idx + 1) * 2654435761)) >>> 0 })).sort((a, b) => a.r - b.r);
    const missions = order.slice(0, Math.min(3, pool.length)).map(o => pool[o.idx]);
    return { ctx, missions };
  }

  function allDayXp(day) { let s = day.bonus || 0; for (const k in day.m) s += day.m[k]; return s; }
  function missionXpTotal() {
    const s = (typeof settings !== "undefined" && settings) ? settings.dailyMissions : null;
    if (!s) return 0;
    let t = 0; for (const k in s) t += allDayXp(s[k]); return t;
  }
  function missionXpForWeek(weekStart) {
    const s = (typeof settings !== "undefined" && settings) ? settings.dailyMissions : null;
    if (!s || !weekStart) return 0;
    const end = addDays(weekStart, 7);
    let t = 0;
    for (const k in s) { const d = parseYmd(k); if (d && d >= weekStart && d < end) t += allDayXp(s[k]); }
    return t;
  }

  // Bank today's earned missions. Runs BEFORE computeProfile so freshly-earned
  // bonus XP shows the same render tick. Silent on the very first ever run.
  function checkMissions() {
    if (typeof settings === "undefined" || !settings) return;
    // Feature off: stop banking NEW mission XP. Already-earned tokens in
    // settings.dailyMissions are intentionally left untouched so lifetime XP
    // (and any unlocked insignias) never silently drop.
    if (settings.missionsOff) return;
    const first = !settings.dailyMissions;
    const store = settings.dailyMissions || {};
    const key = iso(new Date());
    const { ctx, missions } = dailyMissions();
    const day = store[key] || { m: {}, bonus: 0 };
    let changed = false, met = 0;
    missions.forEach(m => {
      const ok = !!m.eval(ctx);
      if (ok) met++;
      if (ok && !(m.id in day.m)) {
        day.m[m.id] = m.xp; changed = true;
        if (!first && window.FX && FX.missionComplete) FX.missionComplete(m.label, m.xp);
      }
    });
    if (missions.length > 0 && met >= missions.length && !day.bonus) {
      day.bonus = MISSION_BONUS; changed = true;
      if (!first && window.FX && FX.missionsAllClear) FX.missionsAllClear(allDayXp(day));
    }
    if (changed || first) {
      store[key] = day;
      settings.dailyMissions = store;
      if (typeof persistSettings === "function") persistSettings();
    }
  }

  // ----- Unified Quests hub (Daily | Weekly under one card) ------------------
  // Both systems still bank independently (checkMissions / checkWeeklyQuests);
  // this only merges their PRESENTATION so the dashboard shows one card, not two
  // near-identical ones. A small toggle flips between today's missions and this
  // week's section-aware quests.
  let questTab = "daily";
  function questData(tab) {
    if (tab === "weekly") {
      const store = (typeof settings !== "undefined" && settings && settings.weeklyQuests) ? settings.weeklyQuests : {};
      const { quests, key } = weeklyQuests();
      const rec = store[key] || { m: {}, bonus: 0 };
      const items = quests.map(q => {
        const done = q.total > 0 && q.done >= q.total;
        return { icon: q.icon, label: q.label, done, right: done ? ("+" + q.xp + " XP") : (Math.min(q.done, q.total) + " / " + q.total) };
      });
      return { items, doneN: items.filter(i => i.done).length, total: quests.length, bonus: rec.bonus ? ` · +${WQ_BONUS} bonus` : "", empty: "No quests yet — add a pursuit." };
    }
    const store = (typeof settings !== "undefined" && settings && settings.dailyMissions) ? settings.dailyMissions : {};
    const day = store[iso(new Date())] || { m: {}, bonus: 0 };
    const { missions } = dailyMissions();
    const items = missions.map(m => {
      const done = m.id in day.m;
      return { icon: m.icon, label: m.label, done, right: "+" + m.xp + " XP" };
    });
    return { items, doneN: items.filter(i => i.done).length, total: missions.length, bonus: day.bonus ? ` · +${MISSION_BONUS} bonus` : "", empty: "No missions today." };
  }
  function renderQuests() {
    const host = document.getElementById("questsHub");
    if (!host) return;
    const missionsOff = !!(typeof settings !== "undefined" && settings && settings.missionsOff);
    if (missionsOff && questTab === "daily") questTab = "weekly"; // Daily tab is hidden when off
    const d = questData(questTab);
    const rows = d.items.map(it => `<div class="dm-row ${it.done ? "done" : ""}">
        <span class="dm-ic"><svg viewBox="0 0 24 24" class="ic"><path d="${it.done ? IP.check : it.icon}"/></svg></span>
        <span class="dm-label">${escapeHtml(it.label)}</span>
        <span class="dm-xp">${escapeHtml(it.right)}</span>
      </div>`).join("");
    const dailyTab = missionsOff ? "" : `<button class="qh-tab ${questTab === "daily" ? "on" : ""}" data-qtab="daily" type="button" role="tab">Daily</button>`;
    host.innerHTML = `
      <div class="dm-head">
        <div class="qh-tabs" role="tablist">
          ${dailyTab}
          <button class="qh-tab ${questTab === "weekly" ? "on" : ""}" data-qtab="weekly" type="button" role="tab">Weekly</button>
        </div>
        <span class="dm-count">${d.doneN} / ${d.total}${d.bonus}</span>
      </div>
      <div class="dm-list">${rows || `<div class="dm-empty">${escapeHtml(d.empty)}</div>`}</div>`;
    host.classList.toggle("all-done", d.total > 0 && d.doneN >= d.total);
    if (!host._wired) {
      host._wired = true;
      host.addEventListener("click", e => {
        const t = e.target.closest("[data-qtab]"); if (!t) return;
        questTab = t.dataset.qtab; renderQuests();
      });
    }
  }
  function renderMissions() { renderQuests(); }   // back-compat alias

  // ===========================================================================
  // WEEKLY QUESTS — 3 section-aware challenges generated from the user's OWN
  // pursuits (Training, Scholarship, custom Cardio, …). Targets come from each
  // module's own weekly target; progress is read from THIS week's data. Clearing
  // a quest banks real bonus XP as a token in settings.weeklyQuests (folded into
  // the lifetime pool, exactly like daily missions). Seeded by the current week
  // so the set is stable Mon–Sun and refreshes each new week.
  // ===========================================================================
  const WQ_XP = 120;       // per cleared quest
  const WQ_BONUS = 250;    // extra when all three clear
  function wqWeekStart() { return getStartOfWeek(new Date()); }
  function wqWeekKey() { return iso(wqWeekStart()); }
  function wqWeekRec() {
    const db = (typeof database !== "undefined") ? database : null;
    const wk = (db && db.weeks) ? db.weeks[wqWeekKey()] : null;
    return { checks: (wk && wk.checks) || {}, fields: (wk && wk.fields) || {} };
  }
  // Build the candidate quests from every enabled section that can set a target.
  function weeklyQuestPool(week, modules) {
    const F = window.Forge; if (!F) return [];
    const checks = week.checks || {}, fields = week.fields || {};
    const out = [];
    const push = (m, label, done, total) => out.push({
      id: "wq-" + m.id, moduleId: m.id, label: label, done: done, total: total,
      attr: m.attr, icon: MISSION_ATTR_ICON[m.attr] || IP.star, xp: WQ_XP,
    });
    (modules || []).forEach(m => {
      if (!m || m.enabled === false) return;
      const nm = m.name || "Pursuit";
      if (m.type === "table") {
        const n = m.checkCount != null ? m.checkCount : (m.rows ? m.rows.length : 7);
        const tgt = (m.target && m.target.value) ? Number(m.target.value) : n;
        let done = 0; for (let i = 0; i < n; i++) if (checks[m.idPrefix + "-" + i]) done++;
        push(m, nm + ": " + tgt + " session" + (tgt === 1 ? "" : "s"), done, tgt);
      } else if (m.type === "checklist") {
        const items = m.items || []; if (!items.length) return;
        let done = 0; items.forEach(it => { if (checks[F.checklistId(m.idPrefix, it)]) done++; });
        push(m, nm + ": complete all", done, items.length);
      } else if (m.type === "hours-table" || m.type === "composite") {
        const tgt = (m.target && m.target.value) ? Number(m.target.value) : 1;
        push(m, nm + ": " + tgt + " hour" + (tgt === 1 ? "" : "s"), F.moduleCountValue(week, modules, m), tgt);
      } else if (m.type === "counter") {
        const tgt = (m.target && m.target.value) ? Number(m.target.value) : 1;
        const unit = (m.target && m.target.unit) ? " " + m.target.unit : "";
        push(m, nm + ": reach " + tgt + unit, F.moduleCountValue(week, modules, m), tgt);
      } else if (m.type === "notes") {
        const v = fields[m.field || (m.idPrefix + "-notes")];
        push(m, nm + ": write it", (v && String(v).trim()) ? 1 : 0, 1);
      } else if (m.type === "review") {
        const flds = m.fields || [];
        let done = 0; flds.forEach(f => { if (fields[f] && String(fields[f]).trim()) done++; });
        push(m, nm + ": fill it out", done, flds.length || 1);
      }
    });
    return out;
  }
  // Deterministic 3, seeded by the current week (mirrors dailyMissions' hash).
  function weeklyQuests() {
    const key = wqWeekKey();
    const pool = weeklyQuestPool(wqWeekRec(), modulesNow());
    let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const order = pool.map((q, idx) => ({ idx, r: (h ^ ((idx + 1) * 2654435761)) >>> 0 })).sort((a, b) => a.r - b.r);
    const quests = order.slice(0, Math.min(3, pool.length)).map(o => pool[o.idx]);
    return { quests, key };
  }
  function wqXpTotal() {
    const s = (typeof settings !== "undefined" && settings) ? settings.weeklyQuests : null;
    if (!s) return 0;
    let t = 0; for (const k in s) t += allDayXp(s[k]); return t;   // allDayXp: bonus + Σ cleared
  }
  function wqXpForWeek(weekStart) {
    const s = (typeof settings !== "undefined" && settings) ? settings.weeklyQuests : null;
    if (!s || !weekStart) return 0;
    const k = iso(weekStart);
    return s[k] ? allDayXp(s[k]) : 0;
  }
  // Bank cleared quests for the current week. Silent on first ever run.
  function checkWeeklyQuests() {
    if (typeof settings === "undefined" || !settings) return;
    const first = !settings.weeklyQuests;
    const store = settings.weeklyQuests || {};
    const { quests, key } = weeklyQuests();
    const rec = store[key] || { m: {}, bonus: 0 };
    let changed = false, met = 0;
    quests.forEach(q => {
      const ok = q.total > 0 && q.done >= q.total;
      if (ok) met++;
      if (ok && !(q.id in rec.m)) {
        rec.m[q.id] = q.xp; changed = true;
        if (!first && window.FX && FX.missionComplete) FX.missionComplete(q.label, q.xp);
      }
    });
    if (quests.length > 0 && met >= quests.length && !rec.bonus) {
      rec.bonus = WQ_BONUS; changed = true;
      if (!first && window.FX && FX.missionsAllClear) FX.missionsAllClear(allDayXp(rec));
    }
    if (changed || first) {
      store[key] = rec;
      settings.weeklyQuests = store;
      if (typeof persistSettings === "function") persistSettings();
    }
  }
  function renderWeeklyQuests() { renderQuests(); }   // back-compat alias

  // XP earned in a single week (for the trends view)
  function weekXp(week) { return addWeekXp(week, {}); }

  window.Game = { render, computeProfile, levelFromXp, xpForLevel, rankFor, checkXp, xpForCat, attrColorForCat, renderInsignias, renderCabinet, renderHeroTrophies, renderMissions, renderWeeklyQuests, renderQuests, heroClass, weekXp, weekXpBySource, weekXpByAttr, seasonSummary, yearSummary, calcWeekScore: (w) => (typeof calculateWeekScoreData === "function" ? calculateWeekScoreData(w) : 0) };
})();
