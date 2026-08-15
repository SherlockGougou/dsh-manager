<div align="center">

# DSH Manager

**An independent manager for DeepSeek Harness** — health checks & one-click repair · plugin management · update checks · backup & restore · instance hosting & system services

A cross-platform desktop app (macOS / Windows / Linux) that complements dsh's official Web UI (in-session) with **machine-level** management: installation, health, repair, plugins, updates, backups, processes and services.

![GitHub release](https://img.shields.io/github/v/release/SherlockGougou/dsh-manager)
![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![license](https://img.shields.io/github/license/SherlockGougou/dsh-manager)

[中文](README.md) · [Releases](https://github.com/SherlockGougou/dsh-manager/releases) · [Discussions](https://github.com/SherlockGougou/dsh-manager/discussions)

</div>

---

## ✨ Features

| Module | Capability |
|---|---|
| **Dashboard** | Environment snapshot (Node/pnpm/dsh versions & install form), DSH_HOME overview, Web instance probe |
| **Instances** | Multi-instance hosting: start/stop/restart (graceful SIGTERM), PID takeover (reclaim orphans after restart), log rotation, port probe, one-click open Web UI |
| **System services** | Install an instance as launchd (macOS) / systemd (Linux) / startup item (Windows): auto-start on login + crash restart, independent of the manager |
| **Health & Repair** | 16+ diagnostics + 6 one-click repairs (permissions / .bak restore / pnpm reinstall / session-log truncation / cache cleanup / allowBuilds injection); destructive actions back up first |
| **Plugins** | Profile bundle-stack visualization, plugin classification (built-in/out-of-tree/plain/orphan), `dsh plugin` passthrough (official reconcile semantics), `--dump-config` tree export |
| **Plugin market** | GitHub topic:dsh-plugin + npm keyword dual-channel search, dsh bundle metadata, one-click install into a profile (cached to avoid API limits) |
| **Session logs** | Workspace/session listing, native zstd multi-frame decoding (node:zlib, zero deps, torn-tail detection), stats, export JSONL / readable Markdown |
| **Config editor** | settings.yaml / .credentials.yaml (masked) / patch files; YAML validation + full-chain `dsh --patch --dump-config` check; `.bak` snapshot + atomic write + LCS diff |
| **Updates** | npm + PyPI registry checks; in-app self-update (electron-updater + GitHub Releases: progress / one-click install); artifact direct links |
| **Backup & restore** | Full DSH_HOME backup (credentials/node_modules excluded by default), manifest, dry-run restore preview, pre-restore file safekeeping, retention policy |
| **Appearance** | Light/dark/system theme (live system sync); frameless clean window (native macOS traffic lights + custom controls on Win/Linux) |

## 📸 Screenshots

> Placeholders — will be replaced with real screenshots in upcoming releases.

| Dashboard | Instances |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Instances](docs/screenshots/instances.png) |

| Health & Repair | Plugins |
|---|---|
| ![Health](docs/screenshots/health.png) | ![Plugins](docs/screenshots/plugins.png) |

| Plugin Market | Sessions |
|---|---|
| ![Market](docs/screenshots/market.png) | ![Sessions](docs/screenshots/sessions.png) |

| Config Editor | Updates |
|---|---|
| ![Config](docs/screenshots/config.png) | ![Updates](docs/screenshots/updates.png) |

| Backup & Restore | Settings |
|---|---|
| ![Backup](docs/screenshots/backup.png) | ![Settings](docs/screenshots/settings.png) |

| Theme (dark / light) |
|---|
| ![Theme](docs/screenshots/theme.png) |

## 🚀 Install

Download the installer for your platform from [Releases](https://github.com/SherlockGougou/dsh-manager/releases):

| Platform | Package | Notes |
|---|---|---|
| macOS | `DSH-Manager-<ver>-arm64.dmg` / `-x64.dmg` | Drag to Applications; Apple Silicon / Intel |
| Windows | `DSH-Manager-Setup-<ver>.exe` | NSIS installer, custom install dir |
| Linux | `.AppImage` / `.deb` | AppImage runs directly; deb for amd64 + arm64 |

The app has built-in update checks: when a new release is published, the Updates page will offer one-click download & install.

## ⚡ Developer quick start

```sh
pnpm install          # deps (project .npmrc pins the pnpm store into the workspace)
pnpm dev              # dev mode (electron-vite HMR)
pnpm core:smoke       # core-layer smoke test (no GUI; drives all core modules)
pnpm typecheck        # type check (node + web tsconfigs)
pnpm build            # build to out/
```

Requirements: Node ≥ 22.19 (24+ recommended), pnpm 10 (corepack).

## 🧭 Usage guide

- **First run**: check the dsh installation on the Updates page, or run `dsh web` to initialize DSH_HOME; then create your first backup on the Backup page.
- **Hosting instances**: create an instance on the Instances page (profile, port, working dir) and optionally install it as a system service for auto-start.
- **Plugins**: discover on the Plugin Market → verify the bundle stack & allowBuilds on the Plugins page → validate the composed tree with `--dump-config`.
- **Repair**: every anomaly on the Health page carries a one-click fix; destructive actions back up to `~/.dsh-manager/repair-backups/` first.
- **Sessions**: decode and inspect any session (torn-tail detection included), export as Markdown/JSONL.
- **Config**: edit patches/settings/credentials (masked) on the Config page; saves auto-create `.bak` and use atomic writes; profile patches get full-chain validation.

## 📁 Project layout

```
src/
├── core/          # framework-agnostic core layer (pure Node; reusable as a future Tauri sidecar)
│   ├── detect.ts        # env detection: node/pnpm/dsh forms, DSH_HOME, port probe
│   ├── home.ts          # DSH_HOME scan & stats (read-only)
│   ├── profiles.ts      # profiles/plugins listing, dsh plugin passthrough, dump-config
│   ├── updates.ts       # npm/PyPI/GitHub update checks (direct HTTP)
│   ├── health.ts        # diagnostics (status + evidence + fix hint + repair link)
│   ├── repair.ts        # repair actions (permissions/yaml/pnpm/log-truncate/cleanup/allowBuilds)
│   ├── backup.ts        # backup/restore/preview/retention
│   ├── zstd.ts          # zstd frame scan/decode (node:zlib; matches dsh container format)
│   ├── sessions.ts      # session listing/decode/stats/export
│   ├── instances.ts     # instance registry + lifecycle + log rotation
│   ├── service.ts       # launchd/systemd/startup-folder service integration
│   ├── marketplace.ts   # plugin market search (GitHub topic + npm keyword + cache)
│   ├── config-editor.ts # config editing (mask/validate/atomic write/diff)
│   ├── manager-config.ts# manager own config (~/.dsh-manager, DSHM_MANAGER_DIR override)
│   └── types.ts         # shared types
├── main/           # Electron main process (window, IPC, theme, updater, auto-start)
├── preload/        # contextBridge (window.dshm; {ok,data|error} protocol + event subscription)
└── renderer/       # React UI (10 pages, dual theme, frameless window)
```

## 🏗 Architecture decisions

1. **Framework-agnostic core**: `src/core` never imports electron and can be driven by `tsx` (`pnpm core:smoke`); a future Tauri migration reuses it as a sidecar with an unchanged IPC surface.
2. **No reinventing wheels**: plugin ops go through the official `dsh plugin`; config validation uses `--dump-config`; session decoding uses node:zlib native zstd; services use native mechanisms (launchd/systemd).
3. **Safety first**: the core treats DSH_HOME as read-only by default; every write (backup/repair/config save) snapshots first; credentials are excluded from backups and masked in the UI; the renderer has no nodeIntegration.
4. **Evidence-based**: session-log format, DSH_HOME layout and profile semantics are based on a [source analysis of deepseek-harness](docs/dsh-manager-analysis.md).

## 📦 Build & release

```sh
pnpm dist:mac    # macOS: dmg + zip (arm64 + x64)
pnpm dist:win    # Windows: NSIS (x64)
pnpm dist:linux  # Linux: AppImage + deb (x64 + arm64)
pnpm dist:dir    # unpacked dir only (fast check)
```

Pushing a `v*` tag triggers [CI](.github/workflows/release.yml): a three-platform matrix build that publishes to GitHub Releases:

```sh
pnpm bump 0.2.0 && git add -A && git commit -m "chore: bump"
git push
pnpm release:check && pnpm release:tag   # tag push → CI packages & publishes
```

## ❓ FAQ

- **Plugin install fails (allowBuilds)**: pnpm ≥10 blocks plugin build scripts by default. Run the `add-allowbuilds` repair action (Health page), or add `allowBuilds: { <pkg>: true }` to the profile's `pnpm-workspace.yaml`.
- **DMG build fails (hdiutil not permitted)**: restricted sandboxes can't create disk images; run `pnpm dist:mac` in a normal terminal.
- **pnpm store-dir overridden by machine config**: this repo's `.npmrc` pins the store to the workspace (`.pnpm-store`).
- **In-app updates not working**: auto-update only works in packaged installs (dev mode shows download links); make sure `DSHM_GH_REPO` or package.json `repository` points at the right repo.
- **dsh instance won't start**: check Node/pnpm/dsh versions and profile bundle consistency on the Health page, then use the matching one-click fix.

## 🗺 Roadmap

- Scheduled tasks (backup / health patrol / update checks)
- Secret scanning & permission auditing
- Session log full-text search
- Code signing (Apple Developer / Windows)
- Release pipeline polish (changelog generation)

## 📄 License

[MIT](LICENSE) © dsh-manager contributors

DSH Manager is an independent project, not affiliated with DeepSeek AI; DeepSeek Harness is the open-source project [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).

