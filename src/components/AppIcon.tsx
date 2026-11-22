import { useState } from "react";
import type { CatalogApp } from "../lib/types";

/** The app's icon from the catalog, or a tinted monogram tile while it's missing. */
export function AppIcon({ app, size = 56 }: { app: CatalogApp; size?: number }) {
  const [failed, setFailed] = useState(false);
  const accent = app.accent ?? "#FF6A3D";
  const style = { width: size, height: size, borderRadius: size * 0.235, "--accent": accent } as React.CSSProperties;
  if (app.icon && !failed) {
    return <img className="app-icon" src={app.icon} alt="" style={style} onError={() => setFailed(true)} draggable={false} />;
  }
  return (
    <div className="app-icon app-icon--mono" style={style} aria-hidden>
      <span style={{ fontSize: size * 0.46 }}>{app.name.slice(0, 1)}</span>
    </div>
  );
}
