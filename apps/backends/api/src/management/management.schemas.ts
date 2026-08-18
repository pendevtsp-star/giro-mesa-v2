import { z } from "zod";
import { COMMISSION_CENTS_MAX } from "./management.rules.js";

const id = z.string().uuid();
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveCents = cents.positive();
const name = z.string().trim().min(1).max(160);
const quantity = z
  .union([z.string().trim(), z.number().finite()])
  .refine(
    (value) => /^-?\d+(\.\d{1,3})?$/.test(String(value)),
    "Use no máximo três casas decimais.",
  );
const positiveQuantity = quantity.refine(
  (value) => Number(value) > 0,
  "A quantidade deve ser positiva.",
);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, "Informe uma data válida.");
const reportDate = date.refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}, "Data inválida.");
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

export const stockLocationUpdateSchema = stockLocationSchema
  .partial()
  .extend({ active: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos uma alteração." });

export const inventoryItemSchema = z.object({
  productId: id.optional(),
  preferredSupplierId: id.optional(),
  name,
  kind: z
    .enum(["ingredient", "prepared", "resale", "reusable", "returnable_container"])
    .default("ingredient"),
  sku: z.string().trim().min(1).max(80).optional(),
  barcode: z.string().trim().min(3).max(80).optional(),
  unit: z.string().trim().min(1).max(20),
  purchaseUnit: z.string().trim().min(1).max(20).optional(),
  purchaseToStockFactor: positiveQuantity.default("1"),
  minimumQuantity: quantity.refine((value) => Number(value) >= 0).default("0"),
  reorderQuantity: quantity.refine((value) => Number(value) >= 0).default("0"),
  leadTimeDays: z.number().int().min(0).max(365).default(0),
  allowNegative: z.boolean().default(false),
});

const inventoryItemKind = z.enum([
  "ingredient",
  "prepared",
  "resale",
  "reusable",
  "returnable_container",
]);

export const nfeImportSchema = z.object({
  xml: z.string().trim().min(1).max(7_000_000),
  supplierId: id.optional(),
});

const nfeNewItemSchema = z
  .object({
    productId: id.optional(),
    name,
    kind: inventoryItemKind,
    unit: z.string().trim().min(1).max(20),
    sku: z.string().trim().min(1).max(80).optional(),
    barcode: z.string().trim().min(3).max(80).optional(),
    purchaseUnit: z.string().trim().min(1).max(20).optional(),
    purchaseToStockFactor: positiveQuantity.default("1"),
  })
  .refine((value) => value.kind !== "resale" || value.productId, {
    path: ["productId"],
    message: "Item de revenda deve estar vinculado a um produto do cardápio.",
  });

export const nfeImportReviewSchema = z.object({
  supplierId: id.optional(),
  lines: z
    .array(
      z
        .object({
          lineId: id,
          status: z.enum(["matched", "new", "ignored"]),
          inventoryItemId: id.optional(),
          newItem: nfeNewItemSchema.optional(),
        })
        .superRefine((line, context) => {
          if (line.status === "matched" && !line.inventoryItemId)
            context.addIssue({
              code: "custom",
              path: ["inventoryItemId"],
              message: "Selecione o item de estoque.",
            });
          if (line.status === "new" && !line.newItem)
            context.addIssue({
              code: "custom",
              path: ["newItem"],
              message: "Informe os dados do novo item.",
            });
          if (line.status === "ignored" && (line.inventoryItemId || line.newItem))
            context.addIssue({
              code: "custom",
              message: "Uma linha ignorada não pode vincular ou criar item.",
            });
        }),
    )
    .min(1)
    .max(500),
});

export const nfeImportConfirmSchema = z
  .object({
    locationId: id,
    receivedAt: instant.optional(),
    acceptTotalDivergence: z.boolean().default(false),
    divergenceReason: z.string().trim().min(5).max(500).optional(),
  })
  .refine((value) => !value.acceptTotalDivergence || value.divergenceReason, {
    path: ["divergenceReason"],
    message: "Informe o motivo para aceitar a divergência do total da NF-e.",
  });

export const productReturnableSchema = z.object({
  productId: id,
  containerInventoryItemId: id,
  quantityPerUnit: positiveQuantity.default("1"),
  depositCents: cents.default(0),
  active: z.boolean().default(true),
});

export const returnableCustodyConfirmSchema = z.object({
  containerInventoryItemId: id,
  locationId: id,
  quantity: positiveQuantity,
  orderId: id.optional(),
  note: z.string().trim().min(3).max(1_000).optional(),
});

export const returnableIncidentSchema = z
  .object({
    movementId: id.optional(),
    containerInventoryItemId: id,
    locationId: id.optional(),
    orderId: id.optional(),
    type: z.enum(["breakage", "loss", "suspected_theft", "recording_error", "other"]),
    quantity: positiveQuantity,
    note: z.string().trim().min(3).max(1_000),
    evidence: z.array(z.string().trim().url().max(2_000)).max(10).default([]),
  })
  .refine((value) => value.movementId || value.locationId, {
    path: ["locationId"],
    message: "Vincule a custódia ou informe o local da perda física.",
  });

export const returnableIncidentReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(5).max(1_000),
});

