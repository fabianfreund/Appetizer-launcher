// Mirrors github::is_newer in Rust: semver-ish compare with a string fallback.
export function normalizeVersion(tag: string): string {
  const t = tag.trim();
  const tail = t.split(/[@/]/).pop() ?? t;
  return tail.replace(/^v/i, "");
}

function parse(v: string): { core: number[]; pre: string } | null {
  const m = normalizeVersion(v).match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  if (!m) return null;
  const core = m[1].split(".").map(Number);
  while (core.length < 3) core.push(0);
  return { core: core.slice(0, 3), pre: m[2] ?? "" };
}

export function isNewer(latest: string, current: string): boolean {
  const l = parse(latest);
  const c = parse(current);
  if (!l || !c) return normalizeVersion(latest) !== normalizeVersion(current);
  for (let i = 0; i < 3; i++) if (l.core[i] !== c.core[i]) return l.core[i] > c.core[i];
  if (l.pre === c.pre) return false;
  if (!l.pre) return true; // 1.0.0 > 1.0.0-beta
  if (!c.pre) return false;
  return l.pre.localeCompare(c.pre, undefined, { numeric: true }) > 0;
}

export function formatBytes(n: number): string {
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(+d) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
