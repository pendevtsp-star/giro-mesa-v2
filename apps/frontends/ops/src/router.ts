import type { RouteId } from "./domain";

export const routeIds: RouteId[] = [
  "dashboard",
  "salon",
  "counter",
  "catalog",
  "kds",
  "cash",
  "inventory",
  "purchases",
  "finance",
  "reports",
  "fiscal",
  "accountant",
  "people",
  "delivery",
  "reservations",
  "crm",
  "multiunit",
  "platform",
  "alerts",
];

export function parseRoute(hash: string): RouteId {
  const value = hash.replace(/^#\/?/, "").split("/")[0];
  return routeIds.includes(value as RouteId) ? (value as RouteId) : "dashboard";
}

export function routeHref(route: RouteId): string {
  return `#/${route}`;
}
