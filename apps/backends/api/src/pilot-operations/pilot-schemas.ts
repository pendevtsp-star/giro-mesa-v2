import {
  integratedPaymentMethodSchema,
  paymentAttemptCreateSchema,
  paymentAttemptStatusSchema,
  paymentDeviceCredentialRotateSchema,
  paymentDeviceDiagnosticsSchema,
  paymentDevicePairingCreateSchema,
  paymentDevicePairingRedeemSchema,
  paymentDeviceResultSchema,
  paymentHomologationRunSchema,
  paymentReconciliationInputSchema,
  paymentReconciliationStatusSchema,
  paymentReversalCreateSchema,
  paymentTerminalCertificationSchema,
  paymentTerminalConfigurationSchema,
  paymentTerminalProviderSchema,
  paymentTerminalStatusSchema,
} from "@giromesa/contracts";
import { z } from "zod";
import { MAX_STORED_CENTS } from "./pilot-rules.js";

const id = z.string().uuid();
const cents = z.number().int().nonnegative().max(MAX_STORED_CENTS);
const shortName = z.string().trim().min(1).max(160);
const httpUrl = z
  .string()
  .url()
  .max(2_000)
  .refine((value) => /^https?:\/\//i.test(value), "Use uma URL HTTP(S).");
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(100);
const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const floorCoordinate = z.number().int().min(-1_000_000).max(1_000_000);
const fulfillmentType = z.enum(["dine_in", "pickup", "delivery"]);
export const serviceModeSchema = z.enum(["full_service", "quick_service", "bar", "hybrid"]);
const orderCourse = z.enum(["anytime", "starter", "main", "dessert"]);
const optionalPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{8,30}$/)
  .optional();
const optionalDateTime = z.string().datetime({ offset: true }).optional();
const futureDateTime = z
  .string()
  .datetime({ offset: true })
  .refine((value) => new Date(value).getTime() >= Date.now() - 60_000, "Informe um prazo futuro.");
export const availabilityScheduleSchema = z.object({
  windows: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        start: clockTime,
        end: clockTime,
      }),
    )
    .min(1)
    .max(50),
});

export const categorySchema = z.object({
  name: shortName.max(120),
  slug,
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const updateCategorySchema = z.object({
  name: shortName.max(120).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
  channels: z
    .array(z.enum(["salon", "delivery", "qr", "pickup"]))
    .min(1)
    .max(4)
    .optional(),
  schedule: availabilityScheduleSchema.nullable().optional(),
  defaultStationId: id.nullable().optional(),
});

export const allergenSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]+$/)
    .max(40),
  name: shortName.max(100),
});

export const modifierGroupSchema = z
  .object({
    name: shortName.max(120),
    minimumSelections: z.number().int().min(0).max(50).default(0),
    maximumSelections: z.number().int().min(1).max(50).default(1),
    options: z
      .array(
        z.object({
          name: shortName.max(120),
          priceDeltaCents: cents.default(0),
          sortOrder: z.number().int().min(0).max(10_000).default(0),
        }),
      )
      .min(0)
      .max(100),
  })
  .refine((value) => value.minimumSelections <= value.maximumSelections, {
    message: "minimumSelections must be <= maximumSelections",
  });

export const stationSchema = z.object({
  name: shortName.max(120),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]+$/)
    .max(40),
});

const stationRoutingSchema = z
  .array(z.object({ stationId: id, stage: z.number().int().min(1).max(20) }).strict())
  .max(50)
  .optional();

const validateStationRouting = (
  value: { stationIds: string[]; stationRouting?: { stationId: string; stage: number }[] },
  context: z.RefinementCtx,
) => {
  if (!value.stationRouting) return;
  const routeIds = value.stationRouting.map((route) => route.stationId);
  if (
    new Set(routeIds).size !== routeIds.length ||
    [...new Set(value.stationIds)].sort().join(":") !== [...routeIds].sort().join(":")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["stationRouting"],
      message: "stationRouting deve conter exatamente uma etapa para cada praça selecionada.",
    });
  }
};

const productBaseSchema = z.object({
  categoryId: id,
  sku: z.string().trim().max(80).optional(),
  ean: z
    .string()
    .regex(/^\d{8,14}$/)
    .optional(),
  productType: z.enum(["prepared", "resale"]).optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  name: shortName,
  description: z.string().trim().max(2_000).optional(),
  imageUrl: httpUrl.nullable().optional(),
  estimatedPrepTimeMinutes: z.number().int().min(0).max(1440).optional(),
  allergenIds: z.array(id).max(50).default([]),
  modifierGroupIds: z.array(id).max(50).default([]),
  stationIds: z.array(id).min(1).max(50),
  stationRouting: stationRoutingSchema,
  recipe: z
    .array(
      z.object({
        ingredientName: shortName,
        quantityMilli: z.number().int().positive().max(1_000_000_000),
        unit: z.string().trim().min(1).max(20),
        lossBasisPoints: z.number().int().min(0).max(10_000).default(0),
      }),
    )
    .max(300)
    .default([]),
  priceCents: cents,
  deliveryPriceCents: cents.nullable().optional(),
  costCents: cents.nullable().optional(),
  available: z.boolean().default(true),
  availabilitySchedule: availabilityScheduleSchema.nullable().optional(),
  dailyStock: z.number().int().min(0).max(1_000_000).nullable().optional(),
  autoDeductStock: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  dietaryFlags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  spiciness: z.number().int().min(0).max(5).nullable().optional(),
  pairing: z.string().trim().max(500).nullable().optional(),
  suggestedProductIds: z.array(id).max(50).optional(),
  sizes: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(40),
        name: shortName.max(80),
        priceCents: cents,
      }),
    )
    .max(30)
    .optional(),
  translations: z
    .record(
      z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
      z.object({ name: shortName, description: z.string().trim().max(2_000).optional() }),
    )
    .refine((value) => Object.keys(value).length <= 10, "No máximo 10 traduções.")
    .optional(),
  fiscal: z
    .object({
      ncm: z
        .string()
        .regex(/^\d{8}$/)
        .optional(),
      cfop: z
        .string()
        .regex(/^\d{4}$/)
        .optional(),
      cest: z
        .string()
        .regex(/^\d{7}$/)
        .optional(),
      origin: z.number().int().min(0).max(8).optional(),
    })
    .optional(),
});

export const productSchema = productBaseSchema.superRefine(validateStationRouting);

export const updateProductSchema = z.object({
  categoryId: id.optional(),
  name: shortName.optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  imageUrl: httpUrl.nullable().optional(),
  estimatedPrepTimeMinutes: z.number().int().min(0).max(1440).nullable().optional(),
});

export const productUnitConfigSchema = z
  .object({
    priceCents: cents,
    deliveryPriceCents: cents.nullable().optional(),
    costCents: cents.nullable().optional(),
    available: z.boolean(),
    availabilitySchedule: availabilityScheduleSchema.nullable().optional(),
    stationIds: z.array(id).min(1).max(50),
    stationRouting: stationRoutingSchema,
    dailyStock: z.number().int().min(0).max(1_000_000).nullable().optional(),
    autoDeductStock: z.boolean().default(false),
  })
  .superRefine(validateStationRouting);

export const aggregateProductSchema = productSchema;
export const reorderSchema = z
  .object({
    items: z
      .array(z.object({ id, sortOrder: z.number().int().min(0).max(100_000) }))
      .min(1)
      .max(10_000),
  })
  .refine(
    ({ items }) => new Set(items.map(({ id: itemId }) => itemId)).size === items.length,
    "IDs repetidos.",
  );
export const categoryAvailabilitySchema = z.object({ available: z.boolean() });
export const bulkPriceSchema = z
  .object({
    productIds: z.array(id).max(10_000).default([]),
    categoryIds: z.array(id).max(1_000).default([]),
    mode: z.enum(["percentage", "fixed"]),
    value: z.number().int().min(-10_000).max(MAX_STORED_CENTS),
    channel: z.enum(["salon", "delivery", "both"]),
    reason: z.string().trim().min(3).max(500),
  })
  .refine(
    (value) => value.productIds.length + value.categoryIds.length > 0,
    "Informe produtos ou categorias.",
  )
  .refine((value) => value.mode !== "percentage" || value.value >= -9_999, "Percentual inválido.");

