import { z } from "zod";

const id = z.string().uuid();
const idempotencyKey = z.string().trim().min(8).max(180);
const cents = z.number().int().nonnegative().max(1_000_000_000);
const dateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const publicGuestName = z.string().trim().min(2).max(160);
const publicGuestPhone = z.string().trim().min(8).max(40);
const publicPolicyVersion = z.string().trim().min(1).max(40);
const couponCode = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

function isPublicHttpsUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || !hostname || hostname === "localhost") return false;
  if (hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;
  if (["::1", "0.0.0.0", "127.0.0.1", "169.254.169.254"].includes(hostname)) return false;
  const octets = hostname.split(".").map(Number);
  if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet))) {
    const [first = 0, second = 0] = octets;
    if (first === 10 || first === 127 || first === 0 || (first === 169 && second === 254))
      return false;
    if (first === 192 && second === 168) return false;
    if (first === 172 && second >= 16 && second <= 31) return false;
  }
  return !/^(fc|fd|fe8|fe9|fea|feb)/.test(hostname);
}

export const optOutSchema = z.object({ token: z.string().trim().min(32).max(256) });
export type OptOutInput = z.infer<typeof optOutSchema>;

export const customerSchema = z.object({
  defaultUnitId: id.nullable().optional(),
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: z.string().trim().min(8).max(40).nullable().optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const consentSchema = z.object({
  decision: z.enum(["granted", "withdrawn"]),
  purpose: z.literal("marketing"),
  channel: z.enum(["email", "whatsapp", "all"]),
  source: z.string().trim().min(2).max(60),
  legalBasis: z.enum(["consent", "legitimate_interest"]),
  policyVersion: z.string().trim().min(1).max(40),
});
export type ConsentInput = z.infer<typeof consentSchema>;

export const loyaltyProgramSchema = z.object({
  mode: z.enum(["points", "cashback"]),
  rate: z.number().positive().max(10_000),
  minimumOrderCents: cents.default(0),
  expiresAfterDays: z.number().int().positive().max(3650).nullable().optional(),
  active: z.boolean().default(true),
});
export type LoyaltyProgramInput = z.infer<typeof loyaltyProgramSchema>;

export const loyaltyEarnSchema = z.object({
  customerId: id,
  unitId: id,
  commandId: id,
  idempotencyKey,
});
export type LoyaltyEarnInput = z.infer<typeof loyaltyEarnSchema>;

export const loyaltyRedeemSchema = z.object({
  customerId: id,
  unitId: id,
  amount: z.number().int().positive().max(1_000_000_000),
  sourceRef: z.string().trim().min(1).max(180).optional(),
  idempotencyKey,
});
export type LoyaltyRedeemInput = z.infer<typeof loyaltyRedeemSchema>;

export const loyaltyReverseSchema = z.object({ idempotencyKey });
export type LoyaltyReverseInput = z.infer<typeof loyaltyReverseSchema>;

export const couponSchema = z
  .object({
    unitId: id.nullable().optional(),
    code: couponCode,
    type: z.enum(["fixed", "percentage"]),
    value: z.number().int().positive().max(100_000_000),
    minimumOrderCents: cents.default(0),
    maximumDiscountCents: z.number().int().positive().nullable().optional(),
    validFrom: dateTime.optional(),
    validUntil: dateTime.nullable().optional(),
    channels: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    unitIds: z.array(id).max(100).default([]),
    perCustomerLimit: z.number().int().positive().max(1000).default(1),
    active: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (value.type === "percentage" && value.value > 10_000)
      context.addIssue({ code: "custom", path: ["value"], message: "Use basis points" });
    if (value.validFrom && value.validUntil && value.validUntil <= value.validFrom)
      context.addIssue({ code: "custom", path: ["validUntil"], message: "Invalid interval" });
  });
export type CouponInput = z.infer<typeof couponSchema>;

export const couponRedemptionSchema = z.object({
  code: z.string().trim().min(3).max(64),
  customerId: id.optional(),
  unitId: id,
  orderRef: id,
  channel: z.string().trim().min(1).max(40),
  idempotencyKey,
});
export type CouponRedemptionInput = z.infer<typeof couponRedemptionSchema>;

export const segmentFilterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("marketing_opt_in") }),
  z.object({ kind: z.literal("birthday_month"), month: z.number().int().min(1).max(12) }),
]);
export const segmentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  filters: segmentFilterSchema,
  active: z.boolean().default(true),
});
export type SegmentInput = z.infer<typeof segmentSchema>;

export const campaignSchema = z
  .object({
    unitId: id.nullable().optional(),
    segmentId: id.nullable().optional(),
    name: z.string().trim().min(2).max(160),
    channel: z.enum(["email", "whatsapp"]),
    subject: z.string().trim().min(2).max(180).nullable().optional(),
    content: z.string().trim().min(2).max(5000),
  })
  .superRefine((value, context) => {
    if (value.channel === "email" && !value.subject)
      context.addIssue({ code: "custom", path: ["subject"], message: "Required for email" });
  });
export type CampaignInput = z.infer<typeof campaignSchema>;

export const reservationSchema = z.object({
  unitId: id,
  customerId: id.nullable().optional(),
  guestName: z.string().trim().min(2).max(160),
  guestPhone: z.string().trim().min(8).max(40).nullable().optional(),
  partySize: z.number().int().positive().max(100),
  scheduledAt: dateTime,
  durationMinutes: z.number().int().min(15).max(720).default(120),
  notes: z.string().trim().max(500).nullable().optional(),
  idempotencyKey,
});
export type ReservationInput = z.infer<typeof reservationSchema>;

