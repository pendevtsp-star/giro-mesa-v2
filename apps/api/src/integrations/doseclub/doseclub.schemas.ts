import { z } from "zod";

const externalId = z.string().trim().min(1).max(180);
const idempotencyKey = z.string().trim().min(8).max(180);
const positiveInt = z.number().int().positive().max(2_147_483_647);
const nonNegativeInt = z.number().int().nonnegative().max(2_147_483_647);
const occurredAt = z.iso.datetime({ offset: true });

export const doseClubPurchaseSnapshotSchema = z
  .object({
    volumeMlAtPurchase: positiveInt,
    doseMlAtPurchase: positiveInt,
    totalDoses: positiveInt,
    remainingDoses: nonNegativeInt,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.remainingDoses > snapshot.totalDoses) {
      context.addIssue({
        code: "custom",
        path: ["remainingDoses"],
        message: "remainingDoses cannot exceed totalDoses",
      });
    }
    if (
      BigInt(snapshot.totalDoses) * BigInt(snapshot.doseMlAtPurchase) >
      BigInt(snapshot.volumeMlAtPurchase)
    ) {
      context.addIssue({
        code: "custom",
        path: ["totalDoses"],
        message: "totalDoses and doseMlAtPurchase exceed the purchased volume",
      });
    }
  });

const v2Base = {
  contractVersion: z.literal("v2"),
  operationId: externalId,
  idempotencyKey,
  occurredAt,
  version: positiveInt,
  branchId: externalId,
  externalClubId: externalId,
  purchaseSnapshot: doseClubPurchaseSnapshotSchema,
};

const individualSale = z
  .object({
    ...v2Base,
    operation: z.literal("sale"),
    version: z.literal(1),
    externalOfferId: externalId,
    externalCustomerId: externalId.optional(),
    saleType: z.literal("individual"),
    productId: externalId,
    quantityBottles: positiveInt,
  })
  .strict();

const comboSale = z
  .object({
    ...v2Base,
    operation: z.literal("sale"),
    version: z.literal(1),
    externalOfferId: externalId,
    externalCustomerId: externalId.optional(),
    saleType: z.literal("combo_pool"),
    eligibleProductIds: z.array(externalId).min(2).max(100),
    quantityBottles: positiveInt,
  })
  .strict()
  .superRefine((sale, context) => {
    if (new Set(sale.eligibleProductIds).size !== sale.eligibleProductIds.length) {
      context.addIssue({
        code: "custom",
        path: ["eligibleProductIds"],
        message: "eligibleProductIds must contain distinct values",
      });
    }
  });

const doseOperationFields = {
  productId: externalId,
  doses: positiveInt,
  employeeRef: externalId.optional(),
};

export const doseClubV2ReservationSchema = z
  .object({
    ...v2Base,
    operation: z.literal("reservation"),
    ...doseOperationFields,
  })
  .strict();

export const doseClubV2ConsumptionSchema = z
  .object({
    ...v2Base,
    operation: z.literal("consumption"),
    externalOfferId: externalId.optional(),
    ...doseOperationFields,
  })
  .strict();

export const doseClubV2ReversalSchema = z
  .object({
    ...v2Base,
    operation: z.literal("reversal"),
    originalOperationId: externalId,
    productId: externalId,
    doses: positiveInt,
    reason: z.string().trim().min(2).max(500).optional(),
  })
  .strict();

export const doseClubV2ReconcileSchema = z
  .object({
    ...v2Base,
    operation: z.literal("reconcile"),
    productId: externalId,
    expectedRemainingDoses: nonNegativeInt,
    expectedReservedDoses: nonNegativeInt,
    localVersion: positiveInt,
  })
  .strict();

export const doseClubV2SaleSchema = z.union([individualSale, comboSale]);

export const doseClubV2OperationSchema = z.union([
  individualSale,
  comboSale,
  doseClubV2ReservationSchema,
  doseClubV2ConsumptionSchema,
  doseClubV2ReversalSchema,
  doseClubV2ReconcileSchema,
]);
export type DoseClubV2Operation = z.infer<typeof doseClubV2OperationSchema>;

const v1SaleFields = {
  branchId: externalId,
  quantityBottles: positiveInt,
  totalDoses: positiveInt,
  doseMl: positiveInt,
  externalClubId: externalId,
  externalOfferId: externalId,
  externalCustomerId: externalId.optional(),
  idempotencyKey,
};

function v1VolumeFits(sale: { totalDoses: number; doseMl: number }) {
  return BigInt(sale.totalDoses) * BigInt(sale.doseMl) <= 2_147_483_647n;
}

