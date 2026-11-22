export type OS = "macos" | "windows" | "linux";

export interface CatalogApp {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** GitHub "owner/name". Stable releases are pulled from here. */
  repo: string;
  category: string;
  platforms: OS[];
  icon?: string;
  accent?: string;
  featured?: boolean;
  highlights?: string[];
  /** Per-OS regexes matched against release asset names, in order of preference. */
  assets?: Partial<Record<OS, string[]>>;
}

export interface Catalog {
  schema: number;
  apps: CatalogApp[];
}

export interface Asset {
  name: string;
  url: string;
  size: number;
}

export interface ReleaseInfo {
  tag: string;
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  htmlUrl: string;
  assets: Asset[];
  asset: Asset | null;
}

export interface InstalledApp {
  id: string;
  version: string;
  path: string;
  kind: string;
  installedAt: number;
  assetName: string;
  managed: boolean;
}

export interface Settings {
  autoUpdate: boolean;
  checkIntervalHours: number;
  launchAfterInstall: boolean;
  catalogUrl: string;
}

export interface PlatformInfo {
  os: OS;
  arch: string;
  version: string;
}

export type Phase = "preparing" | "downloading" | "installing" | "uninstalling" | "done";

export interface Progress {
  id: string;
  phase: Phase;
  received: number;
  total: number;
}

export interface AppRef {
  id: string;
  name: string;
  repo: string;
  patterns: string[];
}
