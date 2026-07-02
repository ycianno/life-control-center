const APP_DB_KEY = "lifeControlCenter.v2.database";
const APP_SETTINGS_KEY = "lifeControlCenter.v2.settings";
const LEGACY_KEY = "nonNegotiablesDashboardV1";

let selectedWeekStart = getStartOfWeek(new Date());
let database = { version: 2, weeks: {} };
let settings = { version: 3, dayTemplates: null };
let achievements = [];

// The module engine (modules.js) is the single source of truth for ids, score
// and XP. Built fresh from the current settings each call so in-place edits to
// settings.* lists are always reflected (rebuild is cheap at this app's scale).
function getModules() {
  if (!(window.Forge && Forge.buildBaseModules)) return [];
  const base = Forge.buildBaseModules(settings);
  const custom = (settings.customModules || []).map(normalizeCustomModule);
  return Forge.applyOverlays(base.concat(custom), settings);
}

// Fill in any missing fields on a stored custom module (defensive).
function normalizeCustomModule(m) {
  const cm = Object.assign({ custom: true, enabled: true, countScore: false, icon: "star" }, m);
  cm.idPrefix = cm.idPrefix || cm.id;
  cm.source = cm.source || cm.id;
  cm.category = cm.category || (window.Forge && Forge.CAT_OF_ATTR[cm.attr]) || "discipline";
  if (cm.type === "counter") cm.field = cm.field || `${cm.idPrefix}-count`;
  if (cm.type === "notes") cm.field = cm.field || `${cm.idPrefix}-notes`;
  if (cm.type === "table" && cm.checkCount == null) cm.checkCount = 7;
  return cm;
}

// Build a fresh custom-module definition from the Add Section form. The "daily"
// form type produces a per-day `table` module (a checkbox each day) — these are
// linkable to daily tasks exactly like the built-in Training section.
function makeCustomModule({ name, type, attr, items, targetValue, unit, xpPer }) {
  const id = "custom-" + (slugify(name).slice(0, 20) || "section") + "-" + Math.random().toString(36).slice(2, 6);
  const cat = (window.Forge && Forge.CAT_OF_ATTR[attr]) || "discipline";
  const m = { id, idPrefix: id, source: id, name: name || "New Section", type, attr, category: cat, icon: "star", enabled: true, countScore: false, custom: true };
  if (type === "checklist") { m.items = (items && items.length) ? items : ["First item"]; m.xpPer = Number(xpPer) || 10; }
  else if (type === "counter") { m.field = `${id}-count`; m.target = { kind: /hour|hr|min/i.test(unit || "") ? "hours" : "count", value: Number(targetValue) || 1, unit: unit || "" }; m.xpPer = Number(xpPer) || 5; }
  else if (type === "notes") { m.field = `${id}-notes`; m.xpPer = Number(xpPer) || 10; }
  else if (type === "daily") { m.type = "table"; m.checkCount = 7; m.xpPer = Number(xpPer) || 15; m.countScore = true; }
  return m;
}

// Drive the section DOM from the module list: apply each module's editable name
// to its <h2>, reorder sections to match module order, and apply visibility.
// Built-in section bodies are still rendered by the per-type render functions;
// custom sections are rendered generically (renderCustomSections). All emit the
// same ids the engine reads.
function applyModuleLayout() {
  const mods = getModules();
  const anchor = document.getElementById("editDayModal"); // sits right after the last section
  mods.forEach((m) => {
    const sec = document.getElementById(m.id);
    if (!sec) return;
    const h2 = sec.querySelector(".summary-left h2");
    if (h2 && m.name) h2.textContent = m.name;
    sec.style.display = (m.enabled === false) ? "none" : "";
    // Attribute badge in the header — makes "what stat this section feeds" obvious.
    // (Daily has no single attr — its tasks carry per-task dots instead.)
    const summary = sec.querySelector("summary");
    if (summary && m.attr) {
      let badge = summary.querySelector(".attr-badge");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "attr-badge";
        const chev = summary.querySelector(".chev");
        if (chev && chev.parentNode) chev.parentNode.insertBefore(badge, chev);
        else summary.appendChild(badge);
      }
      badge.textContent = attrName(m.attr);
      badge.style.setProperty("--ac", attrColor(m.attr));
    }
    if (anchor && anchor.parentNode === sec.parentNode) anchor.parentNode.insertBefore(sec, anchor);
  });
}

