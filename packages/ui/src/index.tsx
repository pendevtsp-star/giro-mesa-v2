import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export const ICON_NAMES = [
  "alert",
  "arrow-left",
  "arrow-right",
  "arrow-down",
  "arrow-up",
  "bell",
  "box",
  "building",
  "burger",
  "calendar",
  "cart",
  "check",
  "chevron-down",
  "clipboard",
  "clock",
  "close",
  "counter",
  "currency",
  "dessert",
  "dish",
  "droplet",
  "fish",
  "glass",
  "heart",
  "help",
  "home",
  "info",
  "kitchen",
  "layers",
  "leaf",
  "list",
  "mail",
  "menu",
  "minus",
  "package",
  "pin",
  "platform",
  "plus",
  "receipt",
  "search",
  "shield",
  "sparkles",
  "steak",
  "target",
  "trend-up",
  "truck",
  "user",
  "users",
  "wallet",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const ICON_PATHS: Record<IconName, string> = {
  alert: "M12 3 2.8 20h18.4L12 3Zm0 6v4.5m0 3.5h.01",
  "arrow-left": "m14.5 5-7 7 7 7M8 12h11",
  "arrow-right": "m9.5 5 7 7-7 7m6.5-7H5",
  "arrow-down": "m5 9 7 7 7-7m-7 7V4",
  "arrow-up": "m5 15 7-7 7 7m-7-7v12",
  bell: "M6 9a6 6 0 0 1 12 0c0 7 3 7 3 7H3s3 0 3-7Zm4 11h4",
  box: "m4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7m-8 4v10",
  building: "M4 21V5l8-3 8 3v16M8 8h1m6 0h1M8 12h1m6 0h1M8 16h1m6 0h1m-5 5v-4h2v4",
  burger: "M4 11h16M5 8c1-5 13-5 14 0M4 15h16m-14 0v1c0 2 1 3 3 3h6c2 0 3-1 3-3v-1",
  calendar: "M4 5h16v16H4V5Zm0 5h16M8 3v4m8-4v4",
  cart: "M3 4h2l2 11h10l3-7H6m2 11h.01M17 19h.01",
  check: "m5 12 4 4L19 6",
  "chevron-down": "m5 9 7 7 7-7",
  clipboard: "M7 5H5v16h14V5h-2M9 3h6v4H9V3Zm1 9 2 2 4-4m-6 8h6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2",
  close: "M5 5l14 14M19 5 5 19",
  counter: "M4 9h16v11H4V9Zm2-5h12l2 5H4l2-5Zm3 9h6",
  currency:
    "M12 3v18m4-14.5c-1-1-2.2-1.5-4-1.5-2.2 0-4 1.2-4 3s1.8 2.7 4 3 4 1.2 4 3-1.8 3-4 3c-1.8 0-3.2-.5-4-1.5",
  dessert: "M5 10h14l-2 10H7L5 10Zm2-3c1-3 9-3 10 0H7Zm5-2V3",
  dish: "M4 15h16M6 15a6 6 0 0 1 12 0M3 19h18M12 7V5",
  droplet: "M12 3s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12Z",
  fish: "M4 12c4-5 10-5 14 0-4 5-10 5-14 0Zm14 0 3-3v6l-3-3Zm-9-1h.01",
  glass: "M6 4h12l-2 8a4 4 0 0 1-8 0L6 4Zm6 12v5m-4 0h8",
  heart: "M12 20S4 15 4 9a4 4 0 0 1 7-2l1 2 1-2a4 4 0 0 1 7 2c0 6-8 11-8 11Z",
  help: "M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.7.3-.7 1-.7 1.6m0 4h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  home: "m3 11 9-8 9 8M5 10v11h14V10m-9 11v-6h4v6",
  info: "M12 11v6m0-10h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  kitchen: "M4 5h16v12H4V5Zm3 16h10M8 9h3m2 0h3m-8 4h8",
  layers: "m12 3 9 5-9 5-9-5 9-5Zm9 10-9 5-9-5m18 5-9 5-9-5",
  leaf: "M20 4C11 4 5 8 5 15c0 3 2 5 5 5 7 0 10-8 10-16ZM5 20c3-5 7-8 12-10",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  mail: "M3 5h18v14H3V5Zm0 1 9 7 9-7",
  menu: "M4 7h16M4 12h16M4 17h16",
  minus: "M5 12h14",
  package: "M5 8h14l-1 13H6L5 8Zm3 0a4 4 0 0 1 8 0",
  pin: "M12 22s7-6 7-13a7 7 0 1 0-14 0c0 7 7 13 7 13Zm0-10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  platform:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z",
  plus: "M12 5v14M5 12h14",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h4",
  search: "m20 20-4.5-4.5M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  shield: "M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-4-10 3 3 5-6",
  sparkles:
    "m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Zm6 11 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z",
  steak: "M5 7c3-4 12-4 14 2 2 7-5 12-11 10-5-2-6-8-3-12Zm7 3c2-2 5-1 5 2s-4 5-6 3c-1-1-1-3 1-5Z",
  target:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  "trend-up": "m4 17 6-6 4 4 6-8m-5 0h5v5",
  truck:
    "M3 6h11v11H3V6Zm11 4h4l3 3v4h-7v-7ZM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
  users:
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 10a7 7 0 0 1 14 0m1-17a4 4 0 0 1 0 7m0 3a7 7 0 0 1 5 7",
  wallet: "M3 6h16v14H3V6Zm0 0 13-3v3m0 5h5v5h-5a2.5 2.5 0 0 1 0-5Z",
};

export function Icon({
  name,
  label,
  className = "",
}: {
  name: IconName;
  label?: string;
  className?: string;
}) {
  return (
    <svg
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={`gm-icon ${className}`}
      fill="none"
      focusable="false"
      role={label ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      height={24}
      width={24}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({
  className = "",
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`gm-button gm-button--${variant} gm-button--${size} ${className}`}
      type={type}
      {...props}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return <span className={`gm-badge gm-badge--${tone}`}>{children}</span>;
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`gm-card ${className}`} {...props} />;
}

export function Progress({ value, label }: { value: number; label: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="gm-progress">
      <div className="gm-progress__meta">
        <span>{label}</span>
        <span>{bounded}%</span>
      </div>
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={bounded}
        className="gm-progress__track"
        role="progressbar"
      >
        <span style={{ width: `${bounded}%` }} />
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="gm-empty">
      <span aria-hidden="true" className="gm-empty__icon">
        {icon}
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="gm-sr-only">{children}</span>;
}
