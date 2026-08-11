import { createHash } from "node:crypto";

export const remunerationRuleKinds = ["service", "commission", "profit_sharing"] as const;
export type RemunerationRuleKind = (typeof remunerationRuleKinds)[number];
export const remunerationMetrics = [
  "grossSalesCents",
  "netSalesCents",
  "serviceChargeCents",
  "eligibleSalesCents",
  "profitCents",
  "hoursMinutes",
  "unitsSold",
] as const;
export type RemunerationMetric = (typeof remunerationMetrics)[number];
export type RemunerationMetrics = Readonly<Record<RemunerationMetric, number>>;
export type RemunerationRounding = "down" | "up" | "half_up";

export type RemunerationExpression =
  | Readonly<{ type: "constant"; value: number }>
  | Readonly<{ type: "metric"; metric: RemunerationMetric }>
  | Readonly<{ type: "add"; operands: readonly RemunerationExpression[] }>
  | Readonly<{ type: "min"; operands: readonly RemunerationExpression[] }>
  | Readonly<{ type: "max"; operands: readonly RemunerationExpression[] }>
  | Readonly<{ type: "subtract"; left: RemunerationExpression; right: RemunerationExpression }>
  | Readonly<{
      type: "basis_points";
      operand: RemunerationExpression;
      basisPoints: number;
      rounding: RemunerationRounding;
    }>
  | Readonly<{
      type: "if";
      condition: Readonly<{
        operator: "gt" | "gte" | "lt" | "lte" | "eq";
        left: RemunerationExpression;
        right: RemunerationExpression;
      }>;
      then: RemunerationExpression;
      else: RemunerationExpression;
    }>;

export interface RemunerationRuleVersion {
  ruleSetId: string;
  version: number;
  kind: RemunerationRuleKind;
  effectiveFrom: string;
  effectiveUntil: string | null;
  expression: RemunerationExpression;
}

export interface RemunerationTraceEntry {
  path: string;
  type: RemunerationExpression["type"] | "condition";
  result: number | boolean;
}

function safeInteger(value: number, field: string, allowNegative = false) {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0))
    throw new TypeError(`${field} must be a safe ${allowNegative ? "" : "non-negative "}integer.`);
  return value;
}

function integerFromBigInt(value: bigint, field: string) {
  const number = Number(value);
  return safeInteger(number, field, true);
}

function roundedRatio(numerator: bigint, denominator: bigint, rounding: RemunerationRounding) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || rounding === "down") return quotient;
  const direction = numerator < 0n ? -1n : 1n;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  if (rounding === "up") return quotient + direction;
  return absoluteRemainder * 2n >= denominator ? quotient + direction : quotient;
}

function evaluation(
  expression: RemunerationExpression,
  metrics: RemunerationMetrics,
  trace: RemunerationTraceEntry[],
  path: string,
  depth: number,
  budget: { nodes: number },
): number {
  if (depth > 32 || ++budget.nodes > 256) throw new RangeError("Remuneration rule is too complex.");
  let result: number;
  if (expression.type === "constant") {
    result = safeInteger(expression.value, `${path}.value`, true);
  } else if (expression.type === "metric") {
    if (!remunerationMetrics.includes(expression.metric)) throw new TypeError("Unknown metric.");
    result = safeInteger(metrics[expression.metric], expression.metric);
  } else if (expression.type === "add" || expression.type === "min" || expression.type === "max") {
    if (expression.operands.length === 0 || expression.operands.length > 64)
      throw new RangeError(`${expression.type} requires between one and 64 operands.`);
    const operands = expression.operands.map((operand, index) =>
      evaluation(operand, metrics, trace, `${path}.operands[${index}]`, depth + 1, budget),
    );
    if (expression.type === "add")
      result = integerFromBigInt(
        operands.reduce((sum, value) => sum + BigInt(value), 0n),
        `${path}.result`,
      );
    else result = expression.type === "min" ? Math.min(...operands) : Math.max(...operands);
  } else if (expression.type === "subtract") {
    result = integerFromBigInt(
      BigInt(evaluation(expression.left, metrics, trace, `${path}.left`, depth + 1, budget)) -
        BigInt(evaluation(expression.right, metrics, trace, `${path}.right`, depth + 1, budget)),
      `${path}.result`,
    );
  } else if (expression.type === "basis_points") {
    safeInteger(expression.basisPoints, `${path}.basisPoints`);
    if (expression.basisPoints > 10_000) throw new RangeError("basisPoints cannot exceed 10000.");
    const operand = evaluation(
      expression.operand,
      metrics,
      trace,
      `${path}.operand`,
      depth + 1,
      budget,
    );
    result = integerFromBigInt(
      roundedRatio(BigInt(operand) * BigInt(expression.basisPoints), 10_000n, expression.rounding),
      `${path}.result`,
    );
  } else {
    const left = evaluation(
      expression.condition.left,
      metrics,
      trace,
      `${path}.condition.left`,
      depth + 1,
      budget,
    );
    const right = evaluation(
      expression.condition.right,
      metrics,
      trace,
      `${path}.condition.right`,
      depth + 1,
      budget,
    );
    const condition =
      expression.condition.operator === "gt"
        ? left > right
        : expression.condition.operator === "gte"
          ? left >= right
          : expression.condition.operator === "lt"
            ? left < right
            : expression.condition.operator === "lte"
              ? left <= right
              : left === right;
    trace.push({ path: `${path}.condition`, type: "condition", result: condition });
    result = evaluation(
      condition ? expression.then : expression.else,
      metrics,
      trace,
      `${path}.${condition ? "then" : "else"}`,
      depth + 1,
      budget,
    );
  }
  trace.push({ path, type: expression.type, result });
  return result;
}

