#!/usr/bin/env node
// Manage catalog.json from GitHub repos.
//
//   pnpm catalog add <owner/repo> [--category Productivity] [--featured] [--accent "#FF6A3D"]
//   pnpm catalog check            # every app: repo reachable, stable release, a download per platform
//   pnpm catalog remove <id>
//
// `add` reads the repo (name, description), its latest stable release (which platforms have
// downloads) and an optional `appetizer.json` in the repo root that overrides any field.
// Paths in appetizer.json (icon, screenshots) are relative to the repo root.
// Running `add` again for an existing app refreshes it and keeps your manual edits
// to fields GitHub doesn't know about (highlights, accent, featured, category).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const CATALOG = new URL("../catalog.json", import.meta.url);
const OSES = ["macos", "windows", "linux"];

// Mirrors default_patterns() in src-tauri/src/github.rs.
const DEFAULT_PATTERNS = {
  macos: [/\.dmg$/i, /(mac|darwin|osx|macos).*\.zip$/i],
  windows: [/setup.*\.exe$/i, /\.exe$/i, /\.msi$/i, /(win|windows).*\.zip$/i],
  linux: [/\.appimage$/i, /\.deb$/i],
};
const JUNK = [".blockmap", ".yml", ".yaml", ".sig", ".sha256", ".sha512", ".txt", ".json", ".asc"];
const ICON_PATHS = [
  "appetizer-icon.png",
  "build/icon.png",
  "icon.png",
  "assets/icon.png",
  "resources/icon.png",
  "public/icon.png",
  "src-tauri/icons/128x128@2x.png",
  "src-tauri/icons/icon.png",
];

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execSync("gh auth token", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}
const TOKEN = token();

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "appetizer-catalog",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}`);
  return res.json();
}

async function raw(repo, path) {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${path}`, { method: "GET" });
  return res.ok ? res : null;
}

/** Repo-relative paths ("build/icon.png") become raw GitHub URLs; full URLs pass through. */
function resolve(repo, path) {
  if (!path) return undefined;
  return /^https?:\/\//.test(path) ? path : `https://raw.githubusercontent.com/${repo}/HEAD/${path.replace(/^\.?\//, "")}`;
}

function usable(assets) {
  return assets.filter((a) => !JUNK.some((j) => a.name.toLowerCase().endsWith(j)));
}

function matchesFor(os, assets, patterns) {
  const list = patterns?.length ? patterns.map((p) => new RegExp(p, "i")) : DEFAULT_PATTERNS[os];
  for (const re of list) {
    const hits = usable(assets).filter((a) => re.test(a.name));
    if (hits.length) return hits;
  }
  return [];
}

function loadCatalog() {
  return JSON.parse(readFileSync(CATALOG, "utf8"));
}

function saveCatalog(c) {
  writeFileSync(CATALOG, JSON.stringify(c, null, 2) + "\n");
}

function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--featured") flags.featured = true;
    else if (a.startsWith("--")) flags[a.slice(2)] = args[++i];
    else rest.push(a);
  }
  return { flags, rest };
}

