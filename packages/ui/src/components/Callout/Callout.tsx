import type { ReactNode } from "react";
import "./Callout.css";

export function Callout({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return <div className={`gm-callout gm-callout--${tone}`}>{children}</div>;
}
