import { useEffect, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { Topbar } from "./components/Topbar";
import { useStore } from "./store";
import { AppDetail } from "./views/AppDetail";
import { Category, Discover, SearchResults } from "./views/Discover";
import { MyApps, Updates } from "./views/Library";
import { Settings } from "./views/Settings";

function Main() {
  const view = useStore((s) => s.view);
  const query = useStore((s) => s.query);
  if (query.trim() && view.kind !== "app" && view.kind !== "settings") return <SearchResults query={query} />;
  switch (view.kind) {
    case "discover":
      return <Discover />;
    case "installed":
      return <MyApps />;
    case "updates":
      return <Updates />;
    case "settings":
      return <Settings />;
    case "category":
      return <Category name={view.name} />;
    case "app":
      return <AppDetail id={view.id} />;
  }
}

export function App() {
  const ready = useStore((s) => !!s.settings);
  const interval = useStore((s) => s.settings?.checkIntervalHours ?? 6);
  const viewKey = useStore((s) => (s.view.kind === "app" ? `app:${s.view.id}` : s.view.kind === "category" ? `cat:${s.view.name}` : s.view.kind));
  const scroller = useRef<HTMLElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const { init, checkUpdates, toast } = useStore.getState();
    init()
      .then(() => checkUpdates({ auto: true, refresh: false }))
      .catch((e) => toast("error", String(e)));
  }, []);

  // Background update checks.
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => useStore.getState().checkUpdates({ auto: true }), interval * 3_600_000);
    return () => clearInterval(t);
  }, [ready, interval]);

  useEffect(() => scroller.current?.scrollTo({ top: 0 }), [viewKey]);

  return (
    <div className="shell">
      <Sidebar />
      <main className="main" ref={scroller}>
        <Topbar />
        <div className="main__content" key={viewKey}>
          {ready ? <Main /> : null}
        </div>
      </main>
      <Toasts />
    </div>
  );
}
