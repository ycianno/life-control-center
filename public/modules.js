/* ===========================================================================
 * modules.js — The Forge module engine (pure, DOM-free)
 * ---------------------------------------------------------------------------
 * Sections are data ("modules"). This file is the single source of truth for:
 *   - how a module's check/field ids are derived (MUST match the legacy ids so
 *     historical weeks keep counting),
 *   - how a week's completion score is computed,
 *   - how a week's XP is computed and attributed to attributes + sections.
 *
 * It has zero DOM dependencies, so it loads in the browser (attaches `Forge`
 * to window, before game.js/app.js) AND is require()-able from node tests.
 * Nothing here writes to storage — everything is derived from the checks/fields
 * the user already records each week, exactly like the legacy engine.
 * ======================================================================== */
(function (root, factory) {
  const Forge = factory();
  root.Forge = Forge;
  if (typeof module !== "undefined" && module.exports) module.exports = Forge;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ----- XP economy (mirrors legacy game.js values) ------------------------
  const XP_BY_CAT = { discipline: 10, training: 30, study: 25, protein: 12, project: 30, other: 8 };
  const ATTR_OF_CAT = { discipline: "Discipline", training: "Body", study: "Mind", protein: "Vitality", project: "Craft" };
  // Reverse map + ordered attribute list — used by the editor's attribute picker
  // so a custom section's XP feeds the chosen stat.
  const CAT_OF_ATTR = { Discipline: "discipline", Body: "training", Mind: "study", Vitality: "protein", Craft: "project" };
  const ATTR_LIST = ["Discipline", "Body", "Mind", "Vitality", "Craft"];
  const ATTR_COLOR = { Discipline: "#38bdf8", Body: "#fb7185", Mind: "#a78bfa", Vitality: "#34d399", Craft: "#fbbf24" };
  const STUDY_HOUR_XP = 8;
  const PROJECT_HOUR_XP = 12;
  const REVIEW_XP = 15;

  // ----- id helpers — reproduce legacy ids byte-for-byte -------------------
  // (legacy: app.js slugify slices 48 / taskId slices 58, same normalize chain)
  function slug(text, max, fallback) {
    return String(text).toLowerCase().trim()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
      .slice(0, max) || fallback;
  }
  function taskId(dayIndex, taskText) { return `day-${dayIndex}-${slug(taskText, 58, "task")}`; }
  function checklistId(prefix, text) { return `${prefix}-${slug(text, 48, "item")}`; }

  // A daily task's attribute. Explicit override (settings.taskAttrs, keyed by the
  // task's slug so the same habit shares one attribute across days) wins; default
  // falls back to keyword inference, which equals the legacy XP routing exactly.
  function dailyAttrKey(text) { return slug(text, 58, "task"); }
  function dailyAttr(text, taskAttrs) {
    const k = dailyAttrKey(text);
    if (taskAttrs && taskAttrs[k] && CAT_OF_ATTR[taskAttrs[k]]) return taskAttrs[k];
    return ATTR_OF_CAT[categoryFor(text)] || "Discipline";
  }

  // ----- daily task ↔ section links ----------------------------------------
  // A daily task can be linked to a per-day section so they're ONE checkbox.
  // settings.taskLinks maps a task slug -> a module id (a `table` section, the
  // only type with a per-day checkbox). The link resolves to that section's row
  // for the given day, so checking either place ticks the same week.checks id.
  function taskLinkOf(taskLinks, text) {
    if (!taskLinks) return null;
    return taskLinks[dailyAttrKey(text)] || null;
  }
  function linkTargetId(moduleId, modules, dayIndex) {
    const m = (modules || []).find((x) => x.id === moduleId);
    if (!m) return null;
    if (m.type === "table") return `${m.idPrefix}-${dayIndex}`;
    return null; // only per-day (table) sections expose a daily checkbox to share
  }
  function linkableModules(modules) {
    return (modules || []).filter((m) => m.type === "table");
  }

  // ----- category inference for free-text daily tasks (relocated from app.js) -
  function categoryFor(text) {
    const t = String(text).toLowerCase();
    if (t.includes("workout") || t.includes("cardio") || t.includes("weights") || t.includes("movement") || t.includes("recovery")) return "training";
    if (t.includes("study") || t.includes("certification")) return "study";
    if (t.includes("protein") || t.includes("cook")) return "protein";
    if (t.includes("project")) return "project";
    return "discipline";
  }

  // ----- default seed data (mirrors app.js defaults; "Operator" preset) ----
  const DEFAULT_BLUEPRINT = {
    Sunday: ["Wake up by 6:00 AM", "Morning cardio or movement", "Shower", "Brush teeth", "Work prep / plan the day", "Work / main responsibility", "Weights or active recovery", "2 hours certification study", "Read", "Sleep by 12:00 AM"],
    Monday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    Tuesday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    Wednesday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    Thursday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    Friday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    Saturday: ["Wake up by 6:00 AM", "Workout or recovery", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Read", "Sleep by 12:00 AM"],
  };
  const DEFAULT_WORKOUTS = [
    ["Monday", "Upper Body / Push-Pull"], ["Tuesday", "Lower Body + Core"], ["Wednesday", "Cardio + Mobility"],
    ["Thursday", "Upper Body"], ["Friday", "Lower Body + Full Body"], ["Saturday", "Optional Cardio / Recovery"], ["Sunday", "Reset / Light Cardio"],
  ];
  const DEFAULT_DIET = ["Protein backup ready for the week", "Weekend protein option planned", "Protein groceries available", "Hydration handled most days", "No full junk mode", "At least one protein meal prepped"];
  const DEFAULT_PROJECT_CHECKS = ["Code, workflow, documentation, or plan created", "Progress documented", "Next action is clear"];
  const DEFAULT_STUDY_AREAS = ["Certification / Course", "Language Learning", "Reading List", "Skill Practice"];
  const DEFAULT_REVIEW = ["Wins this week", "Missed habits / friction", "What needs to change next week?", "One thing I refuse to drop"];

  // ----- migration: build the modules array from current settings ----------
  // Item-ids and XP values are seeded so historical weeks read identically.
  function migrateModules(settings) {
    settings = settings || {};
    return applyOverlays(buildBaseModules(settings), settings);
  }
  function buildBaseModules(settings) {
    settings = settings || {};
    return [
      { id: "daily", type: "daily", name: "Daily Habits", icon: "check", source: "daily",
        countScore: true, attr: null, category: null, enabled: true, order: 1,
        blueprint: settings.dayTemplates || clone(DEFAULT_BLUEPRINT), taskAttrs: settings.taskAttrs || {},
        taskLinks: settings.taskLinks || {} },
      { id: "workout", type: "table", name: "Training", icon: "dumbbell", source: "training",
        countScore: true, attr: "Body", category: "training", enabled: true, order: 2,
        idPrefix: "workout", checkCount: 7, rows: settings.workouts || clone(DEFAULT_WORKOUTS),
        noteField: true, xpPer: XP_BY_CAT.training, target: { kind: "count", value: num(settings.workoutMin, 5) } },
      { id: "diet", type: "checklist", name: "Nutrition", icon: "leaf", source: "nutrition",
        countScore: false, attr: "Vitality", category: "protein", enabled: true, order: 3,
        idPrefix: "diet", items: settings.dietItems || clone(DEFAULT_DIET), xpPer: XP_BY_CAT.protein,
        target: { kind: "days", value: num(settings.proteinMin, 7) } },
      { id: "study", type: "hours-table", name: "Study", icon: "book", source: "study",
        countScore: false, attr: "Mind", category: "study", enabled: true, order: 4,
        rows: settings.studyAreas || clone(DEFAULT_STUDY_AREAS), hoursPrefix: "hours-study",
        xpPerHour: STUDY_HOUR_XP, target: { kind: "hours", value: num(settings.studyTarget, 14) } },
      { id: "projects", type: "composite", name: "Projects", icon: "cube", source: "projects",
        countScore: false, attr: "Craft", category: "project", enabled: true, order: 5,
        outputs: { idPrefix: "project", items: settings.projectChecks || clone(DEFAULT_PROJECT_CHECKS), xpPer: XP_BY_CAT.project },
        hoursField: "projectHours", xpPerHour: PROJECT_HOUR_XP, focusField: "projectFocus",
        target: { kind: "hours", value: num(settings.projectTarget, 2) } },
      { id: "review", type: "review", name: "Weekly Review", icon: "clipboard", source: "review",
        countScore: false, attr: "Discipline", category: "discipline", enabled: true, order: 6,
        fields: ["wins", "misses", "changes", "refuseDrop"], gradeField: "grade",
        prompts: settings.reviewPrompts || clone(DEFAULT_REVIEW), xpPer: REVIEW_XP },
    ];
  }

  // Apply the user's lightweight overlays — renames, reorders and show/hide —
  // onto the base modules. These are presentation-only: `enabled` drives section
  // visibility (mirrors the legacy hiddenSections), it does NOT change scoring,
  // so historical weeks keep their exact score/XP (the engine ignores `enabled`).
  function applyOverlays(modules, settings) {
    settings = settings || {};
    const names = settings.moduleNames || {};
    const hidden = settings.hiddenSections || [];
    const order = settings.moduleOrder;
    modules.forEach((m) => {
      if (names[m.id]) m.name = names[m.id];
      m.enabled = !hidden.includes(m.id);
    });
    if (Array.isArray(order) && order.length) {
      const pos = (id) => { const i = order.indexOf(id); return i < 0 ? 999 : i; };
      modules.sort((a, b) => pos(a.id) - pos(b.id));
    }
    modules.forEach((m, i) => { m.order = i + 1; });
    return modules;
  }
  function num(v, d) { return (v == null || v === "") ? d : Number(v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ----- score: which ids count toward the weekly completion % -------------
  function scoreIds(modules) {
    const ids = [];
    (modules || []).forEach((m) => {
      // `enabled` is visibility-only; scoring always counts so hiding a section
      // never retroactively changes historical weeks.
      if (!m.countScore) return;
      if (m.type === "daily") {
        const bp = m.blueprint || {};
        Object.keys(bp).forEach((day, i) => (bp[day] || []).forEach((t) => ids.push(taskId(i, t))));
      } else if (m.type === "table") {
        const n = m.checkCount != null ? m.checkCount : (m.rows ? m.rows.length : 0);
        for (let i = 0; i < n; i++) ids.push(`${m.idPrefix}-${i}`);
      } else if (m.type === "checklist") {
        (m.items || []).forEach((it) => ids.push(checklistId(m.idPrefix, it)));
      }
    });
    return ids;
  }
  function counterField(m) { return m.field || `${m.idPrefix}-count`; }
  function notesField(m) { return m.field || `${m.idPrefix}-notes`; }
  function weekScore(week, modules) {
    if (!week || !week.checks) return 0;
    const checks = week.checks, fields = week.fields || {};
    const set = new Set();          // checkbox ids — deduped, exactly like legacy
    let extraDone = 0, extraTotal = 0;
    (modules || []).forEach((m) => {
      if (!m.countScore) return;     // `enabled` is visibility-only (see note above)
      if (m.type === "daily") {
        const bp = m.blueprint || {};
        Object.keys(bp).forEach((day, i) => (bp[day] || []).forEach((t) => {
          if (taskLinkOf(m.taskLinks, t)) return;   // counted by its linked section instead
          set.add(taskId(i, t));
        }));
      } else if (m.type === "table") {
        const n = m.checkCount != null ? m.checkCount : (m.rows ? m.rows.length : 0);
        for (let i = 0; i < n; i++) set.add(`${m.idPrefix}-${i}`);
      } else if (m.type === "checklist") {
        (m.items || []).forEach((it) => set.add(checklistId(m.idPrefix, it)));
      } else if (m.type === "counter") {
        extraTotal++;
        const tgt = (m.target && m.target.value) ? Number(m.target.value) : 1;
        if (Number(fields[counterField(m)] || 0) >= tgt) extraDone++;
      } else if (m.type === "notes") {
        extraTotal++;
        const v = fields[notesField(m)];
        if (v && String(v).trim()) extraDone++;
      }
    });
    let done = extraDone;
    set.forEach((id) => { if (checks[id]) done++; });
    const total = set.size + extraTotal;
    return total ? Math.round((done / total) * 100) : 0;
  }

  // ----- xp: total + per-attribute + per-section, for one week -------------
  function weekXp(week, modules) {
    const out = { xp: 0, byAttr: {}, bySource: {} };
    if (!week) return out;
    const checks = week.checks || {};
    const fields = week.fields || {};
    function award(cat, amount, source) {
      out.xp += amount;
      const attr = ATTR_OF_CAT[cat];
      if (attr) out.byAttr[attr] = (out.byAttr[attr] || 0) + amount;
      if (source) out.bySource[source] = (out.bySource[source] || 0) + amount;
    }
    (modules || []).forEach((m) => {
      // `enabled` is visibility-only — XP always counts (see scoreIds note).
      if (m.type === "daily") {
        const bp = m.blueprint || {};
        Object.keys(bp).forEach((day, i) => (bp[day] || []).forEach((t) => {
          if (taskLinkOf(m.taskLinks, t)) return;       // XP comes from the linked section
          if (checks[taskId(i, t)]) {
            const attr = dailyAttr(t, m.taskAttrs);     // explicit attribute, else keyword default
            const c = CAT_OF_ATTR[attr] || "discipline";
            award(c, XP_BY_CAT[c] || XP_BY_CAT.other, m.source);
          }
        }));
      } else if (m.type === "table") {
        const n = m.checkCount != null ? m.checkCount : (m.rows ? m.rows.length : 0);
        for (let i = 0; i < n; i++) if (checks[`${m.idPrefix}-${i}`]) award(m.category, m.xpPer, m.source);
      } else if (m.type === "checklist") {
        (m.items || []).forEach((it) => { if (checks[checklistId(m.idPrefix, it)]) award(m.category, m.xpPer, m.source); });
      } else if (m.type === "hours-table") {
        let hours = 0;
        const pre = m.hoursPrefix + "-";
        for (const k in fields) if (k.indexOf(pre) === 0) hours += Number(fields[k] || 0);
        if (hours > 0) award(m.category, Math.round(hours * m.xpPerHour), m.source);
      } else if (m.type === "composite") {
        if (m.outputs) (m.outputs.items || []).forEach((it) => { if (checks[checklistId(m.outputs.idPrefix, it)]) award(m.category, m.outputs.xpPer, m.source); });
        if (m.hoursField) { const h = Number(fields[m.hoursField] || 0); if (h > 0) award(m.category, Math.round(h * m.xpPerHour), m.source); }
      } else if (m.type === "review") {
        let filled = 0;
        (m.fields || []).forEach((f) => { if (fields[f] && String(fields[f]).trim()) filled++; });
        if (m.gradeField && fields[m.gradeField] && fields[m.gradeField] !== "Not graded yet" && String(fields[m.gradeField]).trim()) filled++;
        if (filled > 0) award(m.category, filled * m.xpPer, m.source);
      } else if (m.type === "counter") {
        const v = Number(fields[counterField(m)] || 0);
        if (v > 0) award(m.category, Math.round(v * (m.xpPer || 0)), m.source);
      } else if (m.type === "notes") {
        const v = fields[notesField(m)];
        if (v && String(v).trim()) award(m.category, (m.xpPer || 0), m.source);
      }
    });
    return out;
  }

  // ----- presets: starter dashboards for different people ------------------
  // Each preset is presentation-only: it sets section order/visibility and adds
  // custom sections. It never touches logged week data. `custom` entries are
  // partial specs that the app turns into real modules (makeCustomModule).
  const BUILTIN_ORDER = ["daily", "workout", "diet", "study", "projects", "review"];
  const PRESETS = {
    operator: {
      name: "Operator", desc: "The original: discipline, training, study, projects, review.",
      hidden: [], order: BUILTIN_ORDER, names: {}, custom: [],
      links: { workout: "workout" }, // the daily "Workout" habit IS today's Training row
    },
    student: {
      name: "Student", desc: "Study-first — classes, reading and projects.",
      hidden: ["diet"], order: ["daily", "study", "projects", "review", "workout"], names: {},
      custom: [
        { type: "checklist", name: "Reading", attr: "Mind", items: ["Read assigned chapters", "Review notes"], xpPer: 10 },
        { type: "counter", name: "Study Sessions", attr: "Mind", targetValue: 10, unit: "sessions", xpPer: 5 },
      ],
    },
    athlete: {
      name: "Athlete", desc: "Training and nutrition front and center.",
      hidden: ["projects"], order: ["daily", "workout", "diet", "review", "study"], names: {},
      custom: [
        { type: "counter", name: "Cardio", attr: "Body", targetValue: 3, unit: "sessions", xpPer: 15 },
        { type: "counter", name: "Sleep", attr: "Vitality", targetValue: 49, unit: "hours", xpPer: 1 },
      ],
    },
    reader: {
      name: "Reader", desc: "Built around books and reflection.",
      hidden: ["workout", "diet", "study", "projects"], order: ["daily", "review"], names: {},
      custom: [
        { type: "counter", name: "Pages", attr: "Mind", targetValue: 140, unit: "pages", xpPer: 1 },
        { type: "counter", name: "Books Finished", attr: "Mind", targetValue: 1, unit: "books", xpPer: 100 },
        { type: "notes", name: "Reading Notes", attr: "Mind", xpPer: 10 },
      ],
    },
    maker: {
      name: "Maker", desc: "Ship things — deep work and output.",
      hidden: ["workout", "diet"], order: ["daily", "projects", "study", "review"], names: {},
      custom: [
        { type: "counter", name: "Deep Work", attr: "Craft", targetValue: 10, unit: "hours", xpPer: 12 },
        { type: "notes", name: "Ship Log", attr: "Craft", xpPer: 15 },
      ],
    },
    minimal: {
      name: "Minimal", desc: "Just daily habits and a weekly review.",
      hidden: ["workout", "diet", "study", "projects"], order: ["daily", "review"], names: {}, custom: [],
    },
  };

  return {
    XP_BY_CAT, ATTR_OF_CAT, CAT_OF_ATTR, ATTR_LIST, ATTR_COLOR, STUDY_HOUR_XP, PROJECT_HOUR_XP, REVIEW_XP, PRESETS, BUILTIN_ORDER,
    DEFAULT_BLUEPRINT, DEFAULT_WORKOUTS, DEFAULT_DIET, DEFAULT_PROJECT_CHECKS, DEFAULT_STUDY_AREAS, DEFAULT_REVIEW,
    slug, taskId, checklistId, categoryFor, dailyAttr, dailyAttrKey, taskLinkOf, linkTargetId, linkableModules, migrateModules, buildBaseModules, applyOverlays, scoreIds, weekScore, weekXp,
  };
});
