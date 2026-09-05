import {
  type DeliveryCourierAssignmentInput,
  type DeliveryCourierCreateInput,
  type DeliveryCourierPositionInput,
  type DeliveryCourierStatusInput,
  type DeliveryNotificationInput,
  deliveryAddressSchema,
  deliveryCourierAssignmentSchema,
  deliveryCourierCreateSchema,
  deliveryCourierPositionSchema,
  deliveryCourierStatusSchema,
  deliveryNotificationSchema,
} from "@giromesa/contracts";
import { z } from "zod";

export type {
  DeliveryCourierAssignmentInput,
  DeliveryCourierCreateInput,
  DeliveryCourierPositionInput,
  DeliveryCourierStatusInput,
  DeliveryNotificationInput,
};
export {
  deliveryCourierAssignmentSchema,
  deliveryCourierCreateSchema,
  deliveryCourierPositionSchema,
  deliveryCourierStatusSchema,
  deliveryNotificationSchema,
};

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

const customerTags = z.array(z.string().trim().min(1).max(40)).max(30);

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
  notes: z.string().trim().max(1000).nullable().optional(),
  tags: customerTags.default([]),
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const customerListQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    unitId: id.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type CustomerListQueryInput = z.infer<typeof customerListQuerySchema>;

export const customerUpdateSchema = customerSchema
  .partial()
  .extend({ tags: customerTags.optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

export const customerArchiveSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type CustomerArchiveInput = z.infer<typeof customerArchiveSchema>;

export const customerMergeSchema = z.object({
  sourceCustomerId: id,
  reason: z.string().trim().min(3).max(500),
});
export type CustomerMergeInput = z.infer<typeof customerMergeSchema>;

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

export const couponUpdateSchema = z
  .object({
    code: couponCode.optional(),
    type: z.enum(["fixed", "percentage"]).optional(),
    value: z.number().int().positive().max(100_000_000).optional(),
    minimumOrderCents: cents.optional(),
    maximumDiscountCents: z.number().int().positive().nullable().optional(),
    validFrom: dateTime.optional(),
    validUntil: dateTime.nullable().optional(),
    channels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    unitIds: z.array(id).max(100).optional(),
    perCustomerLimit: z.number().int().positive().max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });
export type CouponUpdateInput = z.infer<typeof couponUpdateSchema>;

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
  z.object({ kind: z.literal("inactive_days"), days: z.number().int().min(1).max(3650) }),
  z.object({ kind: z.literal("minimum_visits"), visits: z.number().int().min(1).max(10000) }),
  z.object({
    kind: z.literal("minimum_spend_cents"),
    amountCents: z.number().int().min(1).max(1_000_000_000),
  }),
  z.object({ kind: z.literal("no_show_count"), count: z.number().int().min(1).max(1000) }),
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
    variantBContent: z.string().trim().min(2).max(5000).nullable().optional(),
    attributionWindowDays: z.number().int().min(1).max(90).default(7),
    holdoutPercentage: z.number().int().min(0).max(50).default(0),
  })
  .superRefine((value, context) => {
    if (value.channel === "email" && !value.subject)
      context.addIssue({ code: "custom", path: ["subject"], message: "Required for email" });
  });
export type CampaignInput = z.infer<typeof campaignSchema>;

export const campaignCancelSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type CampaignCancelInput = z.infer<typeof campaignCancelSchema>;

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

export const reservationListQuerySchema = z
  .object({
    scope: z.enum(["active", "history", "all"]).default("active"),
    from: dateTime.optional(),
    to: dateTime.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "O início do período deve anteceder o fim.",
  });
export type ReservationListQueryInput = z.infer<typeof reservationListQuerySchema>;

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

export const waitlistListQuerySchema = z
  .object({
    scope: z.enum(["active", "history", "all"]).default("active"),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type WaitlistListQueryInput = z.infer<typeof waitlistListQuerySchema>;

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
  estimatedDeliveryMinutes: z.number().int().min(5).max(240).default(45),
  geometry: z.record(z.string(), z.unknown()),
  active: z.boolean().default(true),
});
export type DeliveryZoneInput = z.infer<typeof deliveryZoneSchema>;

export const deliveryZoneUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    feeCents: cents.optional(),
    minimumOrderCents: cents.optional(),
    estimatedDeliveryMinutes: z.number().int().min(5).max(240).optional(),
    geometry: z.record(z.string(), z.unknown()).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, { message: "Informe ao menos um campo." });
export type DeliveryZoneUpdateInput = z.infer<typeof deliveryZoneUpdateSchema>;

export const deliveryAddressValidationSchema = deliveryAddressSchema.refine(
  (address) => address.latitude !== undefined && address.longitude !== undefined,
  { message: "Coordenadas são obrigatórias para validar a cobertura." },
);
export type DeliveryAddressValidationInput = z.infer<typeof deliveryAddressValidationSchema>;

const deliveryOrderStatus = z.enum([
  "draft",
  "placed",
  "confirmed",
  "preparing",
  "ready",
  "dispatched",
  "completed",
  "canceled",
]);

export const deliveryOrderQuerySchema = z
  .object({
    status: deliveryOrderStatus.optional(),
    updatedSince: dateTime.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    query: z.string().trim().min(1).max(120).optional(),
    scheduled: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    sla: z.enum(["overdue", "on_time", "unset"]).optional(),
  })
  .strict();
export type DeliveryOrderQueryInput = z.infer<typeof deliveryOrderQuerySchema>;

export const deliveryOrderSchema = z.object({
  unitId: id,
  customerId: id.nullable().optional(),
  zoneId: id.nullable().optional(),
  orderRef: id,
  fulfillment: z.enum(["delivery", "pickup"]),
  address: deliveryAddressSchema.nullable().optional(),
  scheduledFor: dateTime.nullable().optional(),
  promisedAt: dateTime.nullable().optional(),
  idempotencyKey,
});
export type DeliveryOrderInput = z.infer<typeof deliveryOrderSchema>;

