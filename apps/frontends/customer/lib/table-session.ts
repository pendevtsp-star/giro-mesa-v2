import type { CartItem } from "./menu";

type UnknownRecord = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cents(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

export type TableSession = {
  status: "awaiting_tab" | "active";
  tableLabel: string;
  activeTab: boolean;
  expiresAt: string;
};

export function readPresenceChallenge(payload: unknown) {
  const value = record(payload);
  if (value?.code !== "PUBLIC_TABLE_PRESENCE_CODE_REQUIRED") return null;
  return {
    tableLabel: text(value.tableLabel) ?? "Mesa",
    message: text(value.message) ?? "Informe o código de presença do estabelecimento.",
  };
}

export function readTableSession(payload: unknown): TableSession | null {
  const value = record(payload);
  const tableLabel = text(value?.tableLabel);
  const expiresAt = text(value?.expiresAt);
  const status = value?.status;
  if (
    !value ||
    (status !== "awaiting_tab" && status !== "active") ||
    !tableLabel ||
    typeof value.activeTab !== "boolean" ||
    value.activeTab !== (status === "active") ||
    !expiresAt ||
    !Number.isFinite(Date.parse(expiresAt))
  ) {
    return null;
  }
  return { status, tableLabel, activeTab: value.activeTab, expiresAt };
}

export function tableSessionCapabilities(activeTab: boolean) {
  return {
    callWaiter: true,
    requestCheck: activeTab,
    viewConsumption: activeTab,
    placeOrder: activeTab,
  };
}

export function isTableOrderId(value: string | null): value is string {
  return Boolean(value && uuidPattern.test(value));
}

export type TableConsumption = {
  status: "open";
  tableLabel: string;
  items: Array<{
    name: string;
    quantity: number;
    totalCents: number;
  }>;
  subtotalCents: number;
  totalCents: number;
};

export function readTableConsumption(payload: unknown): TableConsumption | null {
  const value = record(payload);
  const tableLabel = text(value?.tableLabel);
  if (value?.status !== "open" || !tableLabel || !Array.isArray(value.items)) {
    return null;
  }
  const items = value.items.flatMap((candidate) => {
    const item = record(candidate);
    const name = text(item?.name);
    const quantity = item?.quantity;
    const totalCents = cents(item?.totalCents);
    return name && Number.isSafeInteger(quantity) && (quantity as number) > 0 && totalCents !== null
      ? [{ name, quantity: quantity as number, totalCents }]
      : [];
  });
  if (items.length !== value.items.length) return null;
  const subtotalCents = cents(value.subtotalCents);
  const totalCents = cents(value.totalCents);
  if (subtotalCents === null || totalCents === null) {
    return null;
  }
  return {
    status: value.status,
    tableLabel,
    items,
    subtotalCents,
    totalCents,
  };
}

export type TableOrder = {
  orderId: string;
  status: "draft" | "sent" | "canceled" | "preparing" | "ready" | "served";
  items: Array<{ name: string; quantity: number; totalCents: number }>;
  totalCents: number;
};

export function readTableOrder(payload: unknown): TableOrder | null {
  const value = record(payload);
  const orderId = text(value?.orderId);
  if (
    !value ||
    !orderId ||
    (value.status !== "draft" &&
      value.status !== "sent" &&
      value.status !== "canceled" &&
      value.status !== "preparing" &&
      value.status !== "ready" &&
      value.status !== "served") ||
    !Array.isArray(value.items)
  ) {
    return null;
  }
  const items = value.items.flatMap((candidate) => {
    const item = record(candidate);
    const name = text(item?.name);
    const quantity = item?.quantity;
    const totalCents = cents(item?.totalCents);
    return name && Number.isSafeInteger(quantity) && (quantity as number) > 0 && totalCents !== null
      ? [{ name, quantity: quantity as number, totalCents }]
      : [];
  });
  const totalCents = cents(value.totalCents);
  if (items.length !== value.items.length || totalCents === null) return null;
  return {
    orderId,
    status: value.status,
    items,
    totalCents,
  };
}

export function tableOrderLines(cart: CartItem[]) {
  return cart.map((line) => ({
    productId: line.item.id,
    quantity: line.quantity,
    modifierOptionIds: line.modifiers.map((modifier) => modifier.id),
    ...(line.notes ? { notes: line.notes } : {}),
  }));
}

export type PublicRequestFailure =
  | "session"
  | "conflict"
  | "rate_limit"
  | "unavailable"
  | "invalid";

export function classifyPublicFailure(status: number): PublicRequestFailure {
  if (status === 401 || status === 403) return "session";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "unavailable";
  return "invalid";
}
