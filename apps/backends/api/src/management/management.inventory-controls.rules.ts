export type TemperatureStatus = "normal" | "warning" | "critical";

export function temperatureStatus(
  celsiusMilli: number,
  minimumMilli: number,
  maximumMilli: number,
): TemperatureStatus {
  if (celsiusMilli >= minimumMilli && celsiusMilli <= maximumMilli) return "normal";
  const distance =
    celsiusMilli < minimumMilli ? minimumMilli - celsiusMilli : celsiusMilli - maximumMilli;
  return distance <= 2_000 ? "warning" : "critical";
}

export function dynamicSectorReplenishment(input: {
  current: number;
  inbound: number;
  minimum: number;
  configuredTarget: number;
  dailyDemand: number;
  coverageDays: number;
  sourceSurplus: number;
}) {
  const availableSoon = Math.max(0, input.current + input.inbound);
  const dynamicTarget = Math.max(
    input.minimum,
    input.configuredTarget,
    input.minimum + input.dailyDemand * Math.max(1, input.coverageDays),
  );
  return Math.max(0, Math.min(dynamicTarget - availableSoon, input.sourceSurplus));
}

export function inventoryConfidence(input: {
  countedExpected: number;
  countAbsoluteDifference: number;
  transferred: number;
  transferDivergent: number;
  outbound: number;
  losses: number;
}) {
  const countRate =
    input.countedExpected > 0
      ? Math.min(1, input.countAbsoluteDifference / input.countedExpected)
      : 0;
  const transferRate =
    input.transferred > 0 ? Math.min(1, input.transferDivergent / input.transferred) : 0;
  const lossRate = input.outbound > 0 ? Math.min(1, input.losses / input.outbound) : 0;
  const score = Math.max(0, Math.round(100 - countRate * 50 - transferRate * 30 - lossRate * 20));
  return {
    score,
    level: score >= 90 ? ("high" as const) : score >= 75 ? ("medium" as const) : ("low" as const),
    countAccuracyPercent: Math.round((1 - countRate) * 10_000) / 100,
    transferAccuracyPercent: Math.round((1 - transferRate) * 10_000) / 100,
    lossRatePercent: Math.round(lossRate * 10_000) / 100,
  };
}

export function productionVariance(planned: number, actual: number | null) {
  if (actual === null || planned <= 0) return null;
  return Math.round(((actual - planned) / planned) * 10_000) / 100;
}
