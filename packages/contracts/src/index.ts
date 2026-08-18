import { z } from "zod";

export type {
  components as ApiComponents,
  operations as ApiOperations,
  paths as ApiPaths,
  webhooks as ApiWebhooks,
} from "./generated-api.js";

export const idSchema = z.uuid();
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254)
  .refine((email) => !email.endsWith("@system.giromesa.invalid"), "E-mail reservado.");
export const moneyCentsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const operationalCapabilitySchema = z.enum([
  "operations:payments:record",
  "operations:tabs:close",
  "operations:charges:adjust",
  "operations:exceptions:request",
  "operations:exceptions:approve",
  "operations:tabs:open",
  "operations:reception:manage",
  "operations:reception:seat",
  "operations:tables:turnover",
]);

export const operationalCapabilityAliases = {
  "payments:write": ["operations:payments:record"],
  "cashier:write": [
    "operations:payments:record",
    "operations:tabs:close",
    "operations:charges:adjust",
    "operations:tabs:open",
  ],
} as const;

export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(12).max(128),
  displayName: z.string().trim().min(2).max(120),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  trustedDevice: z.boolean().default(false),
});

export const publicRegisterSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(12).max(128),
    name: z.string().trim().min(2).max(120),
    termsAccepted: z.union([z.literal(true), z.literal("true")]),
  })
  .transform(({ email, password, name }) => ({ email, password, displayName: name }));

export const publicLoginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
    trustedDevice: z.union([z.boolean(), z.literal("on")]).optional(),
  })
  .transform(({ email, password, trustedDevice }) => ({
    email,
    password,
    trustedDevice: trustedDevice === true || trustedDevice === "on",
  }));

export const registerRequestSchema = z.union([registerSchema, publicRegisterSchema]);
export const loginRequestSchema = z.union([loginSchema, publicLoginSchema]);

export const requestPasswordResetSchema = z.object({ email: emailSchema });
export const confirmPasswordResetSchema = z.object({
  token: z.string().min(32).max(200),
  password: z.string().min(12).max(128),
});

export const createOrganizationSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  tradeName: z.string().trim().min(2).max(120),
  document: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z0-9]{12}\d{2}$/.test(value), {
      message: "CNPJ deve conter 14 posições e dois dígitos verificadores numéricos",
    }),
  unitName: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(3).max(64).default("America/Sao_Paulo"),
});

export const enrollDeviceSchema = z.object({
  label: z.string().trim().min(2).max(120),
  certificateFingerprint: z.string().trim().min(32).max(128).optional(),
});

export const inviteMembershipSchema = z.object({
  email: emailSchema,
  role: z.enum([
    "owner",
    "manager",
    "waiter",
    "cashier",
    "receptionist",
    "busser",
    "kds",
    "delivery",
    "inventory",
    "finance",
    "accountant",
  ]),
  unitId: idSchema.nullable(),
});

export const acceptMembershipInviteSchema = z.object({ token: z.string().min(32).max(200) });

export const activationChecklistSchema = z.object({
  business: z.boolean(),
  unit: z.boolean(),
  catalog: z.boolean(),
  team: z.boolean(),
  production: z.boolean(),
  cashier: z.boolean(),
  fiscalChoice: z.boolean(),
  training: z.boolean(),
  rehearsal: z.boolean(),
});

export const updateOnboardingSchema = z.object({
  checklist: activationChecklistSchema.partial(),
});

export const activateTrialSchema = z.object({
  planSlug: z.enum(["operacao", "crescimento", "rede"]),
});

export const operationalCommandSchema = z.object({
  id: idSchema,
  deviceId: idSchema,
  type: z.string().trim().min(3).max(100),
  version: z.number().int().positive().max(100),
  occurredAt: z.iso.datetime({ offset: true }),
  idempotencyKey: z.string().trim().min(8).max(160),
  payload: z.record(z.string(), z.unknown()),
});

export const billingEventSchema = z.object({
  event: z.enum([
    "START_ONBOARDING",
    "ACTIVATE_TRIAL",
    "CONFIRM_PAYMENT",
    "TRIAL_EXPIRED",
    "PAYMENT_OVERDUE",
    "GRACE_EXPIRED",
    "SUSPEND",
    "RESTORE",
    "CANCEL",
  ]),
});

export const trialApplicationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: z.string().trim().min(10).max(20),
  businessName: z.string().trim().min(2).max(120),
  segment: z.string().trim().min(2).max(80).optional(),
  planSlug: z.enum(["operacao", "crescimento", "rede"]),
  consent: z.literal(true),
});

const planLabelToSlug = {
  Operação: "operacao",
  Crescimento: "crescimento",
  Rede: "rede",
} as const;

export const publicTrialApplicationSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: emailSchema,
    phone: z.string().trim().min(10).max(20),
    businessName: z.string().trim().min(2).max(120),
    segment: z.string().trim().min(2).max(80),
    plan: z.enum(["Operação", "Crescimento", "Rede"]),
    privacyAccepted: z.union([z.literal(true), z.literal("true")]),
  })
  .transform(({ plan, ...input }) => ({
    name: input.name,
    email: input.email,
    phone: input.phone,
    businessName: input.businessName,
    planSlug: planLabelToSlug[plan],
    consent: true as const,
    segment: input.segment,
  }));

