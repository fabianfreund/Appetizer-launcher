import { create } from "zustand";
import bundledCatalog from "../catalog.json";
import { api, onProgress, toRef } from "./lib/api";
import type {
  Catalog,
  CatalogApp,
  InstalledApp,
  PlatformInfo,
  Progress,
  ReleaseInfo,
  Settings,
} from "./lib/types";
import { isNewer } from "./lib/version";
import { checkSelfUpdate, installSelfUpdate, restart, type SelfUpdate } from "./lib/selfUpdate";

export type View =
  | { kind: "discover" }
  | { kind: "installed" }
  | { kind: "updates" }
  | { kind: "settings" }
  | { kind: "category"; name: string }
  | { kind: "app"; id: string; from: View };

type Loadable<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error"; error: string };

export interface Task {
  phase: Progress["phase"];
  received: number;
  total: number;
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

interface State {
  platform: PlatformInfo | null;
  catalog: CatalogApp[];
  catalogSource: "bundled" | "remote";
  releases: Record<string, Loadable<ReleaseInfo>>;
  installed: Record<string, InstalledApp>;
  tasks: Record<string, Task>;
  settings: Settings | null;
  selfUpdate: SelfUpdate | null;
  lastChecked: number | null;
  checking: boolean;
  view: View;
  query: string;
  toasts: Toast[];

