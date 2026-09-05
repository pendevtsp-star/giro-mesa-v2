export type ProfileId =
  | "owner"
  | "manager"
  | "waiter"
  | "cashier"
  | "receptionist"
  | "busser"
  | "kitchen"
  | "inventory"
  | "finance"
  | "delivery"
  | "accountant"
  | "platform";

export type Permission =
  | "dashboard.view"
  | "salon.operate"
  | "counter.operate"
  | "catalog.manage"
  | "kds.operate"
  | "cash.operate"
  | "inventory.manage"
  | "purchases.manage"
  | "finance.manage"
  | "fiscal.manage"
  | "accounting.view"
  | "people.manage"
  | "people.view"
  | "settlements.view"
  | "delivery.operate"
  | "reservations.manage"
  | "growth.manage"
  | "multiunit.view"
  | "billing.manage"
  | "settings.manage"
  | "platform.manage";

export type RouteId =
  | "dashboard"
  | "salon"
  | "counter"
  | "catalog"
  | "table-qrs"
  | "kds"
  | "cash"
  | "inventory"
  | "purchases"
  | "finance"
  | "reports"
  | "fiscal"
  | "accountant"
  | "people"
  | "waiter-settlements"
  | "delivery"
  | "reservations"
  | "crm"
  | "multiunit"
  | "billing"
  | "settings"
  | "platform"
  | "device";

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
  branding?: {
    displayName?: string;
    logoUrl?: string | null;
    primaryColor?: string;
  };
}

export type TableStatus =
  | "free"
  | "occupied"
  | "attention"
  | "closing"
  | "reserved"
  | "needs_cleaning"
  | "cleaning";

export interface DiningTable {
  id: string;
  name: string;
  seats: number;
  status: TableStatus;
  server?: string;
  totalCents?: number;
  openedMinutes?: number;
  area: string;
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
  sourceTable?: string;
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
  tableId?: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  action: string;
}
