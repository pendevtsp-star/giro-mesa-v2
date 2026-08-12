import { z } from "zod";
import { POSTGRES_INT4_MAX } from "../common/postgres-integers.js";

const id = z.string().uuid();
const custody = z.object({
  type: z.enum(["supplier", "location", "table", "waiter", "shift", "reconciliation"]),
  id: z.string().trim().min(1).max(160),
});

export const createReturnableAssetSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  trackingMode: z.enum(["aggregate", "serialized"]),
  depositCents: z.number().int().nonnegative().max(POSTGRES_INT4_MAX).optional(),
  serialNumbers: z.array(z.string().trim().min(1).max(120)).max(1_000).default([]),
});

export const returnableMovementSchema = z.object({
  assetId: id,
  serialId: id.optional(),
  movementType: z.enum([
    "receive",
    "circulate",
    "return_empty",
    "send_supplier",
    "receive_supplier",
    "broken",
    "lost",
  ]),
  quantity: z.number().int().positive().max(1_000_000),
  fromCustody: custody,
  toCustody: custody,
  supplierReference: z.string().trim().min(1).max(160).optional(),
  lotReference: z.string().trim().min(1).max(160).optional(),
  reason: z.string().trim().min(3).max(240).optional(),
  occurredAt: z.string().datetime({ offset: true }),
});

export const returnableReconciliationSchema = z
  .object({
    assetId: id,
    custody,
    physicalQuantity: z.number().int().nonnegative().max(1_000_000).optional(),
    physicalSerialIds: z.array(id).max(1_000).optional(),
    occurredAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(15).max(240),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.physicalQuantity === undefined && value.physicalSerialIds === undefined) {
      context.addIssue({
        code: "custom",
        message: "Informe a quantidade física ou os seriais encontrados.",
      });
    }
    if (
      value.physicalQuantity !== undefined &&
      value.physicalSerialIds !== undefined &&
      value.physicalQuantity !== value.physicalSerialIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "A quantidade física deve corresponder aos seriais encontrados.",
      });
    }
  });

export type CreateReturnableAssetInput = z.infer<typeof createReturnableAssetSchema>;
export type ReturnableMovementInput = z.infer<typeof returnableMovementSchema>;
export type ReturnableReconciliationInput = z.infer<typeof returnableReconciliationSchema>;
