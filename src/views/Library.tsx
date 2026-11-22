import { AppRow } from "../components/AppCard";
import { IconArrowDownCircle, IconGrid } from "../components/Icons";
import { timeAgo } from "../lib/version";
import { pendingUpdates, useStore } from "../store";

function Empty({ icon, title, text, cta }: { icon: React.ReactNode; title: string; text: string; cta?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {cta}
    </div>
  );
}

export function MyApps() {
  const catalog = useStore((s) => s.catalog);
  const installed = useStore((s) => s.installed);
  const setView = useStore((s) => s.setView);
  const apps = catalog.filter((a) => installed[a.id]);
  return (
    <div className="page">
      <header className="page__head">
        <h1>My Apps</h1>
        <p>Everything you installed with Appetizer.</p>
      </header>
      {apps.length ? (
        <div className="list">{apps.map((a) => <AppRow key={a.id} app={a} />)}</div>
      ) : (
        <Empty
          icon={<IconGrid size={26} />}
          title="Nothing installed yet"
          text="Pick something tasty from Discover. It installs in one click."
          cta={<button className="btn" onClick={() => setView({ kind: "discover" })}>Browse apps</button>}
        />
      )}
    </div>
  );
}

export function Updates() {
  const catalog = useStore((s) => s.catalog);
  const ids = useStore((s) => pendingUpdates(s).join(","));
  const lastChecked = useStore((s) => s.lastChecked);
  const checking = useStore((s) => s.checking);
  const autoUpdate = useStore((s) => s.settings?.autoUpdate);
  const { updateAll, checkUpdates } = useStore.getState();
  const apps = catalog.filter((a) => ids.split(",").includes(a.id));

  return (
    <div className="page">
      <header className="page__head page__head--row">
        <div>
          <h1>Updates</h1>
          <p>
            {checking ? "Checking…" : lastChecked ? `Checked ${timeAgo(lastChecked)}` : "Not checked yet"}
            {" · "}
            {autoUpdate ? "Automatic updates are on" : "Automatic updates are off"}
          </p>
        </div>
        {apps.length > 1 && <button className="btn btn--primary" onClick={() => updateAll()}>Update all</button>}
      </header>
      {apps.length ? (
        <div className="list">{apps.map((a) => <AppRow key={a.id} app={a} />)}</div>
      ) : (
        <Empty
          icon={<IconArrowDownCircle size={26} />}
          title="You're all up to date"
          text="New stable releases show up here as soon as they're published on GitHub."
          cta={<button className="btn" onClick={() => checkUpdates()} disabled={checking}>Check now</button>}
        />
      )}
    </div>
  );
}