// ===== GENERIC CUSTOM-SECTION RENDERER =====
function customHint(m) {
  if (m.type === "checklist") return `Each item is worth +${m.xpPer} XP.`;
  if (m.type === "counter") { const u = m.target && m.target.unit ? ` ${m.target.unit}` : ""; return `Target: ${(m.target && m.target.value) || 1}${u} per week · +${m.xpPer} XP each.`; }
  if (m.type === "notes") return `Free-form notes · +${m.xpPer} XP when filled.`;
  if (m.type === "table") return `A checkbox for each day · +${m.xpPer} XP each · linkable to a daily task.`;
  return "";
}
function customSectionHtml(m) {
  const head = `<summary><div class="summary-left"><h2>${escapeHtml(m.name)}</h2><p class="hint">${escapeHtml(customHint(m))}</p></div><div style="display:flex;gap:8px;align-items:center;"><button class="icon-btn edit-section-btn" type="button" data-module-id="${m.id}" title="Edit pursuit"><svg viewBox="0 0 24 24" class="ic"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button><span class="chev">⌄</span></div></summary>`;
  let body = "";
  if (m.type === "checklist") {
    body = `<div class="content"><div class="grid grid-3">` + (m.items || []).map((it) =>
      `<label class="check quest"><input id="${Forge.checklistId(m.idPrefix, it)}" type="checkbox" data-cat="${escapeHtml(m.category)}" data-save><span class="q-text">${escapeHtml(it)}</span><span class="q-xp">+${m.xpPer}</span></label>`
    ).join("") + `</div></div>`;
  } else if (m.type === "counter") {
    const u = m.target && m.target.unit ? escapeHtml(m.target.unit) : "";
    const tgt = (m.target && m.target.value) || 1;
    body = `<div class="content"><div class="metric"><div class="top"><div><div class="metric-title">${escapeHtml(m.name)}</div><p class="hint">Target: ${tgt} ${u} · +${m.xpPer} XP each</p></div><span class="metric-number"><span class="counter-total" data-counter="${m.id}">0</span>/${tgt}</span></div><div class="bar"><div class="bar-fill" data-counter-bar="${m.id}"></div></div><label class="label" style="margin-top:14px">Logged manually ${u}</label><input id="${escapeHtml(m.field)}" type="number" min="0" step="any" value="0" data-save><p class="hint counter-sessions" data-counter-sessions="${m.id}"></p></div></div>`;
  } else if (m.type === "notes") {
    body = `<div class="content"><textarea id="${escapeHtml(m.field)}" data-save placeholder="${escapeHtml(m.name)}..."></textarea></div>`;
  } else if (m.type === "table") {
    const days = (typeof dayNames === "function") ? dayNames() : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const n = m.checkCount || 7;
    let rows = "";
    for (let i = 0; i < n; i++) {
      rows += `<tr><td>${escapeHtml(days[i] || ("Day " + (i + 1)))}</td><td><label class="check"><input id="${m.idPrefix}-${i}" type="checkbox" data-cat="${escapeHtml(m.category)}" data-save><span>Done <span class="q-xp">+${m.xpPer}</span></span></label></td><td data-label="Notes"><input id="${m.idPrefix}-note-${i}" type="text" placeholder="Notes..." data-save></td></tr>`;
    }
    body = `<div class="content"><table><thead><tr><th>Day</th><th>Done</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  return head + body;
}
function renderCustomSections() {
  if (!window.Forge) return;
  const mods = getModules().filter((m) => m.custom);
  const anchor = document.getElementById("editDayModal");
  const present = new Set();
  mods.forEach((m) => {
    present.add(m.id);
    let sec = document.getElementById(m.id);
    if (!sec) {
      sec = document.createElement("details");
      sec.id = m.id;
      sec.className = "section section-card glass";
      sec.open = true;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor);
    }
    sec.dataset.custom = "1";
    sec.innerHTML = customSectionHtml(m);
  });
  document.querySelectorAll('details.section-card[data-custom="1"]').forEach((sec) => {
    if (!present.has(sec.id)) sec.remove();
  });
}

// ===== SECTIONS (MODULES) EDITOR =====
let modPersistTimer = null;
function persistSettingsSoon() {
  clearTimeout(modPersistTimer);
  modPersistTimer = setTimeout(persistSettings, 350);
}
function renderModulesEditor() {
  const wrap = document.getElementById("modulesEditor");
  if (!wrap) return;
  const mods = getModules();
  const attrs = (window.Forge && Forge.ATTR_LIST) ? Forge.ATTR_LIST : ["Discipline", "Body", "Mind", "Vitality", "Craft"];
  const rows = mods.map((m, i) => {
    const row = `
    <div class="mod-row" data-id="${m.id}">
      <div class="mod-reorder">
        <button class="mod-up" type="button" title="Move up" aria-label="Move up" ${i === 0 ? "disabled" : ""}><svg viewBox="0 0 24 24" class="ic"><path d="M18 15l-6-6-6 6"/></svg></button>
        <button class="mod-down" type="button" title="Move down" aria-label="Move down" ${i === mods.length - 1 ? "disabled" : ""}><svg viewBox="0 0 24 24" class="ic"><path d="M6 9l6 6 6-6"/></svg></button>
      </div>
      <input class="mod-name" type="text" value="${escapeHtml(m.name)}" maxlength="28" aria-label="Section name" spellcheck="false">
      <label class="mod-show"><input type="checkbox" class="mod-enabled" ${m.enabled ? "checked" : ""}><span>Show</span></label>
      ${m.custom
        ? `<button class="mod-edit" type="button" title="Edit pursuit" aria-label="Edit pursuit"><svg viewBox="0 0 24 24" class="ic"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
           <button class="mod-del" type="button" title="Delete pursuit" aria-label="Delete pursuit"><svg viewBox="0 0 24 24" class="ic"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`
        : `<span class="mod-builtin" title="Built-in pursuit (edit its content from the pursuit itself)"><svg viewBox="0 0 24 24" class="ic"><path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3z"/></svg></span>`}
    </div>`;
    return row;
  }).join("");
  const form = `
    <div class="mod-add">
      <button class="mod-add-toggle" type="button" id="modAddToggle">+ Add a pursuit</button>
      <div class="mod-add-form" id="modAddForm" style="display:none;">
        <label class="label">Name</label>
        <input type="text" id="newModName" placeholder="e.g. Reading" maxlength="28">
        <div class="form-row">
          <div class="form-col"><label class="label">Type</label>
            <select id="newModType">
              <option value="daily">Daily checkbox (one per day · linkable)</option>
              <option value="checklist">Checklist (weekly items)</option>
              <option value="counter">Counter (number / hours)</option>
              <option value="notes">Notes</option>
            </select></div>
          <div class="form-col"><label class="label">Feeds stat</label>
            <select id="newModAttr">${attrs.map((a) => `<option value="${a}">${escapeHtml(attrName(a))}</option>`).join("")}</select></div>
        </div>
        <div id="newModChecklist">
          <label class="label">Items (one per line)</label>
          <textarea id="newModItems" placeholder="Read 20 pages&#10;No phone in bed"></textarea>
        </div>
        <div id="newModCounter" style="display:none;">
          <div class="form-row">
            <div class="form-col"><label class="label">Weekly target</label><input type="number" id="newModTarget" min="0" step="any" value="7"></div>
            <div class="form-col"><label class="label">Unit</label><input type="text" id="newModUnit" placeholder="pages · min · km"></div>
          </div>
        </div>
        <label class="label">XP per item/unit</label>
        <input type="number" id="newModXp" min="0" step="1" value="10">
        <div class="modal-actions" style="margin-top:12px;">
          <button type="button" id="newModCancel">Cancel</button>
          <button type="button" class="primary" id="newModSave">Add Pursuit</button>
        </div>
      </div>
    </div>`;
  const presets = (window.Forge && Forge.PRESETS) ? Forge.PRESETS : {};
  const presetRow = `<div class="mod-presets"><span class="mod-presets-label">Start from a preset</span><div class="mod-presets-row">`
    + Object.entries(presets).map(([id, p]) => `<button class="mod-preset" type="button" data-preset="${id}" title="${escapeHtml(p.desc)}">${escapeHtml(p.name)}</button>`).join("")
    + `</div></div>`;
  wrap.innerHTML = presetRow + rows + form;
}
// ----- Edit Section modal (custom sections) — reachable from the section's own
// pencil and from Settings → Sections. Lets the user set name, stat, XP, items,
// and the weekly target/limit.
let editSectionId = null;
function sectionEditBodyHtml(m) {
  const attrs = (window.Forge && Forge.ATTR_LIST) ? Forge.ATTR_LIST : [];
  const attrOpts = attrs.map((a) => `<option value="${a}" ${a === m.attr ? "selected" : ""}>${escapeHtml(attrName(a))}</option>`).join("");
  let typeFields = "";
  if (m.type === "checklist") {
    typeFields = `<label class="label">Items (one per line)</label><textarea class="es-items">${escapeHtml((m.items || []).join("\n"))}</textarea>`;
  } else if (m.type === "counter") {
    typeFields = `<div class="form-row"><div class="form-col"><label class="label">Weekly target (your limit)</label><input type="number" class="es-target" min="0" step="any" value="${(m.target && m.target.value) || 0}"></div><div class="form-col"><label class="label">Unit</label><input type="text" class="es-unit" value="${escapeHtml((m.target && m.target.unit) || "")}"></div></div>`;
  }
  return `<label class="label">Name</label><input type="text" class="es-name" value="${escapeHtml(m.name)}" maxlength="28" spellcheck="false">
    <div class="form-row">
      <div class="form-col"><label class="label">Feeds stat</label><select class="es-attr">${attrOpts}</select></div>
      <div class="form-col"><label class="label">XP per ${m.type === "counter" ? "unit" : m.type === "table" ? "day" : "item"}</label><input type="number" class="es-xp" min="0" step="1" value="${m.xpPer || 0}"></div>
    </div>
    ${typeFields}
    <label class="me-score" style="margin-top:12px;"><input type="checkbox" class="es-countscore" ${m.countScore ? "checked" : ""}><span>Count toward weekly score</span></label>`;
}
function openSectionEditor(id) {
  const m = (settings.customModules || []).find((x) => x.id === id);
  if (!m) return;
  editSectionId = id;
  document.getElementById("editSectionTitle").textContent = `Edit ${m.name}`;
  document.getElementById("editSectionBody").innerHTML = sectionEditBodyHtml(m);
  const md = document.getElementById("editSectionModal");
  md.classList.add("active"); md.setAttribute("aria-hidden", "false");
}
function closeSectionEditor() {
  editSectionId = null;
  const md = document.getElementById("editSectionModal");
  md.classList.remove("active"); md.setAttribute("aria-hidden", "true");
}
function saveSectionEditor() {
  const m = (settings.customModules || []).find((x) => x.id === editSectionId);
  const body = document.getElementById("editSectionBody");
  if (!m || !body) { closeSectionEditor(); return; }
  const name = (body.querySelector(".es-name").value || "").trim();
  if (name) { m.name = name; if (settings.moduleNames) delete settings.moduleNames[m.id]; }
  const attr = body.querySelector(".es-attr").value;
  m.attr = attr;
  m.category = (window.Forge && Forge.CAT_OF_ATTR[attr]) || "discipline";
  m.xpPer = Number(body.querySelector(".es-xp").value) || 0;
  m.countScore = body.querySelector(".es-countscore").checked;
  if (m.type === "checklist") {
    const items = (body.querySelector(".es-items").value || "").split("\n").map((s) => s.trim()).filter(Boolean);
    m.items = items.length ? items : ["First item"];
  } else if (m.type === "counter") {
    const unit = body.querySelector(".es-unit").value || "";
    m.target = { kind: /hour|hr|min/i.test(unit) ? "hours" : "count", value: Number(body.querySelector(".es-target").value) || 1, unit };
  }
  persistSettings();
  closeSectionEditor();
  renderModulesEditor();
  applyWeekToUI();
}
function applyPreset(id, skipConfirm) {
  const p = (window.Forge && Forge.PRESETS) ? Forge.PRESETS[id] : null;
  if (!p) return;
  if (!skipConfirm && !confirm(`Load the "${p.name}" preset? It rearranges your sections and may add a few. Your logged data is kept.`)) return;
  settings.hiddenSections = (p.hidden || []).slice();
  settings.moduleNames = Object.assign({}, p.names || {});
  settings.customModules = (p.custom || []).map((spec) => makeCustomModule(spec));
  settings.taskLinks = Object.assign({}, p.links || {});
  const order = (p.order && p.order.length) ? p.order.slice() : (window.Forge ? Forge.BUILTIN_ORDER.slice() : []);
  settings.moduleOrder = order.concat(settings.customModules.map((m) => m.id));
  persistSettings();
  renderModulesEditor();
  applyWeekToUI();
}
// ----- First-run onboarding ("Choose your path") -----
// Shown once, only to a genuinely fresh install (no logged data, no customization).
// Existing heroes are marked onboarded silently so they never see it.
const ONBOARD_PATHS = ["operator", "student", "athlete", "reader", "maker", "minimal"];
function renderOnboardingPaths() {
  const wrap = document.getElementById("onboardPaths");
  if (!wrap) return;
  const presets = (window.Forge && Forge.PRESETS) ? Forge.PRESETS : {};
  wrap.innerHTML = ONBOARD_PATHS.filter((id) => presets[id]).map((id) => {
    const p = presets[id];
    return `<button class="onboard-path" type="button" data-preset="${id}">`
      + `<span class="op-name">${escapeHtml(p.name)}</span>`
      + `<span class="op-desc">${escapeHtml(p.desc)}</span></button>`;
  }).join("");
}
function hasLoggedData() {
  const weeks = (database && database.weeks) || {};
  return Object.keys(weeks).some((k) => {
    const w = weeks[k];
    return w && ((w.checks && Object.keys(w.checks).length) || (w.fields && Object.keys(w.fields).length));
  });
}
function isCustomized() {
  return !!(settings && ((settings.customModules && settings.customModules.length)
    || (settings.taskLinks && Object.keys(settings.taskLinks).length)
    || (settings.moduleNames && Object.keys(settings.moduleNames).length)
    || (settings.hiddenSections && settings.hiddenSections.length)
    || settings.callsign));
}
function maybeShowOnboarding() {
  if (!settings || settings.onboarded) return;
  // Anyone with existing history or a tweaked setup is an established user — don't interrupt them.
  if (hasLoggedData() || isCustomized()) { settings.onboarded = true; persistSettings(); return; }
  renderOnboardingPaths();
  const md = document.getElementById("onboardModal");
  if (md) { md.classList.add("active"); md.setAttribute("aria-hidden", "false"); }
}
function finishOnboarding() {
  settings.onboarded = true;
  persistSettings();
  const md = document.getElementById("onboardModal");
  if (md) { md.classList.remove("active"); md.setAttribute("aria-hidden", "true"); }
  applyWeekToUI();
  if (window.Game && Game.render) Game.render();
}
function chooseOnboardPath(presetId) {
  const csEl = document.getElementById("onboardCallsign");
  const cs = csEl ? csEl.value.trim() : "";
  if (cs) settings.callsign = cs;
  applyPreset(presetId, true); // fresh install — no confirm needed
  finishOnboarding();
}
// "Start blank" — a genuinely empty slate: clear every section's items so the
// light starter defaults don't appear. The user builds everything themselves.
// Reloads after saving (like sample-data load) so the module list rebuilds clean.
async function startBlank() {
  const csEl = document.getElementById("onboardCallsign");
  const cs = csEl ? csEl.value.trim() : "";
  if (cs) settings.callsign = cs;
  const emptyDays = {};
  dayNames().forEach((d) => { emptyDays[d] = []; });
  settings.dayTemplates = emptyDays;
  settings.dietItems = [];
  settings.studyAreas = [];
  settings.projectChecks = [];
  settings.workouts = [];
  settings.reviewPrompts = [];
  settings.onboarded = true;
  await persistSettings();
  location.reload();
}
function toggleAddFormFields() {
  const t = document.getElementById("newModType");
  if (!t) return;
  const cl = document.getElementById("newModChecklist");
  const co = document.getElementById("newModCounter");
  if (cl) cl.style.display = t.value === "checklist" ? "" : "none";
  if (co) co.style.display = t.value === "counter" ? "" : "none";
}
function addCustomModuleFromForm() {
  const name = (document.getElementById("newModName").value || "").trim();
  if (!name) { alert("Give the pursuit a name."); return; }
  const m = makeCustomModule({
    name,
    type: document.getElementById("newModType").value,
    attr: document.getElementById("newModAttr").value,
    items: (document.getElementById("newModItems").value || "").split("\n").map((s) => s.trim()).filter(Boolean),
    targetValue: document.getElementById("newModTarget").value,
    unit: document.getElementById("newModUnit").value,
    xpPer: document.getElementById("newModXp").value,
  });
  if (!settings.customModules) settings.customModules = [];
  settings.customModules.push(m);
  settings.moduleOrder = getModules().map((x) => x.id); // keep new section at the end, stably
  persistSettings();
  renderModulesEditor();
  applyWeekToUI();
}
function deleteCustomModule(id) {
  if (!confirm("Delete this pursuit? Anything you already logged stays in your weeks; only the pursuit is removed.")) return;
  settings.customModules = (settings.customModules || []).filter((m) => m.id !== id);
  if (Array.isArray(settings.moduleOrder)) settings.moduleOrder = settings.moduleOrder.filter((x) => x !== id);
  if (settings.moduleNames) delete settings.moduleNames[id];
  if (Array.isArray(settings.hiddenSections)) settings.hiddenSections = settings.hiddenSections.filter((x) => x !== id);
  persistSettings();
  renderModulesEditor();
  applyWeekToUI();
}
function moveModule(id, dir) {
  const order = getModules().map(m => m.id);
  const i = order.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  settings.moduleOrder = order;
  persistSettings();
  renderModulesEditor();
  applyModuleLayout();
}
function renameModule(id, name) {
  if (!settings.moduleNames) settings.moduleNames = {};
  settings.moduleNames[id] = name;
  applyModuleLayout();        // live preview of the new <h2>
  persistSettingsSoon();      // debounced server write
}
function toggleModule(id, show) {
  let hidden = getHiddenSections().slice();
  if (show) hidden = hidden.filter(x => x !== id);
  else if (!hidden.includes(id)) hidden.push(id);
  settings.hiddenSections = hidden;
  persistSettings();
  applySectionVisibility();
}
function wireModulesEditor() {
  const wrap = document.getElementById("modulesEditor");
  if (!wrap) return;
  wrap.addEventListener("click", (e) => {
    const pBtn = e.target.closest(".mod-preset");
    if (pBtn) { applyPreset(pBtn.dataset.preset); return; }
    if (e.target.closest("#modAddToggle")) { const f = document.getElementById("modAddForm"); if (f) { f.style.display = ""; toggleAddFormFields(); } return; }
    if (e.target.closest("#newModCancel")) { const f = document.getElementById("modAddForm"); if (f) f.style.display = "none"; return; }
    if (e.target.closest("#newModSave")) { addCustomModuleFromForm(); return; }
    const row = e.target.closest(".mod-row"); if (!row) return;
    if (e.target.closest(".mod-up")) moveModule(row.dataset.id, -1);
    else if (e.target.closest(".mod-down")) moveModule(row.dataset.id, 1);
    else if (e.target.closest(".mod-edit")) openSectionEditor(row.dataset.id);
    else if (e.target.closest(".mod-del")) deleteCustomModule(row.dataset.id);
  });
  wrap.addEventListener("input", (e) => {
    if (!e.target.classList.contains("mod-name")) return;
    const row = e.target.closest(".mod-row"); if (row) renameModule(row.dataset.id, e.target.value);
  });
  wrap.addEventListener("change", (e) => {
    if (e.target.id === "newModType") { toggleAddFormFields(); return; }
    if (!e.target.classList.contains("mod-enabled")) return;
    const row = e.target.closest(".mod-row"); if (row) toggleModule(row.dataset.id, e.target.checked);
  });
}

// ===== STATS (ATTRIBUTES) EDITOR — rename + recolor the 5 stats =====
let attrRefreshTimer = null;
function refreshAttrUISoon() {
  clearTimeout(attrRefreshTimer);
  attrRefreshTimer = setTimeout(() => { applyWeekToUI(); if (window.Game) Game.render(); }, 200);
}
function renderStatsEditor() {
  const wrap = document.getElementById("statsEditor");
  if (!wrap) return;
  const keys = (window.Forge && Forge.ATTR_LIST) ? Forge.ATTR_LIST : [];
  wrap.innerHTML = keys.map((k) => `
    <div class="stat-row" data-attr="${k}">
      <input type="color" class="stat-color" value="${attrColor(k)}" aria-label="${k} color">
      <input type="text" class="stat-name" value="${escapeHtml(attrName(k))}" maxlength="18" aria-label="${k} name" spellcheck="false">
      <span class="stat-key">${k}</span>
    </div>`).join("");
}
function wireStatsEditor() {
  const wrap = document.getElementById("statsEditor");
  if (!wrap) return;
  wrap.addEventListener("input", (e) => {
    const row = e.target.closest(".stat-row"); if (!row) return;
    const k = row.dataset.attr;
    if (e.target.classList.contains("stat-name")) {
      if (!settings.attrLabels) settings.attrLabels = {};
      const v = e.target.value.trim();
      if (v && v !== k) settings.attrLabels[k] = v; else delete settings.attrLabels[k];
    } else if (e.target.classList.contains("stat-color")) {
      if (!settings.attrColors) settings.attrColors = {};
      settings.attrColors[k] = e.target.value;
    } else return;
    persistSettingsSoon();
    refreshAttrUISoon();
  });
}
let saveTimer = null;
let editingDayIndex = null;
let booting = true;   // suppresses persistence during the instant cache-paint at startup

// ===== THEMES =====
const THEMES = [
  { id: 'true-black', name: 'True Black', preview: '#030305', gradient: 'linear-gradient(135deg, #38bdf8, #8b5cf6)' },
  { id: 'crimson-night', name: 'Crimson', preview: '#14060a', gradient: 'linear-gradient(135deg, #ef4444, #f43f5e)' },
  { id: 'deep-forest', name: 'Deep Forest', preview: '#021a07', gradient: 'linear-gradient(135deg, #22c55e, #14b8a6)' },
  { id: 'warm-ember', name: 'Warm Ember', preview: '#1a0a02', gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)' },
  { id: 'royal-purple', name: 'Royal Purple', preview: '#0c0520', gradient: 'linear-gradient(135deg, #a78bfa, #e879f9)' },
  { id: 'midnight', name: 'Midnight', preview: '#050b1a', gradient: 'linear-gradient(135deg, #3b82f6, #22d3ee)' },
  { id: 'nord', name: 'Nord', preview: '#0e1320', gradient: 'linear-gradient(135deg, #88c0d0, #b48ead)' },
  { id: 'synthwave', name: 'Synthwave', preview: '#0d0418', gradient: 'linear-gradient(135deg, #ec4899, #22d3ee)' },
  { id: 'aurora', name: 'Aurora', preview: '#04140f', gradient: 'linear-gradient(135deg, #2dd4bf, #818cf8)' },
  { id: 'carbon', name: 'Carbon', preview: '#0a0a0b', gradient: 'linear-gradient(135deg, #8a97a8, #5b6675)' },
];

// ===== DEVICE DETECTION =====
function isMobile() {
  return window.innerWidth <= 768;
}

function getTodayDayIndex() {
  return new Date().getDay(); // 0=Sunday matches dayNames() order
}

// ===== DATE UTILITIES =====
// A light, generic starter routine — the same simple habits every day. Meant to
// be edited: a fresh install should feel welcoming, not like someone else's life.
const STARTER_DAY = ["Make the bed", "Drink water", "Move your body (walk or workout)", "Eat something healthy", "Read or learn for 20 min", "Tidy one thing", "Plan tomorrow", "Lights out on time"];
const defaultDailyBlueprint = {
  Sunday: [...STARTER_DAY],
  Monday: [...STARTER_DAY],
  Tuesday: [...STARTER_DAY],
  Wednesday: [...STARTER_DAY],
  Thursday: [...STARTER_DAY],
  Friday: [...STARTER_DAY],
  Saturday: [...STARTER_DAY]
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

// Last-known state mirrored to localStorage so a reload paints instantly (no empty flash).
function readCache(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function cacheState() {
  try {
    localStorage.setItem(APP_DB_KEY, JSON.stringify(database));
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {}
}

async function persistDatabase() {
  if (booting) return;
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
  if (booting) return;
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

// Category inference for free-text daily tasks now lives in modules.js (single
// source of truth, shared by the XP engine). This thin wrapper keeps callers.
function categoryFor(text) {
  return (window.Forge && Forge.categoryFor) ? Forge.categoryFor(text) : "discipline";
}

// A daily task's attribute (explicit override, else keyword default). The
// attribute is the link between a daily habit and the section that trains the
// same stat — e.g. a "Body" task lines up with Training (also Body).
function taskAttr(text) {
  // A linked task auto-takes its section's stat; otherwise use the explicit/inferred attr.
  if (window.Forge) {
    const lm = Forge.linkModule(taskLink(text), getModules());
    if (lm && lm.attr) return lm.attr;
    return Forge.dailyAttr(text, settings.taskAttrs);
  }
  return "Discipline";
}
function setTaskAttr(text, attr) {
  if (!settings.taskAttrs) settings.taskAttrs = {};
  const key = (window.Forge && Forge.dailyAttrKey) ? Forge.dailyAttrKey(text) : text;
  settings.taskAttrs[key] = attr;
  persistSettings();
  applyWeekToUI();
}
// A daily task's link to a per-day section (module id), or null. When linked,
// the task and the section's row for that day are the same checkbox.
function taskLink(text) {
  return (window.Forge && Forge.taskLinkOf) ? Forge.taskLinkOf(settings.taskLinks, text) : null;
}
function setTaskLink(text, moduleId) {
  if (!settings.taskLinks) settings.taskLinks = {};
  const key = (window.Forge && Forge.dailyAttrKey) ? Forge.dailyAttrKey(text) : text;
  if (moduleId) settings.taskLinks[key] = moduleId; else delete settings.taskLinks[key];
  persistSettings();
  applyWeekToUI();
}
function attrCat(attr) { return (window.Forge && Forge.CAT_OF_ATTR[attr]) || "discipline"; }
// Attribute display name + color honor the user's overrides (Phase D). The
// internal key (Body/Mind/…) never changes, so the engine/classes/insignias keep
// working; only the label and color the user sees are customizable.
function attrName(attr) { return (settings.attrLabels && settings.attrLabels[attr]) || attr; }
function attrColor(attr) { return (settings.attrColors && settings.attrColors[attr]) || (window.Forge && Forge.ATTR_COLOR[attr]) || "#94a3b8"; }

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
// ----- Records (achievements) -------------------------------------------
// SVG icons (no emoji) keep Records visually consistent with the rest of the app.
const RECORD_ICONS = {
  certification: "M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM8.21 13.89 7 23l5-3 5 3-1.21-9.12",
  learning:      "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
  career:        "M23 6l-9.5 9.5-5-5L1 18M17 6h6v6",
  fitness:       "M6.5 6.5v11M3.5 9v5M17.5 6.5v11M20.5 9v5M6.5 12h11",
  project:       "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2zM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",
  finance:       "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  milestone:     "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7",
  personal:      "M12 2l3 7h7l-5.5 4 2 7L12 17l-6.5 3 2-7L2 9h7z",
};
const RECORD_COLOR = {
  certification: "#fbbf24", learning: "#a78bfa", career: "#38bdf8", fitness: "#fb7185",
  project: "#34d399", finance: "#22d3ee", milestone: "#f43f5e", personal: "#94a3b8",
};
const RECORD_LABEL = {
  certification: "Certification", learning: "Learning", career: "Career", fitness: "Fitness PR",
  project: "Project", finance: "Finance", milestone: "Milestone", personal: "Personal",
};
const REC_BTN = {
  star: "M12 2l3 7h7l-5.5 4 2 7L12 17l-6.5 3 2-7L2 9h7z",
  pencil: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z",
  x: "M18 6 6 18M6 6l12 12",
};
let recordFilter = "all";
function recIcon(cat) { return RECORD_ICONS[cat] || RECORD_ICONS.personal; }
function recSvg(path) { return `<svg viewBox="0 0 24 24" class="ic"><path d="${path}"/></svg>`; }
function recTags(a) { return (a.tags || "").split(",").map(t => t.trim()).filter(Boolean); }

// Personal-best map: for fitness records with a value, the max per group (first
// tag, else title) is the PR; record the delta from the prior best in the group.
function computePRs() {
  const groups = {};
  achievements.forEach(a => {
    if (a.category !== "fitness" || a.value == null) return;
    const key = (recTags(a)[0] || a.title || "").toLowerCase();
    (groups[key] = groups[key] || []).push(a);
  });
  const pr = {};
  Object.values(groups).forEach(arr => {
    arr.sort((x, y) => Number(x.value) - Number(y.value));
    const best = arr[arr.length - 1], prev = arr[arr.length - 2];
    if (best) pr[best.id] = { isPR: true, delta: prev ? Number(best.value) - Number(prev.value) : 0 };
  });
  return pr;
}

function renderTrophyCase() {
  const list = document.getElementById('trophyList');
  if (!list) return;
  renderRecordFilters();

  const total = achievements.length;
  const pinnedN = achievements.filter(a => a.pinned).length;
  const countEl = document.getElementById('recordCount');
  if (countEl) countEl.textContent = total ? `${total} record${total === 1 ? '' : 's'}${pinnedN ? ` · ${pinnedN} pinned` : ''}` : 'Real-life wins worth keeping';

  if (total === 0) {
    list.innerHTML = `
      <div class="trophy-empty">
        <div class="trophy-empty-icon">${recSvg(RECORD_ICONS.milestone)}</div>
        <p>No records yet.</p>
        <p class="hint">Log a certification, a PR, a launch — anything worth keeping.</p>
      </div>`;
    return;
  }

  const pr = computePRs();
  const rows = achievements
    .filter(a => recordFilter === 'all' || a.category === recordFilter)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.completed_at) - new Date(a.completed_at));

  if (rows.length === 0) {
    list.innerHTML = `<div class="trophy-empty"><p class="hint">No ${escapeHtml(RECORD_LABEL[recordFilter] || recordFilter)} records yet.</p></div>`;
    return;
  }

  list.innerHTML = rows.map(a => {
    const cat = a.category || 'personal';
    const color = RECORD_COLOR[cat] || RECORD_COLOR.personal;
    const tags = recTags(a);
    const prInfo = pr[a.id];
    const metric = (a.value != null && a.value !== '') ? `<span class="rec-metric">${escapeHtml(String(a.value))}${a.unit ? ' ' + escapeHtml(a.unit) : ''}</span>` : '';
    const prBadge = prInfo && prInfo.isPR ? `<span class="rec-pr" title="Personal best">PR${prInfo.delta > 0 ? ' +' + (Math.round(prInfo.delta * 100) / 100) : ''}</span>` : '';
    const autoBadge = a.source === 'auto' ? '<span class="rec-auto">auto</span>' : '';
    const dateStr = a.completed_at ? new Date(a.completed_at).toLocaleDateString() : '';
    return `
    <div class="rec-card ${a.pinned ? 'pinned' : ''} ${prInfo && prInfo.isPR ? 'is-pr' : ''}" style="--rc:${color}">
      <span class="rec-ic">${recSvg(recIcon(cat))}</span>
      <div class="rec-body">
        <div class="rec-top">
          <strong class="rec-title">${escapeHtml(a.title)}</strong>
          ${metric}
        </div>
        <div class="rec-meta">
          <span>${escapeHtml(dateStr)}</span><span class="rec-cat">${escapeHtml(RECORD_LABEL[cat] || cat)}</span>${autoBadge}${prBadge}
        </div>
        ${tags.length ? `<div class="rec-tags">${tags.map(t => `<span class="rec-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        ${a.notes ? `<p class="rec-notes">${escapeHtml(a.notes)}</p>` : ''}
      </div>
      <div class="rec-actions">
        <button class="rec-btn rec-pin ${a.pinned ? 'on' : ''}" data-id="${a.id}" title="${a.pinned ? 'Unpin' : 'Pin'}">${recSvg(REC_BTN.star)}</button>
        <button class="rec-btn rec-edit" data-id="${a.id}" title="Edit">${recSvg(REC_BTN.pencil)}</button>
        <button class="rec-btn rec-del" data-id="${a.id}" title="Remove">${recSvg(REC_BTN.x)}</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.rec-pin').forEach(btn => btn.onclick = async () => {
    const a = achievements.find(x => String(x.id) === btn.dataset.id);
    if (a) await updateRecord(a.id, { pinned: a.pinned ? 0 : 1 });
  });
  list.querySelectorAll('.rec-edit').forEach(btn => btn.onclick = () => {
    const a = achievements.find(x => String(x.id) === btn.dataset.id);
    if (a) openRecordForm(a);
  });
  list.querySelectorAll('.rec-del').forEach(btn => btn.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm('Remove this record?')) return;
    try {
      await fetch(`/api/achievements/${btn.dataset.id}`, { method: 'DELETE' });
      await loadAchievements();
      renderTrophyCase();
    } catch (err) { alert('Failed to delete: ' + err.message); }
  });
}

