#!/usr/bin/env python3
"""
Hermes — Game Master & Discord Agent for The Forge

Reads The Forge's SQLite database, mirrors the app's XP engine to know your
level / rank / attributes / streak / badges, detects milestones since the last
run, and posts a rich, game-aware Discord embed written by a local Ollama model.

Configure paths and your Discord webhook in config.json (see config.example.json).
Run it on a schedule (cron / systemd timer) to get morning quest boards,
midday nudges, evening recaps, and a weekly retrospective on Discord.

Usage:
  python3 hermes.py              # Normal run (cron mode)
  python3 hermes.py --dry-run    # Evaluate + print, no Discord, no state write
  python3 hermes.py --test       # Send a test embed to Discord
  python3 hermes.py --verbose    # Detailed debug output
"""

import argparse
import datetime
import json
import os
import re
import sqlite3
import sys
import unicodedata
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.json")
STATE_PATH = os.path.join(SCRIPT_DIR, "hermes_state.json")

DEFAULT_CONFIG = {
    "database_path": "/path/to/the-forge/data/database.sqlite",
    "ollama_url": "http://localhost:11434",
    "ollama_model": "qwen2.5:3b",
    "discord_webhook_url": "",
    "persona": "game_master",          # game_master | ruthless_sergeant | hype_coach
    "quiet_hours_start": 22,
    "quiet_hours_end": 8,
    "silent_if_complete": True,
    # --- Ollama performance / RAM tuning ---
    "ollama_keep_alive": 0,            # seconds to keep model in RAM after a call (0 = unload now)
    "ollama_num_ctx": 1024,            # small context = less KV-cache RAM
    "ollama_num_predict": 400,         # response budget (no reasoning model needed)
    "ollama_temperature": 0.8,
}

DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