export const publicReservationSchema = z
  .object({
    guestName: publicGuestName,
    guestPhone: publicGuestPhone,
    partySize: reservationSchema.shape.partySize,
    scheduledAt: dateTime,
    notes: reservationSchema.shape.notes,
    privacyAccepted: z.literal(true),
    policyVersion: publicPolicyVersion,
  })
  .strict()
  .superRefine((value, context) => {
    const now = Date.now();
    const scheduledAt = value.scheduledAt.getTime();
    if (scheduledAt <= now)
      context.addIssue({
        code: "custom",
        path: ["scheduledAt"],
        message: "A reserva precisa estar no futuro.",
      });
    if (scheduledAt > now + 366 * 24 * 60 * 60 * 1000)
      context.addIssue({
        code: "custom",
        path: ["scheduledAt"],
        message: "A reserva excede a janela pública disponível.",
      });
  });
export type PublicReservationInput = z.infer<typeof publicReservationSchema>;

export const reservationTransitionSchema = z.object({
  status: z.enum(["confirmed", "seated", "completed", "canceled", "no_show"]),
});
export type ReservationTransitionInput = z.infer<typeof reservationTransitionSchema>;

export const waitlistSchema = z.object({
  unitId: id,
  customerId: id.nullable().optional(),
  guestName: z.string().trim().min(2).max(160),
  guestPhone: z.string().trim().min(8).max(40).nullable().optional(),
  partySize: z.number().int().positive().max(100),
  quotedWaitMinutes: z.number().int().nonnegative().max(720).nullable().optional(),
  idempotencyKey,
});
export type WaitlistInput = z.infer<typeof waitlistSchema>;

export const publicWaitlistSchema = z
  .object({
    guestName: publicGuestName,
    guestPhone: publicGuestPhone,
    partySize: waitlistSchema.shape.partySize,
    privacyAccepted: z.literal(true),
    policyVersion: publicPolicyVersion,
  })
  .strict();
export type PublicWaitlistInput = z.infer<typeof publicWaitlistSchema>;

export const publicCouponValidationSchema = z
  .object({
    code: couponCode,
    orderTotalCents: cents,
    channel: z.literal("qr").default("qr"),
  })
  .strict();
export type PublicCouponValidationInput = z.infer<typeof publicCouponValidationSchema>;

export const waitlistTransitionSchema = z.object({
  status: z.enum(["notified", "seated", "left", "canceled", "no_show"]),
});
export type WaitlistTransitionInput = z.infer<typeof waitlistTransitionSchema>;

export const deliveryZoneSchema = z.object({
  unitId: id,
  name: z.string().trim().min(2).max(120),
  feeCents: cents,
  minimumOrderCents: cents.default(0),
  geometry: z.record(z.string(), z.unknown()),
  active: z.boolean().default(true),
});
export type DeliveryZoneInput = z.infer<typeof deliveryZoneSchema>;

export const deliveryOrderSchema = z.object({
  unitId: id,
  customerId: id.nullable().optional(),
  zoneId: id.nullable().optional(),
  orderRef: id,
  fulfillment: z.enum(["delivery", "pickup"]),
  address: z.record(z.string(), z.unknown()).nullable().optional(),
  scheduledFor: dateTime.nullable().optional(),
  idempotencyKey,
});
export type DeliveryOrderInput = z.infer<typeof deliveryOrderSchema>;

export const deliveryTransitionSchema = z.object({
  status: z.enum([
    "placed",
    "confirmed",
    "preparing",
    "ready",
    "dispatched",
    "completed",
    "canceled",
  ]),
});
export type DeliveryTransitionInput = z.infer<typeof deliveryTransitionSchema>;

export const dispatchSchema = z.object({
  courierReference: z.string().trim().min(2).max(160),
  idempotencyKey,
});
export type DispatchInput = z.infer<typeof dispatchSchema>;

export const priceOverrideSchema = z.object({
  unitId: id,
  productRef: z.string().trim().min(1).max(180),
  priceCents: z.number().int().positive().max(100_000_000),
  active: z.boolean().default(true),
});
export type PriceOverrideInput = z.infer<typeof priceOverrideSchema>;

export const transferSchema = z.object({
  originUnitId: id,
  destinationUnitId: id,
  notes: z.string().trim().max(500).nullable().optional(),
  idempotencyKey,
  lines: z
    .array(
      z.object({
        inventoryItemRef: z.string().trim().min(1).max(180),
        quantity: z.number().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(500),
});
export type TransferInput = z.infer<typeof transferSchema>;

export const transferTransitionSchema = z.object({
  status: z.enum(["in_transit", "received", "canceled"]),
});
export type TransferTransitionInput = z.infer<typeof transferTransitionSchema>;

export const apiKeySchema = z.object({
  name: z.string().trim().min(2).max(120),
  scopes: z.array(z.string().trim().min(2).max(80)).min(1).max(30),
  expiresAt: dateTime.nullable().optional(),
});
export type ApiKeyInput = z.infer<typeof apiKeySchema>;

export const webhookEndpointSchema = z.object({
  url: z.string().url().max(2048).refine(isPublicHttpsUrl, "Public HTTPS URL required"),
  eventTypes: z.array(z.string().trim().min(2).max(120)).min(1).max(100),
});
export type WebhookEndpointInput = z.infer<typeof webhookEndpointSchema>;

export const webhookEventSchema = z.object({
  eventType: z.string().trim().min(2).max(120),
  aggregateType: z.string().trim().min(2).max(80),
  aggregateId: z.string().trim().min(1).max(160),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey,
});
export type WebhookEventInput = z.infer<typeof webhookEventSchema>;

export const doseClubSchema = z.object({
  unitId: id.nullable().optional(),
  credentialReference: z.string().trim().min(3).max(180),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type DoseClubInput = z.infer<typeof doseClubSchema>;
