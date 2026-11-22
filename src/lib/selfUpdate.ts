// Appetizer updating itself via the Tauri updater (signed builds from GitHub Releases).
import { api, isTauri, LAUNCHER_REPO } from "./api";
import { isNewer } from "./version";

export interface SelfUpdate {
  version: string;
  state: "available" | "downloading" | "ready";
  progress: number | null;
  /** Browser/dev fallback: a release page to open instead. */
  url?: string;
}

type Update = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;
let pending: Update = null;

export async function checkSelfUpdate(currentVersion: string): Promise<SelfUpdate | null> {
  if (!isTauri) {
    const r = await api.latestRelease({ id: "appetizer", name: "Appetizer", repo: LAUNCHER_REPO, patterns: [] });
    return isNewer(r.version, currentVersion) ? { version: r.version, state: "available", progress: null, url: r.htmlUrl } : null;
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  pending = await check();
  return pending ? { version: pending.version, state: "available", progress: null } : null;
}

/**
 * Downloads and installs. On Windows the installer closes the app itself.
 * Returns false when the re-check finds no update any more (nothing was installed).
 */
export async function installSelfUpdate(onProgress: (p: number | null) => void): Promise<boolean> {
  // Re-check right before installing so the signature always matches the file that's
  // published now (a release asset may have been replaced since the last check).
  const { check } = await import("@tauri-apps/plugin-updater");
  pending = await check();
  if (!pending) return false;
  let total = 0;
  let got = 0;
  await pending.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data.contentLength ?? 0;
    if (e.event === "Progress") {
      got += e.data.chunkLength;
      onProgress(total ? got / total : null);
    }
  });
  return true;
}

export async function restart(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