DEFAULT_DAILY_BLUEPRINT = {
    "Sunday": ["Wake up by 6:00 AM", "Morning cardio or movement", "Shower", "Brush teeth", "Work prep / plan the day", "Work / main responsibility", "Weights or active recovery", "2 hours certification study", "Read", "Sleep by 12:00 AM"],
    "Monday": ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    "Tuesday": ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    "Wednesday": ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    "Thursday": ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    "Friday": ["Wake up by 6:00 AM", "Workout", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Project work or planning", "Read", "Sleep by 12:00 AM"],
    "Saturday": ["Wake up by 6:00 AM", "Workout or recovery", "Shower", "Brush teeth", "Cook / clean / organize", "2 hours certification study", "Read", "Sleep by 12:00 AM"],
}

DEFAULT_DIET_ITEMS = [
    "Protein backup ready for the week", "Weekend protein option planned",
    "Protein groceries available", "Hydration handled most days",
    "No full junk mode", "At least one protein meal prepped",
]
DEFAULT_PROJECT_CHECKS = [
    "Code, workflow, documentation, or plan created",
    "Progress documented", "Next action is clear",
]

# XP economy — mirrors public/game.js
XP_BY_CAT = {"discipline": 10, "training": 30, "study": 25, "protein": 12, "project": 30, "other": 8}
STUDY_HOUR_XP = 8
PROJECT_HOUR_XP = 12
ATTR_OF_CAT = {"discipline": "Discipline", "training": "Body", "study": "Mind", "protein": "Vitality", "project": "Craft"}
ATTR_ORDER = ["Discipline", "Body", "Mind", "Vitality", "Craft"]
RANKS = [(1, "Bronze"), (8, "Silver"), (16, "Gold"), (26, "Platinum"), (40, "Diamond"), (60, "Master")]

BADGE_NAMES = {
    "first-steps": "First Steps", "disciplined": "Disciplined", "bookworm": "Bookworm",
    "flawless-week": "Flawless Week", "on-fire": "On Fire", "iron-body": "Iron Body",
    "scholar": "Scholar", "centurion": "Centurion", "polymath": "Polymath",
    "maker": "Maker", "relentless": "Relentless", "ascendant": "Ascendant",
}


def load_config():
    config = DEFAULT_CONFIG.copy()
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            config.update(json.load(f))
    return config


# ---------------------------------------------------------------------------
# Slug / id helpers (mirror public/game.js + app.js)
# ---------------------------------------------------------------------------

def _slug(text: str, limit: int) -> str:
    s = unicodedata.normalize("NFD", str(text).lower().strip())
    s = re.sub(r"[̀-ͯ]", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:limit]
    return s or "item"


def task_id(day_index: int, task_text: str) -> str:
    return f"day-{day_index}-{_slug(task_text, 58)}"


def diet_id(text: str) -> str:
    return f"diet-{_slug(text, 48)}"


def proj_id(text: str) -> str:
    return f"project-{_slug(text, 48)}"


def category_for(text: str) -> str:
    t = str(text).lower()
    if any(k in t for k in ("workout", "cardio", "weights", "movement", "recovery")):
        return "training"
    if "study" in t or "certification" in t:
        return "study"
    if "protein" in t or "cook" in t:
        return "protein"
    if "project" in t:
        return "project"
    return "discipline"


def get_week_start(date):
    return date - datetime.timedelta(days=(date.weekday() + 1) % 7)


def get_day_index(date):
    return (date.weekday() + 1) % 7


def iso(date):
    return date.strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Level curve / ranks (mirror game.js)
# ---------------------------------------------------------------------------

def xp_for_level(level: int, base: int) -> int:
    return round(base * (1.18 ** (level - 1)))


def level_from_xp(total_xp: float, base: int) -> dict:
    level, acc = 1, 0
    while level < 999:
        need = xp_for_level(level, base)
        if acc + need > total_xp:
            break
        acc += need
        level += 1
    return {"level": level, "into": max(0, int(total_xp - acc)), "next": xp_for_level(level, base)}


def rank_for(level: int) -> dict:
    name, idx = RANKS[0][1], 0
    for i, (mn, nm) in enumerate(RANKS):
        if level >= mn:
            name, idx = nm, i
    nxt = RANKS[idx + 1][0] if idx + 1 < len(RANKS) else None
    span = (nxt - RANKS[idx][0]) if nxt else 24
    tier_num = min(3, 1 + int(((level - RANKS[idx][0]) / span) * 3)) if span else 1
    return {"name": name, "tier": ["I", "II", "III"][tier_num - 1]}


# ---------------------------------------------------------------------------
# Database access
# ---------------------------------------------------------------------------

def load_db(config: dict):
    db_path = config["database_path"]
    if not os.path.exists(db_path):
        print(f"[ERROR] Database not found: {db_path}", file=sys.stderr)
        sys.exit(1)
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT week_key, data FROM weeks")
    weeks = {k: json.loads(d) for k, d in cur.fetchall()}
    cur.execute("SELECT value FROM settings WHERE key = 'app_settings'")
    row = cur.fetchone()
    settings = json.loads(row[0]) if row else {}
    conn.close()
    return weeks, settings


def get_blueprint(settings):
    return settings.get("dayTemplates") or DEFAULT_DAILY_BLUEPRINT


# ---------------------------------------------------------------------------
# XP engine (mirror game.js addWeekXp / computeProfile / calculateWeekScoreData)
# ---------------------------------------------------------------------------

def add_week_xp(week, settings, attr_totals):
    if not week:
        return 0
    checks = week.get("checks", {})
    fields = week.get("fields", {})
    blueprint = get_blueprint(settings)
    xp = 0

    def award(cat, amount):
        nonlocal xp
        xp += amount
        attr = ATTR_OF_CAT.get(cat)
        if attr is not None:
            attr_totals[attr] = attr_totals.get(attr, 0) + amount

    for i, day in enumerate(DAY_NAMES):
        for t in blueprint.get(day, []):
            if checks.get(task_id(i, t)):
                cat = category_for(t)
                award(cat, XP_BY_CAT.get(cat, XP_BY_CAT["other"]))
    for i in range(7):
        if checks.get(f"workout-{i}"):
            award("training", XP_BY_CAT["training"])
    for item in settings.get("dietItems") or DEFAULT_DIET_ITEMS:
        if checks.get(diet_id(item)):
            award("protein", XP_BY_CAT["protein"])
    for item in settings.get("projectChecks") or DEFAULT_PROJECT_CHECKS:
        if checks.get(proj_id(item)):
            award("project", XP_BY_CAT["project"])

    study_hours = sum(float(v or 0) for k, v in fields.items() if str(k).startswith("hours-study-"))
    if study_hours > 0:
        award("study", round(study_hours * STUDY_HOUR_XP))
    proj_hours = float(fields.get("projectHours") or 0)
    if proj_hours > 0:
        award("project", round(proj_hours * PROJECT_HOUR_XP))
    return xp


def calculate_week_score(week, settings) -> int:
    if not week or not week.get("checks"):
        return 0
    blueprint = get_blueprint(settings)
    valid = set()
    for i, day in enumerate(DAY_NAMES):
        valid.add(f"workout-{i}")
        for t in blueprint.get(day, []):
            valid.add(task_id(i, t))
    checks = week["checks"]
    done = sum(1 for k in valid if checks.get(k))
    return round(done / len(valid) * 100) if valid else 0


def compute_streak(weeks, settings) -> int:
    grade = settings.get("streakGrade") or 75
    today = datetime.date.today()
    wk = get_week_start(today)
    streak = 0
    cur = weeks.get(iso(wk))
    if cur and calculate_week_score(cur, settings) >= grade:
        streak += 1
    wk -= datetime.timedelta(days=7)
    while True:
        data = weeks.get(iso(wk))
        if data and calculate_week_score(data, settings) >= grade:
            streak += 1
            wk -= datetime.timedelta(days=7)
        else:
            break
    return streak


BOSSES = [
    ("Inertia", "🪨", "training", "You won't even start."),
    ("The Procrastinator", "🦥", "discipline", "Tomorrow, right?"),
    ("Brain Fog", "🌫️", "study", "Why study? You'll just forget it."),
    ("The Glutton", "🍔", "protein", "One more cheat day won't hurt…"),
    ("The Drifter", "🌀", "project", "Busywork feels like progress."),
    ("Lord Snooze", "😴", "discipline", "Five more minutes. Every morning."),
    ("Doomscroll Hydra", "🐍", "study", "Just one more scroll…"),
    ("The Couch Wraith", "👻", "training", "Skip the workout. Stay cozy."),
]
BOSS_ATTR = {"discipline": "Discipline", "training": "Body", "study": "Mind", "protein": "Vitality", "project": "Craft"}


def compute_boss(weeks, settings):
    """Mirror of public/app.js Weekly Boss — same roster, hash, and 2x-weakness."""
    wk_key = iso(get_week_start(datetime.date.today()))
    h = 0
    for ch in wk_key:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    name, emoji, weak, taunt = BOSSES[h % len(BOSSES)]
    checks = (weeks.get(wk_key, {}) or {}).get("checks", {})
    blueprint = get_blueprint(settings)
    tot = done = 0
    for i, day in enumerate(DAY_NAMES):
        for t in blueprint.get(day, []):
            w = 2 if category_for(t) == weak else 1
            tot += w
            if checks.get(task_id(i, t)):
                done += w
        ww = 2 if weak == "training" else 1
        tot += ww
        if checks.get(f"workout-{i}"):
            done += ww
    dmg = round(done / tot * 100) if tot else 0
    grade = settings.get("streakGrade") or 75
    return {"name": name, "emoji": emoji, "weak": BOSS_ATTR.get(weak, weak),
            "taunt": taunt, "dmg": dmg, "grade": grade, "defeated": dmg >= grade}


def compute_profile(weeks, settings) -> dict:
    base = settings.get("gameBase") or 100
    attr_totals = {a: 0 for a in ATTR_ORDER}
    lifetime = 0
    study_total = 0.0
    best_week = 0
    for wk in weeks.values():
        lifetime += add_week_xp(wk, settings, attr_totals)
        if wk and wk.get("fields"):
            study_total += sum(float(v or 0) for k, v in wk["fields"].items() if str(k).startswith("hours-study-"))
        best_week = max(best_week, calculate_week_score(wk, settings))
    lv = level_from_xp(lifetime, base)
    attrs = {a: level_from_xp(attr_totals[a], base)["level"] for a in ATTR_ORDER}
    return {
        "lifetime": lifetime, "level": lv["level"], "into": lv["into"], "next": lv["next"],
        "rank": rank_for(lv["level"]), "attrs": attrs,
        "streak": compute_streak(weeks, settings),
        "best_week": best_week, "study_hours": round(study_total),
        "callsign": settings.get("callsign") or "Operator",
        "badges": list((settings.get("badges") or {}).keys()),
    }


# ---------------------------------------------------------------------------
# Today's quest evaluation
# ---------------------------------------------------------------------------

def evaluate_today(weeks, settings) -> dict:
    today = datetime.date.today()
    di = get_day_index(today)
    day = DAY_NAMES[di]
    tasks = get_blueprint(settings).get(day, [])
    week = weeks.get(iso(get_week_start(today)), {})
    checks = week.get("checks", {})
    completed, incomplete = [], []
    for t in tasks:
        (completed if checks.get(task_id(di, t)) else incomplete).append(t)
    total = len(tasks)
    done = len(completed)
    return {
        "day_name": day, "total": total, "done": done,
        "pct": round(done / total * 100) if total else 0,
        "completed": completed, "incomplete": incomplete,
    }


# ---------------------------------------------------------------------------
# State (milestone detection across runs)
# ---------------------------------------------------------------------------

def load_state():
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_state(state):
    try:
        with open(STATE_PATH, "w") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"[Hermes] Could not write state: {e}", file=sys.stderr)