export const returnableSupplierExchangeSchema = z.object({
  containerInventoryItemId: id,
  locationId: id,
  supplierId: id,
  quantity: positiveQuantity,
  note: z.string().trim().min(3).max(1_000),
});

export const inventoryItemUpdateSchema = inventoryItemSchema
  .partial()
  .extend({
    active: z.boolean().optional(),
    productId: id.nullable().optional(),
    preferredSupplierId: id.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos uma alteração." });

export const recipeConfigurationSchema = z.object({
  productId: id,
  components: z
    .array(
      z.object({
        inventoryItemId: id,
        locationId: id,
        quantityMilli: z.number().int().positive().max(1_000_000_000),
        lossBasisPoints: z.number().int().min(0).max(9_999).default(0),
      }),
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
  address: z.string().trim().min(3).max(500).optional(),
  notes: z.string().trim().min(1).max(1_000).optional(),
});

export const supplierUpdateSchema = supplierSchema
  .extend({ active: z.boolean().optional(), version: z.number().int().positive() })
  .partial({ name: true })
  .refine((value) => Object.keys(value).some((key) => key !== "version"), {
    message: "Informe ao menos uma alteração.",
  });

export const supplierListQuerySchema = z.object({
  search: z.string().trim().max(160).optional(),
  active: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const inventoryEventSchema = z.object({
  type: z.enum(["loss", "count", "adjustment"]),
  reason: z.string().trim().min(3).max(1_000),
  occurredAt: instant.optional(),
  lines: z
    .array(
      z.object({
        locationId: id,
        inventoryItemId: id,
        lotId: id.optional(),
        quantity,
        expectedPreviousQuantity: quantity.optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const inventoryReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(5).max(1_000),
});

export const inventoryTransferResolutionSchema = z.object({
  decision: z.enum(["received", "canceled"]),
  note: z.string().trim().min(3).max(1_000),
});

export const inventoryAssetSchema = z.object({
  inventoryItemId: id,
  locationId: id,
  assetTag: z.string().trim().min(2).max(80),
  status: z.enum(["in_use", "maintenance", "damaged", "retired"]).default("in_use"),
  condition: z.enum(["good", "fair", "poor", "unusable"]).default("good"),
  responsibleIdentityId: id.optional(),
  acquiredAt: instant.optional(),
  lastMaintenanceAt: instant.optional(),
  notes: z.string().trim().min(2).max(1_000).optional(),
});

export const inventoryAssetUpdateSchema = inventoryAssetSchema
  .partial()
  .extend({ responsibleIdentityId: id.nullable().optional(), version: z.number().int().positive() })
  .refine((value) => Object.keys(value).some((key) => key !== "version"), {
    message: "Informe ao menos uma alteração.",
  });

export const inventoryTransferSchema = z
  .object({
    inventoryItemId: id,
    sourceLocationId: id,
    destinationLocationId: id,
    quantity: positiveQuantity,
    reason: z.string().trim().min(3).max(1_000),
    lotId: id.optional(),
  })
  .refine((value) => value.sourceLocationId !== value.destinationLocationId, {
    message: "Origem e destino devem ser diferentes.",
    path: ["destinationLocationId"],
  });

export const inventoryLotSchema = z.object({
  inventoryItemId: id,
  locationId: id,
  batchCode: z.string().trim().min(1).max(80),
  expiresAt: instant.optional(),
  quantity: positiveQuantity,
  unitCostCents: cents.optional(),
});

export const inventoryLotUpdateSchema = z
  .object({
    batchCode: z.string().trim().min(1).max(80).optional(),
    expiresAt: instant.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos uma alteração." });

export const inventoryReservationSchema = z.object({
  inventoryItemId: id,
  locationId: id,
  quantity: positiveQuantity,
  sourceType: z.enum(["order", "scheduled_order", "event", "manual"]),
  sourceId: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(3).max(1_000),
  expiresAt: instant.optional(),
});

export const inventoryReservationResolutionSchema = z.object({
  decision: z.enum(["consumed", "released", "canceled"]),
  note: z.string().trim().min(3).max(1_000),
});

export const productionBatchSchema = z.object({
  outputInventoryItemId: id,
  outputLocationId: id,
  batchCode: z.string().trim().min(1).max(80),
  plannedQuantity: positiveQuantity,
  expiresAt: instant.optional(),
  notes: z.string().trim().max(2_000).optional(),
  inputs: z
    .array(
      z.object({
        inventoryItemId: id,
        locationId: id,
        lotId: id.optional(),
        plannedQuantity: positiveQuantity,
      }),
    )
    .min(1)
    .max(100),
});

export const productionBatchCompletionSchema = z.object({
  actualQuantity: positiveQuantity,
  expiresAt: instant.optional(),
  inputs: z
    .array(z.object({ inputId: id, actualQuantity: positiveQuantity }))
    .min(1)
    .max(100),
});

export const productionBatchCancellationSchema = z.object({
  reason: z.string().trim().min(3).max(1_000),
});

export const interunitTransferSchema = z.object({
  destinationUnitId: id,
  reason: z.string().trim().min(3).max(1_000),
  lines: z
    .array(
      z.object({
        sourceInventoryItemId: id,
        destinationInventoryItemId: id,
        sourceLocationId: id,
        destinationLocationId: id,
        sourceLotId: id.optional(),
        quantity: positiveQuantity,
      }),
    )
    .min(1)
    .max(100),
});

export const interunitTransferReceiptSchema = z.object({
  note: z.string().trim().min(3).max(1_000),
  lines: z
    .array(z.object({ lineId: id, quantity: positiveQuantity }))
    .min(1)
    .max(100),
});

export const interunitTransferCancellationSchema = z.object({
  reason: z.string().trim().min(3).max(1_000),
});

export const inventoryClosingSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  notes: z.string().trim().max(2_000).optional(),
});

export const purchaseOrderSchema = z.object({
  supplierId: id,
  expectedAt: instant.optional(),
  items: z
    .array(
      z.object({ inventoryItemId: id, quantity: positiveQuantity, unitCostCents: positiveCents }),
    )
    .min(1)
    .max(500),
});

export const purchaseOrderUpdateSchema = purchaseOrderSchema
  .extend({ version: z.number().int().positive() })
  .partial({ supplierId: true, expectedAt: true, items: true })
  .refine((value) => Object.keys(value).some((key) => key !== "version"), {
    message: "Informe ao menos uma alteração.",
  });

export const purchaseTransitionSchema = z.object({
  reason: z.string().trim().min(3).max(1_000),
  version: z.number().int().positive(),
});

export const purchaseVersionSchema = z.object({ version: z.number().int().positive() });

export const purchaseReversalSchema = z.object({
  reason: z.string().trim().min(3).max(1_000),
  version: z.number().int().positive(),
});

export const purchaseListQuerySchema = z.object({
  search: z.string().trim().max(160).optional(),
  supplierId: id.optional(),
  status: z
    .enum(["draft", "rejected", "approved", "partially_received", "received", "canceled"])
    .optional(),
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const purchaseReceiptSchema = z.object({
  receivedAt: instant.optional(),
  competenceDate: date.optional(),
  dueDate: date.optional(),
  lines: z
    .array(
      z
        .object({
          purchaseOrderItemId: id,
          locationId: id,
          quantity: positiveQuantity,
          batchCode: z.string().trim().min(1).max(80).optional(),
          expiresAt: instant.optional(),
          unitCostCents: positiveCents.optional(),
        })
        .refine((line) => !line.expiresAt || line.batchCode, {
          message: "Informe o lote quando houver validade.",
          path: ["batchCode"],
        }),
    )
    .min(1)
    .max(500),
});

export const supplierInvoiceSchema = z
  .object({
    documentNumber: z.string().trim().min(1).max(80),
    issuedAt: date,
    competenceDate: date,
    dueDate: date,
    totalCents: positiveCents,
    accessKey: z
      .string()
      .trim()
      .regex(/^\d{44}$/)
      .optional(),
    xmlContent: z.string().trim().min(1).optional(),
    series: z
      .string()
      .trim()
      .regex(/^\d{1,3}$/)
      .optional(),
    model: z.enum(["55", "65"]).optional(),
    taxTotalCents: cents.optional(),
    toleranceCents: cents.default(0),
    confirmIfMatched: z.boolean().default(false),
    lines: z
      .array(
        z.object({
          purchaseOrderItemId: id,
          quantity: positiveQuantity,
          unitCostCents: positiveCents,
        }),
      )
      .min(1)
      .max(500),
  })
  .refine((value) => value.dueDate >= value.issuedAt, {
    message: "O vencimento não pode ser anterior à emissão.",
    path: ["dueDate"],
  })
  .refine((value) => !value.accessKey || value.xmlContent, {
    message: "Informe o XML correspondente à chave da NF-e.",
    path: ["xmlContent"],
  })
  .refine((value) => !value.xmlContent || value.accessKey, {
    message: "Informe a chave de acesso correspondente ao XML da NF-e.",
    path: ["accessKey"],
  })
  .refine(
    (value) =>
      !value.accessKey ||
      (value.series !== undefined &&
        value.model !== undefined &&
        value.taxTotalCents !== undefined),
    {
      message: "Informe série, modelo e total de impostos da NF-e.",
      path: ["accessKey"],
    },
  );

export const purchaseReconciliationSchema = z.object({
  toleranceCents: cents.default(0),
  version: z.number().int().positive(),
});

export const purchaseInvoiceConfirmSchema = z
  .object({
    toleranceCents: cents.optional(),
    acceptDivergence: z.boolean().default(false),
    reason: z.string().trim().min(5).max(500).optional(),
    version: z.number().int().positive(),
  })
  .refine((value) => !value.acceptDivergence || value.reason, {
    message: "Informe o motivo para confirmar uma fatura divergente.",
    path: ["reason"],
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

export const personUpdateSchema = personSchema
  .partial()
  .extend({
    identityId: id.nullable().optional(),
    employmentCode: z.string().trim().min(1).max(80).nullable().optional(),
    hourlyRateCents: cents.nullable().optional(),
    hiredAt: date.nullable().optional(),
    expectedUpdatedAt: instant.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos uma alteração." });

export const personStatusSchema = z.object({
  reason: z.string().trim().min(5).max(1_000),
});

export const peopleListQuerySchema = z.object({
  q: z.string().trim().max(160).optional(),
  status: z.enum(["all", "active", "inactive", "unlinked", "on_shift"]).default("all"),
  role: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const scheduleFieldsSchema = z.object({
  personId: id,
  startsAt: instant,
  endsAt: instant,
  breakMinutes: z.number().int().min(0).max(1_440).default(0),
  notes: z.string().trim().min(1).max(1_000).optional(),
});

export const scheduleSchema = scheduleFieldsSchema.refine(
  (value) => new Date(value.endsAt) > new Date(value.startsAt),
  {
    message: "endsAt deve ser posterior a startsAt.",
  },
);

export const scheduleUpdateSchema = scheduleFieldsSchema
  .omit({ personId: true })
  .partial()
  .extend({
    notes: z.string().trim().min(1).max(1_000).nullable().optional(),
    expectedUpdatedAt: instant.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos uma alteração." })
  .superRefine((value, context) => {
    if (value.startsAt && value.endsAt && new Date(value.endsAt) <= new Date(value.startsAt)) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "endsAt deve ser posterior a startsAt.",
      });
    }
  });

export const scheduleCancelSchema = z.object({
  reason: z.string().trim().min(5).max(1_000),
});

export const scheduleBatchSchema = z.object({
  schedules: z.array(scheduleSchema).min(1).max(100),
});

export const peopleAssignmentBatchSchema = z.object({
  personIds: z.array(id).min(1).max(500),
  enabled: z.boolean(),
});

export const peopleExportSchema = z.object({
  personIds: z.array(id).min(1).max(500),
  format: z.enum(["json", "csv"]).default("csv"),
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

const punchLocationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().int().min(0).max(10_000).optional(),
  deviceId: z.string().trim().min(8).max(160).optional(),
  mockLocationDetected: z.boolean().optional(),
});

export const timeTrackingSettingsSchema = z
  .object({
    mode: z.enum(["off", "all", "selected"]),
    geofenceEnabled: z.boolean().default(true),
    locationLabel: z.string().trim().min(2).max(160).optional(),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
    radiusMeters: z.number().int().min(25).max(5_000),
    accuracyToleranceMeters: z.number().int().min(0).max(500),
    managerCanView: z.boolean().default(false),
    financeCanView: z.boolean().default(false),
    antiFraudEnabled: z.boolean().default(true),
    offlineEnabled: z.boolean().default(true),
    notificationsEnabled: z.boolean().default(true),
    managerAlertOnAnomaly: z.boolean().default(true),
    lateToleranceMinutes: z.number().int().min(0).max(120).default(15),
    minimumBreakMinutes: z.number().int().min(0).max(1_440).default(0),
    maxOvertimeMinutes: z.number().int().min(0).max(720).default(120),
    longShiftAlertMinutes: z.number().int().min(60).max(1_440).default(720),
    reminderBeforeShiftMinutes: z.number().int().min(0).max(240).default(15),
    reminderAfterShiftMinutes: z.number().int().min(0).max(240).default(15),
    selectedPersonIds: z.array(id).max(500).default([]),
  })
  .superRefine((value, context) => {
    if (
      value.mode !== "off" &&
      value.geofenceEnabled &&
      (value.latitude === undefined || value.longitude === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["latitude"],
        message: "Informe a localização da unidade.",
      });
    }
    if (value.mode === "selected" && value.selectedPersonIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["selectedPersonIds"],
        message: "Selecione ao menos um funcionário.",
      });
    }
  });

const capturedAt = instant.optional();

export const selfClockInSchema = punchLocationSchema.extend({ capturedAt });
export const selfBreakSchema = punchLocationSchema.extend({
  type: z.enum(["meal", "temporary"]),
  capturedAt,
});
export const selfClockOutSchema = punchLocationSchema.extend({ capturedAt });
export const completeBreakSchema = punchLocationSchema.extend({ capturedAt });

export const timeCorrectionSchema = z
  .object({
    timeEntryId: id,
    clockedInAt: instant,
    clockedOutAt: instant.optional(),
    reason: z.string().trim().min(5).max(1_000),
  })
  .refine(
    (value) => !value.clockedOutAt || new Date(value.clockedOutAt) > new Date(value.clockedInAt),
    { message: "A saída corrigida deve ser posterior à entrada." },
  );

export const timeCorrectionDecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reviewNote: z.string().trim().min(2).max(1_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.decision === "reject" && !value.reviewNote) {
      context.addIssue({
        code: "custom",
        path: ["reviewNote"],
        message: "Informe o motivo da rejeição.",
      });
    }
  });

export const timeTrackingClosureSchema = z
  .object({
    from: reportDate,
    to: reportDate,
    reason: z.string().trim().min(5).max(1_000).optional(),
  })
  .refine((value) => value.from <= value.to, {
    path: ["to"],
    message: "O fim do fechamento deve ser posterior ou igual ao início.",
  });

export const commissionRuleSchema = z.object({
  name: name.max(120),
  basisPoints: z.number().int().min(0).max(10_000),
});

export const commissionSchema = z.object({
  personId: id,
  ruleId: id.optional(),
  sourceOrderId: id.optional(),
  baseCents: cents.max(COMMISSION_CENTS_MAX),
  amountCents: cents.max(COMMISSION_CENTS_MAX).optional(),
});

export const commissionTransitionSchema = z.object({
  action: z.enum(["approve", "reject", "pay", "cancel"]),
  note: z.string().trim().min(2).max(1_000),
});

export const reportPeriodSchema = z
  .object({
    from: reportDate,
    to: reportDate,
    comparisonMode: z.enum(["previous_period", "previous_year", "none"]).default("previous_period"),
  })
  .superRefine((value, context) => {
    const from = Date.parse(`${value.from}T00:00:00.000Z`);
    const to = Date.parse(`${value.to}T00:00:00.000Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    if (from > to) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "from deve ser anterior ou igual a to.",
      });
    } else if (to - from > 366 * 86_400_000) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "O período máximo é de 366 dias.",
      });
    }
  });

export const overviewSourceSchema = z.enum([
  "operationalShift",
  "operations",
  "inventory",
  "finance",
  "cash",
  "delivery",
  "reservations",
  "activity",
  "multiunit",
]);

export const overviewQuerySchema = z.object({
  source: overviewSourceSchema.optional(),
});

export const overviewPriorityActionSchema = z
  .object({
    occurrenceKey: z.string().regex(/^[a-f0-9]{64}$/),
    action: z.enum(["claim", "snooze", "resolve"]),
    snoozeMinutes: z.number().int().min(5).max(1440).optional(),
  })
  .superRefine((value, context) => {
    if (value.action === "snooze" && value.snoozeMinutes === undefined) {
      context.addIssue({
        code: "custom",
        path: ["snoozeMinutes"],
        message: "Informe por quantos minutos a prioridade será adiada.",
      });
    }
    if (value.action !== "snooze" && value.snoozeMinutes !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["snoozeMinutes"],
        message: "snoozeMinutes só pode ser usado ao adiar uma prioridade.",
      });
    }
  });

export const overviewPreferencesSchema = z.object({
  alertsEnabled: z.boolean(),
  minimumTone: z.enum(["info", "warning", "danger"]),
  digestMinutes: z.number().int().min(5).max(1440),
  thresholds: z
    .object({
      kdsDelayMinutes: z.number().int().min(5).max(120),
      stockCoverageDays: z.number().int().min(1).max(60),
      deliveryRiskMinutes: z.number().int().min(0).max(120),
      salesGoalCents: cents.max(100_000_000),
      maxKdsDelayed: z.number().int().min(0).max(1_000),
      maxStockouts: z.number().int().min(0).max(1_000),
      maxDeliveryDelayed: z.number().int().min(0).max(1_000),
      maxReconciliations: z.number().int().min(0).max(10_000),
    })
    .strict(),
});

export type StockLocationInput = z.infer<typeof stockLocationSchema>;
export type StockLocationUpdateInput = z.infer<typeof stockLocationUpdateSchema>;
export type InventoryItemInput = z.infer<typeof inventoryItemSchema>;
export type InventoryItemUpdateInput = z.infer<typeof inventoryItemUpdateSchema>;
export type NfeImportInput = z.infer<typeof nfeImportSchema>;
export type NfeImportReviewInput = z.infer<typeof nfeImportReviewSchema>;
export type NfeImportConfirmInput = z.infer<typeof nfeImportConfirmSchema>;
export type ProductReturnableInput = z.infer<typeof productReturnableSchema>;
export type ReturnableCustodyConfirmInput = z.infer<typeof returnableCustodyConfirmSchema>;
export type ReturnableIncidentInput = z.infer<typeof returnableIncidentSchema>;
export type ReturnableIncidentReviewInput = z.infer<typeof returnableIncidentReviewSchema>;
export type ReturnableSupplierExchangeInput = z.infer<typeof returnableSupplierExchangeSchema>;
export type InventoryTransferInput = z.infer<typeof inventoryTransferSchema>;
export type InventoryTransferResolutionInput = z.infer<typeof inventoryTransferResolutionSchema>;
export type InventoryReviewInput = z.infer<typeof inventoryReviewSchema>;
export type InventoryAssetInput = z.infer<typeof inventoryAssetSchema>;
export type InventoryAssetUpdateInput = z.infer<typeof inventoryAssetUpdateSchema>;
export type InventoryLotInput = z.infer<typeof inventoryLotSchema>;
export type InventoryLotUpdateInput = z.infer<typeof inventoryLotUpdateSchema>;
export type InventoryReservationInput = z.infer<typeof inventoryReservationSchema>;
export type InventoryReservationResolutionInput = z.infer<
  typeof inventoryReservationResolutionSchema
>;
export type ProductionBatchInput = z.infer<typeof productionBatchSchema>;
export type ProductionBatchCompletionInput = z.infer<typeof productionBatchCompletionSchema>;
export type ProductionBatchCancellationInput = z.infer<typeof productionBatchCancellationSchema>;
export type InterunitTransferInput = z.infer<typeof interunitTransferSchema>;
export type InterunitTransferReceiptInput = z.infer<typeof interunitTransferReceiptSchema>;
export type InterunitTransferCancellationInput = z.infer<
  typeof interunitTransferCancellationSchema
>;
export type InventoryClosingInput = z.infer<typeof inventoryClosingSchema>;
export type RecipeConfigurationInput = z.infer<typeof recipeConfigurationSchema>;
export type SupplierInput = z.infer<typeof supplierSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;
export type InventoryEventInput = z.infer<typeof inventoryEventSchema>;
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export type PurchaseOrderUpdateInput = z.infer<typeof purchaseOrderUpdateSchema>;
export type PurchaseTransitionInput = z.infer<typeof purchaseTransitionSchema>;
export type PurchaseVersionInput = z.infer<typeof purchaseVersionSchema>;
export type PurchaseReversalInput = z.infer<typeof purchaseReversalSchema>;
export type PurchaseListQuery = z.infer<typeof purchaseListQuerySchema>;
export type PurchaseReceiptInput = z.infer<typeof purchaseReceiptSchema>;
export type SupplierInvoiceInput = z.infer<typeof supplierInvoiceSchema>;
export type PurchaseReconciliationInput = z.infer<typeof purchaseReconciliationSchema>;
export type PurchaseInvoiceConfirmInput = z.infer<typeof purchaseInvoiceConfirmSchema>;
export type PayableInput = z.infer<typeof payableSchema>;
export type FinancialPaymentInput = z.infer<typeof financialPaymentSchema>;
export type ReceivableInput = z.infer<typeof receivableSchema>;
export type ReceivablePaymentInput = z.infer<typeof receivablePaymentSchema>;
export type OpenCashShiftInput = z.infer<typeof openCashShiftSchema>;
export type CashMovementInput = z.infer<typeof cashMovementSchema>;
export type CloseCashShiftInput = z.infer<typeof closeCashShiftSchema>;
export type ReconciliationInput = z.infer<typeof reconciliationSchema>;
export type PersonInput = z.infer<typeof personSchema>;
export type PersonUpdateInput = z.infer<typeof personUpdateSchema>;
export type PersonStatusInput = z.infer<typeof personStatusSchema>;
export type PeopleListQuery = z.infer<typeof peopleListQuerySchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateSchema>;
export type ScheduleCancelInput = z.infer<typeof scheduleCancelSchema>;
export type ScheduleBatchInput = z.infer<typeof scheduleBatchSchema>;
export type PeopleAssignmentBatchInput = z.infer<typeof peopleAssignmentBatchSchema>;
export type PeopleExportInput = z.infer<typeof peopleExportSchema>;
export type TimeEntryInput = z.infer<typeof timeEntrySchema>;
export type ClockOutInput = z.infer<typeof clockOutSchema>;
export type PunchLocationInput = z.infer<typeof punchLocationSchema>;
export type TimeTrackingSettingsInput = z.infer<typeof timeTrackingSettingsSchema>;
export type TimeTrackingClosureInput = z.infer<typeof timeTrackingClosureSchema>;
export type SelfBreakInput = z.infer<typeof selfBreakSchema>;
export type SelfClockInInput = z.infer<typeof selfClockInSchema>;
export type SelfClockOutInput = z.infer<typeof selfClockOutSchema>;
export type TimeCorrectionInput = z.infer<typeof timeCorrectionSchema>;
export type TimeCorrectionDecisionInput = z.infer<typeof timeCorrectionDecisionSchema>;
export type CommissionRuleInput = z.infer<typeof commissionRuleSchema>;
export type CommissionInput = z.infer<typeof commissionSchema>;
export type CommissionTransitionInput = z.infer<typeof commissionTransitionSchema>;
export type ReportPeriodInput = z.infer<typeof reportPeriodSchema>;
export type OverviewSourceInput = z.infer<typeof overviewSourceSchema>;
export type OverviewQueryInput = z.infer<typeof overviewQuerySchema>;
export type OverviewPriorityActionInput = z.infer<typeof overviewPriorityActionSchema>;
export type OverviewPreferencesInput = z.infer<typeof overviewPreferencesSchema>;
