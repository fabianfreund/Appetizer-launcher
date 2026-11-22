import { useStore } from "../store";
import { IconCheck, IconX } from "./Icons";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === "success" ? <IconCheck size={16} /> : t.kind === "error" ? <IconX size={16} /> : null}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
