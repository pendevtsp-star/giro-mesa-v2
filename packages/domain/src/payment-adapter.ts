export const paymentAdapterStatuses = ["authorized", "declined", "unknown"] as const;
export type PaymentAdapterStatus = (typeof paymentAdapterStatuses)[number];

export type PaymentAdapterRequest = Readonly<{
  attemptId: string;
  idempotencyKey: string;
  amountCents: number;
  method: string;
  terminalReference?: string;
}>;

export type PaymentAdapterResult = Readonly<{
  status: PaymentAdapterStatus;
  amountCents?: number;
  providerReference?: string;
  errorCode?: string;
}>;

export type NormalizedPaymentResult = PaymentAdapterResult &
  Readonly<{
    reviewRequired: boolean;
    nextAction: "none" | "lookup_or_reconcile";
  }>;

export interface PaymentProviderAdapter {
  readonly name: string;
  execute(request: PaymentAdapterRequest): Promise<PaymentAdapterResult>;
  lookup(providerReference: string): Promise<PaymentAdapterResult>;
  verifyCallback(signature: string | undefined, payload: unknown): boolean | Promise<boolean>;
}

const sensitiveKeys =
  /(?:^|_)(?:pan|cvv|cvc|track1|track2|track_data|pin|password|secret|credential|api_key)(?:$|_)/i;
const cardNumberLike = /(?:^|\D)(?:\d[ -]?){13,19}(?:$|\D)/;

export function assertSafePaymentPayload<T>(payload: T): T {
  const visit = (value: unknown, path: string) => {
    if (typeof value === "string" && cardNumberLike.test(value)) {
      throw new TypeError(`Sensitive payment data is forbidden at ${path}.`);
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        visit(entry, `${path}[${index}]`);
      });
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = key.replaceAll(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
      if (sensitiveKeys.test(normalizedKey)) {
        throw new TypeError(`Sensitive payment data is forbidden at ${path}.${key}.`);
      }
      visit(entry, `${path}.${key}`);
    }
  };
  visit(payload, "payment");
  return payload;
}

function assertIntegerCents(value: number | undefined) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new TypeError("Payment amounts must use positive integer cents.");
  }
}

export function normalizeAdapterResult(result: PaymentAdapterResult): NormalizedPaymentResult {
  if (!paymentAdapterStatuses.includes(result.status)) {
    throw new TypeError("Payment adapter returned an unsupported status.");
  }
  assertIntegerCents(result.amountCents);
  assertSafePaymentPayload(result);
  const unknown = result.status === "unknown";
  return Object.freeze({
    ...result,
    reviewRequired: unknown,
    nextAction: unknown ? "lookup_or_reconcile" : "none",
  });
}

export function canStartPaymentAttempt(
  attempts: readonly { status: string; amountCents: number }[],
  amountCents: number,
) {
  assertIntegerCents(amountCents);
  return !attempts.some(
    (attempt) =>
      attempt.amountCents === amountCents &&
      (attempt.status === "unknown" || attempt.status === "processing"),
  );
}