export function evaluateRemunerationRule(
  expression: RemunerationExpression,
  metrics: RemunerationMetrics,
) {
  const result = evaluation(expression, metrics, [], "$", 0, { nodes: 0 });
  if (result < 0) throw new RangeError("Remuneration output cannot be negative.");
  return result;
}

export function simulateRemunerationRule(
  rule: RemunerationRuleVersion,
  metrics: RemunerationMetrics,
) {
  validateRule(rule);
  for (const metric of remunerationMetrics) safeInteger(metrics[metric], metric);
  const trace: RemunerationTraceEntry[] = [];
  const outputCents = evaluation(rule.expression, metrics, trace, "$", 0, { nodes: 0 });
  if (outputCents < 0) throw new RangeError("Remuneration output cannot be negative.");
  return Object.freeze({ outputCents, trace: Object.freeze(trace) });
}

function validateRule(rule: RemunerationRuleVersion) {
  if (!Number.isSafeInteger(rule.version) || rule.version <= 0)
    throw new TypeError("version must be positive.");
  if (!remunerationRuleKinds.includes(rule.kind)) throw new TypeError("Unknown remuneration kind.");
  const from = new Date(rule.effectiveFrom).getTime();
  const until = rule.effectiveUntil === null ? null : new Date(rule.effectiveUntil).getTime();
  if (!Number.isFinite(from) || (until !== null && (!Number.isFinite(until) || until <= from)))
    throw new TypeError("Invalid remuneration effective window.");
}

export function selectEffectiveRemunerationRule(
  versions: readonly RemunerationRuleVersion[],
  occurredAt: string,
) {
  const at = new Date(occurredAt).getTime();
  if (!Number.isFinite(at)) throw new TypeError("occurredAt must be valid.");
  const matches = versions.filter((rule) => {
    validateRule(rule);
    const from = new Date(rule.effectiveFrom).getTime();
    const until = rule.effectiveUntil === null ? null : new Date(rule.effectiveUntil).getTime();
    return from <= at && (until === null || at < until);
  });
  if (matches.length > 1) throw new Error("Overlapping remuneration rule versions.");
  return matches[0];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

export function freezeRemunerationCalculation(
  rule: RemunerationRuleVersion,
  metrics: RemunerationMetrics,
  sourceReferences: readonly string[],
  calculatedAt: string,
) {
  const simulation = simulateRemunerationRule(rule, metrics);
  if (!Number.isFinite(new Date(calculatedAt).getTime()))
    throw new TypeError("calculatedAt must be valid.");
  if (
    sourceReferences.length === 0 ||
    sourceReferences.some((reference) => reference.trim().length === 0)
  )
    throw new TypeError("At least one source reference is required.");
  const memory = {
    rule: JSON.parse(JSON.stringify(rule)) as RemunerationRuleVersion,
    metrics: { ...metrics },
    sourceReferences: [...sourceReferences],
    outputCents: simulation.outputCents,
    calculatedAt: new Date(calculatedAt).toISOString(),
  };
  return deepFreeze({
    ...memory,
    memoryHash: createHash("sha256").update(stable(memory)).digest("hex"),
  });
}