export const trialApplicationRequestSchema = z.union([
  trialApplicationSchema,
  publicTrialApplicationSchema,
]);

export const contactRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: z.string().trim().min(10).max(20),
  message: z.string().trim().min(5).max(4_000),
  privacyAccepted: z.union([z.literal(true), z.literal("true")]),
});

export const publicMenuCommandSchema = z.object({
  type: z.enum(["place_order", "call_waiter", "request_check"]),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export const publicMenuSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const idempotencyKeySchema = z.string().trim().min(8).max(160);

export const deliveryAddressSchema = z
  .object({
    street: z.string().trim().min(2).max(160),
    number: z.string().trim().min(1).max(30),
    complement: z.string().trim().max(120).optional(),
    neighborhood: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(120),
    state: z
      .string()
      .trim()
      .length(2)
      .transform((value) => value.toUpperCase()),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}-?\d{3}$/),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .strict()
  .superRefine((address, context) => {
    if ((address.latitude === undefined) !== (address.longitude === undefined)) {
      context.addIssue({
        code: "custom",
        path: [address.latitude === undefined ? "latitude" : "longitude"],
        message: "Latitude e longitude devem ser informadas juntas.",
      });
    }
  });

export const deliveryCourierCreateSchema = z
  .object({
    unitId: z.string().uuid(),
    reference: z.string().trim().min(2).max(80),
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(8).max(40).nullable().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const deliveryCourierStatusSchema = z
  .object({
    status: z.enum(["available", "offline"]),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const deliveryCourierPositionSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    recordedAt: z.string().datetime({ offset: true }).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const deliveryCourierAssignmentSchema = z
  .object({
    courierId: z.string().uuid(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const deliveryNotificationSchema = z
  .object({
    audience: z.enum(["operations", "customer"]),
    type: z.enum(["status_update", "courier_assigned", "courier_arriving"]),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const publicOrderSchema = z
  .object({
    fulfillment: z.enum(["pickup", "delivery"]),
    customer: z
      .object({
        name: z.string().trim().min(2).max(120),
        phone: z.string().trim().min(10).max(20),
      })
      .strict(),
    items: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            quantity: z.number().int().min(1).max(99),
            modifierOptionIds: z.array(z.string().uuid()).max(20).default([]),
            notes: z.string().trim().max(180).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    deliveryZone: z.string().trim().min(2).max(120).optional(),
    address: deliveryAddressSchema.optional(),
    paymentMethod: z.literal("pay_on_fulfillment"),
    privacyAccepted: z.literal(true),
    policyVersion: z.string().trim().min(1).max(40),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.fulfillment === "delivery") {
      if (!value.deliveryZone) {
        context.addIssue({ code: "custom", path: ["deliveryZone"], message: "Zona obrigatória." });
      }
      if (!value.address) {
        context.addIssue({ code: "custom", path: ["address"], message: "Endereço obrigatório." });
      }
    } else if (value.deliveryZone || value.address) {
      context.addIssue({
        code: "custom",
        path: ["fulfillment"],
        message: "Retirada não aceita zona ou endereço de entrega.",
      });
    }
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PublicRegisterInput = z.infer<typeof publicRegisterSchema>;
export type PublicLoginInput = z.infer<typeof publicLoginSchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type EnrollDeviceInput = z.infer<typeof enrollDeviceSchema>;
export type InviteMembershipInput = z.infer<typeof inviteMembershipSchema>;
export type OperationalCapability = z.infer<typeof operationalCapabilitySchema>;
export type AcceptMembershipInviteInput = z.infer<typeof acceptMembershipInviteSchema>;
export type UpdateOnboardingInput = z.infer<typeof updateOnboardingSchema>;
export type ActivateTrialInput = z.infer<typeof activateTrialSchema>;
export type OperationalCommandInput = z.infer<typeof operationalCommandSchema>;
export type BillingEventInput = z.infer<typeof billingEventSchema>;
export type TrialApplicationInput = z.infer<typeof trialApplicationSchema>;
export type PublicTrialApplicationInput = z.infer<typeof publicTrialApplicationSchema>;
export type ContactRequestInput = z.infer<typeof contactRequestSchema>;
export type PublicMenuCommandInput = z.infer<typeof publicMenuCommandSchema>;
export type PublicOrderInput = z.infer<typeof publicOrderSchema>;
export type DeliveryAddressInput = z.infer<typeof deliveryAddressSchema>;
export type DeliveryCourierCreateInput = z.infer<typeof deliveryCourierCreateSchema>;
export type DeliveryCourierStatusInput = z.infer<typeof deliveryCourierStatusSchema>;
export type DeliveryCourierPositionInput = z.infer<typeof deliveryCourierPositionSchema>;
export type DeliveryCourierAssignmentInput = z.infer<typeof deliveryCourierAssignmentSchema>;
export type DeliveryNotificationInput = z.infer<typeof deliveryNotificationSchema>;
export type RegisterRequestInput = z.infer<typeof registerRequestSchema>;
export type LoginRequestInput = z.infer<typeof loginRequestSchema>;
export type TrialApplicationRequestInput = z.infer<typeof trialApplicationRequestSchema>;

export interface PublicCommercialPlan {
  slug: "operacao" | "crescimento" | "rede";
  name: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  includedUnits: number;
  entitlements: string[];
}

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}
