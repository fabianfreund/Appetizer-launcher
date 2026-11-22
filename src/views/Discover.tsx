import { useMemo } from "react";
import { ActionButton } from "../components/ActionButton";
import { AppCard } from "../components/AppCard";
import { AppIcon } from "../components/AppIcon";
import { IconGithub } from "../components/Icons";
import { PlatformBadges } from "../components/PlatformBadges";
import { api } from "../lib/api";
import type { CatalogApp } from "../lib/types";
import { useStore } from "../store";

function Hero({ app }: { app: CatalogApp }) {
  const openApp = useStore((s) => s.openApp);
  return (
    <section
      className="hero"
      onClick={() => openApp(app.id)}
      style={{ "--accent": app.accent ?? "var(--brand)" } as React.CSSProperties}
    >
      <div className="hero__glow" />
      <div className="hero__content">
        <span className="eyebrow">Featured</span>
        <h2>{app.name}</h2>
        <p>{app.tagline}</p>
        {app.highlights && (
          <ul className="hero__highlights">
            {app.highlights.slice(0, 4).map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
        <div className="hero__actions">
          <ActionButton app={app} size="lg" />
          <PlatformBadges platforms={app.platforms} labels />
        </div>
      </div>
      <div className="hero__art">
        <AppIcon app={app} size={148} />
      </div>
    </section>
  );
}

export function Grid({ apps, empty }: { apps: CatalogApp[]; empty?: React.ReactNode }) {
  if (!apps.length) return <>{empty}</>;
  return (
    <div className="grid">
      {apps.map((a) => (
        <AppCard key={a.id} app={a} />
      ))}
    </div>
  );
}

function ComingSoon() {
  return (
    <div className="card card--invite" onClick={() => api.openUrl("https://github.com/fabianfreund/Appetizer-launcher")}>
      <div className="invite__icon">
        <IconGithub size={24} />
      </div>
      <div className="card__body">
        <h3>More apps on the way</h3>
        <p className="card__tagline">Every app is its own open-source repo. Want yours here? Add it to the catalog.</p>
      </div>
    </div>
  );
}

export function Discover() {
  const catalog = useStore((s) => s.catalog);
  const os = useStore((s) => s.platform?.os);
  const featured = useMemo(() => catalog.find((a) => a.featured && (!os || a.platforms.includes(os))) ?? catalog[0], [catalog, os]);
  const forYou = catalog.filter((a) => !os || a.platforms.includes(os));
  const elsewhere = catalog.filter((a) => os && !a.platforms.includes(os));

  return (
    <div className="page">
      <header className="page__head">
        <h1>Discover</h1>
        <p>Hand-picked, free and open-source utilities. Always the latest stable release.</p>
      </header>
      {featured && <Hero app={featured} />}
      <h2 className="section-title">All apps</h2>
      <div className="grid">
        {forYou.map((a) => (
          <AppCard key={a.id} app={a} />
        ))}
        <ComingSoon />
      </div>
      {elsewhere.length > 0 && (
        <>
          <h2 className="section-title">On other platforms</h2>
          <Grid apps={elsewhere} />
        </>
      )}
    </div>
  );
}

export function Category({ name }: { name: string }) {
  const apps = useStore((s) => s.catalog).filter((a) => a.category === name);
  return (
    <div className="page">
      <header className="page__head">
        <h1>{name}</h1>
        <p>{apps.length} {apps.length === 1 ? "app" : "apps"}</p>
      </header>
      <Grid apps={apps} />
    </div>
  );
}

export function SearchResults({ query }: { query: string }) {
  const catalog = useStore((s) => s.catalog);
  const q = query.trim().toLowerCase();
  const apps = catalog.filter((a) =>
    [a.name, a.tagline, a.category, a.description].some((f) => f?.toLowerCase().includes(q)),
  );
  return (
    <div className="page">
      <header className="page__head">
        <h1>Results for “{query.trim()}”</h1>
      </header>
      <Grid apps={apps} empty={<div className="empty"><p>No apps match your search.</p></div>} />
    </div>
  );
}
