import { z } from "zod";

const id = z.string().uuid();
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveCents = cents.positive();
const name = z.string().trim().min(1).max(160);
const quantity = z
  .union([z.string().trim(), z.number().finite()])
  .refine(
    (value) => /^-?\d+(\.\d{1,6})?$/.test(String(value)),
    "Use no máximo seis casas decimais.",
  );
const positiveQuantity = quantity.refine(
  (value) => Number(value) > 0,
  "A quantidade deve ser positiva.",
);
const preciseQuantity = z
  .union([z.string().trim(), z.number().finite()])
  .transform((value) => String(value))
  .refine((value) => /^\d+(\.\d{1,6})?$/.test(value) && Number(value) > 0, {
    message: "Use até seis casas decimais e valor positivo.",
  });
const dimensionalUnit = z.enum(["mg", "g", "kg", "ml", "l", "unit", "dozen"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().datetime({ offset: true });

export const idempotencyKeySchema = z.string().trim().min(8).max(160);

export const stockLocationSchema = z.object({
  name: name.max(120),
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/),
});

export const inventoryItemSchema = z.object({
  productId: id.optional(),
  name,
  sku: z.string().trim().min(1).max(80).optional(),
  unit: dimensionalUnit,
  dimension: z.enum(["mass", "volume", "count"]).optional(),
  minimumQuantity: quantity.refine((value) => Number(value) >= 0).default("0"),
  allowNegative: z.boolean().default(false),
});

export const recipeConfigurationSchema = z.object({
  productId: id,
  yieldQuantity: preciseQuantity.optional(),
  yieldUnit: dimensionalUnit.optional(),
  components: z
    .array(
      z
        .object({
          inventoryItemId: id,
          locationId: id,
          quantity: preciseQuantity.optional(),
          unit: dimensionalUnit.optional(),
          quantityMilli: z.number().int().positive().max(1_000_000_000).optional(),
          lossBasisPoints: z.number().int().min(0).max(9_999).default(0),
        })
        .refine(
          (component) => component.quantity !== undefined || component.quantityMilli !== undefined,
          { message: "Informe quantity ou quantityMilli." },
        ),
    )
    .min(1)
    .max(500),
});

export const supplierSchema = z.object({
  name,
  document: z.string().trim().min(3).max(20).optional(),
  contactName: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().min(6).max(24).optional(),
});

export const inventoryEventSchema = z.object({
  type: z.enum(["loss", "count", "adjustment"]),
  reason: z.string().trim().min(3).max(1_000),
  occurredAt: instant.optional(),
  lines: z
    .array(z.object({ locationId: id, inventoryItemId: id, quantity }))
    .min(1)
    .max(500),
});

export const purchaseOrderSchema = z.object({
  supplierId: id,
  expectedAt: instant.optional(),
  items: z
    .array(z.object({ inventoryItemId: id, quantity: positiveQuantity, unitCostCents: cents }))
    .min(1)
    .max(500),
});

export const purchaseReceiptSchema = z.object({
  receivedAt: instant.optional(),
  competenceDate: date,
  dueDate: date,
  lines: z
    .array(z.object({ purchaseOrderItemId: id, locationId: id, quantity: positiveQuantity }))
    .min(1)
    .max(500),
});

export const payableSchema = z.object({
  supplierId: id.optional(),
  description: z.string().trim().min(3).max(240),
  amountCents: positiveCents,
  competenceDate: date,
  dueDate: date,
});

export const financialPaymentSchema = z.object({
  amountCents: positiveCents,
  method: z.string().trim().min(2).max(32),
  reference: z.string().trim().min(1).max(160).optional(),
  occurredAt: instant.optional(),
});

export const receivableSchema = z.object({
  sourceOrderId: id.optional(),
  description: z.string().trim().min(3).max(240),
  amountCents: positiveCents,
  competenceDate: date,
  dueDate: date,
  lines: z
    .array(
      z.object({
        productId: id.optional(),
        description: z.string().trim().min(1).max(180),
        revenueCents: cents,
        costCents: cents.nullable().optional(),
      }),
    )
    .max(500)
    .default([]),
});

export const receivablePaymentSchema = financialPaymentSchema.extend({
  cashShiftId: id.optional(),
});

export const openCashShiftSchema = z.object({ openingCents: cents });
export const cashMovementSchema = z.object({
  type: z.enum(["supply", "withdrawal"]),
  amountCents: positiveCents,
  reason: z.string().trim().min(3).max(1_000),
  occurredAt: instant.optional(),
});
export const closeCashShiftSchema = z.object({
  countedCents: cents,
  closeReason: z.string().trim().min(3).max(1_000).optional(),
});

export const reconciliationSchema = z.object({
  source: z.enum(["manual", "imported"]),
  fileHash: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  entries: z
    .array(
      z.object({
        paymentDirection: z.enum(["payable", "receivable"]),
        paymentId: id.optional(),
        externalKey: z.string().trim().min(1).max(160),
        grossCents: positiveCents,
        feeCents: cents.default(0),
        netCents: cents,
        status: z.enum(["matched", "unmatched", "divergent", "resolved"]),
        resolutionNote: z.string().trim().min(1).max(1_000).optional(),
      }),
    )
    .min(1)
    .max(5_000),
});

export const personSchema = z.object({
  identityId: id.optional(),
  name,
  employmentCode: z.string().trim().min(1).max(80).optional(),
  roleLabel: z.string().trim().min(1).max(80),
  hourlyRateCents: cents.optional(),
  hiredAt: date.optional(),
});

export const scheduleSchema = z
  .object({
    personId: id,
    startsAt: instant,
    endsAt: instant,
    breakMinutes: z.number().int().min(0).max(1_440).default(0),
    notes: z.string().trim().min(1).max(1_000).optional(),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "endsAt deve ser posterior a startsAt.",
  });

export const timeEntrySchema = z
  .object({
    personId: id,
    clockedInAt: instant,
    clockedOutAt: instant.optional(),
    source: z.enum(["manual", "terminal"]).default("manual"),
  })
  .refine(
    (value) => !value.clockedOutAt || new Date(value.clockedOutAt) > new Date(value.clockedInAt),
    {
      message: "clockedOutAt deve ser posterior a clockedInAt.",
    },
  );

export const clockOutSchema = z.object({ clockedOutAt: instant });

export const commissionRuleSchema = z.object({
  name: name.max(120),
  basisPoints: z.number().int().min(0).max(10_000),
});

export const commissionSchema = z.object({
  personId: id,
  ruleId: id.optional(),
  sourceOrderId: id.optional(),
  baseCents: cents,
  amountCents: cents.optional(),
});

export const reportPeriodSchema = z
  .object({ from: date, to: date })
  .refine((value) => value.from <= value.to, { message: "from deve ser anterior ou igual a to." });

export type StockLocationInput = z.infer<typeof stockLocationSchema>;
export type InventoryItemInput = z.infer<typeof inventoryItemSchema>;
export type RecipeConfigurationInput = z.infer<typeof recipeConfigurationSchema>;
export type SupplierInput = z.infer<typeof supplierSchema>;
export type InventoryEventInput = z.infer<typeof inventoryEventSchema>;
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export type PurchaseReceiptInput = z.infer<typeof purchaseReceiptSchema>;
export type PayableInput = z.infer<typeof payableSchema>;
export type FinancialPaymentInput = z.infer<typeof financialPaymentSchema>;
export type ReceivableInput = z.infer<typeof receivableSchema>;
export type ReceivablePaymentInput = z.infer<typeof receivablePaymentSchema>;
export type OpenCashShiftInput = z.infer<typeof openCashShiftSchema>;
export type CashMovementInput = z.infer<typeof cashMovementSchema>;
export type CloseCashShiftInput = z.infer<typeof closeCashShiftSchema>;
export type ReconciliationInput = z.infer<typeof reconciliationSchema>;
export type PersonInput = z.infer<typeof personSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type TimeEntryInput = z.infer<typeof timeEntrySchema>;
export type ClockOutInput = z.infer<typeof clockOutSchema>;
export type CommissionRuleInput = z.infer<typeof commissionRuleSchema>;
export type CommissionInput = z.infer<typeof commissionSchema>;
export type ReportPeriodInput = z.infer<typeof reportPeriodSchema>;