export const deliveryTransitionSchema = z.object({
  status: deliveryOrderStatus.exclude(["draft", "dispatched"]),
});
export type DeliveryTransitionInput = z.infer<typeof deliveryTransitionSchema>;

export const dispatchSchema = z.object({
  courierReference: z.string().trim().min(2).max(160),
  coverageOverrideReason: z.string().trim().min(10).max(500).optional(),
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
  credentialReference: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{2,179}$/),
  config: z
    .object({
      apiBaseUrl: z.string().url(),
      clientId: z.string().trim().min(3).max(180),
    })
    .strict(),
});
export type DoseClubInput = z.infer<typeof doseClubSchema>;

const hourMinute = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const evolutionUnitQuerySchema = z.object({ unitId: id });
export type EvolutionUnitQueryInput = z.infer<typeof evolutionUnitQuerySchema>;

export const evolutionConfigurationSchema = z.object({
  unitId: id,
  enabled: z.boolean().default(true),
  quietHoursStart: hourMinute.default("21:00"),
  quietHoursEnd: hourMinute.default("08:00"),
  maxMessagesPer30Days: z.number().int().min(1).max(30).default(4),
});
export type EvolutionConfigurationInput = z.infer<typeof evolutionConfigurationSchema>;

const whatsappMediaSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "application/pdf",
  ]),
  base64: z.string().min(4).max(4_200_000),
});

export const whatsappMessageSchema = z
  .object({
    unitId: id,
    conversationId: id.optional(),
    customerId: id.optional(),
    phone: z.string().trim().min(10).max(40).optional(),
    body: z.string().trim().max(4096).default(""),
    media: whatsappMediaSchema.optional(),
    idempotencyKey,
  })
  .superRefine((value, context) => {
    if (!value.conversationId && !value.customerId && !value.phone)
      context.addIssue({
        code: "custom",
        message: "conversationId, customerId or phone is required",
      });
    if (!value.body && !value.media)
      context.addIssue({ code: "custom", path: ["body"], message: "body or media is required" });
  });
export type WhatsAppMessageInput = z.infer<typeof whatsappMessageSchema>;

export const whatsappInboxQuerySchema = z
  .object({
    unitId: id,
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursorAt: dateTime.optional(),
    cursorId: id.optional(),
    status: z.enum(["open", "pending", "closed"]).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    assignedTo: z.enum(["me", "unassigned", "any"]).default("any"),
    search: z.string().trim().max(120).optional(),
  })
  .refine((value) => Boolean(value.cursorAt) === Boolean(value.cursorId), {
    message: "cursorAt and cursorId must be provided together",
  });
export type WhatsAppInboxQueryInput = z.infer<typeof whatsappInboxQuerySchema>;

export const whatsappMessagesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    beforeAt: dateTime.optional(),
    beforeId: id.optional(),
  })
  .refine((value) => Boolean(value.beforeAt) === Boolean(value.beforeId), {
    message: "beforeAt and beforeId must be provided together",
  });
export type WhatsAppMessagesQueryInput = z.infer<typeof whatsappMessagesQuerySchema>;

export const whatsappConversationUpdateSchema = z.object({
  status: z.enum(["open", "pending", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assignedIdentityId: id.nullable().optional(),
  slaMinutes: z.number().int().min(5).max(10_080).nullable().optional(),
  expectedUpdatedAt: dateTime,
});
export type WhatsAppConversationUpdateInput = z.infer<typeof whatsappConversationUpdateSchema>;

export const crmQuickReplySchema = z.object({
  unitId: id,
  id: id.optional(),
  title: z.string().trim().min(2).max(80),
  body: z.string().trim().min(1).max(4096),
  active: z.boolean().default(true),
});
export type CrmQuickReplyInput = z.infer<typeof crmQuickReplySchema>;

export const crmAutomationExecutionQuerySchema = z
  .object({
    unitId: id,
    status: z.enum(["queued", "sent", "suppressed", "failed"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursorAt: dateTime.optional(),
    cursorId: id.optional(),
  })
  .refine((value) => Boolean(value.cursorAt) === Boolean(value.cursorId), {
    message: "cursorAt and cursorId must be provided together",
  });
export type CrmAutomationExecutionQueryInput = z.infer<typeof crmAutomationExecutionQuerySchema>;

export const crmAutomationTestSchema = z.object({
  unitId: id,
  phone: z.string().trim().min(10).max(40),
});
export type CrmAutomationTestInput = z.infer<typeof crmAutomationTestSchema>;

export const crmAutomationRuleSchema = z
  .object({
    unitId: id,
    trigger: z.enum(["birthday", "inactive", "post_visit", "no_show", "survey"]),
    enabled: z.boolean(),
    delayMinutes: z.number().int().min(0).max(525_600).default(0),
    inactiveDays: z.number().int().min(1).max(3650).nullable().optional(),
    messageTemplate: z.string().trim().min(1).max(4096),
  })
  .superRefine((value, context) => {
    if (value.trigger === "inactive" && !value.inactiveDays) {
      context.addIssue({
        code: "custom",
        path: ["inactiveDays"],
        message: "inactiveDays is required",
      });
    }
  });
export type CrmAutomationRuleInput = z.infer<typeof crmAutomationRuleSchema>;

export const evolutionWebhookSchema = z
  .object({
    event: z.string().trim().min(1).max(80),
    instanceToken: z.string().trim().min(32).max(256),
    state: z.string().trim().max(40).optional(),
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough();
export type EvolutionWebhookInput = z.infer<typeof evolutionWebhookSchema>;