export const updateAllergenSchema = allergenSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const updateStationSchema = stationSchema
  .partial()
  .extend({ active: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0);
export const updateModifierGroupSchema = z
  .object({
    name: shortName.max(120).optional(),
    minimumSelections: z.number().int().min(0).max(50).optional(),
    maximumSelections: z.number().int().min(1).max(50).optional(),
    options: z
      .array(
        z.object({
          name: shortName.max(120),
          priceDeltaCents: cents.default(0),
          sortOrder: z.number().int().min(0).max(10_000).default(0),
        }),
      )
      .max(100)
      .optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.minimumSelections === undefined ||
      value.maximumSelections === undefined ||
      value.minimumSelections <= value.maximumSelections,
    "minimumSelections must be <= maximumSelections",
  );
export const modifierOptionSchema = z.object({
  name: shortName.max(120),
  priceDeltaCents: cents.default(0),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
});
export const updateModifierOptionSchema = modifierOptionSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0);

export const promotionSchema = z
  .object({
    name: shortName,
    description: z.string().trim().max(2_000).optional(),
    discountType: z.enum(["percentage", "fixed_price"]),
    discountValue: cents.positive(),
    productIds: z.array(id).max(10_000).default([]),
    comboIds: z.array(id).max(1_000).default([]),
    categoryIds: z.array(id).max(1_000).default([]),
    channels: z
      .array(z.enum(["salon", "delivery", "qr", "pickup"]))
      .min(1)
      .max(4),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    startTime: clockTime.nullable().optional(),
    endTime: clockTime.nullable().optional(),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    active: z.boolean().default(true),
  })
  .refine(
    (v) => v.productIds.length + v.comboIds.length + v.categoryIds.length > 0,
    "Informe produtos, categorias ou combos.",
  )
  .refine(
    (v) => v.discountType !== "percentage" || v.discountValue <= 10_000,
    "Percentual inválido.",
  )
  .refine(
    (v) => !v.startsAt || !v.endsAt || Date.parse(v.startsAt) < Date.parse(v.endsAt),
    "Período inválido.",
  )
  .refine(
    (v) => Boolean(v.startTime) === Boolean(v.endTime),
    "Informe início e fim da janela diária.",
  );
export const updatePromotionSchema = z.object({
  name: shortName.optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  discountType: z.enum(["percentage", "fixed_price"]).optional(),
  discountValue: cents.positive().optional(),
  productIds: z.array(id).max(10_000).optional(),
  comboIds: z.array(id).max(1_000).optional(),
  categoryIds: z.array(id).max(1_000).optional(),
  channels: z
    .array(z.enum(["salon", "delivery", "qr", "pickup"]))
    .min(1)
    .max(4)
    .optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  startTime: clockTime.nullable().optional(),
  endTime: clockTime.nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  active: z.boolean().optional(),
});

export const brandingSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  slogan: z.string().trim().max(300).nullable().optional(),
  logoUrl: httpUrl.nullable().optional(),
  coverImageUrl: httpUrl.nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  notice: z.string().trim().max(1_000).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  instagram: z.string().trim().max(120).nullable().optional(),
  openingHours: z.string().trim().max(1_000).nullable().optional(),
  serviceTaxNotice: z.string().trim().max(500).nullable().optional(),
  corkageFeeNotice: z.string().trim().max(500).nullable().optional(),
  wifi: z
    .object({ ssid: z.string().trim().max(120), password: z.string().max(120) })
    .nullable()
    .optional(),
});
const catalogImportRowSchema = productBaseSchema
  .omit({ categoryId: true })
  .extend({
    productId: id.optional(),
    categoryId: id.optional(),
    categoryName: shortName.max(120).optional(),
  })
  .refine(
    (row) => Boolean(row.categoryId || row.categoryName),
    "Informe categoryId ou categoryName.",
  );
export const importCatalogSchema = z.object({
  rows: z.array(catalogImportRowSchema).min(1).max(2_000),
  dryRun: z.boolean().default(false),
});
export const publicationSchema = z.object({ slug, active: z.boolean() });
export const analyticsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
export const mediaUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(4).max(2_800_000),
});
export const dailyStockSchema = z.object({
  remaining: z.number().int().min(0).max(1_000_000).nullable(),
  autoDeductStock: z.boolean().optional(),
});

const expectedFloorRevision = z.number().int().min(1);

export const floorRevisionQuerySchema = z
  .object({ expectedRevision: z.coerce.number().int().min(1) })
  .strict();

export const roomSchema = z
  .object({
    name: shortName.max(120),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    expectedRevision: expectedFloorRevision,
  })
  .strict();

const tableFields = {
  label: shortName.max(60),
  seats: z.number().int().min(1).max(100).default(4),
  width: z.number().int().min(24).max(2_000).default(122),
  height: z.number().int().min(24).max(2_000).default(76),
  rotation: z.number().int().min(0).max(359).default(0),
  shape: z.enum(["round", "square", "rectangle"]).default("rectangle"),
};

function validateSquareGeometry(
  value: { shape: "round" | "square" | "rectangle"; width: number; height: number },
  context: z.RefinementCtx,
) {
  if (value.shape === "square" && value.width !== value.height) {
    context.addIssue({
      code: "custom",
      path: ["height"],
      message: "Mesa quadrada precisa ter largura e altura iguais.",
    });
  }
}

const tableDataSchema = z.object(tableFields).strict().superRefine(validateSquareGeometry);

export const tableSchema = z
  .object({ ...tableFields, expectedRevision: expectedFloorRevision })
  .strict()
  .superRefine(validateSquareGeometry);

export const tableEditSchema = z
  .object({ ...tableFields, roomId: id, expectedRevision: expectedFloorRevision })
  .strict()
  .superRefine(validateSquareGeometry);

export const tableTurnoverSchema = z.object({
  status: z.enum(["cleaning", "available"]),
});

export const tableBatchSchema = z
  .object({
    expectedRevision: expectedFloorRevision,
    tables: z.array(tableDataSchema).min(1).max(30),
  })
  .strict();

const tableLayoutSchema = z
  .object({
    tableId: id,
    roomId: id,
    label: shortName.max(60),
    seats: z.number().int().min(1).max(100),
    x: floorCoordinate,
    y: floorCoordinate,
    width: z.number().int().min(24).max(2_000).default(122),
    height: z.number().int().min(24).max(2_000).default(76),
    rotation: z.number().int().min(0).max(359).default(0),
    shape: z.enum(["round", "square", "rectangle"]).default("rectangle"),
  })
  .strict()
  .superRefine(validateSquareGeometry);

const shiftTableLayoutSchema = z
  .object({
    tableId: id,
    roomId: id,
    x: floorCoordinate,
    y: floorCoordinate,
    rotation: z.number().int().min(0).max(359).default(0),
  })
  .strict();

const floorPointSchema = z
  .object({
    x: floorCoordinate,
    y: floorCoordinate,
  })
  .strict();

function polygonArea(points: Array<{ x: number; y: number }>) {
  return (
    Math.abs(
      points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length];
        return next ? sum + point.x * next.y - next.x * point.y : sum;
      }, 0),
    ) / 2
  );
}

export function pointInsideFloorPolygon(
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>,
) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (!currentPoint || !previousPoint) continue;
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function orientation(
  first: { x: number; y: number },
  second: { x: number; y: number },
  third: { x: number; y: number },
) {
  return Math.sign(
    (second.y - first.y) * (third.x - second.x) - (second.x - first.x) * (third.y - second.y),
  );
}

function polygonIsSimple(points: Array<{ x: number; y: number }>) {
  for (let first = 0; first < points.length; first += 1) {
    const firstEnd = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondEnd = (second + 1) % points.length;
      if (first === second || firstEnd === second || secondEnd === first) continue;
      const a = points[first];
      const b = points[firstEnd];
      const c = points[second];
      const d = points[secondEnd];
      if (
        a &&
        b &&
        c &&
        d &&
        orientation(a, b, c) !== orientation(a, b, d) &&
        orientation(c, d, a) !== orientation(c, d, b)
      ) {
        return false;
      }
    }
  }
  return true;
}

const roomLayoutSchema = z
  .object({
    roomId: id,
    points: z.array(floorPointSchema).min(3).max(16),
  })
  .strict()
  .refine(
    ({ points }) => new Set(points.map((point) => `${point.x}:${point.y}`)).size === points.length,
    "Cada vértice do ambiente deve ser único.",
  )
  .refine(({ points }) => polygonArea(points) >= 100, "O ambiente precisa ter área útil.")
  .refine(({ points }) => polygonIsSimple(points), "As paredes do ambiente não podem se cruzar.");

const floorElementSchema = z
  .object({
    id: id.optional(),
    roomId: id,
    kind: z.enum(["label", "barrier"]),
    label: z.string().trim().min(1).max(120).optional(),
    x: floorCoordinate,
    y: floorCoordinate,
    width: z.number().int().min(1).max(1_000_000),
    height: z.number().int().min(1).max(1_000_000),
    rotation: z.number().int().min(0).max(359).default(0),
  })
  .strict();

export const floorLayoutSchema = z
  .object({
    expectedRevision: expectedFloorRevision,
    tables: z.array(tableLayoutSchema).max(500).default([]),
    rooms: z.array(roomLayoutSchema).max(100).default([]),
    layoutElements: z.array(floorElementSchema).max(1_000).optional(),
  })
  .strict()
  .refine(
    ({ tables, rooms, layoutElements }) =>
      tables.length + rooms.length + (layoutElements?.length ?? 0) > 0,
    "Informe mesas, ambientes ou elementos.",
  )
  .refine(
    ({ tables }) => new Set(tables.map((table) => table.tableId)).size === tables.length,
    "Cada mesa pode aparecer somente uma vez na planta.",
  )
  .refine(
    ({ rooms }) => new Set(rooms.map((room) => room.roomId)).size === rooms.length,
    "Cada ambiente pode aparecer somente uma vez na planta.",
  );

