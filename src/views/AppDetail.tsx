import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, useState } from "react";
import { ActionButton } from "../components/ActionButton";
import { AppIcon } from "../components/AppIcon";
import { IconExternal, IconFolder, IconGithub, IconTrash } from "../components/Icons";
import { PlatformBadges } from "../components/PlatformBadges";
import { api } from "../lib/api";
import { formatBytes, formatDate } from "../lib/version";
import { useStore } from "../store";

function Notes({ markdown }: { markdown: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(markdown, { async: false, gfm: true }) as string),
    [markdown],
  );
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (a?.href.startsWith("https://")) {
      e.preventDefault();
      api.openUrl(a.href);
    }
  };
  return <div className="notes" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function AppDetail({ id }: { id: string }) {
  const app = useStore((s) => s.catalog.find((a) => a.id === id));
  const release = useStore((s) => s.releases[id]);
  const installed = useStore((s) => s.installed[id]);
  const busy = useStore((s) => !!s.tasks[id]);
  const os = useStore((s) => s.platform?.os);
  const { uninstall, reveal, launch } = useStore.getState();
  const [confirm, setConfirm] = useState(false);

  if (!app) return <div className="page"><div className="empty"><p>This app is no longer in the catalog.</p></div></div>;

  const rel = release?.status === "ok" ? release.data : null;
  const repoUrl = `https://github.com/${app.repo}`;
  const fileManager = os === "macos" ? "Finder" : os === "windows" ? "Explorer" : "Files";

  return (
    <div className="page detail" style={{ "--accent": app.accent ?? "var(--brand)" } as React.CSSProperties}>
      <section className="detail__head">
        <div className="detail__glow" />
        <AppIcon app={app} size={128} />
        <div className="detail__title">
          <span className="eyebrow">{app.category}</span>
          <h1>{app.name}</h1>
          <p>{app.tagline}</p>
          <div className="detail__actions">
            <ActionButton app={app} size="lg" />
            {installed && !busy && (
              <button className="btn btn--ghost" onClick={() => reveal(id)}>
                <IconFolder size={16} /> Show in {fileManager}
              </button>
            )}
          </div>
        </div>
      </section>

      <dl className="facts">
        <div>
          <dt>Latest</dt>
          <dd>{rel ? rel.version : release?.status === "loading" ? "…" : "—"}</dd>
        </div>
        <div>
          <dt>Installed</dt>
          <dd>{installed ? installed.version || "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>Released</dt>
          <dd>{rel ? formatDate(rel.publishedAt) : "—"}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{rel?.asset ? formatBytes(rel.asset.size) : "—"}</dd>
        </div>
        <div>
          <dt>Platforms</dt>
          <dd><PlatformBadges platforms={app.platforms} /></dd>
        </div>
        <div>
          <dt>License</dt>
          <dd>Open source</dd>
        </div>
      </dl>

      <div className="detail__cols">
        <div className="detail__main">
          <h2 className="section-title">About</h2>
          <p className="detail__desc">{app.description}</p>
          {app.highlights && (
            <ul className="highlights">
              {app.highlights.map((h) => <li key={h}>{h}</li>)}
            </ul>
          )}

          <h2 className="section-title">What’s new</h2>
          {rel ? (
            <div className="whatsnew">
              <div className="whatsnew__head">
                <strong>{rel.name}</strong>
                <span>{formatDate(rel.publishedAt)}</span>
              </div>
              {rel.notes.trim() ? <Notes markdown={rel.notes} /> : <p className="muted">No release notes.</p>}
            </div>
          ) : release?.status === "error" ? (
            <p className="muted">{release.error}</p>
          ) : (
            <div className="shimmer shimmer--block" />
          )}
        </div>

        <aside className="detail__side">
          <div className="panel">
            <button className="link" onClick={() => api.openUrl(repoUrl)}>
              <IconGithub size={16} /> <span>{app.repo}</span> <IconExternal size={14} />
            </button>
            {rel && (
              <button className="link" onClick={() => api.openUrl(rel.htmlUrl)}>
                <IconExternal size={16} /> <span>Release on GitHub</span>
              </button>
            )}
            {rel?.asset && <p className="panel__file" title={rel.asset.name}>{rel.asset.name}</p>}
          </div>

          {installed && (
            <div className="panel">
              <p className="panel__label">Installed at</p>
              <p className="panel__path" title={installed.path}>{installed.path || "—"}</p>
              {!installed.managed && <p className="panel__hint">Found on this computer. Appetizer will keep it updated once you update it here.</p>}
              <div className="panel__actions">
                <button className="btn btn--ghost" onClick={() => launch(id)} disabled={busy}>Open</button>
                {confirm ? (
                  <button className="btn btn--danger" onClick={() => (setConfirm(false), uninstall(id))} disabled={busy}>
                    Confirm remove
                  </button>
                ) : (
                  <button className="btn btn--ghost btn--danger-text" onClick={() => setConfirm(true)} disabled={busy}>
                    <IconTrash size={15} /> Uninstall
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
