/* The Forge — adoption extras: sample data, onboarding, default-password
   warning, and the shareable character card. Standalone (uses only the public
   API + window.Game); loaded after app.js. */
(function () {
  "use strict";

  // ---- helpers (mirror app.js id scheme) ----
  function slug(text, limit) {
    return String(text).toLowerCase().trim().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, limit) || "task";
  }
  var taskId = function (i, t) { return "day-" + i + "-" + slug(t, 58); };
  var dietId = function (t) { return "diet-" + slug(t, 48); };
  var projId = function (t) { return "project-" + slug(t, 48); };
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function startOfWeek(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x; }

  var BLUEPRINT = {
    Sunday: ["Wake up by 6:00 AM", "Morning cardio or movement", "Shower", "Brush teeth", "Work prep / plan the day", "Work / main responsibility", "Weights or active recovery", "2 hours certification study", "Read", "Sleep by 12:00 AM"],
    Monday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    Tuesday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    Wednesday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    Thursday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    Friday: ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    Saturday: ["Wake up by 6:00 AM", "Workout or recovery", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Read", "Sleep by 12:00 AM"]
  };
  var DIET = ["Protein backup ready for the week", "Weekend protein option planned", "Protein groceries available", "Hydration handled most days", "No full junk mode", "At least one protein meal prepped"];
  var PROJECT = ["Code, workflow, documentation, or plan created", "Progress documented", "Next action is clear"];
  var DAYS = Object.keys(BLUEPRINT);

  function buildSampleData() {
    var WEEKS = 32, today = new Date(), thisWeek = startOfWeek(today), weeks = {};
    for (var w = WEEKS - 1; w >= 0; w--) {
      var ws = new Date(thisWeek); ws.setDate(ws.getDate() - w * 7);
      var ramp = 0.55 + (1 - w / WEEKS) * 0.37, isCurrent = (w === 0);
      var checks = {}, fields = {};
      DAYS.forEach(function (name, i) {
        if (isCurrent && i > today.getDay()) return;
        var hit = Math.min(0.97, ramp + (Math.random() * 0.18 - 0.09));
        BLUEPRINT[name].forEach(function (t) { if (Math.random() < hit) checks[taskId(i, t)] = true; });
        if (Math.random() < hit) checks["workout-" + i] = true;
      });
      DIET.forEach(function (d) { if (Math.random() < ramp) checks[dietId(d)] = true; });
      PROJECT.forEach(function (p) { if (Math.random() < ramp) checks[projId(p)] = true; });
      for (var s = 0; s < 3; s++) fields["hours-study-" + s] = +(Math.random() * 1.5 + 0.5).toFixed(2);
      fields.projectHours = +(Math.random() * 4 + 1).toFixed(1);
      fields.mission = "Finish the certification module and ship the side-project MVP";
      fields.wins = "Stayed consistent on the core routine.";
      fields.misses = "A couple of late nights.";
      fields.changes = "Protect the morning block.";
      fields.grade = ramp > 0.8 ? "A" : ramp > 0.65 ? "B" : "C";
      weeks[iso(ws)] = { checks: checks, fields: fields, createdAt: new Date().toISOString(), schemaVersion: 2 };
    }
    var now = Date.now();
    var settings = {
      version: 3, dayTemplates: null, callsign: "Player One", gameBase: 100,
      streakGrade: 75, streakFreeze: 1,
      studyAreas: ["Certification / Course", "Language Learning", "Reading List", "Skill Practice"],
      badges: { "first-steps": now, "disciplined": now, "bookworm": now, "on-fire": now, "iron-body": now, "scholar": now, "maker": now }
    };
    var achievements = [
      { title: "First Certification", category: "certification", completed_at: new Date().toISOString(), notes: "Passed the exam." },
      { title: "First 100 days", category: "fitness", completed_at: new Date().toISOString(), notes: "Consistency win." }
    ];
    return { weeks: weeks, settings: settings, achievements: achievements };
  }

  async function loadSampleData() {
    if (!confirm("Load sample data?\n\nThis fills the dashboard with ~8 months of example progress so you can explore the app. It REPLACES the current week data and settings. You can Reset or Import a backup afterwards.")) return;
    var btn = document.getElementById("loadSampleBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }
    try {
      var data = buildSampleData();
      var keys = Object.keys(data.weeks);
      for (var i = 0; i < keys.length; i++) {
        await fetch("/api/week/" + keys[i], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data.weeks[keys[i]]) });
      }
      await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data.settings) });
      for (var a = 0; a < data.achievements.length; a++) {
        await fetch("/api/achievements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data.achievements[a]) });
      }
      location.reload();
    } catch (e) {
      alert("Could not load sample data: " + e.message);
      if (btn) { btn.disabled = false; btn.textContent = "Load Sample Data"; }
    }
  }

  // ---- injected styles for banner + welcome ----
  function injectStyles() {
    if (document.getElementById("forge-extras-style")) return;
    var s = document.createElement("style");
    s.id = "forge-extras-style";
    s.textContent =
      "#forgePwBanner{position:sticky;top:0;z-index:60;display:flex;gap:12px;align-items:center;justify-content:center;" +
      "padding:10px 16px;background:linear-gradient(90deg,rgba(245,158,11,.18),rgba(239,68,68,.18));" +
      "border-bottom:1px solid rgba(245,158,11,.4);color:var(--text,#e5e7eb);font-size:14px;font-weight:600;}" +
      "#forgePwBanner button{margin-left:8px;padding:4px 10px;font-size:12px;border-radius:8px;cursor:pointer;" +
      "background:transparent;border:1px solid var(--muted,#444);color:var(--text-dim,#9ca3af);}" +
      ".forge-welcome-backdrop{position:fixed;inset:0;z-index:200;display:grid;place-items:center;" +
      "background:rgba(0,0,0,.72);backdrop-filter:blur(4px);}" +
      ".forge-welcome{width:min(440px,92vw);padding:32px;border-radius:18px;text-align:center;" +
      "background:var(--glass,rgba(20,20,26,.9));border:1px solid var(--muted,#2a2a33);box-shadow:0 30px 80px rgba(0,0,0,.6);}" +
      ".forge-welcome h2{margin:0 0 8px;font-size:24px;color:var(--text,#fff);}" +
      ".forge-welcome p{margin:0 0 22px;color:var(--text-dim,#9ca3af);font-size:15px;line-height:1.5;}" +
      ".forge-welcome .row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;}" +
      ".forge-welcome button{padding:12px 18px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;}";
    document.head.appendChild(s);
  }

  async function showDefaultPasswordBanner() {
    try {
      var cfg = await (await fetch("/api/config")).json();
      if (!cfg || !cfg.defaultPassword) return;
      if (document.getElementById("forgePwBanner")) return;
      injectStyles();
      var bar = document.createElement("div");
      bar.id = "forgePwBanner";
      bar.innerHTML = "⚠️ You're using the default password. Set <code>APP_PASSWORD</code> before exposing this anywhere." +
        "<button type='button'>Dismiss</button>";
      bar.querySelector("button").onclick = function () { bar.remove(); };
      document.body.insertBefore(bar, document.body.firstChild);
    } catch (e) { /* ignore */ }
  }

  async function maybeShowWelcome() {
    try {
      var db = await (await fetch("/api/database")).json();
      var empty = !db || !db.weeks || Object.keys(db.weeks).length === 0;
      if (!empty) return;
      injectStyles();
      var back = document.createElement("div");
      back.className = "forge-welcome-backdrop";
      back.innerHTML =
        "<div class='forge-welcome glass'>" +
        "<h2>Welcome to The Forge</h2>" +
        "<p>Turn your goals into an RPG. Want to explore with example progress first, or start from a clean slate?</p>" +
        "<div class='row'>" +
        "<button class='primary' id='forgeWelcomeSample'>Load sample data</button>" +
        "<button id='forgeWelcomeFresh'>Start fresh</button>" +
        "</div></div>";
      document.body.appendChild(back);
      back.querySelector("#forgeWelcomeFresh").onclick = function () { back.remove(); };
      back.querySelector("#forgeWelcomeSample").onclick = function () { back.remove(); loadSampleData(); };
    } catch (e) { /* ignore */ }
  }

  // ---- shareable character card ----
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawCard() {
    if (!window.Game || typeof window.Game.computeProfile !== "function") return null;
    var p = window.Game.computeProfile();
    var callsign = (typeof settings !== "undefined" && settings && settings.callsign) ? settings.callsign :
      (document.querySelector(".callsign-text") ? document.querySelector(".callsign-text").textContent : "Player One");

    var accent = cssVar("--accent-primary", "#8b5cf6");
    var accent2 = cssVar("--accent-secondary", "#38bdf8");
    var textc = cssVar("--text", "#f5f5f7");
    var dim = cssVar("--text-dim", "#9ca3af");

    var W = 1200, H = 630, S = 2;
    var c = document.createElement("canvas");
    c.width = W * S; c.height = H * S;
    var ctx = c.getContext("2d");
    ctx.scale(S, S);

    // background
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#0b0b12"); g.addColorStop(1, "#050509");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var rg = ctx.createRadialGradient(W - 200, 120, 40, W - 200, 120, 520);
    rg.addColorStop(0, hexA(accent, 0.20)); rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

    var FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    // eyebrow
    ctx.fillStyle = accent; ctx.font = "700 22px " + FONT; ctx.textBaseline = "alphabetic";
    ctx.fillText("⚒  THE FORGE", 64, 80);

    // level orb
    var ox = 170, oy = 250, rad = 92;
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.arc(ox, oy, rad, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.stroke();
    var prog = p.xpForNext ? (p.xpIntoLevel / p.xpForNext) : 0;
    ctx.beginPath(); ctx.arc(ox, oy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.04, prog));
    ctx.strokeStyle = accent; ctx.lineCap = "round"; ctx.stroke();
    ctx.fillStyle = dim; ctx.font = "600 20px " + FONT; ctx.textAlign = "center"; ctx.fillText("LVL", ox, oy - 28);
    ctx.fillStyle = textc; ctx.font = "800 78px " + FONT; ctx.fillText(String(p.level), ox, oy + 30);
    ctx.textAlign = "left";

    // identity
    ctx.fillStyle = textc; ctx.font = "800 56px " + FONT; ctx.fillText(trim(ctx, callsign, 540), 300, 200);
    ctx.fillStyle = accent2; ctx.font = "600 30px " + FONT;
    ctx.fillText(p.rank.name + " · Tier " + p.rank.tier, 300, 246);
    ctx.fillStyle = dim; ctx.font = "500 26px " + FONT;
    ctx.fillText(p.lifetimeXp.toLocaleString() + " lifetime XP   ·   🔥 " + (p.dayStreak || 0) + " day streak", 300, 300);

    // attribute bars
    var bx = 64, bw = 1072, by = 372, rowH = 46;
    var maxLv = Math.max.apply(null, p.attrs.map(function (a) { return a.level; }).concat([1]));
    p.attrs.forEach(function (a, i) {
      var y = by + i * rowH;
      ctx.fillStyle = textc; ctx.font = "600 22px " + FONT;
      ctx.fillText(cap(a.key), bx, y + 4);
      var tx = bx + 200, tw = bw - 200 - 90;
      roundRect(ctx, tx, y - 14, tw, 18, 9); ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fill();
      var fillw = Math.max(18, tw * (a.level / maxLv));
      roundRect(ctx, tx, y - 14, fillw, 18, 9); ctx.fillStyle = a.color || accent; ctx.fill();
      ctx.fillStyle = dim; ctx.font = "700 20px " + FONT; ctx.textAlign = "right";
      ctx.fillText("Lv " + a.level, bx + bw, y + 3); ctx.textAlign = "left";
    });

    // footer
    ctx.fillStyle = dim; ctx.font = "500 18px " + FONT; ctx.textAlign = "right";
    ctx.fillText("github.com/ycianno/the-forge", W - 64, H - 40); ctx.textAlign = "left";
    return c;

    function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }
    function trim(ctx, s, max) { s = String(s); while (ctx.measureText(s).width > max && s.length > 1) s = s.slice(0, -1); return s; }
  }

  function hexA(hex, a) {
    hex = (hex || "").replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(function (x) { return x + x; }).join("");
    if (hex.length < 6) return "rgba(139,92,246," + a + ")";
    var n = parseInt(hex.slice(0, 6), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  function downloadCanvas(canvas) {
    // Synchronous within the click gesture (toDataURL, not async toBlob) so the
    // download isn't blocked as a non-user-initiated action.
    var a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "forge-card.png";
    document.body.appendChild(a); a.click(); a.remove();
  }

  function shareCard() {
    var canvas = drawCard();
    if (!canvas) { alert("Character data isn't ready yet."); return; }
    // Mobile: offer the native share sheet with the image (best-effort, async).
    if (navigator.canShare && typeof navigator.share === "function") {
      canvas.toBlob(function (blob) {
        if (!blob) return downloadCanvas(canvas);
        var file = new File([blob], "forge-card.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: "The Forge", text: "My Forge character." })
            .catch(function () { downloadCanvas(canvas); });
        } else { downloadCanvas(canvas); }
      }, "image/png");
      return;
    }
    // Desktop: straight download.
    downloadCanvas(canvas);
  }

  // ---- season recap card (shareable image of one month) ----
  function goalCur(go, s, prof) {
    if (go.type === "weeks") return s.weeksActive;
    if (go.type === "streak") return prof ? prof.dayStreak : 0;
    if (go.type === "attr") { var a = prof ? prof.attrs.find(function (x) { return x.key === go.attr; }) : null; return a ? a.level : 0; }
    return s.xp;
  }
  function drawSeasonCard(s) {
    if (!s) return null;
    var prof = (window.Game && typeof window.Game.computeProfile === "function") ? window.Game.computeProfile() : null;
    var callsign = (typeof settings !== "undefined" && settings && settings.callsign) ? settings.callsign : "Player One";
    var accent = cssVar("--accent-primary", "#8b5cf6"), accent2 = cssVar("--accent-secondary", "#38bdf8");
    var textc = cssVar("--text", "#f5f5f7"), dim = cssVar("--text-dim", "#9ca3af");
    var topColor = accent2, topName = s.topAttr || "—";
    if (prof && s.topAttr) { var ta = prof.attrs.find(function (a) { return a.key === s.topAttr; }); if (ta) { topColor = ta.color || accent2; topName = ta.label || ta.key; } }

    var W = 1200, H = 630, SC = 2;
    var c = document.createElement("canvas"); c.width = W * SC; c.height = H * SC;
    var ctx = c.getContext("2d"); ctx.scale(SC, SC);
    var g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#0b0b12"); g.addColorStop(1, "#050509"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var rg = ctx.createRadialGradient(W - 180, 120, 40, W - 180, 120, 560); rg.addColorStop(0, hexA(accent, 0.18)); rg.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    var FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.fillStyle = accent; ctx.font = "700 22px " + FONT; ctx.fillText("⚒  THE FORGE — SEASON RECAP", 64, 80);
    ctx.fillStyle = textc; ctx.font = "800 64px " + FONT; ctx.fillText(trim(ctx, s.label, 760), 64, 156);
    ctx.fillStyle = dim; ctx.font = "500 26px " + FONT; ctx.fillText(callsign + (prof ? "   ·   Lv " + prof.level : ""), 64, 198);

    var goals = (typeof settings !== "undefined" && settings && settings.seasonGoals) ? settings.seasonGoals : [];
    var gdone = 0; goals.forEach(function (go) { if (go.target > 0 && goalCur(go, s, prof) >= go.target) gdone++; });

    var tiles = [
      { v: Number(s.xp).toLocaleString(), k: "XP earned", c: accent },
      { v: cap(topName), k: "Top attribute", c: topColor },
      { v: String(s.weeksActive), k: "Active weeks", c: textc },
      { v: s.bestWeek + "%", k: "Best week", c: textc },
      { v: String(s.trophies), k: "Trophies", c: "#fbbf24" },
      { v: String(s.insignias), k: "Insignias", c: accent2 },
    ];
    var gx = 64, gy = 252, gw = W - 128, cols = 3, gap = 20, tw = (gw - gap * (cols - 1)) / cols, th = 128;
    tiles.forEach(function (t, i) {
      var x = gx + (i % cols) * (tw + gap), y = gy + Math.floor(i / cols) * (th + gap);
      roundRect(ctx, x, y, tw, th, 18); ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.fill();
      roundRect(ctx, x, y, tw, th, 18); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.stroke();
      ctx.fillStyle = t.c; ctx.font = "800 46px " + FONT; ctx.fillText(trim(ctx, String(t.v), tw - 44), x + 24, y + 70);
      ctx.fillStyle = dim; ctx.font = "600 20px " + FONT; ctx.fillText(t.k, x + 24, y + 102);
    });
    ctx.fillStyle = dim; ctx.font = "500 18px " + FONT; ctx.textAlign = "left";
    if (goals.length) ctx.fillText("Goals achieved: " + gdone + " / " + goals.length, 64, H - 40);
    ctx.textAlign = "right"; ctx.fillText("github.com/ycianno/the-forge", W - 64, H - 40); ctx.textAlign = "left";
    return c;

    function cap(x) { return String(x).charAt(0).toUpperCase() + String(x).slice(1); }
    function trim(ctx, str, max) { str = String(str); while (ctx.measureText(str).width > max && str.length > 1) str = str.slice(0, -1); return str; }
  }
  function downloadSeason(canvas) {
    var a = document.createElement("a"); a.href = canvas.toDataURL("image/png"); a.download = "forge-season.png";
    document.body.appendChild(a); a.click(); a.remove();
  }
  function shareSeasonCard(s) {
    var canvas = drawSeasonCard(s);
    if (!canvas) { alert("Season data isn't ready yet."); return; }
    if (navigator.canShare && typeof navigator.share === "function") {
      canvas.toBlob(function (blob) {
        if (!blob) return downloadSeason(canvas);
        var file = new File([blob], "forge-season.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: "The Forge", text: "My Forge season recap." }).catch(function () { downloadSeason(canvas); });
        } else { downloadSeason(canvas); }
      }, "image/png");
      return;
    }
    downloadSeason(canvas);
  }
  window.shareSeasonCard = shareSeasonCard;

  // ---- wire up ----
  function wire() {
    var sb = document.getElementById("loadSampleBtn"); if (sb) sb.onclick = loadSampleData;
    var sc = document.getElementById("shareCardBtn"); if (sc) sc.onclick = shareCard;
    showDefaultPasswordBanner();
    setTimeout(maybeShowWelcome, 400); // let app.js render first
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