export const shiftLayoutSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    tables: z.array(shiftTableLayoutSchema).min(1).max(500),
  })
  .strict()
  .refine(
    ({ tables }) => new Set(tables.map((table) => table.tableId)).size === tables.length,
    "Cada mesa pode aparecer somente uma vez na organização temporária.",
  );

export const openTabSchema = z
  .object({
    tableId: id.optional(),
    label: z.string().trim().max(120).optional(),
    fulfillmentType: fulfillmentType.optional(),
    customerId: id.optional(),
    customerName: z.string().trim().max(120).optional(),
    customerPhone: optionalPhone,
    readyNotificationConsent: z.boolean().optional(),
    serviceNotes: z.string().trim().max(500).optional(),
    deliveryAddress: z.string().trim().max(1_000).optional(),
    promisedAt: futureDateTime.optional(),
    responsibleIdentityId: id.optional(),
    reservationId: id.optional(),
    waitlistEntryId: id.optional(),
    guestCount: z.number().int().min(1).max(500).default(1),
  })
  .superRefine((value, context) => {
    if (value.fulfillmentType === "delivery" && !value.deliveryAddress) {
      context.addIssue({
        code: "custom",
        path: ["deliveryAddress"],
        message: "Informe o endereço do delivery.",
      });
    }
    if (value.reservationId && value.waitlistEntryId) {
      context.addIssue({
        code: "custom",
        path: ["reservationId"],
        message: "Informe somente uma origem de recepção.",
      });
    }
    if ((value.reservationId || value.waitlistEntryId) && !value.tableId) {
      context.addIssue({
        code: "custom",
        path: ["tableId"],
        message: "Escolha uma mesa para sentar o cliente.",
      });
    }
  });

export const updateTabSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    label: z.string().trim().max(120).nullable().optional(),
    fulfillmentType: fulfillmentType.optional(),
    customerName: z.string().trim().max(120).nullable().optional(),
    customerPhone: optionalPhone.nullable().optional(),
    readyNotificationConsent: z.boolean().optional(),
    serviceNotes: z.string().trim().max(500).nullable().optional(),
    deliveryAddress: z.string().trim().max(1_000).nullable().optional(),
    promisedAt: optionalDateTime.nullable().optional(),
    guestCount: z.number().int().min(1).max(500).optional(),
    responsibleIdentityId: id.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 1, "Informe ao menos uma alteração.");

export const counterQueueQuerySchema = z.object({
  stage: z
    .enum(["all", "new", "production", "ready", "waiting", "delivered", "late"])
    .default("all"),
  channel: z.enum(["all", "pickup", "dine_in", "delivery"]).default("all"),
  query: z.string().trim().max(120).default(""),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const serviceSectionSchema = z
  .object({
    name: shortName.max(120),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    serviceMode: serviceModeSchema.default("hybrid"),
    tableIds: z.array(id).min(1).max(500),
    defaultResponsibleIdentityId: id.nullable().optional(),
  })
  .strict()
  .refine(
    ({ tableIds }) => new Set(tableIds).size === tableIds.length,
    "Cada mesa pode aparecer somente uma vez na praça.",
  );

export const openOperationalShiftSchema = z
  .object({
    label: z.string().trim().min(2).max(120).optional(),
    serviceMode: serviceModeSchema.default("hybrid"),
    copyPreviousAssignments: z.boolean().default(true),
  })
  .strict();

const shiftSectionAssignmentFields = {
  expectedRevision: z.number().int().min(1),
  tableIds: z.array(id).min(1).max(500),
  primaryIdentityId: id.nullable(),
  supportIdentityIds: z.array(id).max(20).default([]),
};

export const shiftSectionAssignmentSchema = z
  .object(shiftSectionAssignmentFields)
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.tableIds).size !== value.tableIds.length) {
      context.addIssue({ code: "custom", path: ["tableIds"], message: "Mesa repetida na praça." });
    }
    if (new Set(value.supportIdentityIds).size !== value.supportIdentityIds.length) {
      context.addIssue({
        code: "custom",
        path: ["supportIdentityIds"],
        message: "Funcionário de apoio repetido.",
      });
    }
    if (value.primaryIdentityId && value.supportIdentityIds.includes(value.primaryIdentityId)) {
      context.addIssue({
        code: "custom",
        path: ["supportIdentityIds"],
        message: "O titular não pode ser cadastrado também como apoio.",
      });
    }
  });

export const shiftSectionsBatchAssignmentSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    assignments: z
      .array(
        z
          .object({
            tableIds: z.array(id).max(500),
            primaryIdentityId: id.nullable(),
            supportIdentityIds: z.array(id).max(20).default([]),
            shiftSectionId: id,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine(({ assignments }, context) => {
    if (
      new Set(assignments.map(({ shiftSectionId }) => shiftSectionId)).size !== assignments.length
    ) {
      context.addIssue({ code: "custom", path: ["assignments"], message: "Praça repetida." });
    }
    const tableIds = assignments.flatMap(({ tableIds }) => tableIds);
    if (new Set(tableIds).size !== tableIds.length) {
      context.addIssue({
        code: "custom",
        path: ["assignments"],
        message: "Uma mesa não pode pertencer a duas praças no mesmo turno.",
      });
    }
  });

export const shiftSectionCoverageSchema = z.object({ active: z.boolean() }).strict();

export const shiftTransferReasonCodeSchema = z.enum([
  "service_rebalance",
  "staff_coverage",
  "operational_reorganization",
  "other",
]);

const shiftTransferReasonFields = {
  reasonCode: shiftTransferReasonCodeSchema,
  reasonNote: z.string().trim().min(3).max(500).optional(),
};

export const tableReorganizationReasonCodeSchema = z.enum([
  "large_party",
  "sit_together",
  "accessibility",
  "operational_reorganization",
  "other",
]);

const tableReorganizationReasonFields = {
  reasonCode: tableReorganizationReasonCodeSchema,
  reasonNote: z.string().trim().min(3).max(500).optional(),
};

export const temporaryTableTransferSchema = z
  .object({
    targetShiftSectionId: id,
    durationMinutes: z.number().int().min(5).max(720),
    transferOpenTab: z.boolean().default(true),
    ...shiftTransferReasonFields,
  })
  .strict()
  .refine((value) => value.reasonCode !== "other" || Boolean(value.reasonNote), {
    path: ["reasonNote"],
    message: "Descreva o motivo quando selecionar outro.",
  });

export const closeOperationalShiftSchema = z
  .object({
    acknowledgeOpenTabs: z.boolean().default(false),
    handoverIdentityId: id.nullable().optional(),
    handoverAssignments: z
      .array(
        z
          .object({
            sourceResponsibleIdentityId: id.nullable(),
            targetResponsibleIdentityId: id,
          })
          .strict(),
      )
      .max(200)
      .optional(),
    returnableDecision: z.literal("acknowledge").optional(),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.handoverIdentityId && value.handoverAssignments?.length) {
      context.addIssue({
        code: "custom",
        path: ["handoverAssignments"],
        message: "Use uma passagem geral ou distribua por responsável, não as duas opções.",
      });
    }
    const sources = value.handoverAssignments?.map(
      (assignment) => assignment.sourceResponsibleIdentityId ?? "unassigned",
    );
    if (sources && new Set(sources).size !== sources.length) {
      context.addIssue({
        code: "custom",
        path: ["handoverAssignments"],
        message: "Cada responsável de origem só pode aparecer uma vez.",
      });
    }
  })
  .default({ acknowledgeOpenTabs: false });

export const claimTabSchema = z.object({
  expectedVersion: z.number().int().min(1),
  responsibleIdentityId: id,
  reason: z.string().trim().min(3).max(500),
});

export const serviceCallSchema = z
  .object({
    kind: z.enum(["assistance", "bill", "water", "other"]).default("assistance"),
    tabId: id.optional(),
    slaMinutes: z.number().int().min(1).max(120).default(3),
    installationId: id.optional(),
    terminalId: z.string().trim().min(1).max(120).optional(),
    printerId: z.string().trim().min(1).max(120).optional(),
    copies: z.number().int().min(1).max(5).default(1),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.kind !== "bill" &&
      (input.installationId || input.terminalId || input.printerId || input.copies !== 1)
    ) {
      context.addIssue({
        code: "custom",
        path: ["kind"],
        message: "Destino de impressão só pode ser informado no pedido de conta.",
      });
    }
    if (input.kind === "bill" && input.installationId && !input.tabId) {
      context.addIssue({
        code: "custom",
        path: ["tabId"],
        message: "Informe a comanda para imprimir o pedido de conta.",
      });
    }
  });

export const paymentSchema = z.object({
  method: z.enum(["cash", "credit_card", "debit_card", "pix", "other"]),
  amountCents: cents.positive(),
  reference: z.string().trim().max(120).optional(),
  cashRegisterId: id.optional(),
  installationId: id.optional(),
});

const printTargetSchema = z.object({
  installationId: id.optional(),
  terminalId: z.string().trim().min(1).max(120).optional(),
  printerId: z.string().trim().min(1).max(120).optional(),
});

export const printJobSchema = printTargetSchema.extend({
  documentType: z.enum(["partial_statement", "payment_statement", "final_receipt"]),
  serviceCallId: id.optional(),
  copies: z.number().int().min(1).max(5).default(1),
  reason: z.string().trim().min(3).max(500).optional(),
});

export const printSplitSchema = printTargetSchema
  .extend({
    method: z.enum(["equal_people", "fixed_amount"]),
    partCount: z.number().int().min(2).max(50),
    fixedAmountCents: cents.positive().optional(),
    documentType: z.enum(["partial_statement", "payment_statement"]).default("partial_statement"),
    copies: z.number().int().min(1).max(5).default(1),
    serviceCallId: id.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.method === "fixed_amount" && input.fixedAmountCents === undefined) {
      context.addIssue({ code: "custom", path: ["fixedAmountCents"], message: "Informe o valor." });
    }
    if (input.method === "equal_people" && input.fixedAmountCents !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["fixedAmountCents"],
        message: "Divisão igual não recebe valor fixo.",
      });
    }
  });

