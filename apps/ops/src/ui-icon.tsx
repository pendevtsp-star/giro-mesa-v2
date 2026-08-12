import type { ReactNode, SVGProps } from "react";

export const iconNames = [
  "alert",
  "arrow-right",
  "brand",
  "cash",
  "catalog",
  "chevron-down",
  "clock",
  "close",
  "counter",
  "crm",
  "dashboard",
  "delivery",
  "finance",
  "help",
  "info",
  "inventory",
  "kds",
  "list",
  "location",
  "mail",
  "menu",
  "multiunit",
  "people",
  "platform",
  "plus",
  "purchases",
  "reservations",
  "salon",
  "success",
] as const;

export type UiIconName = (typeof iconNames)[number];

function iconContent(name: UiIconName): ReactNode {
  switch (name) {
    case "alert":
      return (
        <>
          <path d="M12 3 2.8 19h18.4L12 3Z" />
          <path d="M12 8v5" />
          <path d="M12 17h.01" />
        </>
      );
    case "arrow-right":
      return (
        <>
          <path d="M5 12h14" />
          <path d="m14 7 5 5-5 5" />
        </>
      );
    case "brand":
      return (
        <>
          <path d="M7 6.5h6a4 4 0 0 1 0 8H9" />
          <path d="M7 6.5v11" />
          <path d="M7 17.5h8" />
        </>
      );
    case "cash":
      return (
        <>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M7 10h.01M17 14h.01" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      );
    case "catalog":
      return (
        <>
          <path d="M5 4h11a3 3 0 0 1 3 3v13H7a2 2 0 0 1-2-2V4Z" />
          <path d="M7 16h12M9 8h6M9 11h4" />
        </>
      );
    case "chevron-down":
      return <path d="m7 9.5 5 5 5-5" />;
    case "clock":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3 2" />
        </>
      );
    case "close":
      return (
        <>
          <path d="m6.5 6.5 11 11" />
          <path d="m17.5 6.5-11 11" />
        </>
      );
    case "counter":
      return (
        <>
          <path d="M4 10h16l-1 9H5l-1-9Z" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M9 14h6" />
        </>
      );
    case "crm":
      return <path d="M20 8.5c0 5-8 10-8 10s-8-5-8-10a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8Z" />;
    case "dashboard":
      return (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      );
    case "delivery":
      return (
        <>
          <path d="M3 7h11v10H3V7ZM14 10h4l3 3v4h-7v-7Z" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="18" cy="18" r="2" />
        </>
      );
    case "finance":
      return (
        <>
          <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
          <path d="m4 7 6-4 6 6 5-5" />
        </>
      );
    case "help":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.7 9a2.5 2.5 0 1 1 3.1 2.4c-.8.3-.8 1-.8 1.6" />
          <path d="M12 17h.01" />
        </>
      );
    case "info":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7h.01" />
        </>
      );
    case "inventory":
      return (
        <>
          <path d="m4 8 8-4 8 4-8 4-8-4Z" />
          <path d="m4 8 8 4 8-4v8l-8 4-8-4V8Z" />
        </>
      );
    case "kds":
      return (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </>
      );
    case "list":
      return (
        <>
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
        </>
      );
    case "location":
      return (
        <>
          <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="2.5" />
        </>
      );
    case "mail":
      return (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m4 7 8 6 8-6" />
        </>
      );
    case "menu":
      return <path d="M4 7h16M4 12h16M4 17h16" />;
    case "multiunit":
      return (
        <>
          <rect x="3" y="5" width="7" height="14" rx="1" />
          <rect x="14" y="3" width="7" height="16" rx="1" />
          <path d="M6 9h1M6 13h1M17 7h1M17 11h1M17 15h1" />
        </>
      );
    case "people":
      return (
        <>
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M3.5 20a5.5 5.5 0 0 1 11 0M14 15a5 5 0 0 1 6.5 5" />
        </>
      );
    case "platform":
      return (
        <>
          <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
          <path d="m4 7 8 4 8-4M12 11v10" />
        </>
      );
    case "plus":
      return <path d="M12 5v14M5 12h14" />;
    case "purchases":
      return (
        <>
          <path d="M4 6h2l2 10h9l2-7H7" />
          <circle cx="10" cy="20" r="1" />
          <circle cx="17" cy="20" r="1" />
        </>
      );
    case "reservations":
      return (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 10h18" />
          <path d="m8 15 2 2 5-5" />
        </>
      );
    case "salon":
      return (
        <>
          <path d="M4 10h16M6 10v9M18 10v9M8 6h8v4H8V6Z" />
          <path d="M4 19h16" />
        </>
      );
    case "success":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.5 2.5L16 9" />
        </>
      );
  }
}

export function UiIcon({ name, ...props }: { name: UiIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="20"
      {...props}
    >
      {iconContent(name)}
    </svg>
  );
}
