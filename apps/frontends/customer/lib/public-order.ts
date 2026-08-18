import type { CartItem } from "./menu";

export type PublicOrderOptions = {
  fulfillment: { pickup: boolean; delivery: boolean };
  deliveryZones: Array<{ name: string; feeCents: number; minimumOrderCents: number }>;
  payment: {
    method: "pay_on_fulfillment";
    status: "awaiting_payment";
    label: string;
  };
};

export type PublicOrderReceipt = {
  protocol: string;
  status: "placed";
  fulfillment: "pickup" | "delivery";
  payment: { method: "pay_on_fulfillment"; status: "awaiting_payment" };
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function integer(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

export function readPublicOrderOptions(value: unknown): PublicOrderOptions | null {
  const payload = record(value);
  const fulfillment = record(payload?.fulfillment);
  const payment = record(payload?.payment);
  if (
    !payload ||
    !fulfillment ||
    typeof fulfillment.pickup !== "boolean" ||
    typeof fulfillment.delivery !== "boolean" ||
    !Array.isArray(payload.deliveryZones) ||
    !payment ||
    payment.method !== "pay_on_fulfillment" ||
    payment.status !== "awaiting_payment" ||
    typeof payment.label !== "string"
  ) {
    return null;
  }
  const zones = payload.deliveryZones.flatMap((value) => {
    const zone = record(value);
    const feeCents = integer(zone?.feeCents);
    const minimumOrderCents = integer(zone?.minimumOrderCents);
    return zone && typeof zone.name === "string" && feeCents !== null && minimumOrderCents !== null
      ? [{ name: zone.name, feeCents, minimumOrderCents }]
      : [];
  });
  if (zones.length !== payload.deliveryZones.length) return null;
  return {
    fulfillment: { pickup: fulfillment.pickup, delivery: fulfillment.delivery },
    deliveryZones: zones,
    payment: {
      method: "pay_on_fulfillment",
      status: "awaiting_payment",
      label: payment.label,
    },
  };
}

export function readPublicOrderReceipt(value: unknown): PublicOrderReceipt | null {
  const payload = record(value);
  const payment = record(payload?.payment);
  const subtotalCents = integer(payload?.subtotalCents);
  const deliveryFeeCents = integer(payload?.deliveryFeeCents);
  const totalCents = integer(payload?.totalCents);
  if (
    !payload ||
    typeof payload.protocol !== "string" ||
    !/^GM-\d{8}-[A-Z0-9]{10}$/.test(payload.protocol) ||
    payload.status !== "placed" ||
    (payload.fulfillment !== "pickup" && payload.fulfillment !== "delivery") ||
    !payment ||
    payment.method !== "pay_on_fulfillment" ||
    payment.status !== "awaiting_payment" ||
    subtotalCents === null ||
    deliveryFeeCents === null ||
    totalCents === null ||
    subtotalCents + deliveryFeeCents !== totalCents
  ) {
    return null;
  }
  return {
    protocol: payload.protocol,
    status: "placed",
    fulfillment: payload.fulfillment,
    payment: { method: "pay_on_fulfillment", status: "awaiting_payment" },
    subtotalCents,
    deliveryFeeCents,
    totalCents,
  };
}

export function publicOrderLines(cart: CartItem[]) {
  return cart.map((line) => ({
    productId: line.item.id,
    quantity: line.quantity,
    modifierOptionIds: line.modifiers.map((modifier) => modifier.id),
    ...(line.notes ? { notes: line.notes } : {}),
  }));
}
