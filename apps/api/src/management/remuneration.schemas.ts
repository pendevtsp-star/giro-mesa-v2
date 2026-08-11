import { z } from "zod";

const expression: z.ZodType<Record<string, unknown>> = z
  .object({ type: z.string().trim().min(1).max(32) })
  .catchall(z.unknown());

const metrics = z.object({
  grossSalesCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  netSalesCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  serviceChargeCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  eligibleSalesCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  profitCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  hoursMinutes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  unitsSold: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
const kind = z.enum(["service", "commission", "profit_sharing"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const remunerationRuleSchema = z.object({
  kind,
  name: z.string().trim().min(3).max(160),
  expression,
  effectiveFrom: z.string().datetime({ offset: true }),
});
export const remunerationVersionSchema = z.object({
  expression,
  effectiveFrom: z.string().datetime({ offset: true }),
});
export const remunerationSimulationSchema = z.object({ metrics });
export const remunerationCalculationSchema = z.object({
  kind,
  periodStart: date,
  periodEnd: date,
  ruleVersionId: z.string().uuid(),
  metrics,
  sourceReferences: z.array(z.string().trim().min(1).max(240)).min(1).max(1_000),
  recipients: z
    .array(
      z.object({
        reference: z.string().trim().min(1).max(160),
        label: z.string().trim().min(1).max(160),
        basisPoints: z.number().int().min(0).max(10_000),
      }),
    )
    .min(1)
    .max(1_000),
});
export const remunerationAdjustmentSchema = z.object({
  amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(15).max(500),
  sourceReferences: z.array(z.string().trim().min(1).max(240)).min(1).max(100),
  recipient: z.object({
    reference: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(160),
  }),
});

export type RemunerationRuleInput = z.infer<typeof remunerationRuleSchema>;
export type RemunerationVersionInput = z.infer<typeof remunerationVersionSchema>;
export type RemunerationSimulationInput = z.infer<typeof remunerationSimulationSchema>;
export type RemunerationCalculationInput = z.infer<typeof remunerationCalculationSchema>;
export type RemunerationAdjustmentInput = z.infer<typeof remunerationAdjustmentSchema>;
