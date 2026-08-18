import type { ReactNode } from "react";
import "./Badge.css";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return <span className={`gm-badge gm-badge--${tone}`}>{children}</span>;
}
