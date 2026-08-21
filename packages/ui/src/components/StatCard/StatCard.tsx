import type { ReactNode } from "react";
import { Icon, type IconName } from "../Icon/Icon";

export function StatCard({
  title,
  value,
  icon,
  trend,
  trendDirection = "up",
  footer,
}: {
  title: string;
  value: string | number;
  icon?: IconName;
  trend?: string;
  trendDirection?: "up" | "down";
  footer?: ReactNode;
}) {
  return (
    <div className="gm-stat-card" data-slot="card">
      <div className="gm-stat-card__header" data-slot="card-header">
        <span className="gm-stat-card__title" data-slot="card-title">
          {title}
        </span>
        {icon && (
          <span className="gm-stat-card__icon">
            <Icon name={icon} size={18} />
          </span>
        )}
      </div>
      <div className="gm-stat-card__value" data-slot="card-content">
        {value}
      </div>
      {(trend || footer) && (
        <div className="gm-stat-card__footer" data-slot="card-footer">
          {trend && (
            <span className={`gm-stat-card__trend gm-stat-card__trend--${trendDirection}`}>
              {trendDirection === "up" ? "↑" : "↓"} {trend}
            </span>
          )}
          {footer && <span>{footer}</span>}
        </div>
      )}
    </div>
  );
}
