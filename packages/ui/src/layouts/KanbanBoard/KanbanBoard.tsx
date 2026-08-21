import type { CSSProperties, ReactNode } from "react";

export function KanbanBoard({ children, columns = 3 }: { children: ReactNode; columns?: number }) {
  return (
    <div
      className="gm-kanban-board"
      data-slot="kanban-board"
      style={{ "--gm-kanban-columns": `repeat(${columns}, 1fr)` } as CSSProperties}
    >
      {children}
    </div>
  );
}

export function KanbanColumn({
  title,
  count,
  children,
  className = "",
}: {
  title: string;
  count?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`gm-kanban-column ${className}`} data-slot="kanban-column">
      <header className="gm-kanban-column__header" data-slot="kanban-column-header">
        <h2>{title}</h2>
        {typeof count === "number" && <span className="gm-kanban-column__count">{count}</span>}
      </header>
      <div className="gm-kanban-column__body" data-slot="kanban-column-content">
        {children}
      </div>
    </div>
  );
}
