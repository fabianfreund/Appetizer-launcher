# Appetizer launcher

Free, open-source, Setapp-style launcher: installs and auto-updates utility apps from their own public GitHub repos (latest **stable** release only). Tauri 2 (Rust) + React/TypeScript, macOS/Windows/Linux. Repo: `fabianfreund/Appetizer-launcher` (public, MIT).

Read first: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) (architecture, releasing, gotchas), [docs/ADDING-APPS.md](docs/ADDING-APPS.md) (catalog). README.md is user-facing: keep it simple, no maintainer details there.

## Commands

- `pnpm app`: run the desktop app (dev server on port 1437)
- `pnpm dev`: UI in a browser with a mocked backend (`src/lib/api.ts`)
- `pnpm build`: type-check + build UI. Rust: `cd src-tauri && cargo test && cargo clippy --all-targets`
- `pnpm catalog add owner/repo` / `pnpm catalog check`: manage `catalog.json`
- `pnpm release:mac`: the whole release (see below)

## Releasing (summary)

1. Bump version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`; `cargo check` to update `Cargo.lock`; commit + push.
2. `pnpm release:mac` (≈15–20 min): builds a universal macOS app locally, signs with "Developer ID Application: Digital Vibes GmbH (8HFX6YPXXN)", notarizes with keychain profile `splatcraft`, tags + pushes `v<version>`, waits for CI (Windows + Linux via `.github/workflows/release.yml`), uploads Mac files and merges them into `latest.json`.
3. Verify: download the DMG, `spctl -a -t open --context context:primary-signature -vv` → "Notarized Developer ID"; `latest.json` lists darwin, windows and linux.

Mac builds are always local (user preference). Don't commit while a release is running: the tag is made from HEAD at the end.

## Never commit secrets

- Updater private key: `~/.tauri/appetizer.key` (outside the repo, no password). Also in repo secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` for CI. Public key is in `tauri.conf.json`.
- `.gitignore` blocks `*.key`, `*.p8`, `*.p12`, `*.pem`, `*.cer`, `.env*`. Scan staged files before committing release changes.
- Apple notarization uses the local keychain profile; no Apple secrets on GitHub.

## Gotchas

- Updater `.app.tar.gz` must not contain AppleDouble `._*` files (macOS tar adds them): build with `COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs`. `tar -t` hides them; check with Python `tarfile`.
- Never run two Mac releases at once (Finder/AppleScript DMG step fails). Recover: `hdiutil detach` leftover `/Volumes/dmg.*`, rerun.
- Replacing a release asset by hand also requires re-signing it and updating `latest.json`.
- Use rustup's cargo (`~/.cargo/bin`), not Homebrew's (no x86_64 target).
- The user has Appetizer installed in `/Applications`. When screenshotting the dev build, match the window by the `target/debug/appetizer` PID, and never kill the installed app.

## Related

- OneShot (first catalog app): `../OneShot`, `fabianfreund/OneShot`, Electron, same signing setup (`npm run release:mac`).
- SplatCraft: same Developer ID + `splatcraft` notary profile.
