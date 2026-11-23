// Thin wrapper over the Rust commands. Outside Tauri (plain `pnpm dev` in a browser)
// it falls back to a mock so the UI can be developed without building the app.
import type {
  AppRef,
  CatalogApp,
  InstalledApp,
  OS,
  PlatformInfo,
  Progress,
  ReleaseInfo,
  Settings,
} from "./types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const LAUNCHER_REPO = "fabianfreund/Appetizer-launcher";

export function toRef(app: CatalogApp, os: OS): AppRef {
  return { id: app.id, name: app.name, repo: app.repo, patterns: app.assets?.[os] ?? [] };
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  return mock(cmd, args ?? {}) as Promise<T>;
}

export const api = {
  platform: () => invoke<PlatformInfo>("platform_info"),
  fetchCatalog: (url: string) => invoke<unknown>("fetch_catalog", { url }),
  latestRelease: (app: AppRef, force = false) => invoke<ReleaseInfo>("latest_release", { app, force }),
  installed: (known: AppRef[]) => invoke<Record<string, InstalledApp>>("installed_apps", { known }),
  install: (app: AppRef) => invoke<InstalledApp>("install_app", { app }),
  uninstall: (app: AppRef) => invoke<void>("uninstall_app", { app }),
  launch: (id: string) => invoke<void>("launch_app", { id }),
  reveal: (id: string) => invoke<void>("reveal_app", { id }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
};

export async function onProgress(cb: (p: Progress) => void): Promise<() => void> {
  if (isTauri) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<Progress>("install-progress", (e) => cb(e.payload));
  }
  mockListeners.add(cb);
  return () => mockListeners.delete(cb);
}

// ───────────── browser mock ─────────────

const mockListeners = new Set<(p: Progress) => void>();
const LS_INSTALLED = "appetizer.mock.installed";
const LS_SETTINGS = "appetizer.mock.settings";

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export const defaultSettings: Settings = {
  autoUpdate: true,
  checkIntervalHours: 6,
  launchAfterInstall: false,
  catalogUrl: `https://raw.githubusercontent.com/${LAUNCHER_REPO}/main/catalog.json`,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mock(cmd: string, a: Record<string, any>): Promise<unknown> {
  switch (cmd) {
    case "platform_info": {
      const ua = navigator.userAgent;
      const os: OS = /Windows/.test(ua) ? "windows" : /Mac/.test(ua) ? "macos" : "linux";
      return { os, arch: "aarch64", version: "0.1.0-dev" };
    }
    case "fetch_catalog": {
      const r = await fetch(a.url);
      if (!r.ok) throw `Catalog returned HTTP ${r.status}`;
      return r.json();
    }
    case "latest_release": {
      const r = await fetch(`https://api.github.com/repos/${a.app.repo}/releases/latest`);
      if (r.status === 404) throw "No stable release published yet";
      if (!r.ok) throw `GitHub returned HTTP ${r.status}`;
      const g = await r.json();
      const assets = g.assets.map((x: any) => ({ name: x.name, url: x.browser_download_url, size: x.size }));
      return {
        tag: g.tag_name,
        version: String(g.tag_name).replace(/^v/i, ""),
        name: g.name || g.tag_name,
        notes: g.body ?? "",
        publishedAt: g.published_at ?? "",
        htmlUrl: g.html_url,
        assets,
        asset: assets[0] ?? null,
      };
    }
    case "installed_apps":
      return read(LS_INSTALLED, {});
    case "install_app": {
      const id = a.app.id as string;
      const total = 48_000_000;
      for (let i = 0; i <= 20; i++) {
        mockListeners.forEach((l) => l({ id, phase: "downloading", received: (total * i) / 20, total }));
        await sleep(90);
      }
      mockListeners.forEach((l) => l({ id, phase: "installing", received: total, total }));
      await sleep(700);
      const entry: InstalledApp = {
        id,
        version: "0.0.0",
        path: `/Applications/${a.app.name}.app`,
        kind: "app-bundle",
        installedAt: Math.floor(Date.now() / 1000),
        assetName: "",
        managed: true,
      };
      write(LS_INSTALLED, { ...read(LS_INSTALLED, {}), [id]: entry });
      mockListeners.forEach((l) => l({ id, phase: "done", received: total, total }));
      return entry;
    }
    case "uninstall_app": {
      await sleep(400);
      const all = read<Record<string, InstalledApp>>(LS_INSTALLED, {});
      delete all[a.app.id];
      write(LS_INSTALLED, all);
      return;
    }
    case "launch_app":
    case "reveal_app":
      return;
    case "open_url":
      window.open(a.url, "_blank", "noopener");
      return;
    case "get_settings":
      return { ...defaultSettings, ...read(LS_SETTINGS, {}) };
    case "save_settings":
      write(LS_SETTINGS, a.settings);
      return a.settings;
  }
  throw `Unknown command ${cmd}`;
}
