import { createHash } from "node:crypto";

export type CommercialPromotionRule = {
  id: string;
  name: string;
  type: "percentage" | "fixed" | "price";
  value: number;
  planSlugs: string[];
  cycles: Array<"monthly" | "annual">;
  startsAt: Date;
  endsAt: Date | null;
  newCustomersOnly: boolean;
  code: string | null;
  redemptionLimit: number | null;
  active: boolean;
};

export function automaticPromotionsOverlap<
  T extends {
    active: boolean;
    code?: string | null;
    planSlugs: string[];
    cycles: Array<"monthly" | "annual">;
    startsAt: Date;
    endsAt?: Date | null;
  },
  U extends {
    active: boolean;
    code?: string | null;
    planSlugs: string[];
    cycles: Array<"monthly" | "annual">;
    startsAt: Date;
    endsAt?: Date | null;
  },
>(left: T, right: U) {
  if (!left.active || !right.active || left.code || right.code) return false;
  const planOverlap = left.planSlugs.some((slug) => right.planSlugs.includes(slug));
  const cycleOverlap = left.cycles.some((cycle) => right.cycles.includes(cycle));
  const leftEnd = left.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const windowOverlap = left.startsAt.getTime() < rightEnd && right.startsAt.getTime() < leftEnd;
  return planOverlap && cycleOverlap && windowOverlap;
}

export function resolveCommercialPromotion(
  promotions: readonly CommercialPromotionRule[],
  input: {
    planSlug: string;
    cycle: "monthly" | "annual";
    basePriceCents: number;
    code?: string;
    newCustomer: boolean;
    now: Date;
  },
) {
  const requestedCode = input.code?.trim().toUpperCase() ?? null;
  return (
    promotions
      .filter(
        (promotion) =>
          promotion.active &&
          promotion.startsAt <= input.now &&
          (!promotion.endsAt || promotion.endsAt > input.now) &&
          promotion.planSlugs.includes(input.planSlug) &&
          promotion.cycles.includes(input.cycle) &&
          (!promotion.newCustomersOnly || input.newCustomer) &&
          (requestedCode ? promotion.code === requestedCode : promotion.code === null),
      )
      .map((promotion) => {
        const discountCents = commercialPromotionDiscount(
          input.basePriceCents,
          promotion.type,
          promotion.value,
        );
        return {
          ...promotion,
          discountCents,
          finalPriceCents: input.basePriceCents - discountCents,
          fingerprint: commercialPromotionFingerprint(promotion),
        };
      })
      .filter((promotion) => promotion.finalPriceCents > 0)
      .sort(
        (left, right) =>
          right.discountCents - left.discountCents || left.id.localeCompare(right.id),
      )[0] ?? null
  );
}

export function commercialPromotionDiscount(
  basePriceCents: number,
  type: CommercialPromotionRule["type"],
  value: number,
) {
  const discount =
    type === "percentage"
      ? Math.floor((basePriceCents * value) / 10_000)
      : type === "fixed"
        ? value
        : Math.max(0, basePriceCents - value);
  return Math.min(basePriceCents, Math.max(0, discount));
}

export function commercialPromotionFingerprint(promotion: CommercialPromotionRule) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: promotion.id,
        type: promotion.type,
        value: promotion.value,
        planSlugs: [...promotion.planSlugs].sort(),
        cycles: [...promotion.cycles].sort(),
        startsAt: promotion.startsAt.toISOString(),
        endsAt: promotion.endsAt?.toISOString() ?? null,
        newCustomersOnly: promotion.newCustomersOnly,
        code: promotion.code,
        redemptionLimit: promotion.redemptionLimit,
      }),
    )
    .digest("hex");
}

export type CommercialExperimentVariant = {
  key: string;
  weight: number;
  headline: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
};

export function assignCommercialExperimentVariant(
  experimentSlug: string,
  variants: readonly CommercialExperimentVariant[],
  visitorId: string,
) {
  const bucket =
    createHash("sha256").update(`${experimentSlug}:${visitorId}`).digest().readUInt32BE(0) % 100;
  let boundary = 0;
  for (const variant of variants) {
    boundary += variant.weight;
    if (bucket < boundary) return variant;
  }
  return null;
}

export function commercialVisitorHash(visitorId: string) {
  return createHash("sha256").update(visitorId).digest("hex");
}
