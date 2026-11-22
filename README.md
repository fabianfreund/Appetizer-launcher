# Appetizer

A free, open-source app launcher for great utility apps on macOS, Windows and Linux. Think Setapp, but free.

Every app in Appetizer lives in its own public GitHub repo. Appetizer reads the **latest stable release** (no drafts, no pre-releases), picks the right download for your OS and CPU, installs it, and keeps it updated.

Built with [Tauri 2](https://tauri.app) (Rust) and React + TypeScript.

## Develop

```bash
pnpm install
pnpm app          # runs the desktop app (tauri dev)
pnpm dev          # UI only in a browser, with a mocked backend
pnpm tauri build  # release bundles (.dmg/.app, .msi/.exe, .AppImage/.deb)
pnpm icons        # regenerate app icons from public/logo.svg
```

Rust tests: `cd src-tauri && cargo test`.

## Adding an app

Add an entry to [`catalog.json`](catalog.json). The running app loads the catalog from GitHub on startup (`settings.catalogUrl`, by default this repo's `main` branch), so new apps show up without a new Appetizer release. The copy bundled into the build is the fallback.

```jsonc
{
  "id": "oneshot",                       // unique, stable
  "name": "OneShot",                     // must match the installed app name (OneShot.app / OneShot.exe)
  "tagline": "Capture, annotate and beautify screenshots.",
  "description": "…",
  "repo": "owner/OneShot",               // GitHub repo with releases
  "category": "Productivity",
  "platforms": ["macos", "windows"],     // macos | windows | linux
  "icon": "https://…/icon.png",          // optional, a letter tile is shown if missing
  "accent": "#FF6A3D",                   // optional brand colour
  "featured": true,                      // optional, shown in the Discover hero
  "highlights": ["…"],                   // optional
  "assets": {                            // optional regexes per OS, tried in order
    "macos": ["\\.dmg$", "mac\\.zip$"],
    "windows": ["setup.*\\.exe$"]
  }
}
```

If `assets` is left out, Appetizer uses defaults: `.dmg` / mac `.zip` on macOS, `setup*.exe` / `.exe` / `.msi` / win `.zip` on Windows, `.AppImage` / `.deb` on Linux. When several files match, the one for the current CPU (`arm64` / `x64` / `universal` in the file name) wins.

### What the app repo needs to publish

A normal GitHub release (not a pre-release) whose tag is the version (`v1.2.0` or `1.2.0`) and whose assets are the installers. electron-builder's default output works as is.

## How installing works

| OS | Formats | Where it goes |
|---|---|---|
| macOS | `.dmg`, `.zip` with an `.app` | `/Applications` (or `~/Applications` if not writable). Quarantine flag removed. |
| Windows | NSIS `.exe` (run with `/S`), `.msi` (passive), portable `.zip` | Installer default, or `%LOCALAPPDATA%\Appetizer\Apps` |
| Linux | `.AppImage`, `.deb` (via `pkexec dpkg`) | `~/.local/share/appetizer/apps` plus a desktop entry |

If the app is running during an update, it is quit first and reopened afterwards. Apps already on disk (for example `/Applications/OneShot.app`) are detected and their version is read so they can be updated.

## Updates

- On launch and every N hours (Settings), Appetizer checks each installed app's latest release.
- With **Update apps automatically** on (the default), apps Appetizer installed get updated in the background. Apps it only found on disk show an Update button instead.
- Appetizer updates itself with the Tauri updater: it reads `latest.json` from this repo's latest release, verifies the signature, installs in the background (macOS/Linux) and offers a restart. On Windows it asks first, because the installer closes the app.

## Releasing Appetizer

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
2. Commit, then tag and push: `git tag v0.1.2 && git push origin main v0.1.2`.
3. The **Release** workflow builds macOS (Apple Silicon + Intel), Windows and Linux, uploads installers and signed updater files, and publishes the release.

Updates are signed with a minisign key. The public key is in `tauri.conf.json`; the private key lives in the repo secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (keep a backup, without it existing installs can't be updated).

GitHub allows 60 unauthenticated API calls per hour. Results are cached for 10 minutes. Set `GITHUB_TOKEN` in the environment to raise the limit during development.

## Layout

```
catalog.json          app catalog (also served remotely)
src/                  React UI (store.ts holds state, lib/api.ts talks to Rust)
src-tauri/src/
  github.rs           release lookup and asset picking
  installer.rs        per-OS install / uninstall / launch / detect
  store.rs            installed.json and settings.json in the app data dir
  lib.rs              Tauri commands, download with progress events
```
