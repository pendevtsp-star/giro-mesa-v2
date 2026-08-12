export function isCommandAccepted(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "acknowledged" in payload &&
    payload.acknowledged === true
  );
}

export function normalizeOptOutToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return token.length >= 32 && token.length <= 256 ? token : null;
}

export function isPublicSubmissionAccepted(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "accepted" in payload &&
    payload.accepted === true
  );
}

export function readCouponValidation(
  payload: unknown,
): { valid: false } | { valid: true; discountCents: number } | null {
  if (typeof payload !== "object" || payload === null || !("valid" in payload)) return null;
  if (payload.valid === false) return { valid: false };
  if (
    payload.valid === true &&
    "discountCents" in payload &&
    Number.isInteger(payload.discountCents) &&
    (payload.discountCents as number) > 0
  ) {
    return { valid: true, discountCents: payload.discountCents as number };
  }
  return null;
}

export type MutationAttempt = { body: string; key: string };

export interface PublicTableSession {
  token: string;
  expiresAt: string;
  capabilities: Array<"call_waiter" | "request_bill" | "view_partial">;
}

export function readTableSession(payload: unknown): PublicTableSession | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.token !== "string" ||
    value.token.length < 40 ||
    typeof value.expiresAt !== "string" ||
    !Array.isArray(value.capabilities)
  ) {
    return null;
  }
  const capabilities = value.capabilities.filter(
    (item): item is PublicTableSession["capabilities"][number] =>
      item === "call_waiter" || item === "request_bill" || item === "view_partial",
  );
  if (capabilities.length !== value.capabilities.length) return null;
  return { token: value.token, expiresAt: value.expiresAt, capabilities };
}

export interface PublicTablePartial {
  occupancyId: string;
  tab: { id: string; totalCents: number };
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    netCents: number;
    status: string;
  }>;
}

export function readTablePartial(payload: unknown): PublicTablePartial | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  const tab = value.tab as Record<string, unknown> | undefined;
  if (
    typeof value.occupancyId !== "string" ||
    !tab ||
    typeof tab.id !== "string" ||
    !Number.isInteger(tab.totalCents) ||
    !Array.isArray(value.items)
  )
    return null;
  const items = value.items.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    return typeof item.id === "string" &&
      typeof item.productName === "string" &&
      Number.isInteger(item.quantity) &&
      Number.isInteger(item.netCents) &&
      typeof item.status === "string"
      ? [
          {
            id: item.id,
            productName: item.productName,
            quantity: item.quantity as number,
            netCents: item.netCents as number,
            status: item.status,
          },
        ]
      : [];
  });
  if (items.length !== value.items.length) return null;
  return {
    occupancyId: value.occupancyId,
    tab: { id: tab.id, totalCents: tab.totalCents as number },
    items,
  };
}

export function resolveMutationAttempt(
  current: MutationAttempt | null,
  body: string,
  createKey: () => string,
): MutationAttempt {
  return current?.body === body ? current : { body, key: createKey() };
}
