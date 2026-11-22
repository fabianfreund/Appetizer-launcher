# Developing Appetizer

## Run it

```bash
pnpm install
pnpm app          # runs the desktop app (tauri dev)
pnpm dev          # UI only in a browser, with a mocked backend
pnpm build        # type-check + build the UI
pnpm catalog …    # manage catalog.json, see docs/ADDING-APPS.md
pnpm icons        # regenerate app icons from public/logo.svg
pnpm release:mac  # release, see "Releasing Appetizer" below
```

Rust tests and lint: `cd src-tauri && cargo test && cargo clippy --all-targets`.

The dev server runs on port **1437** (`vite.config.ts` and `devUrl` in `tauri.conf.json` must match).

App data (installed apps, settings) lives in the Tauri app data dir, on macOS `~/Library/Application Support/app.appetizer.launcher/` (`installed.json`, plus `settings.json` once a setting is changed). Delete them to reset.

## How installing works

| OS | Formats | Where it goes |
|---|---|---|
| macOS | `.dmg`, `.zip` with an `.app` | `/Applications` (or `~/Applications` if not writable). Quarantine flag removed. |
| Windows | NSIS `.exe` (run with `/S`), `.msi` (passive), portable `.zip` | Installer default, or `%LOCALAPPDATA%\Appetizer\Apps` |
| Linux | `.AppImage`, `.deb` (via `pkexec dpkg`) | `~/.local/share/appetizer/apps` plus a desktop entry |

If the app is running during an update, it is quit first and reopened afterwards. Apps already on disk (for example `/Applications/OneShot.app`) are detected and their version is read so they can be updated.

## Updates

- **Catalog apps:** on launch and every N hours (Settings), Appetizer checks each installed app's latest release. With **Update apps automatically** on (the default), apps Appetizer installed are updated in the background. Apps it only found on disk get an Update button instead.
- **Appetizer itself:** uses the Tauri updater (`src/lib/selfUpdate.ts`). It reads `https://github.com/fabianfreund/Appetizer-launcher/releases/latest/download/latest.json` and checks the minisign signature against the public key built into the app. On macOS and Linux it installs in the background and shows a "Restart" banner in the sidebar. On Windows it asks first, because the installer closes the app. Right before installing it checks again, so a release file replaced in the meantime can't cause a signature mismatch.

GitHub allows 60 unauthenticated API calls per hour. Results are cached for 10 minutes. Set `GITHUB_TOKEN` in the environment to raise the limit during development.

## Releasing Appetizer

macOS is built, signed and notarized **locally** (same setup as SplatCraft). Windows and Linux are built by GitHub Actions when the version tag is pushed. The local script pushes the tag for you.

### Steps

1. Make sure **CI is green** on `main` (Actions → CI: build, clippy and tests on macOS, Windows and Linux). Windows and Linux code can't be compiled on a Mac, so CI is the only check for it before the release build.
2. Bump the version in all three files (they must match, the script checks):
   - `package.json` → `"version"`
   - `src-tauri/Cargo.toml` → `version`
   - `src-tauri/tauri.conf.json` → `"version"`
3. Commit and push (the script refuses a dirty working tree).
4. Run:
   ```bash
   pnpm release:mac
   ```
   This will:
   1. build a universal (Apple Silicon + Intel) app and DMG, signed with **Developer ID Application: Digital Vibes GmbH (8HFX6YPXXN)**
   2. notarize and staple the app, then the DMG
   3. make the signed updater bundle (`Appetizer_universal.app.tar.gz` + `.sig`)
   4. tag `v<version>` and push it, which starts the **Release** workflow. It builds Windows (`.exe`, `.msi`) and Linux (`.AppImage`, `.deb`, `.rpm`) into a **draft** release with a `latest.json`
   5. wait for that workflow, upload the Mac files, add the macOS entries to `latest.json`, then **publish** the release

Nothing is public until step 5, so installed copies never see a release without its Mac files.

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

### Verify a release

After `pnpm release:mac` finishes:

```bash
gh release view v<version> --json assets -q '.assets[].name'   # 14 files incl. latest.json
gh release download v<version> -p "*.dmg" -D /tmp/check
spctl -a -t open --context context:primary-signature -vv /tmp/check/*.dmg   # "Notarized Developer ID"
```

`latest.json` must list `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64` and `linux-x86_64`. The real test: an installed older copy shows the update banner and updates itself.

### Gotchas (learned the hard way)

- **macOS tar adds hidden `._*` files** for extended attributes. The Tauri updater can't unpack them ("failed to unpack `._Appetizer.app`"). The script builds the updater bundle with `COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs` and refuses to upload if any remain. macOS's own `tar -t` hides these entries, so check with Python's `tarfile` if in doubt.
- **Don't run two Mac releases at once** (e.g. Appetizer and OneShot). DMG creation drives Finder via AppleScript and fails ("Can't set statusbar visible"). If it happens, detach leftover `/Volumes/dmg.*` images with `hdiutil detach` and run again. Nothing is published before the tag is pushed.
- **Replacing a release asset by hand** (`gh release upload --clobber`) also needs the matching signature in `latest.json` (sign with `pnpm tauri signer sign <file>` using `~/.tauri/appetizer.key`). Running copies that checked before the swap must re-check (restart) or they see "signature verification failed".
- **Use rustup's cargo.** Homebrew's Rust lacks the `x86_64-apple-darwin` target. The script puts `~/.cargo/bin` first in `PATH`.
- **Version in three places** (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`). Run `cargo check` after bumping so `Cargo.lock` updates before you commit.
- **Windows builds are not code-signed** yet, so SmartScreen shows "Windows protected your PC". Fixing it needs a Windows code-signing certificate.

### If something fails

- **Notarization rejected:** the script prints the notary log. `xcrun notarytool log <submission-id> --keychain-profile splatcraft` shows the details.
- **Windows/Linux workflow failed:** the script stops and prints the command for the failed log. Nothing was published. Fix it, delete the tag and the draft (`git push --delete origin v<version> && git tag -d v<version>`, `gh release delete v<version>`), commit, and run `pnpm release:mac` again.
- **Script stopped after CI succeeded** (upload or network error): run it again. It reuses the existing tag, picks up the finished run, replaces the uploads and publishes.

## Where things are configured

| What | Where |
|---|---|
| App catalog (live) | `catalog.json` on `main`, fetched at startup. URL: `DEFAULT_CATALOG_URL` in `src-tauri/src/store.rs`, can be changed in Settings |
| Appetizer's own repo | `LAUNCHER_REPO` in `src/lib/api.ts`, updater endpoint in `tauri.conf.json` |
| Buy me a coffee link | `SUPPORT_URL` in `src/components/Topbar.tsx` (pill in the header, left of the refresh button) |
| Window / title bar (macOS traffic lights) | `app.windows` in `tauri.conf.json`, `.sidebar--mac` in `src/styles.css` |
| Allowed network hosts (CSP) | `app.security.csp` in `tauri.conf.json` |
| Logo | `public/logo.svg` (also the sidebar logo). Run `pnpm icons` after editing |

## Layout

```
catalog.json          app catalog (also served remotely)
src/                  React UI
  store.ts            all state (zustand): catalog, releases, installs, updates
  lib/api.ts          calls into Rust; a browser mock when run with `pnpm dev`
  lib/selfUpdate.ts   Appetizer updating itself
  views/, components/ pages and UI parts
scripts/
  catalog.mjs         pnpm catalog add/check/remove
  release-mac.sh      local macOS build, sign, notarize, upload
  make-icon.mjs       public/logo.svg → src-tauri/icons/source.png
.github/workflows/
  ci.yml              build, clippy, tests on macOS/Windows/Linux for every push
  release.yml         Windows + Linux release builds (draft) on tag push
src-tauri/src/
  github.rs           release lookup and asset picking
  installer.rs        per-OS install / uninstall / launch / detect
  store.rs            installed.json and settings.json in the app data dir
  lib.rs              Tauri commands, download with progress events
```
