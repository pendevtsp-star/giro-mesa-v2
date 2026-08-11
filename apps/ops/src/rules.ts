import type { CartItem, Permission, Profile, RouteId, TicketStatus } from "./domain";

export const routePermissions: Record<RouteId, Permission> = {
  dashboard: "dashboard.view",
  onboarding: "onboarding.manage",
  salon: "salon.operate",
  counter: "counter.operate",
  catalog: "catalog.manage",
  kds: "kds.operate",
  cash: "cash.operate",
  inventory: "inventory.manage",
  purchases: "purchases.manage",
  finance: "finance.manage",
  people: "people.manage",
  delivery: "delivery.operate",
  reservations: "reservations.manage",
  crm: "growth.manage",
  multiunit: "multiunit.view",
  platform: "platform.manage",
  alerts: "alerts.view",
};

export function canAccess(profile: Profile, route: RouteId): boolean {
  return profile.permissions.includes(routePermissions[route]);
}

export function calculateCartTotal(items: CartItem[]): number {
  return items.reduce(
    (total, item) =>
      total + (item.unitPriceCents + (item.modifier?.priceCents ?? 0)) * item.quantity,
    0,
  );
}

export function nextTicketStatus(status: TicketStatus): TicketStatus {
  if (status === "new") return "preparing";
  if (status === "preparing") return "ready";
  return "ready";
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function isValidTerminalPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}
