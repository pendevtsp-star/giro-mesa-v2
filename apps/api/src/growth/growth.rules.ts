import { createHash } from "node:crypto";

export const reservationTransitions = {
  booked: ["confirmed", "canceled", "no_show"],
  confirmed: ["seated", "canceled", "no_show"],
  seated: ["completed"],
  completed: [],
  canceled: [],
  no_show: [],
} as const;

export const waitlistTransitions = {
  waiting: ["notified", "seated", "left", "canceled", "no_show"],
  notified: ["seated", "left", "canceled", "no_show"],
  seated: [],
  left: [],
  canceled: [],
  no_show: [],
} as const;

export const deliveryTransitions = {
  draft: ["placed", "canceled"],
  placed: ["confirmed", "canceled"],
  confirmed: ["preparing", "canceled"],
  preparing: ["ready", "canceled"],
  ready: ["dispatched", "completed", "canceled"],
  dispatched: ["completed", "canceled"],
  completed: [],
  canceled: [],
} as const;

export const transferTransitions = {
  draft: ["in_transit", "canceled"],
  in_transit: ["received", "canceled"],
  received: [],
  canceled: [],
} as const;

export function canTransition<T extends Record<string, readonly string[]>>(
  machine: T,
  from: keyof T,
  to: string,
) {
  return (machine[from] as readonly string[] | undefined)?.includes(to) ?? false;
}

export const marketingOptInAfter = (decision: "granted" | "withdrawn") => decision === "granted";

export function assertSameOrganization(expected: string, actual: string) {
  if (expected !== actual) throw new Error("CROSS_TENANT_RESOURCE");
}

function sortJson(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  return value;
}

export const payloadFingerprint = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(sortJson(value)))
    .digest("hex");

export function loyaltyEarn(
  mode: "points" | "cashback",
  rate: number,
  totalCents: number,
  minimumOrderCents: number,
) {
  if (totalCents < minimumOrderCents) return 0;
  return mode === "points"
    ? Math.floor((totalCents / 100) * rate)
    : Math.floor((totalCents * rate) / 100);
}

export function couponDiscount(
  coupon: {
    type: "fixed" | "percentage";
    value: number;
    minimumOrderCents: number;
    maximumDiscountCents: number | null;
  },
  totalCents: number,
) {
  if (totalCents < coupon.minimumOrderCents) return 0;
  const raw =
    coupon.type === "fixed" ? coupon.value : Math.floor((totalCents * coupon.value) / 10_000);
  return Math.min(totalCents, raw, coupon.maximumDiscountCents ?? raw);
}

export const hashOpaqueSecret = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
