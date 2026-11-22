import { useStore } from "../store";
import type { CatalogApp } from "../lib/types";
import { ActionButton, useAppStatus } from "./ActionButton";
import { AppIcon } from "./AppIcon";
import { PlatformBadges } from "./PlatformBadges";

export function AppCard({ app }: { app: CatalogApp }) {
  const openApp = useStore((s) => s.openApp);
  const status = useAppStatus(app);
  return (
    <article
      className="card"
      tabIndex={0}
      onClick={() => openApp(app.id)}
      onKeyDown={(e) => e.key === "Enter" && openApp(app.id)}
      style={{ "--accent": app.accent ?? "var(--brand)" } as React.CSSProperties}
    >
      <AppIcon app={app} size={60} />
      <div className="card__body">
        <div className="card__title">
          <h3>{app.name}</h3>
          {status.kind === "update" && <span className="dot" title="Update available" />}
        </div>
        <p className="card__tagline">{app.tagline}</p>
        <div className="card__meta">
          <span className="chip">{app.category}</span>
          <PlatformBadges platforms={app.platforms} />
        </div>
      </div>
      <div className="card__action">
        <ActionButton app={app} />
      </div>
    </article>
  );
}

export function AppRow({ app }: { app: CatalogApp }) {
  const openApp = useStore((s) => s.openApp);
  const status = useAppStatus(app);
  const installed = useStore((s) => s.installed[app.id]);
  return (
    <div className="row" onClick={() => openApp(app.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && openApp(app.id)}>
      <AppIcon app={app} size={44} />
      <div className="row__body">
        <h3>{app.name}</h3>
        <p>
          {installed?.version ? `Version ${installed.version}` : "Installed"}
          {status.kind === "update" && <span className="row__new"> → {status.release.version}</span>}
          {installed && !installed.managed && <span className="row__muted"> · found on this computer</span>}
        </p>
      </div>
      <ActionButton app={app} />
    </div>
  );
}