export const printJobQuerySchema = z.object({
  tabId: id.optional(),
  stationId: id.optional(),
  kdsTicketId: id.optional(),
  documentType: z
    .enum(["partial_statement", "payment_statement", "final_receipt", "kds_ticket"])
    .optional(),
  status: z.enum(["queued", "printing", "confirmation_required", "printed", "failed"]).optional(),
  terminalId: z.string().trim().min(1).max(120).optional(),
  printerId: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const printJobStatusSchema = printTargetSchema
  .extend({
    status: z.enum(["printing", "confirmation_required", "printed", "failed"]),
    error: z.string().trim().min(3).max(2_000).optional(),
  })
  .superRefine((input, context) => {
    if (input.status === "failed" && !input.error) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Informe o motivo da falha de impressão.",
      });
    }
    if (input.status !== "failed" && input.error) {
      if (input.status === "confirmation_required" && input.error === "PRINTER_RESULT_UNKNOWN") {
        return;
      }
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Somente uma falha de impressão recebe erro.",
      });
    }
    if (input.status === "confirmation_required" && input.error !== "PRINTER_RESULT_UNKNOWN") {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Resultado desconhecido exige PRINTER_RESULT_UNKNOWN.",
      });
    }
  });

export const retryPrintJobSchema = printTargetSchema.default({});

export const reprintJobSchema = printTargetSchema.extend({
  copies: z.number().int().min(1).max(5).optional(),
  reason: z.string().trim().min(3).max(500),
});

export const closeTabSchema = z.object({
  printRequested: z.boolean().default(false),
  returnableDecision: z.literal("acknowledge").optional(),
  printOptions: printTargetSchema
    .extend({ copies: z.number().int().min(1).max(5).default(1) })
    .optional(),
});

export const reopenTabSchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/),
  reason: z.string().trim().min(3).max(500),
});

export const approvalRequestSchema = z
  .object({
    itemId: id,
    action: z.enum(["discount", "cancel"]),
    discountCents: cents.optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .superRefine((input, context) => {
    if (input.action === "discount" && !input.discountCents) {
      context.addIssue({
        code: "custom",
        path: ["discountCents"],
        message: "Informe o valor do desconto.",
      });
    }
    if (input.action === "cancel" && input.discountCents !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["discountCents"],
        message: "Cancelamento não recebe valor de desconto.",
      });
    }
  });

export const approvalDecisionSchema = z.object({ pin: z.string().regex(/^\d{4,8}$/) });

export const moveItemsSchema = z.object({
  targetTabId: id,
  items: z
    .array(z.object({ orderItemId: id, quantity: z.number().int().min(1).max(500) }))
    .min(1)
    .max(500),
});

export const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: id,
        quantity: z.number().int().min(1).max(500),
        modifierOptionIds: z.array(id).max(100).default([]),
        notes: z.string().trim().max(500).optional(),
        seatNumber: z.number().int().min(1).max(500).optional(),
        course: orderCourse.optional(),
        allergyNote: z.string().trim().max(500).optional(),
        doseClub: z
          .object({
            externalClubId: id,
          })
          .strict()
          .optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const transferTabSchema = z.object({
  tableId: id,
  reason: z.string().trim().min(3).max(500),
});

export const mergeTabsSchema = z
  .object({
    targetTabId: id,
    sourceTabIds: z.array(id).min(1).max(50),
    ...tableReorganizationReasonFields,
  })
  .strict()
  .refine((value) => value.reasonCode !== "other" || Boolean(value.reasonNote), {
    path: ["reasonNote"],
    message: "Descreva o motivo quando selecionar outro.",
  });

export const tableGroupSchema = z
  .object({
    tableIds: z.array(id).min(2).max(50),
    anchorTableId: id,
    mode: z.enum(["physical_only", "single_tab"]),
    targetTabId: id.optional(),
    responsibleIdentityId: id.optional(),
    ...tableReorganizationReasonFields,
  })
  .strict()
  .refine((value) => value.reasonCode !== "other" || Boolean(value.reasonNote), {
    path: ["reasonNote"],
    message: "Descreva o motivo quando selecionar outro.",
  });

export const detachTableGroupSchema = z.object({ tableId: id });

export const splitTabSchema = printTargetSchema
  .extend({
    tableId: id.optional(),
    label: z.string().trim().max(120).optional(),
    items: z
      .array(z.object({ orderItemId: id, quantity: z.number().int().min(1).max(500) }))
      .min(1)
      .max(500),
    copies: z.number().int().min(1).max(5).optional(),
  })
  .strict();

export const serviceChargeSchema = z.object({ basisPoints: z.number().int().min(0).max(10_000) });
export const tipSchema = z.object({ tipCents: cents });

export const approvalSchema = z.object({
  approverMembershipId: id,
  pin: z.string().regex(/^\d{4,8}$/),
  reason: z.string().trim().min(3).max(500),
});

export const discountSchema = z.object({ discountCents: cents, approval: approvalSchema });
export const cancelItemSchema = z.object({ approval: approvalSchema });
export const managerPinSchema = z.object({ pin: z.string().regex(/^\d{4,8}$/) });
export const kdsStateSchema = z
  .object({
    state: z.enum(["preparing", "ready"]),
  })
  .strict();
export const kdsItemStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("preparing") }).strict(),
  z
    .object({
      state: z.literal("ready"),
      quantity: z.number().int().min(1).max(500).optional(),
    })
    .strict(),
]);
export const kdsCancelSchema = z.object({ approval: approvalSchema });
export const kdsRecallSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const kdsRefireSchema = kdsRecallSchema;
export const kdsPrioritySchema = z.object({
  priority: z.number().int().min(0).max(100),
  reason: z.string().trim().min(3).max(500),
});
export const kdsOrderPrioritySchema = kdsPrioritySchema
  .extend({ installationId: id.optional() })
  .strict();
export const kdsCourseStateSchema = z.object({
  course: orderCourse,
  state: z.enum(["held", "fired"]),
});
export const kdsOrderHandoffSchema = z.object({
  target: z.enum(["expedition", "runner", "served"]),
  reason: z.string().trim().min(3).max(500).optional(),
});
export const kdsTicketClaimSchema = z
  .object({
    installationId: id,
    leaseSeconds: z.number().int().min(30).max(300).default(120),
  })
  .strict();
export const kdsChangeAcknowledgeSchema = z
  .object({ revision: z.string().regex(/^[0-9a-f]{64}$/) })
  .strict();
export const kdsRunnerClaimSchema = z
  .object({ reason: z.string().trim().min(3).max(500).optional() })
  .strict();
export const kdsProductAvailabilitySchema = z
  .object({
    available: z.boolean(),
    reason: z.string().trim().min(3).max(500),
    resetAt: z.string().datetime({ offset: true }).nullable().optional(),
    dailyStock: z.number().int().min(0).max(1_000_000).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.available && input.resetAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resetAt"],
        message: "resetAt is only valid while the product is unavailable",
      });
    }
  });
export const kdsTerminalProfileSchema = z
  .object({
    mode: z.enum(["station", "pass"]),
    stationId: id.nullable(),
    label: z.string().trim().min(1).max(120),
    soundEnabled: z.boolean(),
    fullscreenPreferred: z.boolean(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode === "station" && input.stationId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stationId"],
        message: "station mode requires stationId",
      });
    }
    if (input.mode === "pass" && input.stationId !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stationId"],
        message: "pass mode does not accept stationId",
      });
    }
  });
