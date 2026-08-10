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

export function resolveMutationAttempt(
  current: MutationAttempt | null,
  body: string,
  createKey: () => string,
): MutationAttempt {
  return current?.body === body ? current : { body, key: createKey() };
}
