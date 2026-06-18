# Contributing to The Forge

Thanks for your interest! The Forge is a small, opinionated, **single-user** self-hosted app. Contributions are welcome, but please keep that scope in mind — the goal is to stay simple and fast, not to become a multi-tenant platform.

## Ground rules

- **Keep it dependency-light.** The frontend is intentionally vanilla HTML/CSS/JS with no build step. Please don't introduce a framework or bundler.
- **No telemetry, no external calls.** The app must keep working fully offline with all data local.
- **Match the existing style.** Look at the surrounding code before adding anything.

## Development setup

```bash
git clone https://github.com/ycianno/the-forge.git
cd the-forge
npm install
APP_PASSWORD=dev npm start
# → http://localhost:3007
```

Frontend files live in `public/` and are served directly — edit and refresh. The backend is a single `server.js`.

## Submitting changes

1. Fork and create a branch.
2. Keep PRs focused — one feature or fix per PR.
3. Describe **what** changed and **why** in the PR description.
4. If you're touching the game math (XP curve, attributes, boss logic), note it clearly — the optional Discord agent mirrors some of that logic.

## Reporting bugs / ideas

Open an issue with steps to reproduce (for bugs) or the problem you're trying to solve (for features). Screenshots help a lot.
