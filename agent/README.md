# Hermes — the optional Discord Game Master

Hermes is an **optional companion** for The Forge. It reads your Forge database, mirrors the app's XP engine (so it knows your level, rank, attributes, streak, badges, and the current weekly boss), and posts a game-aware message to a Discord channel — written by a **local** LLM via [Ollama](https://ollama.com). Nothing leaves your machine except the Discord post.

It can send:
- 🗺️ a **morning quest board**,
- 🎮 **midday nudges** when quests are still open,
- 🌙 an **evening recap**,
- 📜 a **weekly retrospective** (`--retro`),
- and it celebrates **level-ups, new badges, and streak milestones** the moment they happen.

There are three personas: `game_master` (epic RPG narrator), `ruthless_sergeant`, and `hype_coach`.

## Requirements

- **Python 3.8+** — no third-party packages (standard library only).
- **[Ollama](https://ollama.com)** running somewhere reachable, with a small model pulled:
  ```bash
  ollama pull qwen2.5:3b
  ```
  `qwen2.5:3b` is a good low-RAM default; any chat model works.
- A **Discord webhook URL** for the channel you want messages in (Channel → Edit → Integrations → Webhooks → New Webhook → Copy URL).
- Read access to your Forge **SQLite database** file (the `data/database.sqlite` the app writes).

## Setup

```bash
cd agent
cp config.example.json config.json
```

Edit `config.json`:

| Key | What to set |
|---|---|
| `database_path` | Absolute path to your Forge `database.sqlite`. |
| `ollama_url` | Where Ollama is listening (e.g. `http://localhost:11434`). |
| `ollama_model` | The model you pulled (e.g. `qwen2.5:3b`). |
| `discord_webhook_url` | Your Discord webhook URL. |
| `persona` | `game_master`, `ruthless_sergeant`, or `hype_coach`. |
| `quiet_hours_start` / `quiet_hours_end` | Hours to stay silent (milestones still get through). |

Then try it without sending anything:

```bash
python3 hermes.py --dry-run      # prints the message it would post
python3 hermes.py --test         # sends a test embed to Discord
python3 hermes.py --retro --dry-run
```

> `config.json` and `hermes_state.json` are git-ignored — your webhook and run-state stay local.

## Scheduling

Run it every couple of hours with cron (it decides morning/midday/evening itself and respects quiet hours):

```cron
# Quest board / nudges / recap — every 2 hours
0 */2 * * *  /usr/bin/python3 /path/to/the-forge/agent/hermes.py

# Weekly retrospective — Sunday night
30 21 * * 0  /usr/bin/python3 /path/to/the-forge/agent/hermes.py --retro
```

## Notes

- Hermes **reads** the database; it never writes to it.
- If Ollama is unreachable, it falls back to a templated (non-AI) message so you still get your nudge.
- The XP/level/boss math here mirrors `public/game.js` in the main app — if you change the game math there, update it here too.