def detect_milestones(profile, state):
    first = not state
    leveled_up = (not first) and profile["level"] > state.get("level", profile["level"])
    new_badges = [b for b in profile["badges"] if b not in state.get("badges", profile["badges"] if first else [])]
    if first:
        new_badges = []  # silent backfill
    streak_milestone = None
    if (not first) and profile["streak"] > state.get("streak", 0) and profile["streak"] in (2, 4, 8, 12, 26, 52):
        streak_milestone = profile["streak"]
    return {"leveled_up": leveled_up, "new_badges": new_badges, "streak_milestone": streak_milestone}


# ---------------------------------------------------------------------------
# Run mode (morning quest board / evening recap / midday nudge)
# ---------------------------------------------------------------------------

def run_mode(hour, state):
    today = datetime.date.today().isoformat()
    if hour < 10 and state.get("morning_date") != today:
        return "morning"
    if hour >= 20 and state.get("evening_date") != today:
        return "evening"
    return "midday"


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

PERSONAS = {
    "game_master": """\
You are the Game Master narrating the operator's real life as an epic solo RPG. \
You are dramatic, vivid and motivating, but you genuinely want the hero to win. \
Rules:
- Under 170 words. Plain text only, no markdown, at most one emoji.
- Address the hero by callsign. Frame tasks as quests and progress as XP/levels.
- If there is a milestone (level up, new badge, streak), open by celebrating it.
- If completion is high (>75%), hype the final push to 100%. If low (<50%), \
rally them urgently without shaming.
- End with one clear next quest objective.
- Only reference numbers, tasks and stats that appear in the briefing below. Never invent quantities.""",
    "ruthless_sergeant": """\
You are a ruthless military sergeant keeping a recruit accountable for his daily \
discipline checklist. You do NOT accept excuses; firm, direct, relentless — but \
you care about his success.
Rules:
- Under 170 words. Plain text only, no markdown, no emojis.
- Address him as "soldier" or "recruit". Reference specific incomplete tasks.
- High completion (>75%): acknowledge, push to 100%. Low (<50%): harsh + motivational.
- End with one clear, actionable order.""",
    "hype_coach": """\
You are a high-energy hype coach who believes in the operator completely. \
Warm, electric, relentlessly positive, but specific and honest.
Rules:
- Under 170 words. Plain text only, no markdown, at most one emoji.
- Use the callsign. Celebrate any milestone first. Name specific remaining tasks.
- End with one punchy call to action.""",
}


