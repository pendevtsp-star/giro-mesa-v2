export type ProfileId =
  | "owner"
  | "manager"
  | "waiter"
  | "cashier"
  | "kitchen"
  | "inventory"
  | "finance"
  | "delivery"
  | "platform";

export type Permission =
  | "dashboard.view"
  | "onboarding.manage"
  | "salon.operate"
  | "counter.operate"
  | "catalog.manage"
  | "kds.operate"
  | "cash.operate"
  | "inventory.manage"
  | "purchases.manage"
  | "finance.manage"
  | "remuneration.manage"
  | "people.manage"
  | "delivery.operate"
  | "reservations.manage"
  | "growth.manage"
  | "multiunit.view"
  | "platform.manage"
  | "alerts.view";

export type RouteId =
  | "dashboard"
  | "onboarding"
  | "salon"
  | "counter"
  | "catalog"
  | "kds"
  | "cash"
  | "inventory"
  | "purchases"
  | "finance"
  | "remuneration"
  | "people"
  | "delivery"
  | "reservations"
  | "crm"
  | "multiunit"
  | "platform"
  | "alerts";

export interface Profile {
  id: ProfileId;
  name: string;
  shortName: string;
  role: string;
  description: string;
  permissions: Permission[];
}

export interface Organization {
  id: string;
  name: string;
  document: string;
  units: Unit[];
}

export interface Unit {
  id: string;
  name: string;
  city?: string;
  timezone: string;
}

export type TableStatus = "free" | "occupied" | "attention" | "closing" | "reserved";

export interface DiningTable {
  id: string;
  name: string;
  seats: number;
  status: TableStatus;
  server?: string;
  totalCents?: number;
  openedMinutes?: number;
  area: "Salão principal" | "Varanda" | "Balcão";
}

export interface ProductModifier {
  id: string;
  name: string;
  priceCents: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  prepMinutes: number;
  available: boolean;
  modifiers: ProductModifier[];
}

export interface CartItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  modifier?: ProductModifier;
  note?: string;
}

export type TicketStatus = "new" | "preparing" | "ready";

export interface KitchenTicket {
  id: string;
  reference: string;
  station: "Cozinha" | "Bar";
  items: string[];
  elapsedMinutes: number;
  status: TicketStatus;
  priority?: boolean;
}

export interface StockItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  minimum: number;
  costCents: number;
  supplier: string;
}

export interface AlertItem {
  id: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  action: string;
}