export const terminalProfileModeSchema = z.enum([
  "waiter_mobile",
  "reception",
  "cashier",
  "kds",
  "expedition",
  "shared",
]);
export const terminalProfileRouteSchema = z.enum([
  "dashboard",
  "reservations",
  "salon",
  "counter",
  "cash",
  "kds",
]);
export const terminalProfileSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    mode: terminalProfileModeSchema,
    defaultRoute: terminalProfileRouteSchema,
    printerId: z.string().trim().min(1).max(120).nullable(),
    stationId: id.nullable(),
    cashRegisterId: id.nullable().optional(),
    compact: z.boolean(),
    quickActions: z
      .array(z.enum(["open_tab", "new_order", "receive", "waitlist", "print", "search"]))
      .max(8),
    paymentMode: z.enum(["disabled", "cashier", "homologated_pos"]).optional(),
  })
  .strict();
export const kdsBlockCodeSchema = z.enum([
  "missing_ingredient",
  "equipment_issue",
  "quality_check",
  "dependency",
  "other",
]);
export const kdsBlockSchema = z
  .object({
    code: kdsBlockCodeSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export const kdsUnblockSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export const kdsAttentionAcknowledgeSchema = z
  .object({
    noteId: z.enum(["allergy", "notes"]),
    revision: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export const kdsRerouteSchema = z
  .object({
    stationId: id,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export const kdsBatchCreateSchema = z
  .object({
    stationId: id,
    productId: id.optional(),
    maxAssignments: z.number().int().min(1).max(50),
  })
  .strict();
export const kdsBatchCompleteSchema = z
  .object({ reason: z.string().trim().min(3).max(500).optional() })
  .strict();
export const kdsBatchCancelSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();
export const kdsAnalyticsQuerySchema = z.object({
  stationId: id.optional(),
  windowHours: z.coerce.number().int().min(24).max(672).default(168),
});

const responseDateTime = z.string().datetime({ offset: true });
const nullableResponseDateTime = responseDateTime.nullable();
const kdsTicketStatusSchema = z.enum(["pending", "preparing", "ready", "done", "canceled"]);
const kdsItemStatusSchema = z.enum(["draft", "queued", "preparing", "ready", "served", "canceled"]);
const nullableMetric = z.number().nonnegative().nullable();
const kdsCapacityRecommendationReasonSchema = z.enum([
  "queue_depth",
  "blocked_items",
  "slow_history",
  "insufficient_history",
]);
const kdsCapacitySchema = z.object({
  activeAssignments: z.number().int().nonnegative(),
  blockedAssignments: z.number().int().nonnegative(),
  queuedQuantity: z.number().int().nonnegative(),
  preparingQuantity: z.number().int().nonnegative(),
  sampleSize: z.number().int().nonnegative(),
  p50PrepMinutes: nullableMetric,
  p90PrepMinutes: nullableMetric,
  estimatedUnitsPerHour: nullableMetric,
  recommendation: z.object({
    state: z.enum(["normal", "strained", "overloaded"]),
    suggestedDelayMinutes: nullableMetric,
    reasons: z.array(kdsCapacityRecommendationReasonSchema),
  }),
});
const kdsAttentionReadSchema = z.object({
  id: z.enum(["allergy", "notes"]),
  revision: z.string().regex(/^[0-9a-f]{64}$/),
  kind: z.enum(["allergy", "note"]),
  text: z.string(),
  required: z.literal(true),
  acknowledged: z.boolean(),
  acknowledgedAt: nullableResponseDateTime,
  acknowledgedByIdentityId: id.nullable(),
});
const kdsBatchAssignmentReadSchema = z.object({
  ticketId: id,
  orderItemId: id,
  quantity: z.number().int().positive(),
  position: z.number().int().positive(),
});
export const kdsBatchReadSchema = z.object({
  batchId: id,
  stationId: id,
  productId: id.nullable(),
  state: z.enum(["active", "completed", "canceled"]),
  assignmentCount: z.number().int().nonnegative(),
  totalQuantity: z.number().int().nonnegative(),
  assignments: z.array(kdsBatchAssignmentReadSchema),
  createdAt: responseDateTime,
  completedAt: nullableResponseDateTime,
  canceledAt: nullableResponseDateTime,
  idempotentReplay: z.boolean().optional(),
});

export const kdsTicketReadSchema = z.object({
  id,
  organizationId: id,
  unitId: id,
  orderId: id,
  stationId: id,
  status: kdsTicketStatusSchema,
  priority: z.number().int(),
  rush: z.boolean(),
  dueAt: nullableResponseDateTime,
  startedAt: nullableResponseDateTime,
  readyAt: nullableResponseDateTime,
  handedOffAt: nullableResponseDateTime,
  servedAt: nullableResponseDateTime,
  completedAt: nullableResponseDateTime,
  recallCount: z.number().int(),
  refireCount: z.number().int(),
  claimedByInstallationId: id.nullable(),
  claimedAt: nullableResponseDateTime,
  claimExpiresAt: nullableResponseDateTime,
  createdAt: responseDateTime,
  updatedAt: responseDateTime,
  blocked: z.boolean(),
  predictedReadyAt: nullableResponseDateTime,
  eta: z.object({
    predictedReadyAt: nullableResponseDateTime,
    p50Minutes: nullableMetric,
    p90Minutes: nullableMetric,
    sampleSize: z.number().int().nonnegative(),
    source: z.enum(["product", "station", "configured", "none"]),
  }),
  station: z.object({ id, name: z.string(), code: z.string(), capacity: kdsCapacitySchema }),
  order: z.object({
    id,
    status: z.enum(["draft", "sent", "preparing", "ready", "served", "canceled"]),
    readyNotifiedAt: nullableResponseDateTime,
    priority: z.number().int().min(0).max(100),
    priorityReason: z.string().nullable(),
    priorityUpdatedAt: nullableResponseDateTime,
    priorityUpdatedByIdentityId: id.nullable(),
    runnerIdentityId: id.nullable(),
    runnerClaimedAt: nullableResponseDateTime,
    runnerPickedUpAt: nullableResponseDateTime,
  }),
  tab: z.object({
    id,
    label: z.string().nullable(),
    fulfillmentType,
    customerName: z.string().nullable(),
    promisedAt: nullableResponseDateTime,
    readyNotifiedAt: nullableResponseDateTime,
  }),
  table: z.object({ id, label: z.string() }).nullable(),
  sla: z.object({
    elapsedMinutes: z.number().int().nonnegative(),
    targetMinutes: z.number().int().nonnegative().nullable(),
    overdueMinutes: z.number().int().nonnegative(),
    isOverdue: z.boolean(),
  }),
});

export const kdsItemReadSchema = z.object({
  ticketId: id,
  productId: id,
  item: z.object({
    id,
    organizationId: id,
    unitId: id,
    orderId: id,
    productId: id,
    stationId: id.nullable(),
    productName: z.string(),
    quantity: z.number().int().positive(),
    unitPriceCents: cents,
    modifiersCents: cents,
    grossCents: cents,
    discountCents: cents,
    netCents: cents,
    status: kdsItemStatusSchema,
    seatNumber: z.number().int().positive().nullable(),
    course: orderCourse,
    estimatedPrepTimeMinutes: z.number().int().nonnegative().nullable(),
    allergyNote: z.string().nullable(),
    notes: z.string().nullable(),
    canceledAt: nullableResponseDateTime,
    canceledReason: z.string().nullable(),
    createdAt: responseDateTime,
    updatedAt: responseDateTime,
  }),
  kds: z.object({
    quantity: z.number().int().positive(),
    readyQuantity: z.number().int().nonnegative(),
    stage: z.number().int().min(1).max(20),
    dependencyHeld: z.boolean(),
    status: kdsItemStatusSchema,
    held: z.boolean(),
    heldAt: nullableResponseDateTime,
    firedAt: nullableResponseDateTime,
    startedAt: nullableResponseDateTime,
    readyAt: nullableResponseDateTime,
    completedAt: nullableResponseDateTime,
    blocked: z.object({
      active: z.boolean(),
      code: kdsBlockCodeSchema.nullable(),
      reason: z.string().nullable(),
      blockedAt: nullableResponseDateTime,
      blockedByIdentityId: id.nullable(),
      unblockedAt: nullableResponseDateTime,
      unblockedByIdentityId: id.nullable(),
      count: z.number().int().nonnegative(),
    }),
  }),
  attention: z.array(kdsAttentionReadSchema),
  modifiers: z.array(
    z.object({
      id,
      name: z.string(),
      quantity: z.number().int().positive(),
      unitDeltaCents: z.number().int(),
      totalDeltaCents: z.number().int(),
    }),
  ),
  recipe: z.array(
    z.object({
      id,
      ingredientName: z.string(),
      quantityMilli: z.number().int().positive(),
      unit: z.string(),
      lossBasisPoints: z.number().int().min(0).max(10_000),
    }),
  ),
  changes: z.array(
    z.object({
      id,
      organizationId: id,
      unitId: id,
      ticketId: id,
      orderItemId: id,
      kind: z.enum(["added", "updated", "removed"]),
      revision: z.string().regex(/^[0-9a-f]{64}$/),
      summary: z.string(),
      details: z.record(z.string(), z.unknown()),
      createdByIdentityId: id,
      acknowledgedByIdentityId: id.nullable(),
      acknowledgedAt: nullableResponseDateTime,
      createdAt: responseDateTime,
    }),
  ),
});

export const kdsReadModelSchema = z.object({
  capturedAt: responseDateTime,
  serverTime: responseDateTime,
  revision: z.string().length(64),
  operationServiceMode: serviceModeSchema.nullable(),
  serviceMode: serviceModeSchema.nullable(),
  stations: z.array(
    z.object({ id, name: z.string(), code: z.string(), capacity: kdsCapacitySchema }),
  ),
  capabilities: z.object({
    ticketTransition: z.boolean(),
    itemTransition: z.boolean(),
    partialReady: z.boolean(),
    authorizedCancellation: z.boolean(),
    courseHold: z.boolean(),
    priority: z.boolean(),
    orderPriority: z.boolean(),
    orderPriorityOffline: z.literal(false),
    recall: z.boolean(),
    refire: z.boolean(),
    orderHandoff: z.boolean(),
    availability: z.boolean(),
    block: z.boolean(),
    attentionAcknowledgement: z.boolean(),
    reroute: z.boolean(),
    batches: z.boolean(),
    history: z.boolean(),
    capacity: z.boolean(),
    recommendation: z.boolean(),
    automaticThrottling: z.literal(false),
    terminalProfileRead: z.boolean(),
    terminalProfileManage: z.boolean(),
    sequentialStages: z.boolean(),
    ticketClaim: z.boolean(),
    orderChanges: z.boolean(),
    runnerHandoff: z.boolean(),
    productionGrid: z.boolean(),
    recipes: z.boolean(),
    demandControl: z.boolean(),
  }),
  tickets: z.array(kdsTicketReadSchema),
  items: z.array(kdsItemReadSchema),
  alerts: z.array(
    z.object({
      ticket: kdsTicketReadSchema,
      reason: z.string(),
      items: z.array(kdsItemReadSchema),
    }),
  ),
  metrics: z.object({
    window: z.object({
      from: responseDateTime,
      to: responseDateTime,
      source: z.enum(["active_shift", "rolling_12h"]),
    }),
    total: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    preparing: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    expedition: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
    rush: z.number().int().nonnegative(),
    blockedItems: z.number().int().nonnegative(),
    averageWaitMinutes: z.number().nonnegative(),
    averagePrepMinutes: z.number().nonnegative(),
    medianPrepMinutes: z.number().nonnegative(),
    p90PrepMinutes: z.number().nonnegative(),
    sampleSize: z.number().int().nonnegative(),
  }),
  productAvailability: z.array(
    z.object({
      productId: id,
      productName: z.string(),
      status: z.enum(["available", "limited", "unavailable"]),
      available: z.boolean(),
      dailyStock: z.number().int().nonnegative().nullable(),
      soldToday: z.number().int().nonnegative(),
      remainingQuantity: z.number().int().nonnegative().nullable(),
      autoDeductStock: z.boolean(),
      reason: z.string().nullable(),
      updatedByIdentityId: id.nullable(),
      updatedAt: responseDateTime,
      resetAt: nullableResponseDateTime,
    }),
  ),
  allDay: z.array(
    z.object({
      stationId: id,
      productId: id,
      productName: z.string(),
      totalQuantity: z.number().int().nonnegative(),
      queuedQuantity: z.number().int().nonnegative(),
      preparingQuantity: z.number().int().nonnegative(),
      readyQuantity: z.number().int().nonnegative(),
      heldQuantity: z.number().int().nonnegative(),
    }),
  ),
  batches: z.array(kdsBatchReadSchema),
  productionGrid: z.array(
    z.object({
      stationId: id,
      productId: id,
      productName: z.string(),
      totalQuantity: z.number().int().nonnegative(),
      queuedQuantity: z.number().int().nonnegative(),
      preparingQuantity: z.number().int().nonnegative(),
      readyQuantity: z.number().int().nonnegative(),
      heldQuantity: z.number().int().nonnegative(),
      assignments: z.array(
        z.object({
          ticketId: id,
          orderItemId: id,
          reference: z.string(),
          quantity: z.number().int().positive(),
          readyQuantity: z.number().int().nonnegative(),
          status: kdsItemStatusSchema,
          stage: z.number().int().min(1).max(20),
        }),
      ),
    }),
  ),
  demand: z.object({
    state: z.enum(["normal", "strained", "overloaded"]),
    suggestedDelayMinutes: z.number().nonnegative(),
    automatic: z.literal(false),
    channels: z.array(
      z.object({
        channel: fulfillmentType,
        activeOrders: z.number().int().nonnegative(),
        suggestedDelayMinutes: z.number().nonnegative(),
      }),
    ),
  }),
});

export const kdsBlockResponseSchema = z.object({
  ticketId: id,
  orderItemId: id,
  blocked: z.boolean(),
  code: kdsBlockCodeSchema.optional(),
  reason: z.string().optional(),
  blockedAt: responseDateTime.optional(),
  unblockedAt: responseDateTime.optional(),
  idempotentReplay: z.boolean().optional(),
});

export const kdsAttentionAcknowledgeResponseSchema = z.object({
  ticketId: id,
  orderItemId: id,
  noteId: z.enum(["allergy", "notes"]),
  revision: z.string().regex(/^[0-9a-f]{64}$/),
  acknowledgedAt: responseDateTime,
  acknowledgedByIdentityId: id,
  idempotentReplay: z.boolean().optional(),
});

export const kdsRerouteResponseSchema = z.object({
  sourceTicketId: id,
  targetTicketId: id,
  orderItemId: id,
  sourceStationId: id,
  targetStationId: id,
  state: kdsTicketStatusSchema,
  idempotentReplay: z.boolean().optional(),
});

export const kdsAnalyticsResponseSchema = z.object({
  capturedAt: responseDateTime,
  window: z.object({
    from: responseDateTime,
    to: responseDateTime,
    hours: z.number().int().min(24).max(672),
  }),
  sampleSize: z.number().int().nonnegative(),
  prep: z.object({ p50Minutes: nullableMetric, p90Minutes: nullableMetric }),
  counts: z.object({
    blocked: z.number().int().nonnegative(),
    refired: z.number().int().nonnegative(),
    canceled: z.number().int().nonnegative(),
    availability86: z.number().int().nonnegative(),
  }),
  slowProducts: z.array(
    z.object({
      productId: id,
      productName: z.string(),
      sampleSize: z.number().int().nonnegative(),
      p50Minutes: z.number().nonnegative(),
      p90Minutes: z.number().nonnegative(),
    }),
  ),
});

export const kdsMutationResponseSchema = z.object({
  ticketId: id.optional(),
  ticketIds: z.array(id).optional(),
  orderId: id.optional(),
  orderItemId: id.optional(),
  changeId: id.optional(),
  installationId: id.optional(),
  claimedAt: responseDateTime.optional(),
  claimExpiresAt: responseDateTime.optional(),
  releasedAt: responseDateTime.optional(),
  revision: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  acknowledgedAt: responseDateTime.optional(),
  runnerIdentityId: id.optional(),
  runnerClaimedAt: responseDateTime.optional(),
  state: z
    .enum(["pending", "preparing", "ready", "done", "canceled", "held", "fired", "served"])
    .optional(),
  itemState: z.enum(["preparing", "ready"]).optional(),
  readyQuantity: z.number().int().nonnegative().optional(),
  course: orderCourse.optional(),
  target: z.enum(["expedition", "runner", "served"]).optional(),
  priority: z.number().int().optional(),
  approvalId: id.optional(),
  orderStatuses: z
    .array(
      z.object({
        orderId: id,
        status: z.enum(["sent", "preparing", "ready", "served", "canceled"]),
      }),
    )
    .optional(),
  totals: z
    .array(
      z.object({
        tabId: id,
        totals: z.object({
          subtotalCents: cents,
          discountCents: cents,
          serviceChargeCents: cents,
          tipCents: cents,
          totalCents: cents,
        }),
      }),
    )
    .optional(),
  idempotentReplay: z.boolean().optional(),
});

export const kdsProductAvailabilityReadSchema = z.object({
  productId: id,
  productName: z.string(),
  status: z.enum(["available", "limited", "unavailable"]),
  available: z.boolean(),
  dailyStock: z.number().int().nonnegative().nullable(),
  soldToday: z.number().int().nonnegative(),
  remainingQuantity: z.number().int().nonnegative().nullable(),
  autoDeductStock: z.boolean(),
  reason: z.string().nullable(),
  updatedByIdentityId: id.nullable(),
  updatedAt: responseDateTime,
  resetAt: nullableResponseDateTime,
  idempotentReplay: z.boolean().optional(),
});
export const kdsProductAvailabilityResponseSchema = kdsProductAvailabilityReadSchema;
export const kdsProductAvailabilityListResponseSchema = z.object({
  capturedAt: responseDateTime,
  products: z.array(kdsProductAvailabilityReadSchema),
});

export const kdsOrderPriorityResponseSchema = z.object({
  orderId: id,
  ticketIds: z.array(id),
  priority: z.number().int().min(0).max(100),
  reason: z.string(),
  updatedAt: responseDateTime,
  updatedByIdentityId: id,
  idempotentReplay: z.boolean().optional(),
});

export const kdsTerminalProfileResponseSchema = z.object({
  organizationId: id,
  unitId: id,
  installationId: id,
  mode: z.enum(["station", "pass"]),
  stationId: id.nullable(),
  label: z.string(),
  soundEnabled: z.boolean(),
  fullscreenPreferred: z.boolean(),
  createdAt: responseDateTime,
  updatedAt: responseDateTime,
  updatedByIdentityId: id,
  idempotentReplay: z.boolean().optional(),
});

export const terminalProfileResponseSchema = z.object({
  organizationId: id,
  unitId: id,
  installationId: id,
  label: z.string(),
  mode: terminalProfileModeSchema,
  defaultRoute: terminalProfileRouteSchema,
  printerId: z.string().nullable(),
  stationId: id.nullable(),
  cashRegisterId: id.nullable(),
  compact: z.boolean(),
  quickActions: z.array(z.string()),
  paymentProvider: paymentTerminalProviderSchema.nullable(),
  paymentStatus: paymentTerminalStatusSchema,
  paymentMethods: z.array(integratedPaymentMethodSchema),
  maxPaymentInstallments: z.number().int(),
  paymentSupportsCancel: z.boolean(),
  paymentSupportsRecover: z.boolean(),
  paymentSupportsReversal: z.boolean(),
  createdAt: responseDateTime,
  updatedAt: responseDateTime,
  updatedByIdentityId: id,
  idempotentReplay: z.boolean().optional(),
});
export const terminalProfileLookupResponseSchema = terminalProfileResponseSchema.nullable();

export {
  paymentAttemptCreateSchema,
  paymentDeviceCredentialRotateSchema,
  paymentDeviceDiagnosticsSchema,
  paymentDevicePairingCreateSchema,
  paymentDevicePairingRedeemSchema,
  paymentDeviceResultSchema,
  paymentHomologationRunSchema,
  paymentReconciliationInputSchema,
  paymentReversalCreateSchema,
  paymentTerminalCertificationSchema,
  paymentTerminalConfigurationSchema,
};

export const paymentReconciliationQuerySchema = z.object({
  status: paymentReconciliationStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const paymentTerminalCapabilityResponseSchema = z.object({
  installationId: id,
  available: z.boolean(),
  status: paymentTerminalStatusSchema,
  provider: paymentTerminalProviderSchema.nullable(),
  methods: z.array(integratedPaymentMethodSchema),
  maxInstallments: z.number().int().min(1).max(24),
  supports: z.object({
    cancel: z.boolean(),
    recover: z.boolean(),
    reversal: z.boolean(),
  }),
  reason: z.string().nullable(),
  certificationId: id.nullable(),
  diagnosticsMatch: z.boolean(),
  killSwitch: z.object({ enabled: z.boolean(), reason: z.string().nullable() }),
});

export const paymentDevicePairingResponseSchema = z.object({
  pairingId: id,
  code: z.string(),
  qrPayload: z.string(),
  expiresAt: responseDateTime,
});

export const paymentDeviceCredentialResponseSchema = z.object({
  installationId: id.optional(),
  credentialId: id,
  credentialExpiresAt: responseDateTime,
  rotateAfter: responseDateTime,
  previousCredentialValidUntil: responseDateTime.optional(),
  capabilities: paymentTerminalCapabilityResponseSchema.optional(),
});

const paymentDeviceReportedDiagnosticsResponseSchema = paymentDeviceDiagnosticsSchema.extend({
  lastSeenAt: responseDateTime,
});
const paymentCertificationSummaryResponseSchema = z.object({
  id,
  provider: paymentTerminalProviderSchema,
  status: z.enum(["approved", "suspended"]),
  killSwitchEnabled: z.boolean(),
  killSwitchReason: z.string().nullable(),
});
export const paymentDeviceListResponseSchema = z.object({
  devices: z.array(
    z.object({
      installationId: id,
      label: z.string(),
      enrolledAt: responseDateTime,
      revokedAt: responseDateTime.nullable(),
      lastSeenAt: responseDateTime.nullable(),
      reportedDiagnostics: paymentDeviceReportedDiagnosticsResponseSchema.nullable(),
      capabilities: paymentTerminalCapabilityResponseSchema,
      certification: paymentCertificationSummaryResponseSchema.nullable(),
    }),
  ),
});

export const paymentOperationsHealthResponseSchema = z.object({
  generatedAt: responseDateTime,
  summary: z.object({
    unknownAttempts: z.number().int().nonnegative(),
    staleProcessingAttempts: z.number().int().nonnegative(),
    offlineDevices: z.number().int().nonnegative(),
    reconciliationDivergences: z.number().int().nonnegative(),
  }),
  incidents: z.array(
    z.object({
      kind: z.enum([
        "unknown_attempt",
        "stale_processing",
        "offline_device",
        "reconciliation_divergence",
      ]),
      severity: z.enum(["warning", "critical"]),
      entityId: id,
      label: z.string(),
      occurredAt: responseDateTime,
    }),
  ),
});

const paymentReconciliationEntryResponseSchema = z.object({
  id,
  paymentId: id,
  provider: paymentTerminalProviderSchema,
  providerSettlementId: z.string(),
  providerReference: z.string(),
  grossCents: z.number().int().positive(),
  feeCents: z.number().int().nonnegative(),
  netCents: z.number().int().nonnegative(),
  expectedSettlementAt: responseDateTime,
  settledAt: responseDateTime.nullable(),
  status: paymentReconciliationStatusSchema,
  source: z.enum(["api", "webhook", "import"]),
  createdAt: responseDateTime,
  updatedAt: responseDateTime,
});
export const paymentReconciliationListResponseSchema = z.object({
  entries: z.array(paymentReconciliationEntryResponseSchema),
  summary: z.object({
    grossCents: z.number().int().nonnegative(),
    feeCents: z.number().int().nonnegative(),
    netCents: z.number().int().nonnegative(),
    divergences: z.number().int().nonnegative(),
  }),
});

const paymentHomologationRunResponseSchema = paymentHomologationRunSchema.extend({
  id,
  passed: z.boolean(),
  recordedByIdentityId: id,
  createdAt: responseDateTime,
});
export const paymentHomologationRunMutationResponseSchema = z.object({
  run: paymentHomologationRunResponseSchema,
});
export const paymentHomologationRunListResponseSchema = z.object({
  runs: z.array(paymentHomologationRunResponseSchema),
});

export const paymentAttemptResponseSchema = z.object({
  id,
  tabId: id,
  installationId: id,
  provider: paymentTerminalProviderSchema,
  method: integratedPaymentMethodSchema,
  amountCents: z.number().int().positive(),
  installments: z.number().int().min(1).max(24),
  status: paymentAttemptStatusSchema,
  providerReference: z.string().nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  expiresAt: responseDateTime,
  processingAt: responseDateTime.nullable(),
  resolvedAt: responseDateTime.nullable(),
  createdAt: responseDateTime,
  updatedAt: responseDateTime,
});

export const paymentAttemptActionSchema = z.object({
  type: z.enum(["start", "recover", "cancel"]),
  attemptId: id,
  provider: paymentTerminalProviderSchema,
});

export const paymentAttemptMutationResponseSchema = z.object({
  attempt: paymentAttemptResponseSchema,
  action: paymentAttemptActionSchema.nullable(),
  idempotentReplay: z.boolean().optional(),
});

export const paymentAttemptLookupResponseSchema = z.object({
  attempt: paymentAttemptResponseSchema,
});
export const paymentDeviceResultResponseSchema = z.object({
  attempt: paymentAttemptResponseSchema,
  paymentId: id.nullable().optional(),
  idempotentReplay: z.boolean(),
});
export const paymentDeviceClaimResponseSchema = z.object({
  attempt: paymentAttemptResponseSchema,
  action: z.enum(["start", "recover", "cancel"]),
  capabilities: paymentTerminalCapabilityResponseSchema,
  certification: paymentCertificationSummaryResponseSchema,
});
export const paymentReversalResponseSchema = z.object({
  reversal: z.object({
    id,
    paymentId: id,
    installationId: id,
    amountCents: z.number().int().positive(),
    reason: z.string(),
    status: z.enum(["pending", "processing", "approved", "declined", "canceled", "unknown"]),
    providerReference: z.string().nullable(),
    failureCode: z.string().nullable(),
    resolvedAt: responseDateTime.nullable(),
    createdAt: responseDateTime,
    updatedAt: responseDateTime,
  }),
  action: z.object({
    type: z.enum(["reverse", "recover"]),
    reversalId: id,
    paymentAttemptId: id,
    provider: paymentTerminalProviderSchema,
  }),
  idempotentReplay: z.boolean().optional(),
});
export const paymentDeviceReversalResultResponseSchema = z.object({
  reversal: paymentReversalResponseSchema.shape.reversal,
  idempotentReplay: z.boolean(),
});

export const kdsConflictResponseSchema = z.object({
  statusCode: z.number().int().optional(),
  code: z.string(),
  message: z.string().optional(),
});

export const kdsUnavailableResponseSchema = z.object({
  statusCode: z.number().int().optional(),
  code: z.string(),
  message: z.string(),
});

export type CategoryInput = z.infer<typeof categorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type AllergenInput = z.infer<typeof allergenSchema>;
export type ModifierGroupInput = z.infer<typeof modifierGroupSchema>;
export type StationInput = z.infer<typeof stationSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const comboSchema = z
  .object({
    name: shortName.max(160),
    description: z.string().trim().max(2_000).optional(),
    imageUrl: httpUrl.nullable().optional(),
    priceCents: cents,
    active: z.boolean().default(true),
    items: z
      .array(
        z.object({
          productId: id,
          quantity: z.number().int().min(1).max(100).default(1),
        }),
      )
      .min(1)
      .max(50),
  })
  .superRefine((input, context) => {
    const productIds = input.items.map((item) => item.productId);
    if (new Set(productIds).size !== productIds.length) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Cada produto pode aparecer apenas uma vez no combo.",
      });
    }
  });

export type ComboInput = z.infer<typeof comboSchema>;
export type ProductUnitConfigInput = z.infer<typeof productUnitConfigSchema>;
export type AggregateProductInput = z.infer<typeof aggregateProductSchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
export type CategoryAvailabilityInput = z.infer<typeof categoryAvailabilitySchema>;
export type BulkPriceInput = z.infer<typeof bulkPriceSchema>;
export type UpdateAllergenInput = z.infer<typeof updateAllergenSchema>;
export type UpdateStationInput = z.infer<typeof updateStationSchema>;
export type UpdateModifierGroupInput = z.infer<typeof updateModifierGroupSchema>;
export type ModifierOptionInput = z.infer<typeof modifierOptionSchema>;
export type UpdateModifierOptionInput = z.infer<typeof updateModifierOptionSchema>;
export type PromotionInput = z.infer<typeof promotionSchema>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;
export type BrandingInput = z.infer<typeof brandingSchema>;
export type ImportCatalogInput = z.infer<typeof importCatalogSchema>;
export type PublicationInput = z.infer<typeof publicationSchema>;
export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;
export type MediaUploadInput = z.infer<typeof mediaUploadSchema>;
export type DailyStockInput = z.infer<typeof dailyStockSchema>;
export type RoomInput = z.infer<typeof roomSchema>;
export type FloorRevisionQueryInput = z.infer<typeof floorRevisionQuerySchema>;
export type TableInput = z.infer<typeof tableSchema>;
export type TableEditInput = z.infer<typeof tableEditSchema>;
export type TableTurnoverInput = z.infer<typeof tableTurnoverSchema>;
export type TableBatchInput = z.infer<typeof tableBatchSchema>;
export type FloorLayoutInput = z.infer<typeof floorLayoutSchema>;
export type ShiftLayoutInput = z.infer<typeof shiftLayoutSchema>;
export type OpenTabInput = z.infer<typeof openTabSchema>;
export type UpdateTabInput = z.infer<typeof updateTabSchema>;
export type CounterQueueQueryInput = z.infer<typeof counterQueueQuerySchema>;
export type ServiceSectionInput = z.infer<typeof serviceSectionSchema>;
export type OpenOperationalShiftInput = z.infer<typeof openOperationalShiftSchema>;
export type ShiftSectionAssignmentInput = z.infer<typeof shiftSectionAssignmentSchema>;
export type ShiftSectionsBatchAssignmentInput = z.infer<typeof shiftSectionsBatchAssignmentSchema>;
export type ShiftSectionCoverageInput = z.infer<typeof shiftSectionCoverageSchema>;
export type TemporaryTableTransferInput = z.infer<typeof temporaryTableTransferSchema>;
export type CloseOperationalShiftInput = z.infer<typeof closeOperationalShiftSchema>;
export type ClaimTabInput = z.infer<typeof claimTabSchema>;
export type ServiceCallInput = z.infer<typeof serviceCallSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type PaymentAttemptCreateInput = z.infer<typeof paymentAttemptCreateSchema>;
export type PaymentDeviceCredentialRotateInput = z.infer<
  typeof paymentDeviceCredentialRotateSchema
>;
export type PaymentDeviceDiagnosticsInput = z.infer<typeof paymentDeviceDiagnosticsSchema>;
export type PaymentDevicePairingCreateInput = z.infer<typeof paymentDevicePairingCreateSchema>;
export type PaymentDevicePairingRedeemInput = z.infer<typeof paymentDevicePairingRedeemSchema>;
export type PaymentDeviceResultInput = z.infer<typeof paymentDeviceResultSchema>;
export type PaymentHomologationRunInput = z.infer<typeof paymentHomologationRunSchema>;
export type PaymentReconciliationInput = z.infer<typeof paymentReconciliationInputSchema>;
export type PaymentReconciliationQueryInput = z.infer<typeof paymentReconciliationQuerySchema>;
export type PaymentReversalCreateInput = z.infer<typeof paymentReversalCreateSchema>;
export type PaymentTerminalCertificationInput = z.infer<typeof paymentTerminalCertificationSchema>;
export type PaymentTerminalConfigurationInput = z.infer<typeof paymentTerminalConfigurationSchema>;
export type PrintJobInput = z.infer<typeof printJobSchema>;
export type PrintSplitInput = z.infer<typeof printSplitSchema>;
export type PrintJobQueryInput = z.infer<typeof printJobQuerySchema>;
export type PrintJobStatusInput = z.infer<typeof printJobStatusSchema>;
export type RetryPrintJobInput = z.infer<typeof retryPrintJobSchema>;
export type ReprintJobInput = z.infer<typeof reprintJobSchema>;
export type CloseTabInput = z.infer<typeof closeTabSchema>;
export type ReopenTabInput = z.infer<typeof reopenTabSchema>;
export type ApprovalRequestInput = z.infer<typeof approvalRequestSchema>;
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
export type MoveItemsInput = z.infer<typeof moveItemsSchema>;
export type OrderInput = z.infer<typeof orderSchema>;
export type TransferTabInput = z.infer<typeof transferTabSchema>;
export type MergeTabsInput = z.infer<typeof mergeTabsSchema>;
export type TableGroupInput = z.infer<typeof tableGroupSchema>;
export type DetachTableGroupInput = z.infer<typeof detachTableGroupSchema>;
export type SplitTabInput = z.infer<typeof splitTabSchema>;
export type ServiceChargeInput = z.infer<typeof serviceChargeSchema>;
export type TipInput = z.infer<typeof tipSchema>;
export type DiscountInput = z.infer<typeof discountSchema>;
export type CancelItemInput = z.infer<typeof cancelItemSchema>;
export type ManagerPinInput = z.infer<typeof managerPinSchema>;
export type KdsStateInput = z.infer<typeof kdsStateSchema>;
export type KdsItemStateInput = z.infer<typeof kdsItemStateSchema>;
export type KdsCancelInput = z.infer<typeof kdsCancelSchema>;
export type KdsRecallInput = z.infer<typeof kdsRecallSchema>;
export type KdsRefireInput = z.infer<typeof kdsRefireSchema>;
export type KdsPriorityInput = z.infer<typeof kdsPrioritySchema>;
export type KdsOrderPriorityInput = z.infer<typeof kdsOrderPrioritySchema>;
export type KdsCourseStateInput = z.infer<typeof kdsCourseStateSchema>;
export type KdsOrderHandoffInput = z.infer<typeof kdsOrderHandoffSchema>;
export type KdsTicketClaimInput = z.infer<typeof kdsTicketClaimSchema>;
export type KdsChangeAcknowledgeInput = z.infer<typeof kdsChangeAcknowledgeSchema>;
export type KdsRunnerClaimInput = z.infer<typeof kdsRunnerClaimSchema>;
export type KdsProductAvailabilityInput = z.infer<typeof kdsProductAvailabilitySchema>;
export type KdsTerminalProfileInput = z.infer<typeof kdsTerminalProfileSchema>;
export type TerminalProfileInput = z.infer<typeof terminalProfileSchema>;
export type KdsBlockInput = z.infer<typeof kdsBlockSchema>;
export type KdsUnblockInput = z.infer<typeof kdsUnblockSchema>;
export type KdsAttentionAcknowledgeInput = z.infer<typeof kdsAttentionAcknowledgeSchema>;
export type KdsRerouteInput = z.infer<typeof kdsRerouteSchema>;
export type KdsBatchCreateInput = z.infer<typeof kdsBatchCreateSchema>;
export type KdsBatchCompleteInput = z.infer<typeof kdsBatchCompleteSchema>;
export type KdsBatchCancelInput = z.infer<typeof kdsBatchCancelSchema>;
export type KdsAnalyticsQueryInput = z.infer<typeof kdsAnalyticsQuerySchema>;