def build_prompt(config, profile, status, milestones, mode, hour, boss):
    persona = config.get("persona", "game_master")
    system = PERSONAS.get(persona, PERSONAS["game_master"])

    mile = []
    if milestones["leveled_up"]:
        mile.append(f"LEVELED UP to Level {profile['level']} ({profile['rank']['name']} {profile['rank']['tier']}).")
    for b in milestones["new_badges"]:
        mile.append(f"Unlocked badge: {BADGE_NAMES.get(b, b)}.")
    if milestones["streak_milestone"]:
        mile.append(f"Hit a {milestones['streak_milestone']}-week streak.")

    mode_ctx = {
        "morning": "It is morning. Present today's QUEST BOARD and set the tone for the day.",
        "evening": "It is evening. Give a RECAP of today and a directive for tomorrow.",
        "midday": "Mid-day check-in. Push execution on what's left.",
    }[mode]

    completed = "\n".join(f"- {t}" for t in status["completed"]) or "None yet."
    incomplete = "\n".join(f"- {t}" for t in status["incomplete"]) or "None — all clear."
    attrs = ", ".join(f"{a} Lv{profile['attrs'][a]}" for a in ATTR_ORDER)

    user = f"""\
OPERATOR: {profile['callsign']}
LEVEL: {profile['level']} ({profile['rank']['name']} {profile['rank']['tier']}) — {profile['into']}/{profile['next']} XP to next
STREAK: {profile['streak']} weeks | ATTRIBUTES: {attrs}
DAY: {status['day_name']} | TODAY: {status['done']}/{status['total']} quests ({status['pct']}%)
CONTEXT: {mode_ctx}
WEEKLY BOSS: {boss['name']} — {'DEFEATED' if boss['defeated'] else str(boss['dmg']) + '% damage dealt, still alive'}; weak to {boss['weak']}. Taunt: "{boss['taunt']}"
MILESTONES: {' '.join(mile) if mile else 'none'}

COMPLETED TODAY:
{completed}

OUTSTANDING QUESTS:
{incomplete}

Write the message now."""
    return system, user


