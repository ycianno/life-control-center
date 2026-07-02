# The Forge

<div align="center">
  <img src="public/icon-512.png" width="96" height="96" alt="The Forge logo" />
  <h3>Turn your real life into an RPG.</h3>
  <p><strong>A self-hosted, single-user habit tracker that gamifies your goals</strong> — XP, levels, life attributes, daily quests, streaks, trophies, insignias, and a weekly boss. No accounts, no cloud, no tracking. Your data lives in one SQLite file on your own machine.</p>
  <p>
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white">
    <img alt="SQLite" src="https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white">
    <img alt="Docker" src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white">
    <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-green">
    <a href="https://paypal.me/ycianno"><img alt="Donate" src="https://img.shields.io/badge/Donate-PayPal-00457C?logo=paypal&logoColor=white"></a>
  </p>
</div>

---

## Why The Forge?

Most habit trackers are a flat list of checkboxes — easy to ignore, easy to abandon. The Forge wraps your daily discipline in a game loop so that doing the boring, important things feels rewarding:

- Every checked task awards **XP** with a sound, a particle pop, and a combo meter.
- XP flows into a persistent **level + rank** and five **life attributes** you can watch grow on a radar chart.
- A rotating **weekly boss** gives you something to beat each week; falling behind on its "weak" attribute lets it survive.
- **Streaks**, **trophies** (Bronze → Platinum), and **insignias** keep the dopamine coming.

It's opinionated and built for one person: you. Self-host it, set a password, and own your data.

## Features

