import { useState } from "react";
import type { CatalogApp } from "../lib/types";

/**
 * App icons are full macOS-style images (rounded square with transparent padding, 1024px),
 * so they're shown uncropped. Without an icon, a monogram tile with the same padding is drawn.
 */
export function AppIcon({ app, size = 56 }: { app: CatalogApp; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, "--accent": app.accent ?? "#FF6A3D" } as React.CSSProperties;
  if (app.icon && !failed) {
    return <img className="app-icon" src={app.icon} alt="" style={style} onError={() => setFailed(true)} draggable={false} />;
  }
  const tile = size * 0.84;
  return (
    <div className="app-icon" style={style} aria-hidden>
      <div className="app-icon__tile" style={{ width: tile, height: tile, borderRadius: tile * 0.23, fontSize: tile * 0.5 }}>
        {app.name.slice(0, 1)}
      </div>
    </div>
  );
}
