# Developing Appetizer

## Run it

```bash
pnpm install
pnpm app          # runs the desktop app (tauri dev)
pnpm dev          # UI only in a browser, with a mocked backend
pnpm release:mac  # release, see "Releasing Appetizer" below
pnpm icons        # regenerate app icons from public/logo.svg
```

Rust tests: `cd src-tauri && cargo test`.

## How installing works

| OS | Formats | Where it goes |
|---|---|---|
| macOS | `.dmg`, `.zip` with an `.app` | `/Applications` (or `~/Applications` if not writable). Quarantine flag removed. |
| Windows | NSIS `.exe` (run with `/S`), `.msi` (passive), portable `.zip` | Installer default, or `%LOCALAPPDATA%\Appetizer\Apps` |
| Linux | `.AppImage`, `.deb` (via `pkexec dpkg`) | `~/.local/share/appetizer/apps` plus a desktop entry |

If the app is running during an update, it is quit first and reopened afterwards. Apps already on disk (for example `/Applications/OneShot.app`) are detected and their version is read so they can be updated.

## Updates

- **Catalog apps:** on launch and every N hours (Settings), Appetizer checks each installed app's latest release. With **Update apps automatically** on (the default), apps Appetizer installed are updated in the background. Apps it only found on disk get an Update button instead.
- **Appetizer itself:** uses the Tauri updater. It reads `latest.json` from this repo's latest release and checks the update signature. On macOS and Linux it installs in the background and shows a "Restart" banner. On Windows it asks first, because the installer closes the app.

GitHub allows 60 unauthenticated API calls per hour. Results are cached for 10 minutes. Set `GITHUB_TOKEN` in the environment to raise the limit during development.

## Releasing Appetizer

macOS is built, signed and notarized **locally** (same setup as SplatCraft). Windows and Linux are built by GitHub Actions when the version tag is pushed. The local script pushes the tag for you.

### Steps

1. Bump the version in all three files (they must match, the script checks):
   - `package.json` → `"version"`
   - `src-tauri/Cargo.toml` → `version`
   - `src-tauri/tauri.conf.json` → `"version"`
2. Commit (the script refuses a dirty working tree).
3. Run:
   ```bash
   pnpm release:mac
   ```
   This will:
   1. build a universal (Apple Silicon + Intel) app and DMG, signed with **Developer ID Application: Digital Vibes GmbH (8HFX6YPXXN)**
   2. notarize and staple the app, then the DMG
   3. make the signed updater bundle (`Appetizer_universal.app.tar.gz` + `.sig`)
   4. tag `v<version>` and push it, which starts the **Release** workflow (Windows `.exe`/`.msi`, Linux `.AppImage`/`.deb`/`.rpm`, `latest.json`). The workflow publishes the release.
   5. wait for that workflow, upload the Mac files, and add the macOS entries to `latest.json`

Installed copies pick up the update on their next check.

Options: `NOTARIZE=0` (signed only, quick test), `SKIP_UPLOAD=1` (build only, prints where the files are), `ALLOW_DIRTY=1` (allow uncommitted changes, for tests only).

### One-time setup on a new Mac

| Needed | How |
|---|---|
| Developer ID certificate | "Developer ID Application: Digital Vibes GmbH" in the login keychain (`security find-identity -v -p codesigning`) |
| Notarization profile | `xcrun notarytool store-credentials splatcraft --apple-id <apple-id> --team-id 8HFX6YPXXN` (shared with SplatCraft) |
| Updater signing key | `~/.tauri/appetizer.key` (copy it from a backup, see below) |
| Rust targets | `rustup target add aarch64-apple-darwin x86_64-apple-darwin` (use rustup's cargo, not Homebrew's) |
| GitHub CLI | `gh auth login` |

### Updater signing key

Every update is signed with a minisign key so installed copies only accept real releases.

- Public key: `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`
- Private key: `~/.tauri/appetizer.key` (no password) on the release Mac, plus the repo secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for the Windows/Linux workflow

**Keep a backup of the private key** (for example in your password manager). If it is lost, existing installs can't be updated anymore and users have to download Appetizer again by hand.

### If something fails

- **Notarization rejected:** the script prints the notary log. `xcrun notarytool log <submission-id> --keychain-profile splatcraft` shows the details.
- **Workflow failed:** fix it, delete the tag and draft (`git push --delete origin v<version>`, `gh release delete v<version>`), and run `pnpm release:mac` again.
- **Mac files missing from a published release:** run the script again. It reuses the existing tag and replaces the uploads.

## Layout

```
catalog.json          app catalog (also served remotely)
src/                  React UI (store.ts holds state, lib/api.ts talks to Rust)
scripts/
  catalog.mjs         pnpm catalog add/check/remove
  release-mac.sh      local macOS build, sign, notarize, upload
  make-icon.mjs       public/logo.svg → src-tauri/icons/source.png
.github/workflows/
  release.yml         Windows + Linux builds on tag push
src-tauri/src/
  github.rs           release lookup and asset picking
  installer.rs        per-OS install / uninstall / launch / detect
  store.rs            installed.json and settings.json in the app data dir
  lib.rs              Tauri commands, download with progress events
```
