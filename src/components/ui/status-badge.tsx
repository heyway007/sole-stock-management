import type { PropsWithChildren } from "react";

export function StatusBadge({ children, tone = "neutral" }: PropsWithChildren<{ tone?: "neutral" | "success" | "warning" | "danger" }>) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}
