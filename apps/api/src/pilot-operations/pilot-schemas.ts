import { z } from "zod";

const id = z.string().uuid();
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const shortName = z.string().trim().min(1).max(160);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(100);
const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
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
      .min(1)
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

export const productSchema = z.object({
  categoryId: id,
  sku: z.string().trim().max(80).optional(),
  name: shortName,
  description: z.string().trim().max(2_000).optional(),
  allergenIds: z.array(id).max(50).default([]),
  modifierGroupIds: z.array(id).max(50).default([]),
  stationIds: z.array(id).length(1),
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
  available: z.boolean().default(true),
  availabilitySchedule: availabilityScheduleSchema.optional(),
});

export const productUnitConfigSchema = z.object({
  priceCents: cents,
  available: z.boolean(),
  availabilitySchedule: availabilityScheduleSchema.nullable().optional(),
  stationIds: z.array(id).length(1),
});

export const roomSchema = z.object({
  name: shortName.max(120),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const tableSchema = z.object({
  label: shortName.max(60),
  seats: z.number().int().min(1).max(100).default(4),
});

export const openTabSchema = z.object({
  tableId: id.optional(),
  label: z.string().trim().max(120).optional(),
  guestCount: z.number().int().min(1).max(500).default(1),
});

export const orderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: id,
        quantity: z.number().int().min(1).max(500),
        modifierOptionIds: z.array(id).max(100).default([]),
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const transferTabSchema = z.object({
  tableId: id,
  reason: z.string().trim().min(3).max(500),
});

export const mergeTabsSchema = z.object({
  targetTabId: id,
  sourceTabIds: z.array(id).min(1).max(50),
});

export const splitTabSchema = z.object({
  tableId: id.optional(),
  label: z.string().trim().max(120).optional(),
  items: z
    .array(z.object({ orderItemId: id, quantity: z.number().int().min(1).max(500) }))
    .min(1)
    .max(500),
});

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
export const kdsStateSchema = z.object({
  state: z.enum(["preparing", "ready", "done", "canceled"]),
});

export type CategoryInput = z.infer<typeof categorySchema>;
export type AllergenInput = z.infer<typeof allergenSchema>;
export type ModifierGroupInput = z.infer<typeof modifierGroupSchema>;
export type StationInput = z.infer<typeof stationSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type ProductUnitConfigInput = z.infer<typeof productUnitConfigSchema>;
export type RoomInput = z.infer<typeof roomSchema>;
export type TableInput = z.infer<typeof tableSchema>;
export type OpenTabInput = z.infer<typeof openTabSchema>;
export type OrderInput = z.infer<typeof orderSchema>;
export type TransferTabInput = z.infer<typeof transferTabSchema>;
export type MergeTabsInput = z.infer<typeof mergeTabsSchema>;
export type SplitTabInput = z.infer<typeof splitTabSchema>;
export type ServiceChargeInput = z.infer<typeof serviceChargeSchema>;
export type TipInput = z.infer<typeof tipSchema>;
export type DiscountInput = z.infer<typeof discountSchema>;
export type CancelItemInput = z.infer<typeof cancelItemSchema>;
export type ManagerPinInput = z.infer<typeof managerPinSchema>;
export type KdsStateInput = z.infer<typeof kdsStateSchema>;
