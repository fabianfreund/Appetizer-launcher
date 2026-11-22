import { useStore } from "../store";
import { api } from "../lib/api";
import { IconChevronLeft, IconCoffee, IconRefresh, IconSearch } from "./Icons";

const SUPPORT_URL = "https://buymeacoffee.com/fabianbuilds";

export function Topbar() {
  const view = useStore((s) => s.view);
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const setView = useStore((s) => s.setView);
  const checking = useStore((s) => s.checking);
  const checkUpdates = useStore((s) => s.checkUpdates);

  return (
    <header className="topbar" data-tauri-drag-region>
      {view.kind === "app" ? (
        <button className="icon-btn back" onClick={() => setView(view.from)} aria-label="Back">
          <IconChevronLeft />
          <span>Back</span>
        </button>
      ) : (
        <label className="search">
          <IconSearch size={16} />
          <input
            placeholder="Search apps"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            spellCheck={false}
          />
        </label>
      )}
      <div className="topbar__spacer" data-tauri-drag-region />
      <button className="pill-btn" onClick={() => api.openUrl(SUPPORT_URL)} title="Support Appetizer">
        <IconCoffee size={16} />
        <span>Buy me a coffee</span>
      </button>
      <button
        className={`circle-btn ${checking ? "spinning" : ""}`}
        onClick={() => checkUpdates()}
        title="Check for updates"
        aria-label="Check for updates"
      >
        <IconRefresh size={16} />
      </button>
    </header>
  );
}