function renderRecordFilters() {
  const host = document.getElementById('recordFilters');
  if (!host) return;
  const cats = [...new Set(achievements.map(a => a.category || 'personal'))];
  if (cats.length <= 1) { host.innerHTML = ''; return; }
  const chip = (f, label) => `<button class="rec-filter ${recordFilter === f ? 'on' : ''}" data-rfilter="${f}" type="button">${escapeHtml(label)}</button>`;
  host.innerHTML = chip('all', 'All') + cats.map(c => chip(c, RECORD_LABEL[c] || c)).join('');
  if (!host._wired) {
    host._wired = true;
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-rfilter]'); if (!b) return;
      recordFilter = b.dataset.rfilter;
      renderTrophyCase();
    });
  }
}

// Low-level create/update used by the form, the legacy shim, and auto-records.
async function saveRecord(payload) {
  try {
    const res = await fetch('/api/achievements', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await loadAchievements();
    renderTrophyCase();
    return res.json().catch(() => ({}));
  } catch (err) { alert('Failed to save: ' + err.message); }
}
async function updateRecord(id, patch) {
  try {
    await fetch(`/api/achievements/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await loadAchievements();
    renderTrophyCase();
  } catch (err) { alert('Failed to update: ' + err.message); }
}
// Legacy shim — kept so existing callers (cert auto-archive) keep working.
async function addAchievement(title, category, notes) {
  return saveRecord({ title, category, notes, completed_at: new Date().toISOString(), week_key: weekKey() });
}

// ----- Record add/edit form ----------------------------------------------
function openRecordForm(record) {
  const form = document.getElementById('addTrophyForm');
  const addBtn = document.getElementById('addTrophyBtn');
  if (!form) return;
  const g = id => document.getElementById(id);
  g('trophyEditId').value = record ? record.id : '';
  g('trophyTitle').value = record ? record.title : '';
  g('trophyCategory').value = record ? (record.category || 'personal') : 'certification';
  g('trophyDate').value = (record && record.completed_at) ? String(record.completed_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
  g('trophyValue').value = (record && record.value != null) ? record.value : '';
  g('trophyUnit').value = record ? (record.unit || '') : '';
  g('trophyTags').value = record ? (record.tags || '') : '';
  g('trophyNotes').value = record ? (record.notes || '') : '';
  g('saveTrophyBtn').textContent = record ? 'Save Changes' : 'Save Record';
  form.classList.add('active');
  if (addBtn) addBtn.style.display = 'none';
  g('trophyTitle').focus();
}
function closeRecordForm() {
  const form = document.getElementById('addTrophyForm');
  const addBtn = document.getElementById('addTrophyBtn');
  if (form) form.classList.remove('active');
  if (addBtn) addBtn.style.display = 'block';
  const e = document.getElementById('trophyEditId'); if (e) e.value = '';
}
async function saveRecordForm() {
  const g = id => document.getElementById(id);
  const title = g('trophyTitle').value.trim();
  if (!title) { alert('Please enter a title.'); return; }
  const editId = g('trophyEditId').value;
  const dateStr = g('trophyDate').value;
  const completed_at = dateStr ? new Date(dateStr + 'T12:00:00').toISOString() : new Date().toISOString();
  const payload = {
    title,
    category: g('trophyCategory').value,
    completed_at,
    value: g('trophyValue').value,
    unit: g('trophyUnit').value.trim(),
    tags: g('trophyTags').value.trim(),
    notes: g('trophyNotes').value.trim(),
  };
  if (editId) await updateRecord(editId, payload);
  else await saveRecord({ ...payload, week_key: weekKey(), source: 'manual' });
  closeRecordForm();
}

// ----- Auto-milestone records --------------------------------------------
// Called from game.js render() with the computed profile. Mirrors the engine's
// silent-first-run pattern: on the very first run we seed settings.seenRecords
// with whatever is already true (creating NO historical records); thereafter only
// freshly-crossed milestones POST a keepable record (source:auto, deduped by ext_key).
function autoMilestones(p) {
  const out = [];
  const add = (key, title, value) => out.push({ key, title, value });
  [10, 25, 50, 75, 99].forEach(L => { if (p.level >= L) add('lvl:' + L, 'Reached Level ' + L, L); });
  if (p.rank && p.rank.name) add('rank:' + p.rank.name, 'Became a ' + p.rank.name, null);
  [30, 100, 365].forEach(N => { if (p.dayStreak >= N) add('streak:' + N, N + '-day streak', N); });
  const bosses = (settings && settings.bossDefeated) ? Object.keys(settings.bossDefeated).length : 0;
  for (let m = 10; m <= bosses; m += 10) add('boss:' + m, 'Defeated ' + m + ' bosses', m);
  return out;
}
async function checkAutoRecords(p) {
  if (typeof settings === 'undefined' || !settings || !p) return;
  const first = !settings.seenRecords;
  const seen = settings.seenRecords || [];
  const seenSet = new Set(seen);
  const fresh = autoMilestones(p).filter(m => !seenSet.has(m.key));
  if (!fresh.length) { if (first) { settings.seenRecords = seen; if (typeof persistSettings === 'function') persistSettings(); } return; }
  fresh.forEach(m => seen.push(m.key));
  settings.seenRecords = seen;
  if (typeof persistSettings === 'function') persistSettings();
  if (first) return; // silent backfill — record nothing historical
  for (const m of fresh) {
    await saveRecord({
      title: m.title, category: 'milestone', completed_at: new Date().toISOString(),
      week_key: weekKey(), value: m.value, source: 'auto', ext_key: m.key,
    });
    if (window.FX && FX.record) FX.record(m.title);
  }
}

// ===== RENDERING =====
function renderStatic() {
  renderScoreboard();
  renderStudyAreas();
  renderDiet();
  renderProjectChecks();
  renderReview();
}

// Weekly completion % — delegated to the module engine (counts every module
// flagged countScore). Verified byte-identical to the legacy logic.
function calculateWeekScoreData(weekData) {
  if (!weekData || !weekData.checks) return 0;
  return (window.Forge && Forge.weekScore) ? Forge.weekScore(weekData, getModules()) : 0;
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
  // On phones the 52-week strip scrolls horizontally — land on the most recent
  // weeks (right edge) instead of a year ago.
  const scroller = grid.closest(".heatmap-scroll");
  if (scroller && window.innerWidth <= 768) {
    requestAnimationFrame(() => { scroller.scrollLeft = scroller.scrollWidth; });
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
  ["protein", "Provisions", "Nutrition floor", "0%"],
  ["study", "Scholarship", "Daily study target", "0%"],
  ["career-hours", "Scholarship Hours", "Weekly study hours", "0%"],
  ["projects-hours", "Workshop", "Weekly output hours", "0%"],
  ["projects-bonus", "Workshop Bonus", "Stretch hours", "0%"],
  ["review", "War Council", "Reflection completed", "0%"]
];
function getMetrics() { return settings.metrics || defaultMetrics; }

const defaultStudyAreas = [
  "Certification / Course",
  "Language Learning",
  "Reading List",
  "Skill Practice"
];
function getStudyAreas() { return settings.studyAreas || defaultStudyAreas; }

function getCertDates() { return settings.certDates || {}; }

function renderStudyAreas() {
  const tbody = document.getElementById("studyRows");
  if (!tbody) return;
  tbody.innerHTML = "";
  const dates = getCertDates();
  getStudyAreas().forEach((area, i) => {
    const d = dates[area] || "";
    tbody.insertAdjacentHTML("beforeend", `<tr>
      <td>${escapeHtml(area)}</td>
      <td data-label="Goal"><input id="goal-study-${i}" data-save type="text" placeholder="Goal..."></td>
      <td data-label="Hours"><input id="hours-study-${i}" class="small-input" data-save data-hours="study" type="number" min="0" step="0.25" value="0"> hrs</td>
      <td data-label="Status"><select id="status-study-${i}" data-save><option>Planned</option><option>In Progress</option><option>Ready for Exam</option><option>Completed</option><option>Paused</option></select></td>
      <td data-label="Target"><input type="date" class="cert-date" data-certdate="${escapeHtml(area)}" value="${d}"></td>
      <td data-label="Days Left"><span class="cert-cd" id="cd-study-${i}">—</span></td>
    </tr>`);
  });
  updateCertCountdowns();
}

function updateCertCountdowns() {
  const dates = getCertDates();
  const areas = getStudyAreas();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let soonest = null;
  areas.forEach((area, i) => {
    const el = document.getElementById(`cd-study-${i}`);
    if (!el) return;
    const ds = dates[area];
    if (!ds) { el.textContent = "—"; el.className = "cert-cd"; return; }
    const days = Math.round((new Date(ds + "T00:00:00") - today) / 86400000);
    let cls = "cert-cd", txt;
    if (days < 0) { txt = `${Math.abs(days)}d overdue`; cls += " cd-over"; }
    else if (days === 0) { txt = "Today!"; cls += " cd-soon"; }
    else { txt = days < 7 ? `${days}d left` : `${days}d · ${Math.ceil(days / 7)}w`; cls += days < 14 ? " cd-soon" : days < 35 ? " cd-mid" : " cd-far"; }
    el.textContent = txt; el.className = cls;
    if (days >= 0 && (soonest === null || days < soonest.days)) soonest = { area, days };
  });
  const sum = document.getElementById("certSummary");
  if (sum) {
    if (soonest) {
      const wks = Math.max(1, Math.ceil(soonest.days / 7));
      const tgt = settings.studyTarget || 14;
      sum.innerHTML = `⏳ Next exam: <strong>${escapeHtml(soonest.area)}</strong> in <strong>${soonest.days}</strong> day${soonest.days === 1 ? "" : "s"} · ~${wks} week${wks === 1 ? "" : "s"} to prep at ${tgt} hrs/wk (${wks * tgt} hrs).`;
      sum.style.display = "";
    } else {
      sum.innerHTML = `🎯 Set a target date on a certification to start its countdown.`;
      sum.style.display = "";
    }
  }
}

// ===== EDITABLE LISTS: Diet / Project / Review =====
function slugify(text) {
  return String(text).toLowerCase().trim().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "item";
}

const defaultDietItems = [
  "Eat a healthy breakfast",
  "Hit your protein target",
  "Stay hydrated",
  "Eat fruit or vegetables",
  "Cook instead of takeout",
  "Plan tomorrow's meals"
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
  "Made progress on a project",
  "Documented what you did",
  "Decided the next step"
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

function renderDays() {
  const wrap = document.getElementById("daysGrid");
  const blueprint = getDailyBlueprint();
  const wk = getWeekData();
  wrap.innerHTML = "";

  // Empty state — a blank slate ("Start blank") shouldn't look broken. Point the
  // user at where to add their first quests instead of showing seven empty days.
  const totalTasks = Object.values(blueprint).reduce((n, t) => n + (t ? t.length : 0), 0);
  if (totalTasks === 0) {
    wrap.insertAdjacentHTML("beforeend",
      `<div class="empty-state">
        <div class="empty-state-title">No daily quests yet</div>
        <p>Add your first habits in <strong>Settings → Pursuits</strong> — or load a ready-made path there to get a starter set.</p>
        <button type="button" class="primary" onclick="(document.getElementById('openSettingsBtn')||document.getElementById('moreSettingsBtn')||{click(){}}).click()">Open Settings</button>
      </div>`);
    return;
  }

  // Attribute legend — teaches what the colored dots on each habit mean.
  const attrs = (window.Forge && Forge.ATTR_LIST) ? Forge.ATTR_LIST : [];
  if (attrs.length) {
    const legend = attrs.map((a) => `<span class="al-item"><span class="al-dot" style="background:${attrColor(a)}"></span>${escapeHtml(attrName(a))}</span>`).join("");
    wrap.insertAdjacentHTML("beforeend", `<div class="attr-legend-row">${legend}<span class="al-hint">tap a dot to set which stat a habit trains</span></div>`);
  }

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
      const link = taskLink(task);
      const linkMod = (link && window.Forge) ? Forge.linkModule(link, getModules()) : null;
      const targetId = (link && window.Forge) ? Forge.linkTargetId(link, getModules(), dayIndex) : null;
      if (linkMod && targetId) {
        // Linked task → a PROXY over the section's per-day checkbox (shared id).
        // No id/data-save/data-cat so it can't double-count; it writes the same
        // week.checks key the section uses. The badge shows where it links.
        const lattr = linkMod.attr;
        const lxp = (linkMod.type === "checklist") ? (linkMod.xpPer || 10) : ((window.Game && Game.xpForCat) ? Game.xpForCat(linkMod.category) : 30);
        group.insertAdjacentHTML("beforeend", `<label class="check quest linked"><input type="checkbox" data-link-id="${escapeHtml(targetId)}" ${wk.checks[targetId] ? "checked" : ""}><span class="q-text">${escapeHtml(task)}</span><span class="link-badge" style="--ac:${attrColor(lattr)}" title="Linked to ${escapeHtml(linkMod.name)} — one shared check"><svg viewBox="0 0 24 24" class="ic"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07L11.5 4.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07L10.5 19.5"/></svg>${escapeHtml(linkMod.name)}</span><span class="q-xp">+${lxp}</span></label>`);
        return;
      }
      const id = taskId(dayIndex, task);
      const legacyId = `day-${dayIndex}-task-${taskIndex}`;
      if (wk.checks[id] === undefined && wk.checks[legacyId] !== undefined) wk.checks[id] = wk.checks[legacyId];
      const attr = taskAttr(task);
      const cat = attrCat(attr);
      const xp = (window.Game && Game.xpForCat) ? Game.xpForCat(cat) : 10;
      if (linkMod) {
        // Linked, no shared checkbox: own checkbox, stat is the section's. count
        // mode → each completed day is +1 session to the section (engine adds it);
        // stat mode → just feeds the section's stat. Badge replaces the attr dot.
        const ref = window.Forge ? Forge.normLink(link) : { mode: "stat" };
        const isCount = ref.mode === "count";
        const linkXp = isCount ? (linkMod.type === "counter" ? (linkMod.xpPer || 0) : (linkMod.xpPerHour || 0)) : xp;
        const title = isCount ? `Each day = +1 to ${linkMod.name} (${attrName(attr)})` : `Linked to ${linkMod.name} — feeds ${attrName(attr)}`;
        group.insertAdjacentHTML("beforeend", `<label class="check quest"><input id="${id}" type="checkbox" data-cat="${cat}" data-day="${dayIndex}" data-save><span class="q-text">${escapeHtml(task)}</span><span class="link-badge${isCount ? " counts" : ""}" style="--ac:${attrColor(attr)}" title="${escapeHtml(title)}"><svg viewBox="0 0 24 24" class="ic"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07L11.5 4.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07L10.5 19.5"/></svg>${escapeHtml(linkMod.name)}${isCount ? " +1" : ""}</span><span class="q-xp">+${linkXp}</span></label>`);
        return;
      }
      group.insertAdjacentHTML("beforeend", `<label class="check quest"><input id="${id}" type="checkbox" data-cat="${cat}" data-day="${dayIndex}" data-save><span class="q-text">${escapeHtml(task)}</span><button class="q-attr" type="button" data-task="${escapeHtml(task)}" data-attr="${attr}" style="--ac:${attrColor(attr)}" title="Trains ${escapeHtml(attrName(attr))} · click to change" aria-label="Attribute: ${escapeHtml(attrName(attr))}"></button><span class="q-xp">+${xp}</span></label>`);
    });
    if (!tasks.length) {
      group.innerHTML = `<div class="day-empty">No quests yet for ${day}. Tap ✎ to build this day's checklist.</div>`;
    }
    wrap.appendChild(card);
  });
}