# ---------------------------------------------------------------------------
# Ollama
# ---------------------------------------------------------------------------

def call_ollama(config, system_prompt, user_prompt, verbose=False):
    url = f"{config['ollama_url']}/api/chat"
    payload = {
        "model": config["ollama_model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
        "keep_alive": config.get("ollama_keep_alive", 0),
        "options": {
            "temperature": config.get("ollama_temperature", 0.8),
            "num_predict": config.get("ollama_num_predict", 400),
            "num_ctx": config.get("ollama_num_ctx", 1024),
        },
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            raw = result.get("message", {}).get("content", "")
            cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
            if verbose:
                print(f"[Ollama] model={config['ollama_model']} keep_alive={payload['keep_alive']} "
                      f"raw={len(raw)} cleaned={len(cleaned)} chars")
            return cleaned or None
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        if verbose:
            print(f"[Ollama] Connection failed: {e}")
        return None


def fallback_message(profile, status, milestones, mode):
    pct = status["pct"]
    head = []
    if milestones["leveled_up"]:
        head.append(f"LEVEL UP — you're now Level {profile['level']} ({profile['rank']['name']}).")
    for b in milestones["new_badges"]:
        head.append(f"Badge unlocked: {BADGE_NAMES.get(b, b)}.")
    if mode == "morning":
        body = "A new day, a fresh quest board. Clear the board."
    elif mode == "evening":
        body = "Day's almost logged. Close out what you can."
    elif pct >= 75:
        body = "You've got momentum — finish the last quests and hit 100%."
    elif pct >= 50:
        body = "Halfway. Keep pushing the outstanding quests."
    else:
        body = "The board is wide open. Pick one quest and move."
    out = "\n".join(head)
    if out:
        out += "\n\n"
    out += body
    if status["incomplete"]:
        out += "\n\nOutstanding:\n" + "\n".join(f"  • {t}" for t in status["incomplete"][:8])
    out += "\n\n(Ollama offline — fallback)"
    return out


# ---------------------------------------------------------------------------
# Discord
# ---------------------------------------------------------------------------

def xp_bar(into, nxt, segments=10):
    filled = int(round((into / nxt) * segments)) if nxt else 0
    filled = max(0, min(segments, filled))
    return "▰" * filled + "▱" * (segments - filled)


def post_discord(config, profile, status, message, mode, milestones, boss, is_test=False):
    pct = status["pct"]
    color = 0x22C55E if pct >= 75 else 0xF59E0B if pct >= 50 else 0xEF4444
    r = profile["rank"]
    titles = {
        "morning": f"🗺️ Quest Board — {profile['callsign']}",
        "evening": f"🌙 Evening Recap — {profile['callsign']}",
        "midday": f"🎮 {profile['callsign']} — Lv {profile['level']} {r['name']}",
    }
    title = "🧪 Hermes — Test" if is_test else titles[mode]

    fields = [
        {"name": "⚔️ Level", "value": f"**Lv {profile['level']}** · {r['name']} {r['tier']}\n`{xp_bar(profile['into'], profile['next'])}` {profile['into']}/{profile['next']} XP", "inline": True},
        {"name": "🔥 Streak", "value": f"**{profile['streak']}** weeks", "inline": True},
        {"name": "📊 Today", "value": f"**{status['done']}/{status['total']}** ({pct}%)", "inline": True},
    ]
    mile = []
    if milestones["leveled_up"]:
        mile.append(f"⬆️ Reached **Level {profile['level']}**")
    for b in milestones["new_badges"]:
        mile.append(f"🏅 Badge: **{BADGE_NAMES.get(b, b)}**")
    if milestones["streak_milestone"]:
        mile.append(f"🔥 **{milestones['streak_milestone']}-week** streak")
    if mile:
        fields.append({"name": "🎉 Milestones", "value": "\n".join(mile), "inline": False})

    boss_val = (f"**{boss['emoji']} {boss['name']}** — DEFEATED ✓" if boss["defeated"]
                else f"**{boss['emoji']} {boss['name']}** — {boss['dmg']}% dealt · weak to {boss['weak']}")
    fields.append({"name": "⚔️ Weekly Boss", "value": boss_val, "inline": False})

    if status["incomplete"]:
        quests = "\n".join(f"▫️ {t}" for t in status["incomplete"][:10])
        fields.append({"name": f"🗒️ Outstanding ({len(status['incomplete'])})", "value": quests, "inline": False})
    if status["completed"]:
        doned = "\n".join(f"✅ {t}" for t in status["completed"][:10])
        fields.append({"name": f"✅ Cleared ({len(status['completed'])})", "value": doned, "inline": False})

    now = datetime.datetime.now()
    embed = {
        "title": title,
        "description": message[:2000],
        "color": color,
        "fields": fields,
        "footer": {"text": f"Hermes · {profile['callsign']} · {now.strftime('%I:%M %p')}"},
    }
    payload = {"embeds": [embed]}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        config["discord_webhook_url"], data=data,
        headers={"Content-Type": "application/json", "User-Agent": "Hermes/2.0"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        if resp.status not in (200, 204):
            raise Exception(f"Discord returned status {resp.status}")


# ---------------------------------------------------------------------------
# Weekly retrospective (--retro)
# ---------------------------------------------------------------------------

RETRO_SYSTEM = """\
You are the operator's Game Master, writing a short weekly RETROSPECTIVE of the \
week that just ended. Insightful, specific and motivating — never generic.
Rules:
- Under 190 words. Plain text only, no markdown, at most one emoji.
- Open with a one-line verdict on the week (use the score/grade).
- Call out 1-2 concrete wins and 1-2 friction patterns, using the data AND the \
operator's own notes.
- Close with ONE clear focus for the week ahead.
- Only use facts from the briefing; never invent numbers."""


def get_retro_week(weeks, settings):
    ref = datetime.date.today() - datetime.timedelta(days=1)   # yesterday → last week on Sunday
    start = get_week_start(ref)
    wk = weeks.get(iso(start), {"fields": {}, "checks": {}})
    attr = {a: 0 for a in ATTR_ORDER}
    xp = add_week_xp(wk, settings, attr)
    blueprint = get_blueprint(settings)
    days = []
    for i, name in enumerate(DAY_NAMES):
        tasks = blueprint.get(name, [])
        if not tasks:
            days.append((name, None))
        else:
            done = sum(1 for t in tasks if wk.get("checks", {}).get(task_id(i, t)))
            days.append((name, round(done / len(tasks) * 100)))
    f = wk.get("fields", {})
    return {
        "start": start, "score": calculate_week_score(wk, settings), "xp": xp, "attr": attr,
        "days": days, "wins": f.get("wins", ""), "misses": f.get("misses", ""),
        "changes": f.get("changes", ""), "grade": f.get("grade", ""),
    }


def build_retro_prompt(profile, retro):
    top = [k for k, v in sorted(retro["attr"].items(), key=lambda kv: kv[1], reverse=True) if v > 0][:2]
    daily = " · ".join(f"{n[:3]} {p}%" for n, p in retro["days"] if p is not None)
    rng = f"{retro['start']:%b %d}–{retro['start'] + datetime.timedelta(days=6):%b %d}"
    user = f"""\
WEEKLY RETRO — week of {rng}
Operator: {profile['callsign']} · Level {profile['level']} ({profile['rank']['name']} {profile['rank']['tier']})
Weekly completion: {retro['score']}%  ·  Self-grade: {retro['grade'] or 'not graded'}
XP earned this week: {retro['xp']}
Strongest areas: {', '.join(top) if top else 'none logged'}
Day-by-day: {daily or 'no data'}
Operator's own notes —
  Wins: {retro['wins'] or 'none'}
  Friction: {retro['misses'] or 'none'}
  Planned changes: {retro['changes'] or 'none'}

Write the retrospective now."""
    return RETRO_SYSTEM, user


def retro_fallback(retro):
    s = retro["score"]
    verdict = ("A strong week — keep the pressure on." if s >= 85 else
               "Solid week. Tighten the gaps." if s >= 60 else
               "Tough week. Protect the basics first and reset.")
    return f"{verdict}\n\nWeekly completion: {s}%. XP earned: {retro['xp']}.\n\n(Ollama offline — fallback)"


def post_retro_discord(config, profile, retro, message):
    s = retro["score"]
    color = 0x22C55E if s >= 75 else 0xF59E0B if s >= 50 else 0xEF4444
    rng = f"{retro['start']:%b %d}–{retro['start'] + datetime.timedelta(days=6):%b %d}"
    fields = [
        {"name": "📊 Completion", "value": f"**{s}%**", "inline": True},
        {"name": "✨ XP earned", "value": f"**{retro['xp']}**", "inline": True},
        {"name": "🎓 Grade", "value": retro["grade"] or "—", "inline": True},
    ]
    dd = " · ".join(f"{n[:1]} {p}%" for n, p in retro["days"] if p is not None)
    if dd:
        fields.append({"name": "🗓️ Day-by-day", "value": dd, "inline": False})
    embed = {
        "title": f"📜 Week in Review — {rng}",
        "description": message[:2000],
        "color": color, "fields": fields,
        "footer": {"text": f"Hermes · {profile['callsign']} · weekly retro"},
    }
    data = json.dumps({"embeds": [embed]}).encode("utf-8")
    req = urllib.request.Request(config["discord_webhook_url"], data=data,
        headers={"Content-Type": "application/json", "User-Agent": "Hermes/2.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        if resp.status not in (200, 204):
            raise Exception(f"Discord returned status {resp.status}")


def run_retro(config, weeks, settings, profile, dry_run, verbose):
    retro = get_retro_week(weeks, settings)
    system, user = build_retro_prompt(profile, retro)
    if verbose:
        print(f"\n[Retro Prompt]\n{user}\n")
    msg = call_ollama(config, system, user, verbose=verbose) or retro_fallback(retro)
    if dry_run:
        print(f"\n{'=' * 60}\nWEEKLY RETRO (week of {retro['start']:%b %d}) — {retro['score']}% · {retro['xp']} XP\n{'=' * 60}\n{msg}\n")
        return
    post_retro_discord(config, profile, retro, msg)
    print(f"[Hermes] weekly retro sent (week of {retro['start']:%Y-%m-%d}, {retro['score']}%)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Hermes — The Forge Game Master & Discord Agent")
    parser.add_argument("--dry-run", action="store_true", help="Print, don't send Discord or write state")
    parser.add_argument("--test", action="store_true", help="Send a test embed to Discord")
    parser.add_argument("--retro", action="store_true", help="Post the weekly retrospective for the week just ended")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    config = load_config()
    if not config.get("discord_webhook_url") and not args.dry_run:
        print("[ERROR] discord_webhook_url not set in config.json", file=sys.stderr)
        sys.exit(1)

    now = datetime.datetime.now()
    hour = now.hour

    weeks, settings = load_db(config)
    profile = compute_profile(weeks, settings)

    if args.retro:
        run_retro(config, weeks, settings, profile, args.dry_run, args.verbose)
        sys.exit(0)

    status = evaluate_today(weeks, settings)
    boss = compute_boss(weeks, settings)
    state = load_state()
    milestones = detect_milestones(profile, state)
    mode = run_mode(hour, state)

    has_milestone = milestones["leveled_up"] or milestones["new_badges"] or milestones["streak_milestone"]

    if args.verbose:
        print(f"[Hermes] {profile['callsign']} Lv{profile['level']} {profile['rank']['name']} "
              f"{profile['rank']['tier']} | streak {profile['streak']} | today {status['done']}/{status['total']}")
        print(f"[Hermes] mode={mode} milestones={milestones} badges={len(profile['badges'])}")

    # Quiet hours (still allow milestone celebrations through)
    if not args.dry_run and not args.test and not has_milestone:
        if hour >= config.get("quiet_hours_start", 22) or hour < config.get("quiet_hours_end", 8):
            if args.verbose:
                print("[Hermes] Quiet hours. Skipping.")
            sys.exit(0)

    # Silent if everything done (midday only; always send morning/evening/milestones)
    if (config.get("silent_if_complete", True) and mode == "midday" and not has_milestone
            and status["total"] > 0 and status["done"] == status["total"]):
        if args.verbose or args.dry_run:
            print("[Hermes] All quests cleared, midday, no milestone — silent.")
        if not args.dry_run:
            sys.exit(0)

    if status["total"] == 0 and mode == "midday" and not has_milestone:
        if args.verbose or args.dry_run:
            print("[Hermes] No quests today. Skipping.")
        if not args.dry_run:
            sys.exit(0)

    system_prompt, user_prompt = build_prompt(config, profile, status, milestones, mode, hour, boss)
    if args.verbose:
        print(f"\n[Prompt]\n{user_prompt}\n")

    message = call_ollama(config, system_prompt, user_prompt, verbose=args.verbose)
    if message is None:
        message = fallback_message(profile, status, milestones, mode)

    if args.dry_run:
        print(f"\n{'=' * 60}\nHERMES DRY RUN — {mode.upper()} — {now.strftime('%a %I:%M %p')}\n{'=' * 60}")
        print(f"{profile['callsign']} · Lv {profile['level']} {profile['rank']['name']} {profile['rank']['tier']} · "
              f"streak {profile['streak']} · today {status['done']}/{status['total']} ({status['pct']}%)")
        print(f"\n--- Message ---\n{message}\n")
        sys.exit(0)

    try:
        post_discord(config, profile, status, message, mode, milestones, boss, is_test=args.test)
        print(f"[Hermes] {now.strftime('%Y-%m-%d %H:%M')} — sent ({mode}, {status['pct']}% complete)")
    except Exception as e:
        print(f"[Hermes] ERROR sending Discord: {e}", file=sys.stderr)
        sys.exit(1)

    # Persist state
    if not args.test:
        state["level"] = profile["level"]
        state["streak"] = profile["streak"]
        state["badges"] = profile["badges"]
        if mode == "morning":
            state["morning_date"] = datetime.date.today().isoformat()
        if mode == "evening":
            state["evening_date"] = datetime.date.today().isoformat()
        save_state(state)


if __name__ == "__main__":
    main()
