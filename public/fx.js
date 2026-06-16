/* ===========================================================================
 * fx.js — Dopamine FX layer for Life Control Center
 * ---------------------------------------------------------------------------
 * Game feel: synth sounds (Web Audio, no files), "+XP" particle pops, a combo
 * meter, mobile haptics, and a full-screen level-up celebration.
 *
 * Loaded after game.js, before app.js, so window.FX exists when Game.render()
 * (called from app.js init) first detects a level-up. Listens to its own
 * change events — no edits to app.js needed for the juice.
 * ======================================================================== */
(function () {
  "use strict";

  // ----- Sound preference --------------------------------------------------
  function sfxOn() { return localStorage.getItem("lcc.sfx") !== "off"; }
  function setSfx(on) {
    localStorage.setItem("lcc.sfx", on ? "on" : "off");
    syncToggle();
  }

  // ----- Web Audio synth ---------------------------------------------------
  let actx = null;
  function ac() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    if (actx && actx.state === "suspended") actx.resume();
    return actx;
  }
  function blip(freq, dur, type, vol) {
    const c = ac();
    if (!c || !sfxOn()) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || "triangle";
    o.frequency.value = freq;
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol || 0.16, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.15));
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + (dur || 0.15) + 0.03);
  }
  function arp(freqs, stagger, type, vol) {
    freqs.forEach((f, i) => setTimeout(() => blip(f, 0.42, type || "sine", vol || 0.15), i * (stagger || 70)));
  }

  const NOTES = { tickBase: 523.25 }; // C5
  function playCheck(combo) {
    const f = NOTES.tickBase * Math.pow(2, Math.min(combo - 1, 11) / 12); // climb a semitone per combo
    blip(f, 0.13, "triangle", 0.16);
  }
  function playUncheck() { blip(196, 0.12, "sine", 0.10); }
  function playLevelUp() { arp([523.25, 659.25, 783.99, 1046.5], 80, "sine", 0.17); }

  // ----- Haptics -----------------------------------------------------------
  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

  // ----- Combo meter -------------------------------------------------------
  let combo = 0, comboTimer = null, comboEl = null;
  function ensureComboEl() {
    if (!comboEl) {
      comboEl = document.createElement("div");
      comboEl.className = "fx-combo";
      comboEl.innerHTML = `<span class="fx-combo-x">COMBO</span><span class="fx-combo-n">x2</span>`;
      document.body.appendChild(comboEl);
    }
    return comboEl;
  }
  function bumpCombo() {
    combo++;
    clearTimeout(comboTimer);
    comboTimer = setTimeout(resetCombo, 4200);
    if (combo >= 2) {
      const el = ensureComboEl();
      el.querySelector(".fx-combo-n").textContent = "x" + combo;
      el.classList.toggle("hot", combo >= 5);
      el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    }
    return combo;
  }
  function resetCombo() {
    combo = 0;
    if (comboEl) comboEl.classList.remove("show", "hot");
  }

  // ----- "+XP" particle pop ------------------------------------------------
  function xpPop(x, y, amount, color, combo) {
    const el = document.createElement("div");
    el.className = "fx-xp-pop";
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.color = color;
    el.textContent = "+" + amount + " XP";
    document.body.appendChild(el);
    // tiny burst
    const ring = document.createElement("div");
    ring.className = "fx-burst";
    ring.style.left = x + "px";
    ring.style.top = y + "px";
    ring.style.borderColor = color;
    if (combo >= 5) ring.classList.add("big");
    document.body.appendChild(ring);
    setTimeout(() => { el.remove(); ring.remove(); }, 1100);
  }

  // ----- Level-up celebration ---------------------------------------------
  const CONFETTI = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185"];
  function levelUp(level, rank) {
    playLevelUp();
    vibrate([0, 40, 60, 40, 80]);
    const ov = document.createElement("div");
    ov.className = "fx-overlay";
    const rankLine = rank ? `${rank.name} · Tier ${rank.tier}` : "";
    ov.innerHTML = `
      <div class="fx-confetti"></div>
      <div class="fx-card">
        <span class="fx-card-k">LEVEL UP</span>
        <span class="fx-card-lv">Level ${level}</span>
        <span class="fx-card-rank">${rankLine}</span>
      </div>`;
    document.body.appendChild(ov);
    const field = ov.querySelector(".fx-confetti");
    for (let i = 0; i < 32; i++) {
      const p = document.createElement("span");
      p.className = "confetti-piece";
      p.style.left = Math.random() * 100 + "%";
      p.style.background = CONFETTI[i % CONFETTI.length];
      p.style.animationDelay = (Math.random() * 0.25).toFixed(2) + "s";
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      field.appendChild(p);
    }
    requestAnimationFrame(() => ov.classList.add("show"));
    setTimeout(() => ov.classList.remove("show"), 2100);
    setTimeout(() => ov.remove(), 2600);
  }

  // ----- Check handling ----------------------------------------------------
  function onCheckboxChange(e) {
    const t = e.target;
    if (!t || t.type !== "checkbox" || !t.dataset || t.dataset.cat == null) return;
    if (t.checked) {
      const c = bumpCombo();
      playCheck(c);
      vibrate(12);
      const r = t.getBoundingClientRect();
      const amount = (window.Game && Game.checkXp) ? Game.checkXp(t) : 10;
      const color = (window.Game && Game.attrColorForCat) ? Game.attrColorForCat(t.dataset.cat) : "#38bdf8";
      xpPop(r.left + 14, r.top + r.height / 2, amount, color, c);
    } else {
      resetCombo();
      playUncheck();
    }
  }

  // ----- Sound toggle button -----------------------------------------------
  function syncToggle() {
    const btn = document.getElementById("soundToggle");
    if (!btn) return;
    const on = sfxOn();
    btn.innerHTML = (window.ICONS && ICONS[on ? "soundOn" : "soundOff"]) || (on ? "🔊" : "🔇");
    btn.setAttribute("aria-label", on ? "Mute sounds" : "Enable sounds");
    btn.title = on ? "Sound on" : "Sound off";
  }
  function wireToggle() {
    const btn = document.getElementById("soundToggle");
    if (!btn) return;
    btn.onclick = () => {
      setSfx(!sfxOn());
      if (sfxOn()) playCheck(1); // confirmation chirp
    };
    syncToggle();
  }

  // ----- Init --------------------------------------------------------------
  document.addEventListener("change", onCheckboxChange, true);
  // Resume audio on first user gesture (browsers gate autoplay)
  ["pointerdown", "keydown"].forEach(ev =>
    document.addEventListener(ev, () => ac(), { once: true }));
  if (document.readyState !== "loading") wireToggle();
  else document.addEventListener("DOMContentLoaded", wireToggle);

  window.FX = { levelUp, xpPop, playCheck, setSfx, sfxOn };
})();
