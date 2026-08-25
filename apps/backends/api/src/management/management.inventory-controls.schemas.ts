import { z } from "zod";

const id = z.string().uuid();
const quantity = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine((value) => /^\d{1,12}(?:\.\d{1,3})?$/.test(value), "Quantidade inválida.");

export const inventorySectorPolicySchema = z
  .object({
    blindCountRequired: z.boolean().default(true),
    requireDistinctCountReviewer: z.boolean().default(true),
    scanRequired: z.boolean().default(true),
    offlineAllowed: z.boolean().default(true),
    temperatureMinimumCelsius: z.number().min(-100).max(100).nullable().default(null),
    temperatureMaximumCelsius: z.number().min(-100).max(100).nullable().default(null),
  })
  .refine(
    (value) =>
      (value.temperatureMinimumCelsius === null && value.temperatureMaximumCelsius === null) ||
      (value.temperatureMinimumCelsius !== null &&
        value.temperatureMaximumCelsius !== null &&
        value.temperatureMinimumCelsius < value.temperatureMaximumCelsius),
    { path: ["temperatureMaximumCelsius"], message: "Informe uma faixa de temperatura válida." },
  );

export const blindCountStartSchema = z.object({
  locationId: id,
  shiftReference: z.string().trim().min(1).max(80).optional(),
  reason: z.string().trim().min(3).max(1_000),
  scheduleIds: z.array(id).min(1).max(500).optional(),
});

export const blindCountSubmitSchema = z.object({
  lines: z
    .array(z.object({ lineId: id, countedQuantity: quantity }))
    .min(1)
    .max(2_000)
    .refine((lines) => new Set(lines.map((line) => line.lineId)).size === lines.length, {
      message: "A contagem possui itens repetidos.",
    }),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  offline: z.boolean().default(false),
});

export const blindCountReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(5).max(1_000),
});

export const inventoryTemperatureSchema = z.object({
  locationId: id,
  celsius: z.number().min(-100).max(100),
  source: z.enum(["manual", "sensor", "import"]).default("manual"),
  note: z.string().trim().min(3).max(1_000).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});

export const inventoryLotHoldSchema = z.object({
  reason: z.string().trim().min(5).max(2_000),
  evidence: z.array(z.string().trim().url().max(2_000)).max(10).default([]),
});

export const inventoryLotHoldReleaseSchema = z.object({
  reason: z.string().trim().min(5).max(2_000),
});

export const returnableDepositChargeSchema = z.object({
  orderId: id,
  dueDate: z.string().date().optional(),
});

export const returnableDepositCancelSchema = z.object({
  reason: z.string().trim().min(5).max(1_000),
});

export const returnablePolicySchema = z.object({
  depositMode: z.enum(["disabled", "manual"]).default("disabled"),
  defaultDueDays: z.number().int().min(1).max(365).default(7),
  returnableClosePolicy: z.enum(["ignore", "warn", "block"]).default("warn"),
});

export const returnableDepositReconcileSchema = z.object({
  reason: z.string().trim().min(5).max(1_000),
});

export type InventorySectorPolicyInput = z.infer<typeof inventorySectorPolicySchema>;
export type BlindCountStartInput = z.infer<typeof blindCountStartSchema>;
export type BlindCountSubmitInput = z.infer<typeof blindCountSubmitSchema>;
export type BlindCountReviewInput = z.infer<typeof blindCountReviewSchema>;
export type InventoryTemperatureInput = z.infer<typeof inventoryTemperatureSchema>;
export type InventoryLotHoldInput = z.infer<typeof inventoryLotHoldSchema>;
export type InventoryLotHoldReleaseInput = z.infer<typeof inventoryLotHoldReleaseSchema>;
export type ReturnableDepositChargeInput = z.infer<typeof returnableDepositChargeSchema>;
export type ReturnableDepositCancelInput = z.infer<typeof returnableDepositCancelSchema>;
export type ReturnablePolicyInput = z.infer<typeof returnablePolicySchema>;
export type ReturnableDepositReconcileInput = z.infer<typeof returnableDepositReconcileSchema>;