  init: () => Promise<void>;
  setView: (v: View) => void;
  openApp: (id: string) => void;
  setQuery: (q: string) => void;
  loadReleases: (force?: boolean, ids?: string[]) => Promise<void>;
  refreshInstalled: () => Promise<void>;
  install: (id: string) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  launch: (id: string) => Promise<void>;
  reveal: (id: string) => Promise<void>;
  checkUpdates: (opts?: { auto?: boolean; refresh?: boolean }) => Promise<void>;
  updateAll: () => Promise<void>;
  checkSelf: (auto: boolean) => Promise<void>;
  applySelfUpdate: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
}

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

function validCatalog(v: unknown): v is Catalog {
  const c = v as Catalog;
  return !!c && Array.isArray(c.apps) && c.apps.every((a) => a && a.id && a.name && a.repo);
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  platform: null,
  catalog: (bundledCatalog as Catalog).apps,
  catalogSource: "bundled",
  releases: {},
  installed: {},
  tasks: {},
  settings: null,
  selfUpdate: null,
  lastChecked: null,
  checking: false,
  view: { kind: "discover" },
  query: "",
  toasts: [],

  async init() {
    const [platform, settings] = await Promise.all([api.platform(), api.getSettings()]);
    set({ platform, settings });

    await onProgress((p) =>
      set((s) => {
        const tasks = { ...s.tasks };
        if (p.phase === "done") delete tasks[p.id];
        else tasks[p.id] = { phase: p.phase, received: p.received, total: p.total };
        return { tasks };
      }),
    );

    // Remote catalog lets new apps show up without shipping a new Appetizer build.
    try {
      const remote = await api.fetchCatalog(settings.catalogUrl);
      if (validCatalog(remote) && remote.apps.length) set({ catalog: remote.apps, catalogSource: "remote" });
    } catch {
      /* keep bundled catalog */
    }

    await get().refreshInstalled();
    await get().loadReleases();

  },

  setView: (view) => set({ view, query: "" }),
  openApp: (id) => set((s) => ({ view: { kind: "app", id, from: s.view.kind === "app" ? s.view.from : s.view } })),
  setQuery: (query) => set({ query }),

  async loadReleases(force = false, ids) {
    const { catalog, platform } = get();
    if (!platform) return;
    const apps = catalog.filter(
      (a) => a.platforms.includes(platform.os) && (!ids || ids.includes(a.id)),
    );
    set((s) => {
      const releases = { ...s.releases };
      for (const a of apps) if (force || !releases[a.id] || releases[a.id].status === "error") releases[a.id] = { status: "loading" };
      return { releases };
    });
    await Promise.all(
      apps.map(async (a) => {
        let entry: Loadable<ReleaseInfo>;
        try {
          entry = { status: "ok", data: await api.latestRelease(toRef(a, platform.os), force) };
        } catch (e) {
          entry = { status: "error", error: errText(e) };
        }
        set((s) => ({ releases: { ...s.releases, [a.id]: entry } }));
      }),
    );
  },

  async refreshInstalled() {
    const { catalog, platform } = get();
    if (!platform) return;
    const installed = await api.installed(catalog.map((a) => toRef(a, platform.os)));
    set({ installed });
  },

  async install(id) {
    const { catalog, platform, installed } = get();
    const app = catalog.find((a) => a.id === id);
    if (!app || !platform || get().tasks[id]) return;
    const updating = !!installed[id];
    set((s) => ({ tasks: { ...s.tasks, [id]: { phase: "preparing", received: 0, total: 0 } } }));
    try {
      const entry = await api.install(toRef(app, platform.os));
      set((s) => ({ installed: { ...s.installed, [id]: entry } }));
      get().toast("success", updating ? `${app.name} updated to ${entry.version}` : `${app.name} is ready`);
    } catch (e) {
      get().toast("error", `${app.name}: ${errText(e)}`);
    } finally {
      set((s) => {
        const tasks = { ...s.tasks };
        delete tasks[id];
        return { tasks };
      });
    }
  },

  async uninstall(id) {
    const { catalog, platform } = get();
    const app = catalog.find((a) => a.id === id);
    if (!app || !platform) return;
    set((s) => ({ tasks: { ...s.tasks, [id]: { phase: "uninstalling", received: 0, total: 0 } } }));
    try {
      await api.uninstall(toRef(app, platform.os));
      set((s) => {
        const installed = { ...s.installed };
        delete installed[id];
        return { installed };
      });
      get().toast("info", `${app.name} removed`);
    } catch (e) {
      get().toast("error", errText(e));
    } finally {
      set((s) => {
        const tasks = { ...s.tasks };
        delete tasks[id];
        return { tasks };
      });
    }
  },

  async launch(id) {
    try {
      await api.launch(id);
    } catch (e) {
      get().toast("error", errText(e));
    }
  },

  async reveal(id) {
    try {
      await api.reveal(id);
    } catch (e) {
      get().toast("error", errText(e));
    }
  },

  async checkUpdates({ auto = false, refresh = true } = {}) {
    if (get().checking) return;
    set({ checking: true });
    try {
      if (refresh) {
        await get().refreshInstalled();
        await get().loadReleases(true);
      }
      set({ lastChecked: Date.now() });
      await get().checkSelf(auto);
      if (auto && get().settings?.autoUpdate) {
        // Only replace apps Appetizer installed itself; found-on-disk apps get an Update button.
        for (const id of pendingUpdates(get()).filter((id) => get().installed[id]?.managed)) {
          await get().install(id);
        }
      }
    } finally {
      set({ checking: false });
    }
  },

  async checkSelf(auto) {
    const { platform, selfUpdate, settings } = get();
    if (!platform || (selfUpdate && selfUpdate.state !== "available")) return;
    try {
      const found = await checkSelfUpdate(platform.version);
      set({ selfUpdate: found });
      // Windows installers close the app, so only install silently on macOS / Linux.
      if (found && !found.url && auto && settings?.autoUpdate && platform.os !== "windows") {
        await get().applySelfUpdate();
      }
    } catch {
      /* offline or no release yet */
    }
  },

  async applySelfUpdate() {
    const u = get().selfUpdate;
    if (!u) return;
    if (u.url) return void api.openUrl(u.url);
    if (u.state === "ready") return void restart();
    if (u.state === "downloading") return;
    set({ selfUpdate: { ...u, state: "downloading", progress: null } });
    try {
      await installSelfUpdate((progress) => set((s) => ({ selfUpdate: s.selfUpdate && { ...s.selfUpdate, progress } })));
      set((s) => ({ selfUpdate: s.selfUpdate && { ...s.selfUpdate, state: "ready", progress: 1 } }));
    } catch (e) {
      set({ selfUpdate: { ...u, state: "available" } });
      get().toast("error", `Appetizer update failed: ${errText(e)}`);
    }
  },

  async updateAll() {
    for (const id of pendingUpdates(get())) await get().install(id);
  },

  async saveSettings(patch) {
    const current = get().settings;
    if (!current) return;
    try {
      const settings = await api.saveSettings({ ...current, ...patch });
      set({ settings });
    } catch (e) {
      get().toast("error", errText(e));
    }
  },

  toast(kind, text) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Ids of installed apps whose latest stable release is newer than what's on disk. */
export function pendingUpdates(s: Pick<State, "installed" | "releases">): string[] {
  return Object.values(s.installed)
    .filter((i) => {
      const r = s.releases[i.id];
      return r?.status === "ok" && !!r.data.asset && !!i.version && isNewer(r.data.version, i.version);
    })
    .map((i) => i.id);
}

export type AppStatus =
  | { kind: "busy"; task: Task }
  | { kind: "update"; release: ReleaseInfo; installed: InstalledApp }
  | { kind: "installed"; installed: InstalledApp }
  | { kind: "available"; release: ReleaseInfo }
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string };

export function appStatus(s: State, app: CatalogApp): AppStatus {
  const task = s.tasks[app.id];
  if (task) return { kind: "busy", task };
  const installed = s.installed[app.id];
  const rel = s.releases[app.id];
  if (s.platform && !app.platforms.includes(s.platform.os)) {
    return installed ? { kind: "installed", installed } : { kind: "unavailable", reason: "Not for this platform" };
  }
  if (installed) {
    if (rel?.status === "ok" && rel.data.asset && installed.version && isNewer(rel.data.version, installed.version)) {
      return { kind: "update", release: rel.data, installed };
    }
    return { kind: "installed", installed };
  }
  if (!rel || rel.status === "loading") return { kind: "loading" };
  if (rel.status === "error") return { kind: "unavailable", reason: rel.error };
  if (!rel.data.asset) return { kind: "unavailable", reason: "No download for this platform yet" };
  return { kind: "available", release: rel.data };
}
