# Security Policy

## Scope & threat model

The Forge is a **single-user, self-hosted app protected by one shared password**. It is not designed to be a multi-user system or to be exposed directly to the public internet without protection.

To run it safely:

- **Always change `APP_PASSWORD`** from its default before deploying.
- **Do not expose it directly to the internet.** Put it behind a reverse proxy with HTTPS, or — recommended — a zero-trust tunnel (Cloudflare Tunnel, Tailscale, WireGuard) so only you can reach it.
- The session cookie is `httpOnly` and signed with a random secret that is generated and persisted on first run.
- All data stays in your local SQLite database. The app makes no outbound calls (the optional Discord agent in `agent/` is separate and opt-in).

## Reporting a vulnerability

If you find a security issue, please **do not open a public issue**. Instead, open a private security advisory via GitHub (Security → Advisories) or contact the maintainer directly. Include reproduction steps and the potential impact.

Because this is a single-user app, the most valuable reports are around: authentication bypass, session-cookie forgery, and any path that lets an unauthenticated request read or modify data.