function renderWorkouts() {
  const body = document.getElementById("workoutRows");
  body.innerHTML = "";
  getWorkouts().forEach(([day, plan], i) => {
    body.insertAdjacentHTML("beforeend", `<tr><td>${day}</td><td data-label="Plan">${plan}</td><td><label class="check"><input id="workout-${i}" type="checkbox" data-cat="training" data-save><span>Done</span></label></td><td data-label="Notes / Weight / Reps"><input id="workout-note-${i}" type="text" placeholder="Example: 20 lb DB, 3x10, felt strong..." data-save></td></tr>`);
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
  
  renderDays();
  renderWorkouts();
  renderCustomSections();
  loadWeekFields();
  updateProgress();
  updateStreakAndHeatmap();
  if (window.Game) Game.render();
  applyModuleLayout();
  applySectionVisibility();
  updateCertCountdowns();
  renderBoss();

  // Apply mobile smart layout after rendering
  applyMobileSmartLayout();
}

// ===== MOBILE SMART LAYOUT =====
function applyMobileSmartLayout() {
  if (!isMobile()) return;
  
  // On mobile, auto-collapse non-essential sections
  const sectionsToCollapse = ['scoreboard', 'workout', 'diet', 'study', 'projects', 'review'];
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
  syncLinkedProxies(wk);
}
// Keep linked daily-task proxies in step with the section checkbox they share.
function syncLinkedProxies(wk) {
  wk = wk || getWeekData();
  document.querySelectorAll("input[data-link-id]").forEach((cb) => { cb.checked = !!wk.checks[cb.getAttribute("data-link-id")]; });
}
// Reflect linked-day "sessions" in each custom counter section's total/bar/note,
// so completing a daily task visibly moves the section's number.
function syncCounterDisplays() {
  if (!window.Forge || !Forge.moduleCountValue) return;
  const wk = getWeekData();
  const mods = getModules();
  mods.forEach((m) => {
    if (m.type !== "counter") return;
    const total = Forge.moduleCountValue(wk, mods, m);
    const fromDaily = Forge.linkedCountDays(wk, mods, m.id);
    const tgt = (m.target && m.target.value) || 1;
    const totalEl = document.querySelector(`.counter-total[data-counter="${m.id}"]`);
    if (totalEl) totalEl.textContent = total;
    const bar = document.querySelector(`[data-counter-bar="${m.id}"]`);
    if (bar) bar.style.width = Math.min(100, Math.round((total / tgt) * 100)) + "%";
    const sess = document.querySelector(`.counter-sessions[data-counter-sessions="${m.id}"]`);
    if (sess) sess.textContent = fromDaily > 0 ? `+ ${fromDaily} from linked daily task${fromDaily === 1 ? "" : "s"} → ${total} total this week` : "";
  });
}
// Built-in hours sections (Study, Projects) get a live "+N hours from daily" note.
function syncSessionNotes() {
  if (!window.Forge || !Forge.linkedCountDays) return;
  const wk = getWeekData();
  const mods = getModules();
  mods.forEach((m) => {
    if (m.type !== "hours-table" && m.type !== "composite") return;
    const sec = document.getElementById(m.id);
    const content = sec && sec.querySelector(".content");
    if (!content) return;
    let note = content.querySelector(".session-note");
    const n = Forge.linkedCountDays(wk, mods, m.id);
    if (n > 0) {
      if (!note) { note = document.createElement("p"); note.className = "hint session-note"; content.appendChild(note); }
      note.textContent = `+ ${n} hour${n === 1 ? "" : "s"} from linked daily task${n === 1 ? "" : "s"} this week (counts toward your stat & target)`;
    } else if (note) { note.textContent = ""; }
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
    if (badge) badge.textContent = `${dayDone}/${items.length}`;
    if (bar) bar.style.width = p + "%";
  }

  // Built-in hours sections include linked daily "sessions" (each completed day = +1 hr).
  const _wk = getWeekData(), _mods = getModules();
  const studySessions = (window.Forge && Forge.linkedCountDays) ? Forge.linkedCountDays(_wk, _mods, "study") : 0;
  const projSessions = (window.Forge && Forge.linkedCountDays) ? Forge.linkedCountDays(_wk, _mods, "projects") : 0;

  const studyHours = [...document.querySelectorAll('[data-hours="study"]')].reduce((sum, el) => sum + Number(el.value || 0), 0) + studySessions;
  setMetric("career-hours", Math.round((studyHours / studyTarget) * 100));

  const projectHours = Number(document.getElementById("projectHours")?.value || 0) + projSessions;
  document.getElementById("projectHoursValue").textContent = projectHours;
  document.getElementById("projectBar").style.width = Math.min(100, Math.round((projectHours / projectTarget) * 100)) + "%";
  setMetric("projects-hours", Math.round((projectHours / projectTarget) * 100));
  setMetric("projects-bonus", Math.round((projectHours / projectStretch) * 100));
  syncSessionNotes();

  const reviewDone = ["wins", "misses", "changes", "refuseDrop"].filter(id => document.getElementById(id)?.value.trim()).length;
  setMetric("review", percent(reviewDone, 4));
  renderXpChips();
  syncLinkedProxies();
  syncCounterDisplays();
  if (typeof renderBoss === "function") renderBoss();
}

// ===== CALENDAR (month view) =====
let calViewDate = null;
function openCalendar() {
  calViewDate = new Date();
  renderCalendarMonth();
  const md = document.getElementById("calendarModal");
  if (md) { md.classList.add("active"); md.setAttribute("aria-hidden", "false"); }
}
function closeCalendar() {
  const md = document.getElementById("calendarModal");
  if (md) { md.classList.remove("active"); md.setAttribute("aria-hidden", "true"); }
}
function calShiftMonth(delta) {
  if (!calViewDate) calViewDate = new Date();
  calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth() + delta, 1);
  renderCalendarMonth();
}
function renderCalendarMonth() {
  const grid = document.getElementById("calGrid");
  if (!grid || !calViewDate) return;
  const year = calViewDate.getFullYear(), month = calViewDate.getMonth();
  const first = new Date(year, month, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const titleEl = document.getElementById("calTitle");
  if (titleEl) titleEl.textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  let cells = "";
  let activeDays = 0, sumPct = 0, ratedDays = 0, questsDone = 0;
  for (let i = 0; i < startDay; i++) cells += `<div class="cal-cell empty" aria-hidden="true"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const isToday = date.getTime() === today.getTime();
    const isFuture = date > today;
    const info = isFuture ? null : dayPctInfo(date);
    const lvl = info ? hmLevel(info.pct) : 0;
    if (info && info.done > 0) { activeDays++; questsDone += info.done; }
    if (info && info.total > 0) { sumPct += info.pct; ratedDays++; }
    const meta = (info && info.total) ? `<span class="cal-meta">${info.done}/${info.total}</span>` : "";
    cells += `<button class="cal-cell d${lvl}${isToday ? " today" : ""}${isFuture ? " future" : ""}" data-date="${iso(date)}"${isFuture ? ' tabindex="-1"' : ""}><span class="cal-num">${d}</span>${meta}</button>`;
  }
  grid.innerHTML = cells;
  const avg = ratedDays ? Math.round(sumPct / ratedDays) : 0;
  const sum = document.getElementById("calSummary");
  if (sum) sum.innerHTML =
    `<span class="cs-item"><strong>${activeDays}</strong> active days</span>` +
    `<span class="cs-item"><strong>${avg}%</strong> avg completion</span>` +
    `<span class="cs-item"><strong>${questsDone}</strong> quests done</span>`;
}

// Per-section "+N XP this week" chips, so XP is visibly earned from every tab.
// Driven by the module list (built-in + custom), keyed by each module's section
// id and XP source. Chips are injected into each <summary> (CSP-safe DOM) and
// refreshed on every change via updateProgress().
function renderXpChips() {
  const bySource = (window.Game && Game.weekXpBySource) ? Game.weekXpBySource(getWeekData()) : {};
  getModules().forEach((m) => {
    const section = document.getElementById(m.id);
    if (!section) return;
    const summary = section.querySelector("summary");
    if (!summary) return;
    let chip = summary.querySelector(".xp-chip");
    if (!chip) {
      chip = document.createElement("span");
      chip.className = "xp-chip";
      const chev = summary.querySelector(".chev");
      if (chev && chev.parentNode) chev.parentNode.insertBefore(chip, chev);
      else summary.appendChild(chip);
    }
    const xp = Math.round(bySource[m.source] || 0);
    chip.textContent = xp > 0 ? `+${xp} XP` : "";   // hidden via .xp-chip:empty
  });
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
      if (target === 'modules') { renderModulesEditor(); renderStatsEditor(); }
    });
  });
}

// ===== MOBILE TAB BAR =====
function tabHaptic() {
  if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
}
function scrollToTop() {
  (document.scrollingElement || document.documentElement).scrollTo({ top: 0, behavior: 'smooth' });
}

function initMobileTabBar() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const moreDrawer = document.getElementById('moreDrawer');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      tabHaptic();

      // Handle "More" drawer toggle
      if (target === 'more') {
        moreDrawer.classList.toggle('active');
        // Update tab active state
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        return;
      }

      // Cabinet opens the trophy cabinet sheet (it's a modal, not a section).
      if (target === 'cabinet') {
        moreDrawer.classList.remove('active');
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        openCabinet();
        return;
      }

      // Close more drawer if open
      moreDrawer.classList.remove('active');

      // Update active tab
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Scroll to the target section. Today goes straight to today's task list
      // (the dashboard hero is reachable by tapping the mobile header instead).
      const targetEl = document.getElementById(target);
      if (targetEl) {
        if (targetEl.tagName === 'DETAILS' && !targetEl.open) targetEl.open = true;
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  initScrollSpy(tabBtns, moreDrawer);

  // Tapping the mobile header — the sticky context bar or the brand wordmark —
  // jumps back up to the dashboard hero (character screen).
  document.querySelectorAll('.mobile-context, .brand').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => { tabHaptic(); scrollToTop(); });
  });
  
  // More drawer items
  const moreActions = {
    'moreScoreboardBtn': () => { moreDrawer.classList.remove('active'); scrollToSection('scoreboard'); },
    'moreReportsBtn': () => { moreDrawer.classList.remove('active'); document.getElementById('reportsModal').classList.add('active'); },
    'moreSettingsBtn': () => { moreDrawer.classList.remove('active'); openSettings(); },
    'moreProjectsBtn': () => { moreDrawer.classList.remove('active'); scrollToSection('projects'); },
    'moreDietBtn': () => { moreDrawer.classList.remove('active'); scrollToSection('diet'); },
    'moreReviewBtn': () => { moreDrawer.classList.remove('active'); scrollToSection('review'); },
    'moreCalendarBtn': () => { moreDrawer.classList.remove('active'); openCalendar(); },
    'moreExpandBtn': () => { moreDrawer.classList.remove('active'); document.querySelectorAll("details.section-card").forEach(d => d.open = true); },
    'moreCollapseBtn': () => { moreDrawer.classList.remove('active'); document.querySelectorAll("details.section-card").forEach(d => d.open = false); },
    'moreExportBtn': () => { moreDrawer.classList.remove('active'); document.getElementById('exportBtn').click(); },
    'moreImportBtn': () => { moreDrawer.classList.remove('active'); document.getElementById('importFile').click(); },
    'moreResetBtn': () => { moreDrawer.classList.remove('active'); document.getElementById('resetBtn').click(); },
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

  // Tapping the dimmed area behind any sheet dismisses it, then re-syncs the
  // bottom tab to wherever the page is now scrolled.
  document.querySelectorAll('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', (e) => {
      if (e.target !== bd) return;
      bd.classList.remove('active');
      window.dispatchEvent(new Event('scroll'));
    });
  });
}

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) {
    if (el.tagName === 'DETAILS' && !el.open) el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Keep the active bottom-tab in sync with what's actually on screen, so the bar
// stops lying after the user scrolls. Sections without their own tab fold into
// the nearest one — the whole top region (hero/boss/scoreboard) is
// Today; diet→Train; projects/review→More. Cabinet is a modal, never scroll-lit.
function initScrollSpy(tabBtns, moreDrawer) {
  const MAP = [
    ['charScreen', 'daily'], ['boss', 'daily'],
    ['scoreboard', 'daily'], ['daily', 'daily'],
    ['workout', 'workout'], ['diet', 'workout'],
    ['study', 'study'],
    ['projects', 'more'], ['review', 'more'],
  ];
  const LINE = 120; // activation line measured from the top of the viewport
  let ticking = false;

  function update() {
    ticking = false;
    if (!isMobile()) return;
    if (moreDrawer && moreDrawer.classList.contains('active')) return; // don't fight the drawer
    if (document.querySelector('.modal-backdrop.active')) return; // don't fight an open sheet (e.g. Cabinet)
    // Pick the section sitting closest to the activation line from above — this
    // is order-independent, so it stays correct even though the page's vertical
    // order (scoreboard sits above the daily list) differs from MAP order.
    let current = MAP[0][1];
    let bestTop = -Infinity;
    for (const [secId, target] of MAP) {
      const el = document.getElementById(secId);
      if (!el || el.offsetParent === null) continue; // skip hidden sections
      const top = el.getBoundingClientRect().top;
      if (top - LINE <= 0 && top > bestTop) { bestTop = top; current = target; }
    }
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.target === current));
  }

  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  window.addEventListener('resize', update);
  update();
}

// ===== SETTINGS MODAL =====
// ===== SECTION VISIBILITY =====
const SECTIONS = [
  ["boss", "Weekly Boss"], ["scoreboard", "Quest Log"], ["daily", "Daily Quests"],
  ["workout", "Training"], ["diet", "Provisions"], ["study", "Scholarship"],
  ["projects", "Workshop"], ["review", "War Council"]
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

// ===== PUSH REMINDERS =====
function getReminders() { return settings.reminders || { enabled: false, morning: "08:00", evening: "19:00" }; }
function urlBase64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const base = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function enableReminders() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { alert("Push isn't supported on this browser."); return false; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { alert("Notifications were not allowed."); return false; }
    const reg = await navigator.serviceWorker.ready;
    const { key } = await (await fetch("/api/push/key")).json();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
    return true;
  } catch (e) { console.error("enableReminders failed", e); alert("Could not enable reminders: " + e.message); return false; }
}

function openSettings() {
  document.getElementById("cfgWorkoutMin").value = settings.workoutMin || 5;
  document.getElementById("cfgProteinMin").value = settings.proteinMin || 7;
  document.getElementById("cfgProjectTarget").value = settings.projectTarget || 2;
  document.getElementById("cfgStudyTarget").value = settings.studyTarget || 14;
  const dif = document.getElementById("cfgDifficulty"); if (dif) dif.value = String(settings.gameBase || 100);
  const sg = document.getElementById("cfgStreakGrade"); if (sg) sg.value = settings.streakGrade || 75;
  const sf = document.getElementById("cfgStreakFreeze"); if (sf) sf.value = (settings.streakFreeze != null ? settings.streakFreeze : 1);
  const cs = document.getElementById("cfgCallsign"); if (cs) cs.value = settings.callsign || "";
  renderSectionToggles();
  renderModulesEditor();
  renderStatsEditor();
  const rem = getReminders();
  const re = document.getElementById("cfgRemindEnable"); if (re) re.checked = !!rem.enabled;
  const rm = document.getElementById("cfgRemindMorning"); if (rm) rm.value = rem.morning || "08:00";
  const rv = document.getElementById("cfgRemindEvening"); if (rv) rv.value = rem.evening || "19:00";
  renderThemeGrid();
  document.getElementById("settingsModal").classList.add("active");
}

function openCabinet() {
  if (window.Game && Game.renderCabinet) Game.renderCabinet();
  renderTrophyCase();
  document.getElementById("cabinetModal").classList.add("active");
}
function closeCabinet() { document.getElementById("cabinetModal").classList.remove("active"); window.dispatchEvent(new Event("scroll")); }

// ===== EVENT BINDING =====
// ===== WEEKLY BOSS =====
const BOSSES = [
  { name: "Inertia", emoji: "🪨", weak: "training", taunt: "You won't even start. Prove me wrong." },
  { name: "The Procrastinator", emoji: "🦥", weak: "discipline", taunt: "Tomorrow, right? That's what you always say." },
  { name: "Brain Fog", emoji: "🌫️", weak: "study", taunt: "Why study? You'll just forget it." },
  { name: "The Glutton", emoji: "🍔", weak: "protein", taunt: "One more cheat day won't hurt…" },
  { name: "The Drifter", emoji: "🌀", weak: "project", taunt: "Busywork feels like progress, doesn't it?" },
  { name: "Lord Snooze", emoji: "😴", weak: "discipline", taunt: "Five more minutes. Every single morning." },
  { name: "Doomscroll Hydra", emoji: "🐍", weak: "study", taunt: "Just one more scroll…" },
  { name: "The Couch Wraith", emoji: "👻", weak: "training", taunt: "Skip the workout. Stay cozy." },
];
const BOSS_ATTR = { discipline: "Discipline", training: "Body", study: "Mind", protein: "Vitality", project: "Craft" };
function bossForWeek(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return BOSSES[h % BOSSES.length];
}
function computeBossDamage() {
  const boss = bossForWeek(weekKey());
  const checks = getWeekData().checks || {};
  const blueprint = getDailyBlueprint();
  const names = Object.keys(blueprint);
  let totW = 0, doneW = 0;
  for (let i = 0; i < 7; i++) {
    (blueprint[names[i]] || []).forEach((t) => {
      const w = categoryFor(t) === boss.weak ? 2 : 1;
      totW += w; if (checks[taskId(i, t)]) doneW += w;
    });
    const ww = boss.weak === "training" ? 2 : 1;
    totW += ww; if (checks["workout-" + i]) doneW += ww;
  }
  return { boss, dmg: totW ? Math.round(doneW / totW * 100) : 0 };
}
function renderBoss() {
  const panel = document.getElementById("boss");
  if (!panel) return;
  const { boss, dmg } = computeBossDamage();
  const grade = settings.streakGrade || 75;
  const defeated = dmg >= grade;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("bossEmoji", boss.emoji);
  set("bossName", boss.name);
  set("bossWeak", "Weak to " + (BOSS_ATTR[boss.weak] || boss.weak) + " · those quests hit 2×");
  set("bossStatus", defeated ? "DEFEATED" : Math.max(0, grade - dmg) + "% to defeat");
  set("bossTaunt", defeated ? "Defeated. Next week, a new challenger." : boss.taunt);
  const fill = document.getElementById("bossHpFill");
  if (fill) { const hp = Math.max(0, Math.round((1 - dmg / grade) * 100)); fill.style.width = (defeated ? 100 : hp) + "%"; }
  panel.classList.toggle("defeated", defeated);

  // Defeat celebration — once per week; silent backfill on first ever run
  const key = weekKey();
  const first = !settings.bossDefeated;
  if (!settings.bossDefeated) settings.bossDefeated = {};
  if (defeated && !settings.bossDefeated[key]) {
    settings.bossDefeated[key] = boss.name;
    if (typeof persistSettings === "function") persistSettings();
    if (!first && window.FX && FX.bossDefeated) FX.bossDefeated(boss.name);
  } else if (first) {
    if (typeof persistSettings === "function") persistSettings();
  }
}

// ===== SEASONS (monthly goals + shareable recap) =====
// A season = a calendar month. Goals are recurring definitions in
// settings.seasonGoals, evaluated live against the viewed month's summary
// (Game.seasonSummary). The recap canvas lives in extras.js (shareSeasonCard).
let seasonOffset = 0; // months back from the current month (0 = this month)
const SEASON_GOAL_TYPES = {
  xp:     { label: "Earn XP",            needsAttr: false, def: 2000 },
  weeks:  { label: "Active weeks",       needsAttr: false, def: 4 },
  attr:   { label: "Reach attribute Lv", needsAttr: true,  def: 5 },
  streak: { label: "Day streak",         needsAttr: false, def: 14 },
};
function seasonMonthStart() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth() - seasonOffset, 1); }
function curSeasonSummary() { return (window.Game && Game.seasonSummary) ? Game.seasonSummary(seasonMonthStart()) : null; }
function seasonGoalProgress(g, s, prof) {
  if (g.type === "weeks")  return { cur: s.weeksActive, target: g.target, label: `Stay active ${g.target} weeks` };
  if (g.type === "streak") return { cur: prof ? prof.dayStreak : 0, target: g.target, label: `Reach a ${g.target}-day streak` };
  if (g.type === "attr")   { const a = prof ? prof.attrs.find(x => x.key === g.attr) : null; return { cur: a ? a.level : 0, target: g.target, label: `${attrName(g.attr)} to Lv ${g.target}` }; }
  return { cur: s.xp, target: g.target, label: `Earn ${Number(g.target).toLocaleString()} XP` };
}
function renderSeason() {
  const s = curSeasonSummary(); if (!s) return;
  const prof = (window.Game && Game.computeProfile) ? Game.computeProfile() : null;
  const lbl = document.getElementById("seasonLabel"); if (lbl) lbl.textContent = s.label + (s.isCurrent ? " · live" : "");
  const next = document.getElementById("seasonNext"); if (next) next.disabled = seasonOffset <= 0;
  const body = document.getElementById("seasonBody"); if (!body) return;
  const topName = s.topAttr ? attrName(s.topAttr) : "—";
  const topColor = s.topAttr ? attrColor(s.topAttr) : "var(--muted)";
  const stats = [
    { v: s.xp.toLocaleString(), k: "XP earned" },
    { v: `<span style="color:${topColor}">${escapeHtml(topName)}</span>`, k: "Top attribute" },
    { v: s.weeksActive, k: "Active weeks" },
    { v: s.bestWeek + "%", k: "Best week" },
    { v: s.trophies, k: "Trophies" },
    { v: s.insignias, k: "Insignias" },
  ];
  const statsHtml = `<div class="season-stats">${stats.map(x => `<div class="season-stat"><span class="ss-v">${x.v}</span><span class="ss-k">${x.k}</span></div>`).join("")}</div>`;
  const goals = settings.seasonGoals || [];
  const goalsHtml = goals.map(g => {
    const p = seasonGoalProgress(g, s, prof);
    const pct = p.target > 0 ? Math.min(100, Math.round(p.cur / p.target * 100)) : 0;
    const done = p.target > 0 && p.cur >= p.target;
    return `<div class="season-goal ${done ? "done" : ""}">
      <div class="sg-top"><span class="sg-label">${escapeHtml(p.label)}</span><button class="sg-del" data-goal="${g.id}" type="button" aria-label="Remove goal"><svg viewBox="0 0 24 24" class="ic"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <div class="sg-bar"><span class="sg-fill" style="width:${pct}%"></span></div>
      <div class="sg-meta">${Number(p.cur).toLocaleString()} / ${Number(p.target).toLocaleString()}${done ? " · done ✓" : ""}</div>
    </div>`;
  }).join("") || `<div class="season-empty">No goals yet — set one below.</div>`;
  const attrOpts = (prof ? prof.attrs : []).map(a => `<option value="${a.key}">${escapeHtml(a.label || a.key)}</option>`).join("");
  const addHtml = `<div class="season-add">
    <select id="sgType">${Object.keys(SEASON_GOAL_TYPES).map(t => `<option value="${t}">${SEASON_GOAL_TYPES[t].label}</option>`).join("")}</select>
    <select id="sgAttr" style="display:none">${attrOpts}</select>
    <input id="sgTarget" type="number" min="1" value="2000" aria-label="Target">
    <button id="sgAdd" type="button" class="primary">Add</button>
  </div>`;
  body.innerHTML = statsHtml + `<div class="season-goals-head">Season Goals</div><div class="season-goals">${goalsHtml}</div>` + addHtml;
  const typeSel = document.getElementById("sgType"), attrSel = document.getElementById("sgAttr"), tgtInp = document.getElementById("sgTarget");
  if (typeSel) {
    const sync = () => { if (attrSel) attrSel.style.display = SEASON_GOAL_TYPES[typeSel.value].needsAttr ? "" : "none"; };
    typeSel.onchange = () => { sync(); if (tgtInp) tgtInp.value = SEASON_GOAL_TYPES[typeSel.value].def; };
    sync();
  }
}
function openSeason() { seasonOffset = 0; renderSeason(); const md = document.getElementById("seasonModal"); if (md) { md.classList.add("active"); md.setAttribute("aria-hidden", "false"); } }
function closeSeason() { const md = document.getElementById("seasonModal"); if (md) { md.classList.remove("active"); md.setAttribute("aria-hidden", "true"); } }
function addSeasonGoalFromForm() {
  const type = (document.getElementById("sgType") || {}).value || "xp";
  const target = Math.max(1, Number((document.getElementById("sgTarget") || {}).value) || 1);
  const g = { id: "g" + Date.now().toString(36), type, target };
  if (SEASON_GOAL_TYPES[type] && SEASON_GOAL_TYPES[type].needsAttr) g.attr = (document.getElementById("sgAttr") || {}).value || null;
  settings.seasonGoals = (settings.seasonGoals || []).concat([g]);
  persistSettings();
  renderSeason();
}
function removeSeasonGoal(id) {
  settings.seasonGoals = (settings.seasonGoals || []).filter(g => g.id !== id);
  persistSettings();
  renderSeason();
}

// ===== YEAR IN REVIEW =====
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
let yearOffset = 0; // years back from current (0 = this year)
function curYear() { return new Date().getFullYear() - yearOffset; }
function curYearSummary() { return (window.Game && Game.yearSummary) ? Game.yearSummary(curYear()) : null; }
function renderYear() {
  const s = curYearSummary(); if (!s) return;
  const prof = (window.Game && Game.computeProfile) ? Game.computeProfile() : null;
  const lbl = document.getElementById("yearLabel"); if (lbl) lbl.textContent = s.year + (s.isCurrent ? " · in progress" : "");
  const next = document.getElementById("yearNext"); if (next) next.disabled = yearOffset <= 0;
  const body = document.getElementById("yearBody"); if (!body) return;
  const topName = s.topAttr ? attrName(s.topAttr) : "—";
  const topColor = s.topAttr ? attrColor(s.topAttr) : "var(--muted)";
  const bestMonth = s.bestMonthIndex >= 0 ? MONTHS_SHORT[s.bestMonthIndex] : "—";
  const stats = [
    { v: s.xp.toLocaleString(), k: "Total XP" },
    { v: `<span style="color:${topColor}">${escapeHtml(topName)}</span>`, k: "Top attribute" },
    { v: bestMonth, k: "Best month" },
    { v: s.monthsActive, k: "Active months" },
    { v: s.trophies, k: "Trophies" },
    { v: s.insignias, k: "Insignias" },
  ];
  const statsHtml = `<div class="season-stats">${stats.map(x => `<div class="season-stat"><span class="ss-v">${x.v}</span><span class="ss-k">${x.k}</span></div>`).join("")}</div>`;
  const monthly = trBarBlock("XP by month", s.monthly.map((v, i) => ({ label: MONTHS_SHORT[i], value: v, raw: String(v) })), Math.max(1, ...s.monthly));
  const attrs = prof ? prof.attrs : [];
  const maxAttr = Math.max(1, ...attrs.map(a => s.byAttr[a.key] || 0));
  const attrBars = attrs.map(a => {
    const v = s.byAttr[a.key] || 0; const pct = Math.round(v / maxAttr * 100);
    return `<div class="ya-row"><span class="ya-head"><span class="attr-dot" style="background:${a.color}"></span><span class="ya-name">${escapeHtml(a.label || a.key)}</span></span><span class="ya-bar"><span class="ya-fill" style="width:${pct}%;background:${a.color}"></span></span><span class="ya-val">${v.toLocaleString()}</span></div>`;
  }).join("");
  const attrBlock = attrs.length ? `<div class="tr-block"><div class="tr-title">XP by attribute</div><div class="ya-bars">${attrBars}</div></div>` : "";
  body.innerHTML = statsHtml + monthly + attrBlock;
}
function openYear() { yearOffset = 0; renderYear(); const md = document.getElementById("yearModal"); if (md) { md.classList.add("active"); md.setAttribute("aria-hidden", "false"); } }
function closeYear() { const md = document.getElementById("yearModal"); if (md) { md.classList.remove("active"); md.setAttribute("aria-hidden", "true"); } }

// ===== FOCUS TIMER =====
let focusState = null;
function openFocus() {
  const sel = document.getElementById("focusTarget");
  if (sel) sel.innerHTML = getStudyAreas().map((a, i) => `<option value="study:${i}">${escapeHtml(a)}</option>`).join("") + `<option value="project">Project work</option>`;
  document.getElementById("focusSetup").style.display = "";
  document.getElementById("focusRunning").style.display = "none";
  document.querySelectorAll(".focus-dur").forEach((b) => b.classList.remove("active"));
  const def = document.querySelector('.focus-dur[data-min="25"]'); if (def) def.classList.add("active");
  const c = document.getElementById("focusCustom"); if (c) c.value = "";
  document.getElementById("focusModal").classList.add("active");
}
function focusLabel(sel) {
  if (sel && sel.indexOf("study:") === 0) return getStudyAreas()[Number(sel.split(":")[1])] || "Study";
  return "Project work";
}
function focusFormat(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, "0")}`; }
function focusRender() {
  if (!focusState) return;
  const r = Math.max(0, focusState.remainSec);
  const t = document.getElementById("focusTime"); if (t) t.textContent = focusFormat(r);
  const ring = document.getElementById("focusRing");
  if (ring) { const pct = focusState.totalSec ? (1 - r / focusState.totalSec) : 0; ring.style.background = `conic-gradient(var(--accent-primary) ${(pct * 360).toFixed(1)}deg, rgba(255,255,255,0.08) 0deg)`; }
}
function startFocus(minutes) {
  const sel = document.getElementById("focusTarget").value;
  const total = Math.max(1, Math.round(minutes)) * 60;
  focusState = { sel, totalSec: total, remainSec: total, paused: false, timer: null };
  document.getElementById("focusSetup").style.display = "none";
  document.getElementById("focusRunning").style.display = "";
  document.getElementById("focusTargetLabel").textContent = focusLabel(sel);
  const pb = document.getElementById("focusPauseBtn"); if (pb) pb.textContent = "Pause";
  focusRender();
  focusState.timer = setInterval(() => {
    if (!focusState || focusState.paused) return;
    focusState.remainSec--;
    focusRender();
    if (focusState.remainSec <= 0) endFocus(true);
  }, 1000);
}
function endFocus(completed) {
  if (!focusState) { document.getElementById("focusModal").classList.remove("active"); return; }
  const elapsed = focusState.totalSec - Math.max(0, focusState.remainSec);
  const hours = Math.round(elapsed / 3600 * 100) / 100;
  if (hours > 0) {
    const el = focusState.sel.indexOf("study:") === 0
      ? document.getElementById(`hours-study-${focusState.sel.split(":")[1]}`)
      : document.getElementById("projectHours");
    if (el) { el.value = (Number(el.value || 0) + hours).toFixed(2); el.dispatchEvent(new Event("input", { bubbles: true })); }
  }
  const label = focusLabel(focusState.sel);
  if (focusState.timer) clearInterval(focusState.timer);
  focusState = null;
  document.getElementById("focusModal").classList.remove("active");
  if (window.FX && FX.focusDone) FX.focusDone(hours, label, completed);
}

// ===== ANALYTICS / TRENDS =====
function trBarBlock(title, items, max) {
  const m = max || 1;
  const bars = items.map((it) => {
    const h = Math.max(2, Math.round((it.value / m) * 100));
    let cls = "gx";
    if (it.grade) cls = it.value >= 85 ? "g3" : it.value >= 75 ? "g2" : it.value >= 50 ? "g1" : it.value > 0 ? "g0" : "gz";
    return `<div class="tr-bar" title="${escapeHtml(String(it.label))}: ${escapeHtml(String(it.raw))}"><div class="tr-bar-fill ${cls}" style="height:${h}%"></div><span class="tr-bar-lbl">${escapeHtml(String(it.label))}</span></div>`;
  }).join("");
  return `<div class="tr-block"><div class="tr-title">${title}</div><div class="tr-chart">${bars}</div></div>`;
}

// A tiny sparkline (area + line + last dot) for a series of weekly values.
function sparkSvg(values, color) {
  const W = 150, H = 32, pad = 3;
  const n = values.length;
  const max = Math.max(1, ...values);
  const xs = (i) => pad + (n > 1 ? (i / (n - 1)) * (W - 2 * pad) : (W - 2 * pad) / 2);
  const ys = (v) => H - pad - (v / max) * (H - 2 * pad);
  const pts = values.map((v, i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
  const area = `${xs(0).toFixed(1)},${H - pad} ${pts} ${xs(n - 1).toFixed(1)},${H - pad}`;
  const lx = xs(n - 1).toFixed(1), ly = ys(values[n - 1] || 0).toFixed(1);
  return `<svg viewBox="0 0 ${W} ${H}" class="tr-spark-svg" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${area}" fill="${color}" fill-opacity="0.13" stroke="none"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx}" cy="${ly}" r="2.3" fill="${color}"/>
  </svg>`;
}

// Per-attribute weekly-XP trend lines for the Reports view.
function trAttrTrends(attrs, last12) {
  const rows = attrs.map((a) => {
    const series = last12.map((w) => (w.byAttr && w.byAttr[a.key]) || 0);
    const peak = Math.max(0, ...series);
    return `<div class="tr-spark" title="${escapeHtml(a.label || a.key)} — weekly XP, peak ${peak}">
      <span class="tr-spark-head"><span class="attr-dot" style="background:${a.color}"></span><span class="tr-spark-name">${escapeHtml(a.label || a.key)}</span></span>
      <span class="tr-spark-chart">${sparkSvg(series, a.color)}</span>
      <span class="tr-spark-lvl">Lv ${a.level}</span>
    </div>`;
  }).join("");
  return `<div class="tr-block"><div class="tr-title">Attribute trends · weekly XP, last 12 weeks</div><div class="tr-sparks">${rows}</div></div>`;
}
function renderTrends() {
  const el = document.getElementById("reportContent");
  if (!el) return;
  const weeks = database.weeks || {};
  const calc = (w) => (window.Game && Game.calcWeekScore) ? Game.calcWeekScore(w) : calculateWeekScoreData(w);
  const wxp = (w) => (window.Game && Game.weekXp) ? Game.weekXp(w) : 0;
  const wxa = (w) => (window.Game && Game.weekXpByAttr) ? Game.weekXpByAttr(w) : {};
  const prof = (window.Game && Game.computeProfile) ? Game.computeProfile() : null;

  const cur = getStartOfWeek(new Date());
  const last12 = [];
  for (let i = 11; i >= 0; i--) {
    const d = addDays(cur, -i * 7); const w = weeks[iso(d)];
    last12.push({ date: d, score: w ? calc(w) : 0, xp: w ? wxp(w) : 0, byAttr: w ? wxa(w) : {} });
  }

  const blueprint = getDailyBlueprint();
  const names = Object.keys(blueprint);
  const wdSum = [0, 0, 0, 0, 0, 0, 0], wdN = [0, 0, 0, 0, 0, 0, 0];
  const taskStat = {};
  Object.values(weeks).forEach((w) => {
    if (!w || !w.checks) return;
    for (let i = 0; i < 7; i++) {
      const tasks = blueprint[names[i]] || [];
      if (!tasks.length) continue;
      let done = 0;
      tasks.forEach((t) => {
        const c = !!w.checks[taskId(i, t)];
        const st = taskStat[t] || (taskStat[t] = { done: 0, seen: 0 });
        st.seen++; if (c) { st.done++; done++; }
      });
      wdSum[i] += Math.round(done / tasks.length * 100); wdN[i]++;
    }
  });
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = wdSum.map((s, i) => wdN[i] ? Math.round(s / wdN[i]) : 0);
  const skipped = Object.entries(taskStat).map(([name, st]) => ({ name, rate: Math.round(st.done / st.seen * 100) }))
    .filter((x) => taskStat[x.name].seen >= 2).sort((a, b) => a.rate - b.rate).slice(0, 5);

  let html = "";
  if (prof) {
    const stats = [["Level", prof.level], ["Lifetime XP", prof.lifetimeXp.toLocaleString()], ["Best week", prof.bestWeekPct + "%"], ["Day streak", prof.dayStreak], ["Active wks", prof.activeWeeks]];
    html += `<div class="tr-stats">${stats.map(([k, v]) => `<div class="tr-stat"><span class="tr-stat-v">${v}</span><span class="tr-stat-k">${k}</span></div>`).join("")}</div>`;
  }
  html += trBarBlock("Weekly completion · last 12 weeks", last12.map((w) => ({ label: fmt(w.date), value: w.score, raw: w.score + "%", grade: true })), 100);
  html += trBarBlock("XP earned · last 12 weeks", last12.map((w) => ({ label: fmt(w.date), value: w.xp, raw: String(w.xp) })), Math.max(1, ...last12.map((w) => w.xp)));
  if (prof && prof.attrs) html += trAttrTrends(prof.attrs, last12);
  html += trBarBlock("Completion by weekday", weekday.map((v, i) => ({ label: DOW[i], value: v, raw: v + "%", grade: true })), 100);
  if (skipped.length) {
    html += `<div class="tr-block"><div class="tr-title">Most skipped quests</div>` +
      skipped.map((s) => `<div class="tr-skip"><span class="tr-skip-name">${escapeHtml(s.name)}</span><span class="tr-skip-bar"><span class="tr-skip-fill" style="width:${s.rate}%"></span></span><span class="tr-skip-rate">${s.rate}%</span></div>`).join("") +
      `</div>`;
  }
  el.innerHTML = html;
}

function bindEvents() {
  document.addEventListener("input", e => { if (e.target.matches("[data-save]")) { saveWeekField(e.target); updateProgress(); } });
  // Linked daily-task proxy → writes the section's shared check id (counts once).
  document.addEventListener("change", e => {
    if (!e.target.matches || !e.target.matches("input[data-link-id]")) return;
    const id = e.target.getAttribute("data-link-id");
    if (!id) return;
    const wk = getWeekData();
    wk.checks[id] = e.target.checked;
    wk.updatedAt = new Date().toISOString();
    const secEl = document.getElementById(id);          // mirror onto the section's own checkbox
    if (secEl && secEl.type === "checkbox") secEl.checked = e.target.checked;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { persistDatabase(); updateStreakAndHeatmap(); if (window.Game) Game.render(); }, 80);
    updateProgress();
  });
  // First-run onboarding: pick a path or start blank.
  document.addEventListener("click", e => {
    const path = e.target.closest && e.target.closest(".onboard-path");
    if (path) { chooseOnboardPath(path.getAttribute("data-preset")); return; }
    if (e.target.id === "onboardSkip") startBlank();
  });
  // Certification target dates (stored in settings.certDates, not week fields)
  document.addEventListener("change", e => {
    if (!e.target.matches("[data-certdate]")) return;
    if (!settings.certDates) settings.certDates = {};
    const name = e.target.dataset.certdate;
    if (e.target.value) settings.certDates[name] = e.target.value;
    else delete settings.certDates[name];
    persistSettings();
    updateCertCountdowns();
  });
  document.addEventListener("change", e => { 
    if (e.target.matches("[data-save]")) { 
      saveWeekField(e.target); 
      updateProgress(); 
      
      // Auto-archive: detect study completion
      if (e.target.id?.startsWith('status-study-') && e.target.value === 'Completed') {
        const idx = parseInt(e.target.id.split('-').pop());
        const area = getStudyAreas()[idx];
        if (area && confirm(`Archive "${area}" as a completed certification?`)) {
          saveRecord({
            title: area, category: 'certification',
            notes: `Completed during week of ${document.getElementById('weekRangeText').textContent}`,
            completed_at: new Date().toISOString(), week_key: weekKey(),
            source: 'auto', ext_key: 'cert:' + area + ':' + weekKey(),
          });
        }
      }
    } 
  });
  document.addEventListener("click", e => {
    const btn = e.target.closest(".edit-day-btn");
    if (btn) { e.preventDefault(); e.stopPropagation(); openDayEditor(Number(btn.dataset.dayIndex)); }
  });
  // Click a daily task's attribute dot to cycle which stat it trains.
  document.addEventListener("click", e => {
    const dot = e.target.closest(".q-attr");
    if (!dot) return;
    e.preventDefault(); e.stopPropagation();
    const list = (window.Forge && Forge.ATTR_LIST) ? Forge.ATTR_LIST : ["Discipline", "Body", "Mind", "Vitality", "Craft"];
    const next = list[(list.indexOf(dot.dataset.attr) + 1) % list.length];
    setTaskAttr(dot.dataset.task, next);
  });
  // Pencil on a custom section opens the Edit Section modal.
  document.addEventListener("click", e => {
    const eb = e.target.closest(".edit-section-btn");
    if (!eb) return;
    e.preventDefault(); e.stopPropagation();
    openSectionEditor(eb.dataset.moduleId);
  });
  const esClose = document.getElementById("editSectionClose");
  if (esClose) esClose.onclick = closeSectionEditor;
  const esCancel = document.getElementById("editSectionCancel");
  if (esCancel) esCancel.onclick = closeSectionEditor;
  const esSave = document.getElementById("editSectionSave");
  if (esSave) esSave.onclick = saveSectionEditor;
  const esModal = document.getElementById("editSectionModal");
  if (esModal) esModal.addEventListener("click", e => { if (e.target.id === "editSectionModal") closeSectionEditor(); });
  document.getElementById("prevWeekBtn").onclick = () => { selectedWeekStart = addDays(selectedWeekStart, -7); applyWeekToUI(); };
  document.getElementById("nextWeekBtn").onclick = () => { selectedWeekStart = addDays(selectedWeekStart, 7); applyWeekToUI(); };
  document.getElementById("currentWeekBtn").onclick = () => { selectedWeekStart = getStartOfWeek(new Date()); applyWeekToUI(); };
  document.getElementById("resetBtn").onclick = resetThisWeek;
  document.getElementById("exportBtn").onclick = exportBackup;
  document.getElementById("importFile").onchange = importBackup;
  document.getElementById("expandAllBtn").onclick = () => document.querySelectorAll("details.section-card").forEach(d => d.open = true);
  document.getElementById("collapseAllBtn").onclick = () => document.querySelectorAll("details.section-card").forEach(d => d.open = false);
  document.getElementById("cancelDayEditBtn").onclick = closeDayEditor;
  const cancelDayTop = document.getElementById("cancelDayEditTopBtn");
  if (cancelDayTop) cancelDayTop.onclick = closeDayEditor;
  document.getElementById("saveDayTemplateBtn").onclick = saveDayTemplate;
  document.getElementById("resetDayTemplateBtn").onclick = resetDayTemplate;
  document.getElementById("editDayModal").addEventListener("click", e => { if (e.target.id === "editDayModal") closeDayEditor(); });
  // Day-editor rows: add / reorder / delete / live stat-dot
  const addDayTaskBtn = document.getElementById("addDayTaskBtn");
  if (addDayTaskBtn) addDayTaskBtn.onclick = () => {
    const rows = dayEditorReadRows();
    rows.push({ text: "", attr: "Discipline" });
    renderDayEditorRows(rows);
    const inputs = document.querySelectorAll("#editDayRows .de-text");
    if (inputs.length) inputs[inputs.length - 1].focus();
  };
  const dayRows = document.getElementById("editDayRows");
  if (dayRows) {
    dayRows.addEventListener("click", (e) => {
      const row = e.target.closest(".day-edit-row"); if (!row) return;
      const rows = dayEditorReadRows();
      const idx = [...dayRows.children].indexOf(row);
      if (e.target.closest(".de-del")) { rows.splice(idx, 1); renderDayEditorRows(rows); }
      else if (e.target.closest(".de-up") && idx > 0) { [rows[idx - 1], rows[idx]] = [rows[idx], rows[idx - 1]]; renderDayEditorRows(rows); }
      else if (e.target.closest(".de-down") && idx < rows.length - 1) { [rows[idx + 1], rows[idx]] = [rows[idx], rows[idx + 1]]; renderDayEditorRows(rows); }
    });
    dayRows.addEventListener("change", (e) => {
      const rowEl = e.target.closest(".day-edit-row");
      if (!rowEl) return;
      // Picking a link auto-assigns + locks the stat to the linked section's stat.
      if (e.target.classList.contains("de-link")) {
        let ref = null;
        if (e.target.value) { try { ref = JSON.parse(e.target.value); } catch (x) { ref = e.target.value; } }
        const lm = ref && window.Forge ? Forge.linkModule(ref, getModules()) : null;
        const attrSel = rowEl.querySelector(".de-attr");
        const dot = rowEl.querySelector(".de-dot");
        if (lm && lm.attr) { attrSel.value = lm.attr; attrSel.disabled = true; if (dot) dot.style.setProperty("--ac", attrColor(lm.attr)); }
        else { attrSel.disabled = false; if (dot) dot.style.setProperty("--ac", attrColor(attrSel.value)); }
        return;
      }
      if (e.target.classList.contains("de-attr")) {
        const dot = rowEl.querySelector(".de-dot");
        if (dot) dot.style.setProperty("--ac", attrColor(e.target.value));
      }
    });
  }

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
      const sf = document.getElementById("cfgStreakFreeze"); if (sf) settings.streakFreeze = Math.min(3, Math.max(0, Number(sf.value) || 0));
      const cs = document.getElementById("cfgCallsign"); if (cs && cs.value.trim()) settings.callsign = cs.value.trim();
      settings.hiddenSections = [...document.querySelectorAll('#sectionToggles input[data-section]')].filter(c => !c.checked).map(c => c.dataset.section);
      const reEnable = document.getElementById("cfgRemindEnable");
      if (reEnable) {
        const wasEnabled = (settings.reminders || {}).enabled;
        settings.reminders = {
          enabled: reEnable.checked,
          morning: (document.getElementById("cfgRemindMorning") || {}).value || "08:00",
          evening: (document.getElementById("cfgRemindEvening") || {}).value || "19:00",
        };
        if (reEnable.checked && !wasEnabled) await enableReminders();
      }
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

  // Cabinet (trophies + insignias + records)
  const openCabinetBtn = document.getElementById("openCabinetBtn");
  if (openCabinetBtn) openCabinetBtn.onclick = openCabinet;
  // Calendar modal
  const openCalBtn = document.getElementById("openCalendarBtn");
  if (openCalBtn) openCalBtn.onclick = openCalendar;
  const calClose = document.getElementById("calClose");
  if (calClose) calClose.onclick = closeCalendar;
  const calPrev = document.getElementById("calPrev");
  if (calPrev) calPrev.onclick = () => calShiftMonth(-1);
  const calNext = document.getElementById("calNext");
  if (calNext) calNext.onclick = () => calShiftMonth(1);
  const calTodayBtn = document.getElementById("calToday");
  if (calTodayBtn) calTodayBtn.onclick = () => { calViewDate = new Date(); renderCalendarMonth(); };
  const calModal = document.getElementById("calendarModal");
  if (calModal) calModal.addEventListener("click", (e) => { if (e.target.id === "calendarModal") closeCalendar(); });
  const calGrid = document.getElementById("calGrid");
  if (calGrid) calGrid.addEventListener("click", (e) => {
    const cell = e.target.closest(".cal-cell[data-date]");
    if (!cell || cell.classList.contains("future") || cell.classList.contains("empty")) return;
    const date = new Date(cell.dataset.date + "T00:00:00");
    selectedWeekStart = getStartOfWeek(date);
    applyWeekToUI();
    closeCalendar();
    scrollToSection("daily");
  });
  const openCabinetHeroBtn = document.getElementById("openCabinetHeroBtn");
  if (openCabinetHeroBtn) openCabinetHeroBtn.onclick = openCabinet;
  const closeCabinetBtn = document.getElementById("closeCabinetBtn");
  if (closeCabinetBtn) closeCabinetBtn.onclick = closeCabinet;
  const closeCabinetTopBtn = document.getElementById("closeCabinetTopBtn");
  if (closeCabinetTopBtn) closeCabinetTopBtn.onclick = closeCabinet;
  document.getElementById("cabinetModal")?.addEventListener("click", e => {
    if (e.target.id === "cabinetModal") closeCabinet();
  });

  // Records form (add + edit)
  const addTrophyBtn = document.getElementById("addTrophyBtn");
  if (addTrophyBtn) addTrophyBtn.onclick = () => openRecordForm(null);
  const cancelTrophyBtn = document.getElementById("cancelTrophyBtn");
  if (cancelTrophyBtn) cancelTrophyBtn.onclick = () => closeRecordForm();
  const saveTrophyBtn = document.getElementById("saveTrophyBtn");
  if (saveTrophyBtn) saveTrophyBtn.onclick = () => saveRecordForm();

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
  // Focus timer
  const openFocusBtn = document.getElementById("openFocusBtn");
  if (openFocusBtn) openFocusBtn.onclick = openFocus;
  const closeFocusBtn = document.getElementById("closeFocusBtn");
  if (closeFocusBtn) closeFocusBtn.onclick = () => { if (focusState) endFocus(false); else document.getElementById("focusModal").classList.remove("active"); };
  document.querySelectorAll(".focus-dur").forEach((b) => b.onclick = () => {
    document.querySelectorAll(".focus-dur").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    const c = document.getElementById("focusCustom"); if (c) c.value = "";
  });
  const focusCustomEl = document.getElementById("focusCustom");
  if (focusCustomEl) focusCustomEl.oninput = () => { if (focusCustomEl.value) document.querySelectorAll(".focus-dur").forEach((x) => x.classList.remove("active")); };
  const focusStartBtn = document.getElementById("focusStartBtn");
  if (focusStartBtn) focusStartBtn.onclick = () => {
    const custom = Number(document.getElementById("focusCustom").value);
    const active = document.querySelector(".focus-dur.active");
    startFocus(custom > 0 ? custom : (active ? Number(active.dataset.min) : 25));
  };
  const focusPauseBtn = document.getElementById("focusPauseBtn");
  if (focusPauseBtn) focusPauseBtn.onclick = () => { if (focusState) { focusState.paused = !focusState.paused; focusPauseBtn.textContent = focusState.paused ? "Resume" : "Pause"; } };
  const focusStopBtn = document.getElementById("focusStopBtn");
  if (focusStopBtn) focusStopBtn.onclick = () => endFocus(false);

  const openReportBtn = document.getElementById("openReportBtn");
  if (openReportBtn) openReportBtn.onclick = () => {
    document.getElementById("reportsModal").classList.add("active");
    renderTrends();
  };
  const closeReportBtn = document.getElementById("closeReportBtn");
  if (closeReportBtn) closeReportBtn.onclick = () => document.getElementById("reportsModal").classList.remove("active");

  // ----- Season modal -----
  const openSeasonBtn = document.getElementById("openSeasonBtn");
  if (openSeasonBtn) openSeasonBtn.onclick = openSeason;
  const seasonClose = document.getElementById("seasonClose");
  if (seasonClose) seasonClose.onclick = closeSeason;
  const seasonCloseBtn = document.getElementById("seasonCloseBtn");
  if (seasonCloseBtn) seasonCloseBtn.onclick = closeSeason;
  const seasonPrev = document.getElementById("seasonPrev");
  if (seasonPrev) seasonPrev.onclick = () => { if (seasonOffset < 120) seasonOffset++; renderSeason(); };
  const seasonNext = document.getElementById("seasonNext");
  if (seasonNext) seasonNext.onclick = () => { if (seasonOffset > 0) seasonOffset--; renderSeason(); };
  const seasonShareBtn = document.getElementById("seasonShareBtn");
  if (seasonShareBtn) seasonShareBtn.onclick = () => { if (window.shareSeasonCard) window.shareSeasonCard(curSeasonSummary()); };
  const seasonModal = document.getElementById("seasonModal");
  if (seasonModal) {
    seasonModal.addEventListener("click", (e) => {
      if (e.target === seasonModal) return closeSeason();
      const del = e.target.closest && e.target.closest(".sg-del");
      if (del) return removeSeasonGoal(del.getAttribute("data-goal"));
      if (e.target.id === "sgAdd") return addSeasonGoalFromForm();
    });
  }

  // ----- Year in Review modal -----
  const openYearBtn = document.getElementById("openYearBtn");
  if (openYearBtn) openYearBtn.onclick = openYear;
  const yearClose = document.getElementById("yearClose");
  if (yearClose) yearClose.onclick = closeYear;
  const yearCloseBtn = document.getElementById("yearCloseBtn");
  if (yearCloseBtn) yearCloseBtn.onclick = closeYear;
  const yearPrev = document.getElementById("yearPrev");
  if (yearPrev) yearPrev.onclick = () => { if (yearOffset < 30) yearOffset++; renderYear(); };
  const yearNext = document.getElementById("yearNext");
  if (yearNext) yearNext.onclick = () => { if (yearOffset > 0) yearOffset--; renderYear(); };
  const yearShareBtn = document.getElementById("yearShareBtn");
  if (yearShareBtn) yearShareBtn.onclick = () => { if (window.shareYearCard) window.shareYearCard(curYearSummary()); };
  const yearModal = document.getElementById("yearModal");
  if (yearModal) yearModal.addEventListener("click", (e) => { if (e.target === yearModal) closeYear(); });

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
  
  const genTrends = document.getElementById("genTrendsBtn");
  if (genTrends) genTrends.onclick = renderTrends;
  const genMonth = document.getElementById("genMonthReportBtn");
  if (genMonth) genMonth.onclick = () => genReport(4);
  const genYear = document.getElementById("genYearReportBtn");
  if (genYear) genYear.onclick = () => genReport(52);
  const copyRep = document.getElementById("copyReportBtn");
  if (copyRep) copyRep.onclick = () => navigator.clipboard.writeText(document.getElementById("reportContent").innerText).then(() => alert("Report copied."));

  // Init settings tabs
  initSettingsTabs();
  wireModulesEditor();
  wireStatsEditor();
  
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

function dayEditorAttrs() { return (window.Forge && Forge.ATTR_LIST) ? Forge.ATTR_LIST : ["Discipline", "Body", "Mind", "Vitality", "Craft"]; }
function renderDayEditorRows(rows) {
  const wrap = document.getElementById("editDayRows");
  if (!wrap) return;
  const attrs = dayEditorAttrs();
  const targets = (window.Forge && Forge.linkTargets) ? Forge.linkTargets(getModules()) : [];
  wrap.innerHTML = rows.map((row) => {
    const linkedMod = row.link && window.Forge ? Forge.linkModule(row.link, getModules()) : null;
    const attr = linkedMod ? linkedMod.attr : (row.attr || "Discipline");
    const opts = attrs.map((a) => `<option value="${a}" ${a === attr ? "selected" : ""}>${escapeHtml(attrName(a))}</option>`).join("");
    const curLink = row.link && window.Forge ? JSON.stringify(Forge.normLink(row.link)) : "";
    const linkSel = targets.length ? `<select class="de-link" aria-label="Link to section" title="Link to a section — shared checkbox, or attached by stat"><option value="">— no link</option>${targets.map((t) => { const v = JSON.stringify(t.ref); return `<option value="${escapeHtml(v)}" ${v === curLink ? "selected" : ""}>↔ ${escapeHtml(t.label)}</option>`; }).join("")}</select>` : "";
    return `<div class="day-edit-row">
      <div class="de-move">
        <button class="de-up" type="button" aria-label="Move up"><svg viewBox="0 0 24 24" class="ic"><path d="M18 15l-6-6-6 6"/></svg></button>
        <button class="de-down" type="button" aria-label="Move down"><svg viewBox="0 0 24 24" class="ic"><path d="M6 9l6 6 6-6"/></svg></button>
      </div>
      <span class="de-dot" style="--ac:${attrColor(attr)}"></span>
      <input class="de-text" type="text" value="${escapeHtml(row.text)}" placeholder="Task name" spellcheck="false">
      <select class="de-attr" aria-label="Stat" ${linkedMod ? "disabled title='Set by the link'" : ""}>${opts}</select>
      ${linkSel}
      <button class="de-del" type="button" aria-label="Remove task"><svg viewBox="0 0 24 24" class="ic"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>`;
  }).join("");
}
function dayEditorReadRows() {
  return [...document.querySelectorAll("#editDayRows .day-edit-row")].map((r) => ({
    text: r.querySelector(".de-text").value.trim(),
    attr: r.querySelector(".de-attr").value,
    link: (() => { const el = r.querySelector(".de-link"); if (!el || !el.value) return ""; try { return JSON.parse(el.value); } catch (e) { return el.value; } })(),
  }));
}
function openDayEditor(dayIndex) {
  editingDayIndex = dayIndex;
  const name = dayNames()[dayIndex];
  const tasks = getDailyBlueprint()[name] || [];
  document.getElementById("editDayTitle").textContent = `Edit ${name} Checklist`;
  renderDayEditorRows(tasks.map((t) => ({ text: t, attr: taskAttr(t), link: taskLink(t) })));
  document.getElementById("editDayModal").classList.add("active");
  document.getElementById("editDayModal").setAttribute("aria-hidden", "false");
}

function closeDayEditor() {
  editingDayIndex = null;
  document.getElementById("editDayModal").classList.remove("active");
  document.getElementById("editDayModal").setAttribute("aria-hidden", "true");
}

async function saveDayTemplate() {
  if (editingDayIndex === null) return;
  const name = dayNames()[editingDayIndex];
  const rows = dayEditorReadRows().filter((r) => r.text);
  if (!rows.length) { alert("Keep at least one task in the day."); return; }
  const templates = structuredCloneSafe(getDailyBlueprint());
  templates[name] = rows.map((r) => r.text);
  settings.dayTemplates = templates;
  // Persist each task's chosen attribute explicitly (keyed by task slug) so it's
  // no longer inferred — the picker is now the source of truth.
  if (!settings.taskAttrs) settings.taskAttrs = {};
  if (!settings.taskLinks) settings.taskLinks = {};
  rows.forEach((r) => {
    if (!window.Forge) return;
    const k = Forge.dailyAttrKey(r.text);
    if (r.link) {
      settings.taskLinks[k] = r.link;
      const lm = Forge.linkModule(r.link, getModules());   // auto-assign the section's stat
      settings.taskAttrs[k] = (lm && lm.attr) ? lm.attr : r.attr;
    } else {
      delete settings.taskLinks[k];
      settings.taskAttrs[k] = r.attr;
    }
  });
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
  const summary = `THE FORGE — WEEKLY SUMMARY\n\nWeek: ${document.getElementById("weekRangeText").textContent}\nMission: ${document.getElementById("mission").value}\nWeekly Completion: ${document.getElementById("scoreValue").textContent}\nCertification Study Hours: ${studyHours}/14\nProject Hours: ${document.getElementById("projectHours").value}/2 minimum, 3 bonus\nWeekly Grade: ${document.getElementById("grade").value}\n\nCurrent Project Focus:\n${document.getElementById("projectFocus").value}\n\nWins:\n${document.getElementById("wins").value}\n\nMissed Habits / Friction:\n${document.getElementById("misses").value}\n\nChanges for Next Week:\n${document.getElementById("changes").value}\n\nOne Thing I Refuse To Drop:\n${document.getElementById("refuseDrop").value}`;
  navigator.clipboard.writeText(summary).then(() => alert("Weekly summary copied."));
}

async function exportBackup() {
  await persistDatabase();
  await persistSettings();
  let payload;
  try {
    const res = await fetch("/api/backup");
    if (!res.ok) throw new Error("Server backup export failed");
    payload = await res.json();
  } catch (err) {
    console.warn("Falling back to client-side backup export", err);
    payload = { exportedAt: new Date().toISOString(), app: "The Forge", version: 3, backupVersion: 1, database, settings, achievements };
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `the-forge-backup-${iso(new Date())}.json`;
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
      if (!confirm("Import this backup? Included weeks replace current week data; included records replace current records.")) {
        e.target.value = "";
        return;
      }
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const imported = await res.json().catch(() => ({}));
      if (!res.ok || !imported.success) throw new Error(imported.error || imported.message || "Server rejected the backup");
      database = imported.database || { version: 2, weeks: {} };
      settings = imported.settings || { version: 3, dayTemplates: null };
      achievements = Array.isArray(imported.achievements) ? imported.achievements : [];
      localStorage.setItem(APP_DB_KEY, JSON.stringify(database));
      localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
      if (settings.theme) applyTheme(settings.theme);
      applyWeekToUI();
      alert("Backup imported successfully.");
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
  bindEvents();  // event delegation + button handlers — once, up front

  // Instant paint from the last-known cache so a reload never flashes the empty shell.
  // Writes stay suppressed (booting) so this can't clobber fresher server state.
  const cachedDb = readCache(APP_DB_KEY);
  const cachedSettings = readCache(APP_SETTINGS_KEY);
  if (cachedDb && cachedDb.weeks && cachedSettings) {
    database = cachedDb;
    settings = cachedSettings;
    if (settings.theme) applyTheme(settings.theme);
    renderStatic();
    applyWeekToUI();
  }

  // Revalidate from the server in parallel (one round-trip, not three), then reconcile.
  await Promise.all([loadDatabase(), loadSettings(), loadAchievements()]);
  await migrateLegacyIfNeeded();
  booting = false;
  cacheState();
  if (settings.theme) applyTheme(settings.theme);
  renderStatic();
  applyWeekToUI();
  maybeShowOnboarding();
}

init();

// Register the service worker for offline support + installable PWA.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
