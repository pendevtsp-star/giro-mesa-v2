import { BadRequestException } from "@nestjs/common";

export const SETTLEMENT_CENTS_MAX = 2_147_483_647;

export type SettlementConfig = {
  serviceChargeEnabled: boolean;
  defaultServiceChargeBasisPoints: number;
  serviceChargeApplication: "manual" | "suggest_dine_in";
  attributionMode: "final_responsible" | "order_creator";
  transferMode: "move_to_final" | "preserve_origin";
  serviceBase: "gross" | "net_after_discounts";
  eligibleTabs: "closed" | "fully_paid";
  serviceDistribution: "individual_sales" | "equal_pool";
  serviceTeamShareBasisPoints: number;
  partnershipBase: "gross" | "net" | "received" | "net_excluding_service";
  tierApplication: "all_revenue" | "progressive";
  discountTreatment: "deduct" | "ignore";
  cancellationTreatment: "exclude" | "deduct";
  refundTreatment: "deduct" | "informational";
  periodMode: "calendar_month" | "custom";
  customPeriodStartDay: number;
  aggregateAcrossUnits: boolean;
};

export type PartnershipTier = {
  minimumCents: number;
  maximumCents: number | null;
  rewardType: "percentage" | "fixed";
  rewardValue: number;
};

export const defaultSettlementConfig: SettlementConfig = {
  serviceChargeEnabled: false,
  defaultServiceChargeBasisPoints: 0,
  serviceChargeApplication: "manual",
  attributionMode: "final_responsible",
  transferMode: "move_to_final",
  serviceBase: "net_after_discounts",
  eligibleTabs: "fully_paid",
  serviceDistribution: "individual_sales",
  serviceTeamShareBasisPoints: 10_000,
  partnershipBase: "net_excluding_service",
  tierApplication: "all_revenue",
  discountTreatment: "deduct",
  cancellationTreatment: "exclude",
  refundTreatment: "deduct",
  periodMode: "calendar_month",
  customPeriodStartDay: 1,
  aggregateAcrossUnits: false,
};

export function normalizeSettlementConfig(
  configuration?: Partial<SettlementConfig> | null,
): SettlementConfig {
  return { ...defaultSettlementConfig, ...configuration };
}

function assertCents(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > SETTLEMENT_CENTS_MAX) {
    throw new BadRequestException({
      code: "SETTLEMENT_AMOUNT_OUT_OF_RANGE",
      message: `${field} deve estar entre 0 e ${SETTLEMENT_CENTS_MAX} centavos.`,
    });
  }
}

export function validatePartnershipTiers(tiers: readonly PartnershipTier[]) {
  if (tiers.length === 0) return;
  const sorted = [...tiers].sort((left, right) => left.minimumCents - right.minimumCents);
  if (sorted[0]?.minimumCents !== 0) {
    throw new BadRequestException({
      code: "PARTNERSHIP_TIER_GAP",
      message: "A primeira faixa deve iniciar em zero.",
    });
  }
  for (const [index, tier] of sorted.entries()) {
    assertCents(tier.minimumCents, "minimumCents");
    if (tier.maximumCents !== null) {
      assertCents(tier.maximumCents, "maximumCents");
      if (tier.maximumCents < tier.minimumCents) {
        throw new BadRequestException({
          code: "PARTNERSHIP_TIER_INVALID_RANGE",
          message: "O limite final da faixa deve ser maior ou igual ao inicial.",
        });
      }
    }
    if (tier.rewardType === "percentage") {
      if (
        !Number.isInteger(tier.rewardValue) ||
        tier.rewardValue < 0 ||
        tier.rewardValue > 10_000
      ) {
        throw new BadRequestException({ code: "PARTNERSHIP_TIER_INVALID_PERCENTAGE" });
      }
    } else {
      assertCents(tier.rewardValue, "rewardValue");
    }
    const next = sorted[index + 1];
    if (!next) {
      if (tier.maximumCents !== null) {
        throw new BadRequestException({
          code: "PARTNERSHIP_TIER_MISSING_OPEN_END",
          message: "A última faixa deve permanecer sem limite final.",
        });
      }
      continue;
    }
    if (tier.maximumCents === null || next.minimumCents !== tier.maximumCents + 1) {
      throw new BadRequestException({
        code: "PARTNERSHIP_TIER_GAP",
        message: "As faixas devem ser contíguas e não podem se sobrepor.",
      });
    }
  }
}

export function partnershipRewardCents(
  baseCents: number,
  tiers: readonly PartnershipTier[],
  application: SettlementConfig["tierApplication"],
) {
  assertCents(baseCents, "baseCents");
  validatePartnershipTiers(tiers);
  if (tiers.length === 0) return 0;
  const sorted = [...tiers].sort((left, right) => left.minimumCents - right.minimumCents);
  if (application === "all_revenue") {
    const tier = sorted.find(
      (candidate) =>
        baseCents >= candidate.minimumCents &&
        (candidate.maximumCents === null || baseCents <= candidate.maximumCents),
    );
    if (!tier) return 0;
    const result =
      tier.rewardType === "fixed"
        ? tier.rewardValue
        : Math.floor((baseCents * tier.rewardValue) / 10_000);
    assertCents(result, "partnershipRewardCents");
    return result;
  }
  let result = 0;
  for (const tier of sorted) {
    if (baseCents < tier.minimumCents) break;
    if (tier.rewardType === "fixed") {
      result += tier.rewardValue;
      continue;
    }
    const taxableCents = Math.max(
      0,
      tier.maximumCents !== null && baseCents > tier.maximumCents
        ? tier.maximumCents + 1 - tier.minimumCents
        : baseCents - tier.minimumCents,
    );
    result += Math.floor((taxableCents * tier.rewardValue) / 10_000);
  }
  assertCents(result, "partnershipRewardCents");
  return result;
}

export function teamServiceShareCents(serviceChargeCents: number, teamShareBasisPoints: number) {
  assertCents(serviceChargeCents, "serviceChargeCents");
  if (
    !Number.isInteger(teamShareBasisPoints) ||
    teamShareBasisPoints < 0 ||
    teamShareBasisPoints > 10_000
  ) {
    throw new BadRequestException({ code: "INVALID_SERVICE_TEAM_SHARE" });
  }
  return Math.floor((serviceChargeCents * teamShareBasisPoints) / 10_000);
}

export function settlementPayableCents(serviceShareCents: number, partnershipCents: number) {
  assertCents(serviceShareCents, "serviceShareCents");
  assertCents(partnershipCents, "partnershipCents");
  const payableCents = serviceShareCents + partnershipCents;
  assertCents(payableCents, "payableCents");
  return payableCents;
}

export function allocateCents(
  totalCents: number,
  entries: readonly { key: string; weight: number }[],
) {
  assertCents(totalCents, "totalCents");
  if (entries.length === 0) return new Map<string, number>();
  const sorted = [...entries].sort((left, right) => left.key.localeCompare(right.key));
  const totalWeight = sorted.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (totalWeight === 0) {
    return new Map(sorted.map((entry, index) => [entry.key, index === 0 ? totalCents : 0]));
  }
  const allocated = sorted.map((entry) => ({
    key: entry.key,
    value: Math.floor((totalCents * Math.max(0, entry.weight)) / totalWeight),
  }));
  let remainder = totalCents - allocated.reduce((sum, entry) => sum + entry.value, 0);
  for (const entry of allocated) {
    if (remainder === 0) break;
    entry.value += 1;
    remainder -= 1;
  }
  return new Map(allocated.map((entry) => [entry.key, entry.value]));
}
