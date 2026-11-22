import { api, LAUNCHER_REPO } from "../lib/api";
import { useStore } from "../store";
import { osLabel } from "../components/PlatformBadges";

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? "toggle--on" : ""}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function Row({ title, text, children }: { title: string; text?: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div>
        <h3>{title}</h3>
        {text && <p>{text}</p>}
      </div>
      <div className="setting__control">{children}</div>
    </div>
  );
}

export function Settings() {
  const settings = useStore((s) => s.settings);
  const platform = useStore((s) => s.platform);
  const source = useStore((s) => s.catalogSource);
  const count = useStore((s) => s.catalog.length);
  const save = useStore((s) => s.saveSettings);
  if (!settings) return null;

  return (
    <div className="page page--narrow">
      <header className="page__head">
        <h1>Settings</h1>
      </header>

      <h2 className="section-title">Updates</h2>
      <div className="settings">
        <Row title="Update apps automatically" text="Install new stable releases in the background as soon as they're out.">
          <Toggle label="Update apps automatically" checked={settings.autoUpdate} onChange={(v) => save({ autoUpdate: v })} />
        </Row>
        <Row title="Check for updates" text="How often Appetizer looks for new releases on GitHub.">
          <select value={settings.checkIntervalHours} onChange={(e) => save({ checkIntervalHours: Number(e.target.value) })}>
            <option value={1}>Every hour</option>
            <option value={6}>Every 6 hours</option>
            <option value={12}>Every 12 hours</option>
            <option value={24}>Once a day</option>
          </select>
        </Row>
        <Row title="Open apps after installing">
          <Toggle label="Open apps after installing" checked={settings.launchAfterInstall} onChange={(v) => save({ launchAfterInstall: v })} />
        </Row>
      </div>

      <h2 className="section-title">Catalog</h2>
      <div className="settings">
        <Row title="Catalog source" text={source === "remote" ? `${count} apps loaded from the online catalog.` : `Using the built-in catalog (${count} apps). The online catalog couldn't be reached.`}>
          <span className={`pill ${source === "remote" ? "pill--ok" : ""}`}>{source === "remote" ? "Online" : "Built-in"}</span>
        </Row>
        <div className="setting setting--stack">
          <div>
            <h3>Catalog URL</h3>
            <p>A JSON file listing the apps. Point it at your own fork to curate a different set. Applies on next launch.</p>
          </div>
          <input
            className="text-input"
            defaultValue={settings.catalogUrl}
            spellCheck={false}
            onBlur={(e) => e.target.value.startsWith("https://") && e.target.value !== settings.catalogUrl && save({ catalogUrl: e.target.value })}
          />
        </div>
      </div>

      <h2 className="section-title">About</h2>
      <div className="settings">
        <Row title={`Appetizer ${platform?.version ?? ""}`} text={platform ? `${osLabel(platform.os)} · ${platform.arch}` : undefined}>
          <button className="btn btn--ghost" onClick={() => api.openUrl(`https://github.com/${LAUNCHER_REPO}`)}>Source code</button>
        </Row>
      </div>
    </div>
  );
}