export const doseClubV1SaleSchema = z.union([
  z
    .object({ ...v1SaleFields, saleType: z.literal("individual"), productId: externalId })
    .strict()
    .refine(v1VolumeFits, {
      path: ["totalDoses"],
      message: "the purchased volume exceeds the supported contract",
    }),
  z
    .object({
      ...v1SaleFields,
      saleType: z.literal("combo_pool"),
      eligibleProductIds: z.array(externalId).min(2).max(100),
    })
    .strict()
    .refine(v1VolumeFits, {
      path: ["totalDoses"],
      message: "the purchased volume exceeds the supported contract",
    })
    .superRefine((sale, context) => {
      if (new Set(sale.eligibleProductIds).size !== sale.eligibleProductIds.length) {
        context.addIssue({
          code: "custom",
          path: ["eligibleProductIds"],
          message: "eligibleProductIds must contain distinct values",
        });
      }
    }),
]);
export type DoseClubV1Sale = z.infer<typeof doseClubV1SaleSchema>;

export const doseClubV1ConsumptionSchema = z
  .object({
    branchId: externalId,
    orderId: externalId.optional(),
    productId: externalId,
    externalClubId: externalId,
    externalOfferId: externalId.optional(),
    offerType: z.enum(["individual", "combo_pool"]).optional(),
    externalConsumptionId: externalId,
    doseMl: positiveInt,
    employeeRef: externalId.optional(),
    idempotencyKey,
  })
  .strict();
export type DoseClubV1Consumption = z.infer<typeof doseClubV1ConsumptionSchema>;

export const doseClubV1ReversalSchema = z
  .object({
    branchId: externalId,
    productId: externalId,
    externalClubId: externalId,
    externalConsumptionId: externalId,
    externalReversalId: externalId,
    originalIdempotencyKey: idempotencyKey,
    doseMl: positiveInt,
    reason: z.string().trim().min(2).max(500),
    idempotencyKey,
  })
  .strict();
export type DoseClubV1Reversal = z.infer<typeof doseClubV1ReversalSchema>;

export const doseClubSaleWireSchema = z
  .object({
    contractVersion: z.literal("v2").optional(),
    operation: z.literal("sale").optional(),
    operationId: externalId.optional(),
    idempotencyKey,
    occurredAt: occurredAt.optional(),
    version: z.literal(1).optional(),
    branchId: externalId,
    externalClubId: externalId,
    purchaseSnapshot: doseClubPurchaseSnapshotSchema.optional(),
    externalOfferId: externalId,
    externalCustomerId: externalId.optional(),
    saleType: z.enum(["individual", "combo_pool"]),
    productId: externalId.optional(),
    eligibleProductIds: z.array(externalId).min(2).max(100).optional(),
    quantityBottles: positiveInt,
    totalDoses: positiveInt.optional(),
    doseMl: positiveInt.optional(),
  })
  .strict();

export const doseClubConsumptionWireSchema = z
  .object({
    contractVersion: z.literal("v2").optional(),
    operation: z.literal("consumption").optional(),
    operationId: externalId.optional(),
    idempotencyKey,
    occurredAt: occurredAt.optional(),
    version: positiveInt.optional(),
    branchId: externalId,
    externalClubId: externalId,
    purchaseSnapshot: doseClubPurchaseSnapshotSchema.optional(),
    productId: externalId,
    doses: positiveInt.optional(),
    employeeRef: externalId.optional(),
    orderId: externalId.optional(),
    externalOfferId: externalId.optional(),
    offerType: z.enum(["individual", "combo_pool"]).optional(),
    externalConsumptionId: externalId.optional(),
    doseMl: positiveInt.optional(),
  })
  .strict();

export const doseClubReversalWireSchema = z
  .object({
    contractVersion: z.literal("v2").optional(),
    operation: z.literal("reversal").optional(),
    operationId: externalId.optional(),
    idempotencyKey,
    occurredAt: occurredAt.optional(),
    version: positiveInt.optional(),
    branchId: externalId,
    externalClubId: externalId,
    purchaseSnapshot: doseClubPurchaseSnapshotSchema.optional(),
    productId: externalId,
    doses: positiveInt.optional(),
    originalOperationId: externalId.optional(),
    externalConsumptionId: externalId.optional(),
    externalReversalId: externalId.optional(),
    originalIdempotencyKey: idempotencyKey.optional(),
    doseMl: positiveInt.optional(),
    reason: z.string().trim().min(2).max(500).optional(),
  })
  .strict();
