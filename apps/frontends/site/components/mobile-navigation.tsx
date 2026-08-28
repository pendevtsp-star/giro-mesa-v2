"use client";

import { type ReactNode, useRef } from "react";

export function MobileNavigation({ children }: { children: ReactNode }) {
  const disclosure = useRef<HTMLDetailsElement>(null);

  return (
    <details
      className="mobile-nav"
      ref={disclosure}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a") && disclosure.current) {
          disclosure.current.open = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && disclosure.current?.open) {
          disclosure.current.open = false;
          disclosure.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="button button-outline">Menu</summary>
      <nav aria-label="Navegação móvel">{children}</nav>
    </details>
  );
}
