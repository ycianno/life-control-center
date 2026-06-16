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

  // Fixed-id checkboxes that live outside the daily blueprint.
  const DIET_CHECKS = [
    "diet-protein-backup", "diet-weekend-plan", "diet-groceries",
    "diet-water", "diet-no-junk-mode", "diet-meal-prep",
  ];
  const PROJECT_CHECKS = ["project-output", "project-documented", "project-next"];

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
    return Math.round(100 * Math.pow(1.18, level - 1));
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
    // Diet checks (protein -> Vitality)
    for (const id of DIET_CHECKS) if (checks[id]) award("protein", XP_BY_CAT.protein);
    // Project checks (project -> Craft)
    for (const id of PROJECT_CHECKS) if (checks[id]) award("project", XP_BY_CAT.project);

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
    for (const key in weeks) {
      const before = lifetimeXp;
      lifetimeXp += addWeekXp(weeks[key], attrTotals);
      if (lifetimeXp > before) activeWeeks++;
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

    return {
      lifetimeXp, weeklyXp, activeWeeks,
      level: lv.level, xpIntoLevel: lv.xpIntoLevel, xpForNext: lv.xpForNext,
      rank, attrs,
    };
  }

  // ----- Rendering ---------------------------------------------------------
  let lastLevel = null;

  function setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }

  function attrRadarSvg(attrs) {
    const W = 250, H = 220, cx = W / 2, cy = 100, R = 72, gap = 19;
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
    setText("rankName", p.rank.name);
    setText("rankTier", "Tier " + p.rank.tier);
    setText("lifetimeXp", p.lifetimeXp.toLocaleString());
    setText("weeklyXp", "+" + p.weeklyXp.toLocaleString());
    setText("weeksActive", p.activeWeeks);
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

    // Level-up celebration (lightweight; full FX lands in the dopamine phase)
    if (lastLevel !== null && p.level > lastLevel) levelUpToast(p.level);
    lastLevel = p.level;
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

  window.Game = { render, computeProfile, levelFromXp, xpForLevel, rankFor };
})();
