import type { ReactNode } from "react";

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return (
    <span className="gm-sr-only" data-slot="visually-hidden">
      {children}
    </span>
  );
}
