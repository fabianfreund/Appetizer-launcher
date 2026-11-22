import type { OS } from "../lib/types";
import { IconApple, IconLinux, IconWindows } from "./Icons";

const meta: Record<OS, { label: string; Icon: typeof IconApple }> = {
  macos: { label: "macOS", Icon: IconApple },
  windows: { label: "Windows", Icon: IconWindows },
  linux: { label: "Linux", Icon: IconLinux },
};

export function PlatformBadges({ platforms, labels = false }: { platforms: OS[]; labels?: boolean }) {
  return (
    <span className="platforms">
      {platforms.map((p) => {
        const { label, Icon } = meta[p];
        return (
          <span key={p} className="platform" title={label}>
            <Icon size={12} />
            {labels && <span>{label}</span>}
          </span>
        );
      })}
    </span>
  );
}

export const osLabel = (os: OS) => meta[os].label;
