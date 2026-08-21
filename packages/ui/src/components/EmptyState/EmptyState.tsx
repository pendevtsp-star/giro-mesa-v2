import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string | ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="gm-empty" data-slot="empty">
      <span aria-hidden="true" className="gm-empty__icon">
        {icon}
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}
