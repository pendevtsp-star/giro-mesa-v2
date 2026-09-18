export type OrderPriceChange = {
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
};

export function readOrderPriceChange(value: unknown): OrderPriceChange | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.code !== "PUBLIC_ORDER_PRICE_CHANGED") return null;
  const { subtotalCents, deliveryFeeCents, totalCents } = row;
  if (
    typeof subtotalCents !== "number" ||
    !Number.isSafeInteger(subtotalCents) ||
    subtotalCents < 0 ||
    typeof deliveryFeeCents !== "number" ||
    !Number.isSafeInteger(deliveryFeeCents) ||
    deliveryFeeCents < 0 ||
    typeof totalCents !== "number" ||
    !Number.isSafeInteger(totalCents) ||
    totalCents !== subtotalCents + deliveryFeeCents
  )
    return null;
  return { subtotalCents, deliveryFeeCents, totalCents };
}
