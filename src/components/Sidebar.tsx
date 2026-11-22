import { useMemo } from "react";
import { pendingUpdates, useStore, type View } from "../store";
import { IconArrowDownCircle, IconGear, IconGrid, IconSparkle } from "./Icons";

function NavItem({ view, label, icon, badge }: { view: View; label: string; icon: React.ReactNode; badge?: number }) {
  const current = useStore((s) => (s.view.kind === "app" ? s.view.from : s.view));
  const setView = useStore((s) => s.setView);
  const active =
    current.kind === view.kind && (view.kind !== "category" || (current.kind === "category" && current.name === view.name));
  return (
    <button className={`nav ${active ? "nav--active" : ""}`} onClick={() => setView(view)}>
      <span className="nav__icon">{icon}</span>
      <span className="nav__label">{label}</span>
      {!!badge && <span className="nav__badge">{badge}</span>}
    </button>
  );
}

function Brand({ size }: { size: number }) {
  return (
    <div className="brand" data-tauri-drag-region>
      <img src="/logo.svg" alt="" width={size} height={size} data-tauri-drag-region />
      <span data-tauri-drag-region>Appetizer</span>
    </div>
  );
}

export function Sidebar() {
  const catalog = useStore((s) => s.catalog);
  const installedCount = useStore((s) => Object.keys(s.installed).length);
  const updates = useStore((s) => pendingUpdates(s).length);
  const selfUpdate = useStore((s) => s.selfUpdate);
  const applySelfUpdate = useStore((s) => s.applySelfUpdate);
  const version = useStore((s) => s.platform?.version);
  const mac = useStore((s) => s.platform?.os === "macos");
  const categories = useMemo(() => [...new Set(catalog.map((a) => a.category))].sort(), [catalog]);

  return (
    <aside className={`sidebar ${mac ? "sidebar--mac" : ""}`}>
      {/* On macOS the brand sits in the title bar, right of the traffic lights. */}
      <div className="sidebar__drag" data-tauri-drag-region>
        {mac && <Brand size={22} />}
      </div>
      {!mac && <Brand size={30} />}

      <nav className="sidebar__nav">
        <NavItem view={{ kind: "discover" }} label="Discover" icon={<IconSparkle />} />
        <NavItem view={{ kind: "installed" }} label="My Apps" icon={<IconGrid />} badge={installedCount || undefined} />
        <NavItem view={{ kind: "updates" }} label="Updates" icon={<IconArrowDownCircle />} badge={updates || undefined} />

        {categories.length > 0 && <div className="sidebar__section">Categories</div>}
        {categories.map((c) => (
          <NavItem key={c} view={{ kind: "category", name: c }} label={c} icon={<span className="cat-dot" />} />
        ))}
      </nav>

      <div className="sidebar__foot">
        {selfUpdate && (
          <button className="self-update" onClick={applySelfUpdate} disabled={selfUpdate.state === "downloading"}>
            <strong>Appetizer {selfUpdate.version}</strong>
            <span>
              {selfUpdate.state === "ready"
                ? "is ready. Restart to finish"
                : selfUpdate.state === "downloading"
                  ? `Downloading${selfUpdate.progress != null ? ` ${Math.round(selfUpdate.progress * 100)}%` : "…"}`
                  : selfUpdate.url
                    ? "is available. Download"
                    : "is available. Install"}
            </span>
          </button>
        )}
        <NavItem view={{ kind: "settings" }} label="Settings" icon={<IconGear />} />
        <div className="sidebar__version">v{version ?? "…"} · free & open source</div>
      </div>
    </aside>
  );
}
