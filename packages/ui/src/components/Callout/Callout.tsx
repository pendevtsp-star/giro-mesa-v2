import type { ReactNode } from "react";

export function Callout({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <div className={`gm-callout gm-callout--${tone}`} data-slot="alert">
      {children}
    </div>
  );
}
