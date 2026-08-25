import {
  boolean,
  numeric,
  optionalString,
  record,
  requiredString,
  rows,
} from "../../management.shared";

export interface InventoryControlLine {
  id: string;
  inventoryItemId: string;
  lotId: string | null;
  expectedQuantity: number | null;
  countedQuantity: number | null;
  differenceQuantity: number | null;
}

export interface InventoryCountSession {
  id: string;
  locationId: string;
  status: "open" | "submitted" | "approved" | "rejected";
  reason: string;
  startedByIdentityId: string;
  createdAt: string;
  reviewNote: string | null;
  lines: InventoryControlLine[];
}

export interface InventoryControlsData {
  policies: Array<{
    locationId: string;
    blindCountRequired: boolean;
    requireDistinctCountReviewer: boolean;
    scanRequired: boolean;
    offlineAllowed: boolean;
    temperatureMinMilli: number | null;
    temperatureMaxMilli: number | null;
  }>;
  countSessions: InventoryCountSession[];
  lotHolds: Array<{
    id: string;
    lotId: string;
    status: "active" | "released";
    reason: string;
    createdAt: string;
  }>;
  temperatureReadings: Array<{
    id: string;
    locationId: string;
    celsiusMilli: number;
    status: "normal" | "warning" | "critical";
    occurredAt: string;
  }>;
  confidence: {
    score: number;
    level: "high" | "medium" | "low";
    countAccuracyPercent: number;
    transferAccuracyPercent: number;
    lossRatePercent: number;
  };
  anomalies: Array<{
    id: string;
    kind: string;
    severity: "high" | "medium" | "low";
    locationId: string | null;
    detail: string;
    occurredAt: string;
  }>;
  purchaseSuggestions: Array<{
    inventoryItemId: string;
    inventoryItemName: string;
    suggestedPurchaseQuantity: number;
    preferredSupplierId: string | null;
    leadTimeDays: number;
  }>;
  productionVariances: Array<{
    productionBatchId: string;
    inventoryItemId: string;
    plannedQuantity: number;
    actualQuantity: number | null;
    variancePercent: number | null;
  }>;
  returnableDepositExposures: Array<{
    orderId: string;
    quantity: number;
    amountCents: number;
    charge: { id: string; status: string } | null;
  }>;
  returnableDepositMode: "disabled" | "manual";
  capabilities: {
    canReviewCount: boolean;
    canReleaseLot: boolean;
    canChargeDeposit: boolean;
  };
}

const numberOrNull = (value: unknown) => numeric(value, true);
const status = <T extends string>(value: unknown, allowed: readonly T[]): T => {
  const parsed = requiredString(value) as T;
  if (!allowed.includes(parsed)) throw new Error("Resposta de estoque inválida.");
  return parsed;
};

export function parseInventoryControls(value: unknown): InventoryControlsData {
  const source = record(value);
  const confidence = record(source.confidence);
  const capabilities = record(source.capabilities);
  return {
    policies: rows(source, "policies").map((item) => ({
      locationId: requiredString(item.locationId),
      blindCountRequired: boolean(item.blindCountRequired),
      requireDistinctCountReviewer: boolean(item.requireDistinctCountReviewer),
      scanRequired: boolean(item.scanRequired),
      offlineAllowed: boolean(item.offlineAllowed),
      temperatureMinMilli: numberOrNull(item.temperatureMinMilli),
      temperatureMaxMilli: numberOrNull(item.temperatureMaxMilli),
    })),
    countSessions: rows(source, "countSessions").map((session) => ({
      id: requiredString(session.id),
      locationId: requiredString(session.locationId),
      status: status(session.status, ["open", "submitted", "approved", "rejected"] as const),
      reason: requiredString(session.reason),
      startedByIdentityId: requiredString(session.startedByIdentityId),
      createdAt: requiredString(session.createdAt),
      reviewNote: optionalString(session.reviewNote),
      lines: rows(session, "lines").map((line) => ({
        id: requiredString(line.id),
        inventoryItemId: requiredString(line.inventoryItemId),
        lotId: optionalString(line.lotId),
        expectedQuantity: numberOrNull(line.expectedQuantity),
        countedQuantity: numberOrNull(line.countedQuantity),
        differenceQuantity: numberOrNull(line.differenceQuantity),
      })),
    })),
    lotHolds: rows(source, "lotHolds").map((hold) => ({
      id: requiredString(hold.id),
      lotId: requiredString(hold.lotId),
      status: status(hold.status, ["active", "released"] as const),
      reason: requiredString(hold.reason),
      createdAt: requiredString(hold.createdAt),
    })),
    temperatureReadings: rows(source, "temperatureReadings").map((reading) => ({
      id: requiredString(reading.id),
      locationId: requiredString(reading.locationId),
      celsiusMilli: numeric(reading.celsiusMilli) ?? 0,
      status: status(reading.status, ["normal", "warning", "critical"] as const),
      occurredAt: requiredString(reading.occurredAt),
    })),
    confidence: {
      score: numeric(confidence.score) ?? 0,
      level: status(confidence.level, ["high", "medium", "low"] as const),
      countAccuracyPercent: numeric(confidence.countAccuracyPercent) ?? 0,
      transferAccuracyPercent: numeric(confidence.transferAccuracyPercent) ?? 0,
      lossRatePercent: numeric(confidence.lossRatePercent) ?? 0,
    },
    anomalies: rows(source, "anomalies").map((item) => ({
      id: requiredString(item.id),
      kind: requiredString(item.kind),
      severity: status(item.severity, ["high", "medium", "low"] as const),
      locationId: optionalString(item.locationId),
      detail: requiredString(item.detail),
      occurredAt: requiredString(item.occurredAt),
    })),
    purchaseSuggestions: rows(source, "purchaseSuggestions").map((item) => ({
      inventoryItemId: requiredString(item.inventoryItemId),
      inventoryItemName: requiredString(item.inventoryItemName),
      suggestedPurchaseQuantity: numeric(item.suggestedPurchaseQuantity) ?? 0,
      preferredSupplierId: optionalString(item.preferredSupplierId),
      leadTimeDays: numeric(item.leadTimeDays) ?? 0,
    })),
    productionVariances: rows(source, "productionVariances").map((item) => ({
      productionBatchId: requiredString(item.productionBatchId),
      inventoryItemId: requiredString(item.inventoryItemId),
      plannedQuantity: numeric(item.plannedQuantity) ?? 0,
      actualQuantity: numberOrNull(item.actualQuantity),
      variancePercent: numberOrNull(item.variancePercent),
    })),
    returnableDepositExposures: rows(source, "returnableDepositExposures").map((item) => ({
      orderId: requiredString(item.orderId),
      quantity: numeric(item.quantity) ?? 0,
      amountCents: numeric(item.amountCents) ?? 0,
      charge: item.charge
        ? {
            id: requiredString(record(item.charge).id),
            status: requiredString(record(item.charge).status),
          }
        : null,
    })),
    returnableDepositMode: status(source.returnableDepositMode, ["disabled", "manual"] as const),
    capabilities: {
      canReviewCount: boolean(capabilities.canReviewCount),
      canReleaseLot: boolean(capabilities.canReleaseLot),
      canChargeDeposit: boolean(capabilities.canChargeDeposit),
    },
  };
}
