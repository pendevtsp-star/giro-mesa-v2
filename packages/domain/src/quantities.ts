export const quantityUnits = ["mg", "g", "kg", "ml", "l", "unit", "dozen"] as const;
export type QuantityUnit = (typeof quantityUnits)[number];
export type QuantityDimension = "mass" | "volume" | "count";
export type QuantityRounding = "exact" | "up" | "down" | "half_up";

type UnitDefinition = Readonly<{
  dimension: QuantityDimension;
  numerator: bigint;
  denominator: bigint;
}>;

const units: Readonly<Record<QuantityUnit, UnitDefinition>> = {
  mg: { dimension: "mass", numerator: 1n, denominator: 1_000n },
  g: { dimension: "mass", numerator: 1n, denominator: 1n },
  kg: { dimension: "mass", numerator: 1_000n, denominator: 1n },
  ml: { dimension: "volume", numerator: 1n, denominator: 1_000n },
  l: { dimension: "volume", numerator: 1n, denominator: 1n },
  unit: { dimension: "count", numerator: 1n, denominator: 1n },
  dozen: { dimension: "count", numerator: 12n, denominator: 1n },
};

const scale = 1_000_000n;

export type FixedQuantity = Readonly<{
  atoms: bigint;
  unit: QuantityUnit;
  dimension: QuantityDimension;
}>;

export function parseQuantity(value: string, unit: QuantityUnit): FixedQuantity {
  const normalized = value.trim();
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(normalized)) {
    throw new TypeError("Quantity must use fixed precision with at most six decimal places.");
  }
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const atoms = BigInt(whole) * scale + BigInt(fraction.padEnd(6, "0"));
  return Object.freeze({
    atoms: negative ? -atoms : atoms,
    unit,
    dimension: units[unit].dimension,
  });
}

export function formatQuantity(quantity: FixedQuantity) {
  const negative = quantity.atoms < 0n;
  const absolute = negative ? -quantity.atoms : quantity.atoms;
  return `${negative ? "-" : ""}${absolute / scale}.${String(absolute % scale).padStart(6, "0")}`;
}

function divide(value: bigint, denominator: bigint, rounding: QuantityRounding) {
  const quotient = value / denominator;
  const remainder = value % denominator;
  if (remainder === 0n) return quotient;
  if (rounding === "exact")
    throw new RangeError("Quantity conversion is not exact at six decimals.");
  if (rounding === "down") return quotient;
  const positive = value > 0n;
  if (rounding === "up") return quotient + (positive ? 1n : -1n);
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  return absoluteRemainder * 2n >= denominator ? quotient + (positive ? 1n : -1n) : quotient;
}

export function convertQuantity(
  quantity: FixedQuantity,
  targetUnit: QuantityUnit,
  rounding: QuantityRounding,
): FixedQuantity {
  const from = units[quantity.unit];
  const target = units[targetUnit];
  if (from.dimension !== target.dimension) {
    throw new TypeError(`Cannot convert ${from.dimension} to ${target.dimension}.`);
  }
  const numerator = quantity.atoms * from.numerator * target.denominator;
  const denominator = from.denominator * target.numerator;
  return Object.freeze({
    atoms: divide(numerator, denominator, rounding),
    unit: targetUnit,
    dimension: target.dimension,
  });
}

export function applyYield(quantity: FixedQuantity, yieldBasisPoints: number): FixedQuantity {
  if (
    !Number.isSafeInteger(yieldBasisPoints) ||
    yieldBasisPoints <= 0 ||
    yieldBasisPoints > 10_000
  ) {
    throw new TypeError("yieldBasisPoints must be an integer from 1 to 10000.");
  }
  const numerator = quantity.atoms * 10_000n;
  const atoms = divide(numerator, BigInt(yieldBasisPoints), "up");
  return Object.freeze({ ...quantity, atoms });
}

export function effectiveVersion<
  T extends { validFrom: string | Date; validUntil: string | Date | null },
>(versions: readonly T[], occurredAt: string | Date) {
  const at = new Date(occurredAt).getTime();
  if (!Number.isFinite(at)) throw new TypeError("occurredAt must be a valid timestamp.");
  const matching = versions.filter((version) => {
    const from = new Date(version.validFrom).getTime();
    const until = version.validUntil === null ? null : new Date(version.validUntil).getTime();
    if (!Number.isFinite(from) || (until !== null && !Number.isFinite(until))) {
      throw new TypeError("Technical sheet validity must use valid timestamps.");
    }
    return from <= at && (until === null || at < until);
  });
  if (matching.length > 1) throw new Error("Overlapping effective-dated technical sheets.");
  return matching[0];
}
