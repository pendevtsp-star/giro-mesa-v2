import { createHash } from "node:crypto";

export const reservationTransitions = {
  booked: ["confirmed", "canceled", "no_show"],
  confirmed: ["seated", "canceled", "no_show"],
  seated: ["completed"],
  completed: [],
  canceled: [],
  no_show: [],
} as const;

export const waitlistTransitions = {
  waiting: ["notified", "seated", "left", "canceled", "no_show"],
  notified: ["seated", "left", "canceled", "no_show"],
  seated: [],
  left: [],
  canceled: [],
  no_show: [],
} as const;

export const deliveryTransitions = {
  draft: ["placed", "canceled"],
  placed: ["confirmed", "canceled"],
  confirmed: ["preparing", "canceled"],
  preparing: ["ready", "canceled"],
  ready: ["dispatched", "completed", "canceled"],
  dispatched: ["completed", "canceled"],
  completed: [],
  canceled: [],
} as const;

export const transferTransitions = {
  draft: ["in_transit", "canceled"],
  in_transit: ["received", "canceled"],
  received: [],
  canceled: [],
} as const;

export function canTransition<T extends Record<string, readonly string[]>>(
  machine: T,
  from: keyof T,
  to: string,
) {
  return (machine[from] as readonly string[] | undefined)?.includes(to) ?? false;
}

export const marketingOptInAfter = (decision: "granted" | "withdrawn") => decision === "granted";

export function assertSameOrganization(expected: string, actual: string) {
  if (expected !== actual) throw new Error("CROSS_TENANT_RESOURCE");
}

type Point = readonly [longitude: number, latitude: number];
type CoverageStatus = "covered" | "outside" | "unchecked" | "unavailable";

function point(value: unknown): Point | null {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    typeof value[0] !== "number" ||
    typeof value[1] !== "number" ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1])
  )
    return null;
  return [value[0], value[1]];
}

function ringCoverage(
  target: Point,
  rawRing: unknown,
): "inside" | "outside" | "boundary" | "invalid" {
  if (!Array.isArray(rawRing)) return "invalid";
  const ring = rawRing.map(point).filter((entry): entry is Point => entry !== null);
  if (ring.length < 3) return "invalid";
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const a = ring[previous];
    const b = ring[current];
    if (!a || !b) continue;
    const cross = (target[0] - a[0]) * (b[1] - a[1]) - (target[1] - a[1]) * (b[0] - a[0]);
    if (
      Math.abs(cross) <= 1e-10 &&
      target[0] >= Math.min(a[0], b[0]) - 1e-10 &&
      target[0] <= Math.max(a[0], b[0]) + 1e-10 &&
      target[1] >= Math.min(a[1], b[1]) - 1e-10 &&
      target[1] <= Math.max(a[1], b[1]) + 1e-10
    )
      return "boundary";
    if (
      a[1] > target[1] !== b[1] > target[1] &&
      target[0] < ((b[0] - a[0]) * (target[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside ? "inside" : "outside";
}

function polygonCoverage(target: Point, rawPolygon: unknown): boolean | null {
  if (!Array.isArray(rawPolygon) || rawPolygon.length === 0) return null;
  const outer = ringCoverage(target, rawPolygon[0]);
  if (outer === "invalid") return null;
  if (outer === "boundary") return true;
  if (outer === "outside") return false;
  for (const hole of rawPolygon.slice(1)) {
    const coverage = ringCoverage(target, hole);
    if (coverage === "invalid") return null;
    if (coverage === "boundary") return true;
    if (coverage === "inside") return false;
  }
  return true;
}

function circleCoverage(target: Point, geometry: Record<string, unknown>): boolean | null {
  const centerValue = geometry.center;
  const center =
    point(centerValue) ??
    (typeof geometry.centerLongitude === "number" && typeof geometry.centerLatitude === "number"
      ? ([geometry.centerLongitude, geometry.centerLatitude] as const)
      : null);
  const radiusKm = geometry.radiusKm;
  if (!center || typeof radiusKm !== "number" || !Number.isFinite(radiusKm) || radiusKm <= 0)
    return null;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(target[1] - center[1]);
  const longitudeDelta = radians(target[0] - center[0]);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(center[1])) * Math.cos(radians(target[1])) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= radiusKm + 1e-9;
}

export function deliveryCoverageStatus(
  geometry: Record<string, unknown>,
  address: { latitude?: number; longitude?: number } | null | undefined,
): CoverageStatus {
  if (address?.latitude === undefined || address.longitude === undefined) return "unchecked";
  const target: Point = [address.longitude, address.latitude];
  let covered: boolean | null = null;
  if (geometry.type === "Polygon") covered = polygonCoverage(target, geometry.coordinates);
  else if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    const results = geometry.coordinates.map((polygon) => polygonCoverage(target, polygon));
    covered = results.some((result) => result === true)
      ? true
      : results.every((result) => result === false)
        ? false
        : null;
  } else if (geometry.type === "circle" || geometry.type === "unit-radius") {
    covered = circleCoverage(target, geometry);
  }
  return covered === null ? "unavailable" : covered ? "covered" : "outside";
}

function sortJson(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  return value;
}

export const payloadFingerprint = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(sortJson(value)))
    .digest("hex");

export function loyaltyEarn(
  mode: "points" | "cashback",
  rate: number,
  totalCents: number,
  minimumOrderCents: number,
) {
  if (totalCents < minimumOrderCents) return 0;
  return mode === "points"
    ? Math.floor((totalCents / 100) * rate)
    : Math.floor((totalCents * rate) / 100);
}

export function couponDiscount(
  coupon: {
    type: "fixed" | "percentage";
    value: number;
    minimumOrderCents: number;
    maximumDiscountCents: number | null;
  },
  totalCents: number,
) {
  if (totalCents < coupon.minimumOrderCents) return 0;
  const raw =
    coupon.type === "fixed" ? coupon.value : Math.floor((totalCents * coupon.value) / 10_000);
  return Math.min(totalCents, raw, coupon.maximumDiscountCents ?? raw);
}

export const hashOpaqueSecret = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
