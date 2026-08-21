import type { ReactNode } from "react";

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
    <div
      className={`gm-app-shell ${sidebarOpen ? "" : "gm-app-shell--collapsed"}`}
      data-slot="sidebar-wrapper"
    >
      <aside className="gm-app-shell__sidebar" data-slot="sidebar">
        {sidebar}
      </aside>
      <div className="gm-app-shell__main" data-slot="sidebar-inset">
        <header className="gm-app-shell__topbar" data-slot="app-header">
          {topbar}
        </header>
        <main className="gm-app-shell__content" data-slot="app-content">
          {children}
        </main>
      </div>
    </div>
  );
}
