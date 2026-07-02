# Security Policy

## Scope & threat model

The Forge is a **single-user, self-hosted app protected by one shared password**. It is not designed to be a multi-user system or to be exposed directly to the public internet without protection.

To run it safely:

- **Create a unique password on first launch.** If you use `APP_PASSWORD` as an environment override, do not leave it unset or as a placeholder.
- **Do not expose it directly to the internet.** Put it behind a reverse proxy with HTTPS, or — recommended — a zero-trust tunnel (Cloudflare Tunnel, Tailscale, WireGuard) so only you can reach it.
- First-run passwords are stored as one-way `scrypt` hashes in SQLite. `APP_PASSWORD` remains an optional environment override for Docker/server operators.
- The session cookie is `httpOnly` and signed with a random secret that is generated and persisted on first run.
- Browser write requests are checked against the app origin to reduce cross-site request risk. If an unusual reverse proxy rewrites `Host`, set `PUBLIC_ORIGIN` to the public URL. If The Forge is behind a trusted HTTPS reverse proxy, set `TRUST_PROXY=1` so auth cookies are marked `Secure`.
- All data stays in your local SQLite database. The app makes no outbound calls (the optional Discord agent in `agent/` is separate and opt-in).

## Reporting a vulnerability

If you find a security issue, please **do not open a public issue**. Instead, open a private security advisory via GitHub (Security → Advisories) or contact the maintainer directly. Include reproduction steps and the potential impact.

Because this is a single-user app, the most valuable reports are around: authentication bypass, session-cookie forgery, and any path that lets an unauthenticated request read or modify data.
