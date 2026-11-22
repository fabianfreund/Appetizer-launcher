import { useShallow } from "zustand/react/shallow";
import { appStatus, useStore, type AppStatus } from "../store";
import type { CatalogApp } from "../lib/types";

export function useAppStatus(app: CatalogApp): AppStatus {
  return useStore(useShallow((s) => appStatus(s, app)));
}

function Ring({ value }: { value: number | null }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`ring ${value === null ? "ring--spin" : ""}`} width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <circle cx="11" cy="11" r={r} className="ring__track" />
      <circle
        cx="11"
        cy="11"
        r={r}
        className="ring__value"
        strokeDasharray={c}
        strokeDashoffset={value === null ? c * 0.7 : c * (1 - value)}
      />
    </svg>
  );
}

const busyLabel = { preparing: "Preparing", downloading: "", installing: "Installing", uninstalling: "Removing", done: "" };

/** Get / progress / Update / Open, depending on the app's state. */
export function ActionButton({ app, size = "md" }: { app: CatalogApp; size?: "md" | "lg" }) {
  const status = useAppStatus(app);
  const { install, launch } = useStore.getState();
  const cls = `action action--${size}`;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  switch (status.kind) {
    case "loading":
      return <span className={`${cls} action--ghost shimmer`} aria-label="Loading" />;
    case "busy": {
      const { phase, received, total } = status.task;
      const pct = phase === "downloading" && total > 0 ? received / total : null;
      return (
        <span className={`${cls} action--busy`} onClick={stop} role="status">
          <Ring value={pct} />
          <span>{pct !== null ? `${Math.round(pct * 100)}%` : busyLabel[phase]}</span>
        </span>
      );
    }
    case "update":
      return (
        <button className={`${cls} action--primary`} onClick={(e) => (stop(e), install(app.id))}>
          Update
        </button>
      );
    case "installed":
      return (
        <button className={`${cls} action--soft`} onClick={(e) => (stop(e), launch(app.id))}>
          Open
        </button>
      );
    case "available":
      return (
        <button className={`${cls} action--soft action--get`} onClick={(e) => (stop(e), install(app.id))}>
          Get
        </button>
      );
    case "unavailable":
      return (
        <span className={`${cls} action--disabled`} title={status.reason} onClick={stop}>
          {status.reason.startsWith("No stable release") ? "Soon" : "Unavailable"}
        </span>
      );
  }
}