| | |
|---|---|
| 🎮 **Game engine** | Lifetime XP, leveling curve, Initiate→Forgemaster ranks, and 5 independently-leveling attributes (Discipline, Body, Mind, Vitality, Craft) — all derived from the checks you already make. |
| ✅ **Daily quests** | A per-day checklist where each task awards XP. Combos, haptics, and a "Day Cleared" celebration when you finish the day. |
| 🔥 **Streaks & freeze** | Daily and weekly streaks with milestone rewards (7 / 30 / 100 / 365 days) and a configurable "freeze" grace day so one bad day doesn't reset everything. |
| 🏆 **Trophy Cabinet** | A dedicated showcase: trophy grades, a filterable wall of auto-unlocking **insignias** (Ascension, Attributes, Consistency, Boss, Study, Volume) across rarities, and manually-logged **Records** for real-world wins (certifications, PRs, goals). |
| 👹 **Weekly boss** | A deterministic boss each week whose HP drains as you complete your week — with double damage to its weak attribute. Defeat it for an insignia and a victory celebration. |
| ⏱️ **Focus timer** | A built-in Pomodoro/focus timer that logs elapsed hours straight into your study/project goals. |
| 📊 **Analytics** | Weekly completion & XP trends, by-weekday breakdowns, and your most-skipped quests. |
| 📅 **Goal tracking** | Certifications & study goals with deadline countdowns and pacing, weekly project-output tracking, diet/protein checklists, and a structured weekly review. |
| 🎨 **10 themes** | A full palette of distinct dark themes (True Black, Crimson, Deep Forest, Synthwave, Nord, Carbon, and more). |
| 📱 **PWA + push** | Installable on iOS/Android, works offline, and supports optional web-push reminders. |
| 🪪 **Shareable card** | Export your level, rank, and attributes as a PNG to share — and load **sample data** in one click so a fresh install looks alive. |
| 🤖 **Optional Discord agent** | "Hermes" — a local-AI companion (via [Ollama](https://ollama.com)) that reads your progress and nudges you on Discord. See [`agent/`](agent/). |

> Everything (goals, quests, diet, projects, review prompts, difficulty) is editable in-app — no code changes required.

## Screenshots

<div align="center">
  <img src="docs/screenshots/character.png" width="80%" alt="Character screen with level orb, attribute radar, and contribution heatmap" />
  <br/><br/>
  <img src="docs/screenshots/themes.png" width="80%" alt="A selection of the built-in themes" />
  <br/><br/>
  <img src="docs/screenshots/card.png" width="60%" alt="A shareable character card with level, rank, and attributes" />
  <br/><br/>
  <img src="docs/screenshots/cabinet.png" width="45%" alt="The trophy Cabinet with insignias and records" />
</div>

## Install

> **New to self-hosting? Read this first.**
> You do **not** need a "server", a cloud account, or any networking know-how to try The Forge. A "server" is just *a computer that stays on* — and your own laptop or desktop counts. The Forge is a single small program that runs on your machine and opens at **http://localhost:3007** in your browser, like any local app.
>
> - **Just want to try it?** Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac/Linux), run the one command in **Option A**, and open the link. Nothing is exposed to the internet; everything stays on your computer. Close it when you're done.
> - **Want it running 24/7?** Leave it on any always-on machine — an old laptop, a Raspberry Pi, a NAS, or a cheap VPS — and reach it from your phone (see [Accessing it](#accessing-it-from-your-phone--outside-home)). But that's a *later* step, not a requirement to start.

### Which option is right for me?

| You are… | Pick | Why |
|---|---|---|
| Running a home-server dashboard (**CasaOS, Umbrel, Unraid, Portainer**) | **Option 0 — One-click** | Install from your dashboard's UI. No terminal. |
| Comfortable installing one app (**Docker Desktop**) | **Option A — Docker** | One command, nothing to build or compile. **Easiest for most people.** |
| A developer / want no Docker at all | **Option B — Bare metal** | Plain Node.js. More setup, full control. |

All three run the **exact same app** on the same port. You can change your mind later — your data is just one file.

### Option 0 — One-click app stores (no terminal)

If you already run a self-hosted dashboard, this is the easiest path — install from the UI in one click. Ready-made manifests live in [`deploy/`](deploy/).

- **CasaOS** — App Store → *Custom Install* (the `+`) → paste the contents of [`deploy/casaos/the-forge.yml`](deploy/casaos/the-forge.yml).
- **Portainer** — *Stacks → Add stack*, name it `forge`, paste the project's [`docker-compose.yml`](docker-compose.yml) (or point it at this repo), then *Deploy*. On first launch, create your password in the browser.
- **Umbrel** — add as a Community App Store app; see [`deploy/umbrel/`](deploy/umbrel/).
- **Unraid / Dockge / Coolify / Yacht** — *Add Container* with image `ghcr.io/ycianno/the-forge:latest`, port `3007`, volume `/app/data`. Set `APP_PASSWORD` if you want an environment password override; otherwise create one on first launch.

See [`deploy/README.md`](deploy/README.md) for full details.

### Option A — Docker (recommended)

**Fastest — prebuilt image, nothing to build.** A multi-arch image (amd64 **+ arm64**, so it runs on a Raspberry Pi) is published to GitHub's Container Registry. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) first (or Docker Engine on Linux), then:

```bash
docker run -d --name forge \
  -p 3007:3007 \
  -v "$PWD/data:/app/data" \
  ghcr.io/ycianno/the-forge:latest
```

Then open **http://localhost:3007** and create your password. That's it — to update later: `docker pull ghcr.io/ycianno/the-forge:latest && docker rm -f forge` and re-run the command.

Prefer an environment-variable password instead of browser setup? Add `-e APP_PASSWORD=your-password` to the command.

**Or from source, with Compose:**

```bash
git clone https://github.com/ycianno/the-forge.git
cd the-forge
cp .env.example .env          # optional: edit .env for PORT / APP_PASSWORD overrides
docker compose up -d
```

> The default `docker-compose.yml` builds from source. To use the prebuilt image instead, comment out `build: .` and uncomment the `image:` line.

### Option B — Bare metal (Node, no Docker)

This runs The Forge directly with Node.js. It needs **Node.js 20+** and, on first install, a few build tools — `better-sqlite3` compiles a small native module. Set those up **first**, or `npm install` will fail with a `node-gyp` error.

**1. Install Node.js 20+ and build tools:**

```bash
# Debian / Ubuntu / Raspberry Pi OS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3

# Fedora / RHEL
sudo dnf install -y nodejs gcc-c++ make python3

# macOS (Homebrew) — Xcode tools provide the compiler
xcode-select --install 2>/dev/null; brew install node
```

(No package manager? Grab an installer from [nodejs.org](https://nodejs.org).)

**2. Install The Forge — one-line installer.** It checks Node, downloads The Forge, installs it, asks you to set a password, and offers to start it:

```bash
curl -fsSL https://raw.githubusercontent.com/ycianno/the-forge/main/install.sh | bash
```

**Or do it by hand:**

```bash
git clone https://github.com/ycianno/the-forge.git
cd the-forge
npm install
npm start
```

Then open **http://localhost:3007** and create your password. To use an environment-variable password instead, set `APP_PASSWORD` in `.env` or export it before `npm start`.

**Keep it running on boot (Linux / systemd).** Docker restarts the app for you; on bare metal a small service unit does the same. The easiest way is to let the installer do it — re-run with `--service`:

```bash
curl -fsSL https://raw.githubusercontent.com/ycianno/the-forge/main/install.sh | bash -s -- --service
```

That writes and enables the unit for you. To do it by hand instead, create `/etc/systemd/system/the-forge.service`:

```ini
[Unit]
Description=The Forge
After=network.target

[Service]
WorkingDirectory=/opt/the-forge
ExecStart=/usr/bin/node server.js
Restart=always
User=forge

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now the-forge`. (On macOS, `pm2 start server.js --name the-forge` is the easy equivalent. The service reads your password from the `.env` file in `WorkingDirectory`.)

### On Windows

The Forge runs natively on Windows — **no Docker, no WSL, no Visual Studio required** on a normal x64 PC. `better-sqlite3` ships prebuilt binaries for the current Node LTS on Windows x64, so `npm install` just downloads them (no compiler).

**Easiest (double-click, recommended for non-developers).** Download **[`install.bat`](https://raw.githubusercontent.com/ycianno/the-forge/main/install.bat)** (right-click → *Save link as…*) and **double-click it**. This wrapper keeps the window open no matter what and bypasses PowerShell's execution policy, so if anything goes wrong you can actually *read* the error instead of it flashing shut. It installs Node LTS via `winget` if needed, downloads The Forge, asks for a password, and creates a **Start Menu shortcut**.

**One-line installer (PowerShell).** In **PowerShell**, run:

```powershell
irm https://raw.githubusercontent.com/ycianno/the-forge/main/install.ps1 | iex
```

Every run writes a full log to `%TEMP%\the-forge-install_*.log`, and the installer pauses at the end (success *or* failure) so nothing scrolls away. To also start it automatically at logon, download and run it with the `-Service` flag instead:

```powershell
irm https://raw.githubusercontent.com/ycianno/the-forge/main/install.ps1 -OutFile install.ps1; .\install.ps1 -Service
```

**Or by hand:** install [Node.js LTS for Windows](https://nodejs.org), then in PowerShell:

```powershell
git clone https://github.com/ycianno/the-forge.git
cd the-forge
npm install
"APP_PASSWORD=your-password`nPORT=3007" | Set-Content .env -Encoding ascii
npm start
```

Then open **http://localhost:3007**.

> **Alternatives:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (run the **Option A** `docker run` command as-is) or **WSL2** (`wsl --install`, then follow **Option B** inside Ubuntu) both work too. They're only needed for edge cases like Windows-on-ARM, where a prebuilt binary may be missing.

---

**However you start it:** open **http://localhost:3007** (or `http://<server-ip>:3007` from another device on your network), log in, and on first launch **load sample data** to explore — or start fresh. All your data lives in one SQLite file at `data/database.sqlite`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| **(Windows) The install window flashes an error and closes instantly** | Use **[`install.bat`](https://raw.githubusercontent.com/ycianno/the-forge/main/install.bat)** (double-click) instead of *"Run with PowerShell"* — it keeps the window open. Either way, the full error is saved to a log file at `%TEMP%\the-forge-install_*.log`: press <kbd>Win</kbd>+<kbd>R</kbd>, type `%TEMP%`, and open the newest `the-forge-install_…log`. |
| **(Windows) Install fails at the database step / "better-sqlite3 will not load"** | Your Node is a **non-LTS** (odd-numbered: 21, 23, 25…) version with no prebuilt binary. Uninstall it, install the **LTS** (even-numbered) build from [nodejs.org](https://nodejs.org), and re-run the installer. On an **ARM64** PC use Docker Desktop or WSL2 instead. |
| **`npm install` fails with a `node-gyp` / compiler error** | You're missing build tools. Install them (see [Option B, step 1](#option-b--bare-metal-node-no-docker)) — `build-essential python3` on Debian/Ubuntu, Xcode Command Line Tools on macOS — then re-run `npm install`. On Windows, this usually means Node isn't LTS (see the row above). |
| **"Node.js 20+ required" (or a very old Node)** | Your system Node is too old. Install 20+ via the NodeSource line above, or use [nvm](https://github.com/nvm-sh/nvm): `nvm install 20 && nvm use 20`. |
| **Port 3007 already in use** | Something else is on that port. Pick another: set `PORT=8080` (in `.env`, or `-e PORT=8080 -p 8080:8080` for Docker) and open that port instead. |
| **Page won't load at localhost** | Give it a few seconds on first start (it creates the database). Check it's running: `docker logs forge` (Docker) or look at the terminal output (bare metal). `/healthz` should return `{"status":"ok"}`. |
| **Can't reach it from my phone** | Use your machine's LAN IP, not `localhost`: `http://<server-ip>:3007`. Both devices must be on the same Wi-Fi, and the host firewall must allow port 3007. For outside-home access, see [Accessing it](#accessing-it-from-your-phone--outside-home). |
| **I forgot my password / want to change it** | Set a temporary `APP_PASSWORD` environment override and restart, log in, export a backup if needed, then remove the override when you're ready to use the stored setup password again. |
| **How do I update?** | **Docker:** `docker pull …:latest` then recreate the container (your `data/` volume is kept). **Bare metal:** `git pull && npm install &&` restart. Your database is never touched by updates. |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `APP_PASSWORD` | *(unset)* | Optional password override. If unset or left as a known placeholder, The Forge asks you to create a password on first launch and stores a one-way hash in SQLite. |
| `PORT` | `3007` | Port the server listens on. |
| `DB_PATH` | `/app/data/database.sqlite` | Where the SQLite database lives. |
| `SESSION_SECRET` | *(auto-generated)* | Secret used to sign the session cookie. A random one is generated and persisted on first run; set this only if you want to control it explicitly. |
| `PUBLIC_ORIGIN` | *(unset)* | Optional canonical origin, such as `https://forge.example.com`, for reverse proxies that rewrite the `Host` header. Leave unset for normal Docker/local/LAN use. |
| `TRUST_PROXY` | *(unset)* | Set to `1` only when The Forge is behind a reverse proxy you control. This lets Express honor `X-Forwarded-Proto` and mark auth cookies `Secure` on HTTPS. |

Web-push **VAPID keys are generated automatically** on first run and stored in the database — you don't need to configure them.

## Backups

- **From the UI:** Settings → Data → *Export Full Backup* writes a JSON snapshot you can re-import later. Imports are validated server-side and applied atomically, so a bad backup is rejected before it can partially overwrite your data.
- **Raw database:** copy `data/database.sqlite` out of the mounted volume. The included [`backup.sh`](backup.sh) shows a simple scheduled-snapshot approach.

## Accessing it from your phone / outside home

By default The Forge is reachable on your home network at `http://<server-ip>:3007`, and you can **Add to Home Screen** on your phone to install it as an app (it's a PWA — works offline, supports push). To reach it from anywhere, pick one — easiest first:

| Option | Domain? | Effort | Notes |
|---|---|---|---|
| **Same Wi-Fi** | No | none | `http://<server-ip>:3007` at home. Good enough for many. |
| **Tailscale** ⭐ | No | ~5 min | Private VPN mesh. Reach it from your phone anywhere, encrypted, **nothing exposed to the internet**. Free, with iOS/Android apps. Best mobile-from-anywhere option. |
| **Cloudflare Tunnel** | Yes | ~20–30 min | A real `https://forge.yourdomain.com` URL with no port-forwarding, plus an optional login gate (Cloudflare Access). Free tier covers it. Best "clean URL" option. |
| **Reverse proxy + port-forward** | Yes | more | Classic self-host: [Caddy](https://caddyserver.com) (auto-HTTPS) or Nginx + a DNS record + a forwarded port. Most control, most exposure. |

**Tailscale** and **Cloudflare Tunnel** are recommended because they give you remote access *without* opening your home network to the public internet.

## Security

The Forge is a **single-user app with a single shared password** — intentionally simple, not a multi-tenant platform. It ships with sensible defaults:

- A first-run setup screen that stores a one-way `scrypt` password hash in SQLite.
- A signed, `httpOnly` session cookie (secret auto-generated and persisted).
- **Brute-force protection:** the login endpoint is rate-limited (lockout after repeated failures).
- **Same-origin write protection:** browser write requests must come from the app's own origin, with `PUBLIC_ORIGIN` available for unusual reverse-proxy setups.
- **Security headers** including a strict Content-Security-Policy (all assets, fonts included, are served locally — no external calls).
- An in-app warning if you're still running an unsafe setup password.

Still, treat it like what it is:

- **Always create a unique password** before exposing it anywhere. If you use `APP_PASSWORD`, do not leave it as a placeholder.
- **Don't put it directly on the public internet without protection.** Use HTTPS via a reverse proxy, or — recommended — a zero-trust tunnel / VPN (Cloudflare Tunnel, Tailscale) so only you can reach it. See [Accessing it](#accessing-it-from-your-phone--outside-home) above and [SECURITY.md](SECURITY.md).

## Tech stack

- **Frontend:** Vanilla HTML/CSS/JS — no framework, no build step. Themed entirely with CSS custom properties.
- **Backend:** Node.js + Express.
- **Database:** SQLite via `better-sqlite3`.
- **Auth:** Signed, `httpOnly` session cookie.
- **Packaging:** Docker + Docker Compose.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The Forge is opinionated by design, so features that keep it simple and single-user are the easiest to land.

## Support

The Forge is free and open source. If it's helping you level up your life, you can fuel its development with a one-off tip — it genuinely helps and is hugely appreciated:

<a href="https://paypal.me/ycianno"><img alt="Donate with PayPal" src="https://img.shields.io/badge/Donate-PayPal-00457C?logo=paypal&logoColor=white&style=for-the-badge"></a>

Not able to donate? Starring the repo and sharing it helps just as much. 🙏

## License

[MIT](LICENSE) © 2026 YZEE Labs