function normalizeRepo(input) {
  const m = String(input ?? "").match(/(?:github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`Expected owner/repo or a GitHub URL, got "${input}"`);
  return m[1];
}

async function add(args) {
  const { flags, rest } = parseFlags(args);
  const repoName = normalizeRepo(rest[0]);
  const info = await gh(`/repos/${repoName}`);
  if (!info) throw new Error(`Repo ${repoName} not found (is it public?)`);
  if (info.private) throw new Error(`${repoName} is private. Appetizer needs public releases.`);
  const repo = info.full_name;

  let manifest = {};
  const m = await raw(repo, "appetizer.json");
  if (m) {
    manifest = await m.json();
    console.log("  found appetizer.json in the repo");
  }

  const release = await gh(`/repos/${repo}/releases/latest`);
  const assets = release?.assets ?? [];
  const detected = OSES.filter((os) => matchesFor(os, assets, manifest.assets?.[os]).length);

  let icon = resolve(repo, manifest.icon);
  if (!icon) {
    for (const p of ICON_PATHS) {
      if (await raw(repo, p)) {
        icon = `https://raw.githubusercontent.com/${repo}/HEAD/${p}`;
        break;
      }
    }
  }

  const catalog = loadCatalog();
  const id = manifest.id ?? info.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const existing = catalog.apps.find((a) => a.id === id || a.repo.toLowerCase() === repo.toLowerCase());
  const description = manifest.description ?? existing?.description ?? info.description ?? "";

  const entry = {
    id: existing?.id ?? id,
    name: manifest.name ?? existing?.name ?? info.name,
    tagline: manifest.tagline ?? existing?.tagline ?? info.description ?? "",
    description,
    repo,
    category: flags.category ?? manifest.category ?? existing?.category ?? "Utilities",
    platforms: manifest.platforms ?? (detected.length ? detected : existing?.platforms ?? []),
    ...((icon ?? existing?.icon) ? { icon: icon ?? existing.icon } : {}),
    ...((flags.accent ?? manifest.accent ?? existing?.accent) ? { accent: flags.accent ?? manifest.accent ?? existing.accent } : {}),
    ...((flags.featured ?? manifest.featured ?? existing?.featured) ? { featured: true } : {}),
    ...((manifest.highlights ?? existing?.highlights) ? { highlights: manifest.highlights ?? existing.highlights } : {}),
    ...((manifest.screenshots ?? existing?.screenshots)
      ? { screenshots: manifest.screenshots ? manifest.screenshots.map((p) => resolve(repo, p)) : existing.screenshots }
      : {}),
    ...((manifest.assets ?? existing?.assets) ? { assets: manifest.assets ?? existing.assets } : {}),
  };

  if (existing) catalog.apps[catalog.apps.indexOf(existing)] = entry;
  else catalog.apps.push(entry);
  saveCatalog(catalog);

  console.log(`${existing ? "Updated" : "Added"} ${entry.name} (${entry.id})`);
  console.log(`  repo       ${repo}`);
  console.log(`  release    ${release ? release.tag_name : "none yet: shows as \"Soon\" until one is published"}`);
  console.log(`  platforms  ${entry.platforms.join(", ") || "none detected"}`);
  console.log(`  icon       ${entry.icon ?? "none: a letter tile is used"}`);
  console.log(`  screenshots ${entry.screenshots?.length ?? 0}`);
  if (!entry.tagline) console.log("  ! no tagline: set a GitHub repo description or add appetizer.json");
  console.log("\nReview catalog.json, then commit and push. Running copies pick it up on next launch.");
}

async function check() {
  const { apps } = loadCatalog();
  let problems = 0;
  for (const app of apps) {
    const release = await gh(`/repos/${app.repo}/releases/latest`).catch((e) => ({ error: e.message }));
    const lines = [];
    if (!release) lines.push("no stable release yet (shows as \"Soon\")");
    else if (release.error) lines.push(release.error);
    else {
      for (const os of app.platforms) {
        const hits = matchesFor(os, release.assets, app.assets?.[os]);
        lines.push(hits.length ? `${os.padEnd(8)} ${hits.map((h) => h.name).join(", ")}` : `${os.padEnd(8)} ✗ no matching download`);
        if (!hits.length) problems++;
      }
    }
    if (!release || release.error) problems++;
    console.log(`${app.name} · ${app.repo} · ${release?.tag_name ?? "-"}`);
    for (const l of lines) console.log(`  ${l}`);
  }
  if (problems) {
    console.log(`\n${problems} problem(s).`);
    process.exitCode = 1;
  } else console.log("\nAll apps have downloads for their platforms.");
}

function remove(args) {
  const catalog = loadCatalog();
  const before = catalog.apps.length;
  catalog.apps = catalog.apps.filter((a) => a.id !== args[0]);
  if (catalog.apps.length === before) throw new Error(`No app with id "${args[0]}"`);
  saveCatalog(catalog);
  console.log(`Removed ${args[0]}`);
}

const [cmd, ...args] = process.argv.slice(2);
const commands = { add, check, remove };
if (!commands[cmd]) {
  console.log("Usage: pnpm catalog add <owner/repo> [--category X] [--featured] [--accent #hex]\n       pnpm catalog check\n       pnpm catalog remove <id>");
  process.exit(cmd ? 1 : 0);
}
Promise.resolve(commands[cmd](args)).catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
