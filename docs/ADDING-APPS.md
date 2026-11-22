# Adding apps to Appetizer

Every app is its own public GitHub repo with normal GitHub releases. To list one:

```bash
pnpm catalog add owner/repo --category Productivity   # add or refresh an entry
pnpm catalog check                                     # verify every app has downloads
git commit -am "Add <app>" && git push                 # live on next launch of Appetizer
```

`catalog add` reads the repo's name and description, the latest stable release (to see which platforms have downloads), and an optional **`appetizer.json`** in the app repo's root. Running it again refreshes the entry. The running launcher loads [`catalog.json`](../catalog.json) from this repo's `main` branch on startup, so no new Appetizer release is needed. The copy built into the app is only a fallback.

Other commands: `pnpm catalog remove <id>`.

**Adding an app before it's on GitHub** (so it's ready the moment it's released): `pnpm catalog add owner/repo --manifest ../App/appetizer.json`. The entry points at the future repo; the app shows as "Soon" until the repo exists and has a stable release, then becomes installable with no further changes. Icon and screenshot links start working once the repo is pushed (a letter tile is shown until then).

An app with no release yet always shows as "Soon", so it's safe to list apps early.

## `appetizer.json` in the app repo (recommended)

This lets each app control its own listing: icon, screenshots and texts. Paths are relative to the app repo's root.

```json
{
  "name": "OneShot",
  "tagline": "Capture, annotate and beautify screenshots.",
  "description": "Longer text for the app page.",
  "category": "Productivity",
  "icon": "build/icon.png",
  "screenshots": ["docs/assets/screenshot-editor.png"],
  "accent": "#FF5A7A",
  "highlights": ["Area, window & full-screen capture", "Annotate, crop, pixelate"],
  "platforms": ["macos", "windows", "linux"],
  "assets": { "macos": ["\\.dmg$"] }
}
```

Every field is optional. Without one:

| Field | Falls back to |
|---|---|
| `name`, `tagline` | repo name, repo description |
| `icon` | first that exists: `appetizer-icon.png`, `build/icon.png`, `icon.png`, `assets/icon.png`, `resources/icon.png`, `public/icon.png`, `src-tauri/icons/128x128@2x.png`; else a letter tile |
| `platforms` | detected from the latest release's downloads |
| `assets` | the default patterns below |

**Icon:** a 1024×1024 PNG in the macOS style (rounded square with transparent padding). It is shown uncropped, so the same file you use for the app works.
**Screenshots:** PNG or JPG, about 16:10, at least 1600px wide.

## What the app repo needs to publish

A normal GitHub release (not a draft or pre-release) whose tag is the version (`v1.2.0` or `1.2.0`) and whose assets are the installers. electron-builder's and Tauri's default output both work as is.

Default download patterns, tried in order: `.dmg` / mac `.zip` on macOS, `setup*.exe` / `.exe` / `.msi` / win `.zip` on Windows, `.AppImage` / `.deb` on Linux. When several files match, the one for the current CPU (`arm64` / `x64` / `universal` in the file name) wins. Override per OS with `assets` (regexes).

## `catalog.json` fields

`id`, `name`, `tagline`, `description`, `repo`, `category`, `platforms` are required. Optional: `icon`, `screenshots`, `accent`, `featured` (shown in the Discover hero), `highlights`, `assets`. `catalog add` writes all of these; edit by hand if you like (`featured` and `accent` are kept on refresh).
