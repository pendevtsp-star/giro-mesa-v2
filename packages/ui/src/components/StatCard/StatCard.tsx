import type { ReactNode } from "react";
import { Icon, type IconName } from "../Icon/Icon";
import "./StatCard.css";

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
    <div className="gm-stat-card">
      <div className="gm-stat-card__header">
        <span className="gm-stat-card__title">{title}</span>
        {icon && (
          <span className="gm-stat-card__icon">
            <Icon name={icon} size={18} />
          </span>
        )}
      </div>
      <div className="gm-stat-card__value">{value}</div>
      {(trend || footer) && (
        <div className="gm-stat-card__footer">
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
