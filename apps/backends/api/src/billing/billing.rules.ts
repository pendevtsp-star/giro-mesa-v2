import { ConflictException } from "@nestjs/common";

export const UPGRADE_QUOTE_MINUTES = 15;

export interface CheckoutFingerprint {
  intent: string;
  targetPlanId: string | null;
  amountCents: number | null;
  cycle: string | null;
  upgradeQuoteId: string | null;
  providerReference?: string | null;
}

export function sameCheckoutRequest(stored: CheckoutFingerprint, requested: CheckoutFingerprint) {
  return (
    stored.intent === requested.intent &&
    stored.targetPlanId === requested.targetPlanId &&
    stored.amountCents === requested.amountCents &&
    stored.cycle === requested.cycle &&
    stored.upgradeQuoteId === requested.upgradeQuoteId &&
    (requested.intent !== "regularize" || stored.providerReference === requested.providerReference)
  );
}

export function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function cyclePriceCents(
  monthlyPriceCents: number,
  annualPriceCents: number,
  cycle: string,
) {
  return cycle === "annual" ? annualPriceCents : monthlyPriceCents;
}

export function proratedUpgrade(
  sourcePriceCents: number,
  targetPriceCents: number,
  periodStartsAt: Date,
  periodEndsAt: Date,
  now: Date,
) {
  const periodMs = periodEndsAt.getTime() - periodStartsAt.getTime();
  const remainingMs = Math.max(0, periodEndsAt.getTime() - now.getTime());
  if (periodMs <= 0 || remainingMs <= 0 || now < periodStartsAt) {
    throw new ConflictException({
      code: "BILLING_PERIOD_INVALID",
      message: "O período atual não permite calcular o upgrade.",
    });
  }
  const differenceCents = targetPriceCents - sourcePriceCents;
  if (differenceCents <= 0) {
    throw new ConflictException({
      code: "BILLING_UPGRADE_REQUIRED",
      message: "Selecione um plano publicado de valor superior.",
    });
  }
  const remainingRatio = Math.min(1, remainingMs / periodMs);
  const amountCents = Math.round(differenceCents * remainingRatio);
  if (amountCents <= 0) {
    throw new ConflictException({
      code: "BILLING_UPGRADE_AMOUNT_TOO_LOW",
      message: "O valor proporcional restante não permite gerar um checkout.",
    });
  }
  return {
    amountCents,
    remainingRatio,
  };
}

export function checkoutExpiresAt(now: Date) {
  return new Date(now.getTime() + UPGRADE_QUOTE_MINUTES * 60_000);
}
