import { z } from "zod";
import { SETTLEMENT_CENTS_MAX } from "./management-settlements.rules.js";

const id = z.string().uuid();
const cents = z.number().int().min(0).max(SETTLEMENT_CENTS_MAX);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Data inválida.");

export const settlementConfigSchema = z
  .object({
    attributionMode: z.enum(["final_responsible", "order_creator"]),
    transferMode: z.enum(["move_to_final", "preserve_origin"]),
    serviceBase: z.enum(["gross", "net_after_discounts"]),
    eligibleTabs: z.enum(["closed", "fully_paid"]),
    serviceDistribution: z.enum(["individual_sales", "equal_pool"]),
    serviceTeamShareBasisPoints: z.number().int().min(0).max(10_000),
    partnershipBase: z.enum(["gross", "net", "received", "net_excluding_service"]),
    tierApplication: z.enum(["all_revenue", "progressive"]),
    discountTreatment: z.enum(["deduct", "ignore"]),
    cancellationTreatment: z.enum(["exclude", "deduct"]),
    refundTreatment: z.enum(["deduct", "informational"]),
    periodMode: z.enum(["calendar_month", "custom"]),
    customPeriodStartDay: z.number().int().min(1).max(28),
    aggregateAcrossUnits: z.boolean(),
  })
  .strict();

export const partnershipTierSchema = z
  .object({
    minimumCents: cents,
    maximumCents: cents.nullable(),
    rewardType: z.enum(["percentage", "fixed"]),
    rewardValue: z.number().int().min(0).max(SETTLEMENT_CENTS_MAX),
  })
  .strict()
  .superRefine((tier, context) => {
    if (tier.maximumCents !== null && tier.maximumCents < tier.minimumCents) {
      context.addIssue({
        code: "custom",
        path: ["maximumCents"],
        message: "O limite final deve ser maior ou igual ao inicial.",
      });
    }
    if (tier.rewardType === "percentage" && tier.rewardValue > 10_000) {
      context.addIssue({
        code: "custom",
        path: ["rewardValue"],
        message: "O percentual deve estar entre 0% e 100%.",
      });
    }
  });

export const partnershipPlanSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    effectiveFrom: date,
    tiers: z.array(partnershipTierSchema).max(50),
  })
  .strict();

export const operationalLossSchema = z
  .object({
    tabId: id,
    type: z.enum(["unpaid_tab", "refund", "chargeback", "other"]),
    reason: z.string().trim().min(3).max(1_000),
    amountCents: cents.optional(),
  })
  .strict();

export const operationalLossDecisionSchema = z
  .object({
    action: z.enum(["approve", "reject", "reverse"]),
    note: z.string().trim().min(2).max(1_000),
  })
  .strict();

export const settlementPeriodSchema = z
  .object({ from: date, to: date, operationalShiftId: id.optional() })
  .strict()
  .superRefine((period, context) => {
    const from = Date.parse(`${period.from}T00:00:00.000Z`);
    const to = Date.parse(`${period.to}T00:00:00.000Z`);
    if (from > to) {
      context.addIssue({ code: "custom", path: ["to"], message: "Período inválido." });
    } else if (to - from > 366 * 86_400_000) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "O período máximo é de 366 dias.",
      });
    }
  });

export const settlementTransitionSchema = z
  .object({
    action: z.enum(["approve", "pay", "cancel"]),
    note: z.string().trim().min(2).max(1_000),
  })
  .strict();

export type SettlementConfigInput = z.infer<typeof settlementConfigSchema>;
export type PartnershipPlanInput = z.infer<typeof partnershipPlanSchema>;
export type OperationalLossInput = z.infer<typeof operationalLossSchema>;
export type OperationalLossDecisionInput = z.infer<typeof operationalLossDecisionSchema>;
export type SettlementPeriodInput = z.infer<typeof settlementPeriodSchema>;
export type SettlementTransitionInput = z.infer<typeof settlementTransitionSchema>;
