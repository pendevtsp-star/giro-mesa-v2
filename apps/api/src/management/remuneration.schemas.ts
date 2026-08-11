import { type RemunerationExpression, remunerationMetrics } from "@giromesa/domain";
import { z } from "zod";

const safeInteger = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

const expressionNode: z.ZodType<RemunerationExpression> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("constant"), value: safeInteger }).strict(),
    z.object({ type: z.literal("metric"), metric: z.enum(remunerationMetrics) }).strict(),
    z
      .object({
        type: z.enum(["add", "min", "max"]),
        operands: z.array(expressionNode).min(1).max(64),
      })
      .strict(),
    z
      .object({
        type: z.literal("subtract"),
        left: expressionNode,
        right: expressionNode,
      })
      .strict(),
    z
      .object({
        type: z.literal("basis_points"),
        operand: expressionNode,
        basisPoints: z.number().int().min(0).max(10_000),
        rounding: z.enum(["down", "up", "half_up"]),
      })
      .strict(),
    z
      .object({
        type: z.literal("if"),
        condition: z
          .object({
            operator: z.enum(["gt", "gte", "lt", "lte", "eq"]),
            left: expressionNode,
            right: expressionNode,
          })
          .strict(),
        consequent: expressionNode,
        alternate: expressionNode,
      })
      .strict(),
  ]),
);

function expressionBounds(
  expression: RemunerationExpression,
  depth = 1,
): { nodes: number; depth: number } {
  const children: readonly RemunerationExpression[] =
    expression.type === "add" || expression.type === "min" || expression.type === "max"
      ? expression.operands
      : expression.type === "subtract"
        ? [expression.left, expression.right]
        : expression.type === "basis_points"
          ? [expression.operand]
          : expression.type === "if"
            ? [
                expression.condition.left,
                expression.condition.right,
                expression.consequent,
                expression.alternate,
              ]
            : [];
  return children.reduce(
    (bounds, child) => {
      const nested = expressionBounds(child, depth + 1);
      return { nodes: bounds.nodes + nested.nodes, depth: Math.max(bounds.depth, nested.depth) };
    },
    { nodes: 1, depth },
  );
}

export const remunerationExpressionSchema = expressionNode.superRefine((expression, context) => {
  const bounds = expressionBounds(expression);
  if (bounds.depth > 32) {
    context.addIssue({ code: "custom", message: "A regra excede a profundidade máxima de 32." });
  }
  if (bounds.nodes > 256) {
    context.addIssue({ code: "custom", message: "A regra excede o limite de 256 nós." });
  }
});

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
  expression: remunerationExpressionSchema,
  effectiveFrom: z.string().datetime({ offset: true }),
});
export const remunerationVersionSchema = z.object({
  expression: remunerationExpressionSchema,
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
