import type { ReactNode } from "react";
import "./AppShell.css";

export function AppShell({
  sidebar,
  topbar,
  children,
  sidebarOpen = true,
}: {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
  sidebarOpen?: boolean;
}) {
  return (
    <div className={`gm-app-shell ${sidebarOpen ? "" : "gm-app-shell--collapsed"}`}>
      <aside className="gm-app-shell__sidebar">{sidebar}</aside>
      <div className="gm-app-shell__main">
        <header className="gm-app-shell__topbar">{topbar}</header>
        <main className="gm-app-shell__content">{children}</main>
      </div>
    </div>
  );
}
