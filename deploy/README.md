# One-click deploy manifests

Ready-to-submit app definitions for self-hosted app stores. Getting listed in
these stores is free distribution — users install The Forge from their
dashboard in one click.

## Umbrel — [`umbrel/`](umbrel/)

[Umbrel](https://umbrel.com) apps are a folder with a `umbrel-app.yml` manifest
and a `docker-compose.yml` (which routes through Umbrel's `app_proxy`).

- **Community App Store (fastest):** host an app-store repo and add it in Umbrel
  via *Settings → App Store → Community App Stores*. Drop these two files in a
  `the-forge/` folder. See the
  [community app store template](https://github.com/getumbrel/umbrel-community-app-store).
- **Official store:** open a PR adding the `the-forge/` folder to
  [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps), and add
  gallery images (`1.png`, `2.png`, `3.png` — use the files in
  [`../../docs/screenshots/`](../../docs/screenshots)).

## CasaOS — [`casaos/the-forge.yml`](casaos/the-forge.yml)

A CasaOS-flavored Compose file with `x-casaos` metadata.

- **Import directly:** CasaOS → *App Store → Custom Install (the `+`)* → paste
  the contents of `the-forge.yml`.
- **Official store:** submit to
  [IceWhaleTech/CasaOS-AppStore](https://github.com/IceWhaleTech/CasaOS-AppStore).

## Others

The standard [`docker-compose.yml`](../docker-compose.yml) and the published
image `ghcr.io/ycianno/the-forge:latest` work directly with **Portainer**,
**Dockge**, **Coolify**, **Yacht**, and **Unraid** (Add Container → repository
`ghcr.io/ycianno/the-forge:latest`, port `3007`, volume `/app/data`).

> All of these use the public multi-arch image (amd64 + arm64), so they run on
> a Raspberry Pi as well as an x86 box. Create a password on first launch, or
> set `APP_PASSWORD` if you prefer an environment-variable override.
