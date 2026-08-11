import { z } from "zod";

const INT32_MAX = 2_147_483_647;

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
export const requestEmailVerificationSchema = z.object({ email: emailSchema });
export const verifyEmailSchema = z.object({ token: z.string().min(32).max(200) });

export const createOrganizationSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  tradeName: z.string().trim().min(2).max(120),
  document: z
    .string()
    .trim()
    .regex(/^\d{14}$/, "CNPJ must contain 14 digits"),
  unitName: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(3).max(64).default("America/Sao_Paulo"),
});

export const enrollDeviceSchema = z.object({
  label: z.string().trim().min(2).max(120),
  certificateFingerprint: z.string().trim().min(32).max(128).optional(),
});

export const inviteMembershipSchema = z.object({
  email: emailSchema,
  role: z.enum(["owner", "manager", "waiter", "cashier", "kds", "inventory", "finance"]),
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

export const onboardingChecklistStatusSchema = z.enum([
  "pending",
  "in_progress",
  "verified",
  "blocked",
  "not_applicable",
]);

const checklistEvidenceReferenceSchema = z.string().trim().min(3).max(240);
const checklistProgressEvidenceSchema = z
  .object({
    note: z.string().trim().min(1).max(240).optional(),
  })
  .strict();
const checklistProgressItem = (status: "pending" | "in_progress" | "blocked") =>
  z
    .object({
      status: z.literal(status),
      evidenceReference: checklistEvidenceReferenceSchema.optional(),
      evidence: checklistProgressEvidenceSchema.optional(),
    })
    .strict();
const checklistProgressOptions = [
  checklistProgressItem("pending"),
  checklistProgressItem("in_progress"),
  checklistProgressItem("blocked"),
] as const;
const checklistProgressSchema = z
  .object({
    status: z.enum(["pending", "in_progress", "blocked"]),
    evidenceReference: checklistEvidenceReferenceSchema.optional(),
    evidence: checklistProgressEvidenceSchema.optional(),
  })
  .strict();
const productionProgressItem = (status: "in_progress" | "blocked") =>
  z
    .object({
      status: z.literal(status),
      evidenceReference: checklistEvidenceReferenceSchema.optional(),
      evidence: productionInProgressSchema,
    })
    .strict();
const productionRouteEvidenceBaseSchema = z.object({
  configurationReference: z.string().trim().min(3).max(120).optional(),
});
const productionInProgressSchema = z.discriminatedUnion("mode", [
  productionRouteEvidenceBaseSchema
    .extend({
      mode: z.literal("kds"),
      kdsStationIds: z.array(idSchema).min(1).max(24),
    })
    .strict(),
  productionRouteEvidenceBaseSchema
    .extend({
      mode: z.literal("print"),
      printerProfileIds: z.array(idSchema).min(1).max(24),
    })
    .strict(),
  productionRouteEvidenceBaseSchema
    .extend({
      mode: z.literal("both"),
      kdsStationIds: z.array(idSchema).min(1).max(24),
      printerProfileIds: z.array(idSchema).min(1).max(24),
    })
    .strict(),
]);
const productionProgressOptions = [
  z.object({ status: z.literal("pending") }).strict(),
  productionProgressItem("in_progress"),
  productionProgressItem("blocked"),
] as const;
const verifiedChecklistItem = <T extends z.ZodType>(evidence: T) =>
  z
    .object({
      status: z.literal("verified"),
      evidenceReference: checklistEvidenceReferenceSchema,
      evidence,
    })
    .strict();
const waivedChecklistItem = <T extends z.ZodType>(evidence: T) =>
  z
    .object({
      status: z.literal("not_applicable"),
      evidenceReference: checklistEvidenceReferenceSchema.optional(),
      evidence: evidence.optional(),
      waiverReason: z.string().trim().min(10).max(500),
    })
    .strict();

const fiscalEvidenceSchema = z
  .object({ choice: z.enum(["disabled", "focus", "external"]) })
  .strict();
const productionEvidenceSchema = z.object({ mode: z.literal("off") }).strict();
const completedEvidenceSchema = z.object({ completed: z.literal(true) }).strict();
const qrWaiverEvidenceSchema = z
  .object({ reason: z.enum(["pilot_without_qr", "external_qr", "not_required"]) })
  .strict();
const fiscalWaiverEvidenceSchema = z
  .object({ reason: z.enum(["external_fiscal", "not_required"]) })
  .strict();

export const onboardingChecklistEvidenceInputSchema = z.union([
  checklistProgressSchema,
  verifiedChecklistItem(fiscalEvidenceSchema),
  verifiedChecklistItem(productionEvidenceSchema),
  verifiedChecklistItem(completedEvidenceSchema),
  waivedChecklistItem(qrWaiverEvidenceSchema),
  waivedChecklistItem(fiscalWaiverEvidenceSchema),
]);

const onboardingChecklistItemsInputSchema = z
  .object({
    business: checklistProgressSchema,
    unit: checklistProgressSchema,
    plan: checklistProgressSchema,
    fiscalChoice: z.discriminatedUnion("status", [
      ...checklistProgressOptions,
      verifiedChecklistItem(fiscalEvidenceSchema),
      waivedChecklistItem(fiscalWaiverEvidenceSchema),
    ]),
    catalog: checklistProgressSchema,
    tables: checklistProgressSchema,
    team: checklistProgressSchema,
    qr: z.discriminatedUnion("status", [
      ...checklistProgressOptions,
      waivedChecklistItem(qrWaiverEvidenceSchema),
    ]),
    production: z.discriminatedUnion("status", [
      ...productionProgressOptions,
      verifiedChecklistItem(productionEvidenceSchema),
    ]),
    cashier: checklistProgressSchema,
    training: z.discriminatedUnion("status", [
      ...checklistProgressOptions,
      verifiedChecklistItem(completedEvidenceSchema),
    ]),
    rehearsal: z.discriminatedUnion("status", [
      ...checklistProgressOptions,
      verifiedChecklistItem(completedEvidenceSchema),
    ]),
  })
  .partial()
  .strict();

export const updateOnboardingSchema = z
  .object({
    /** N-1 compatibility. true records progress but never verifies an item. */
    checklist: activationChecklistSchema.partial().optional(),
    items: onboardingChecklistItemsInputSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value.checklist ?? {}).length > 0 || Object.keys(value.items ?? {}).length > 0,
    "At least one checklist item is required",
  );

export const onboardingSelectionSchema = z
  .object({
    planSlug: z.enum(["operacao", "crescimento", "rede"]),
    selectedUnitId: idSchema,
    /** Required only when replacing an existing, different selection. */
    reselect: z.boolean().default(false),
  })
  .strict();

export const activateTrialSchema = z
  .object({
    /** N-1 compatibility. The value must match the plan pinned before the saga starts. */
    planSlug: z.enum(["operacao", "crescimento", "rede"]).optional(),
  })
  .strict();

export const onboardingChecklistItemSchema = z.enum([
  "business",
  "unit",
  "plan",
  "fiscalChoice",
  "catalog",
  "tables",
  "team",
  "qr",
  "production",
  "cashier",
  "training",
  "rehearsal",
]);

export const onboardingChecklistSourceSchema = z.enum([
  "system",
  "actor_attestation",
  "authorized_waiver",
  "legacy_import",
]);

export const onboardingEvidenceResponseSchema = z
  .object({
    selectedUnitId: idSchema.nullable().optional(),
    selectedUnitActive: z.boolean().optional(),
    activeMembersObserved: z.number().int().min(0).max(10_000).optional(),
    menuPublished: z.boolean().optional(),
    tablesConfigured: z.boolean().optional(),
    capabilitiesConfigured: z.boolean().optional(),
    serverTestPassed: z.boolean().optional(),
    configured: z.boolean().optional(),
    requestedMode: z.enum(["off", "kds", "print", "both"]).nullable().optional(),
    kdsStationIds: z.array(idSchema).max(24).optional(),
    printerProfileIds: z.array(idSchema).max(24).optional(),
    configurationReference: z.string().max(120).nullable().optional(),
    catalogVersion: z.number().int().nonnegative().max(INT32_MAX).nullable().optional(),
    slug: z.enum(["operacao", "crescimento", "rede"]).nullable().optional(),
    note: z.string().max(240).optional(),
    choice: z.enum(["disabled", "focus", "external"]).optional(),
    completed: z.boolean().optional(),
    reason: z
      .enum(["pilot_without_qr", "external_qr", "not_required", "external_fiscal"])
      .optional(),
    mode: z.enum(["off", "kds", "print", "both"]).optional(),
    legacyValue: z.boolean().optional(),
  })
  .strict();

export const onboardingChecklistEvidenceResponseSchema = z
  .object({
    status: onboardingChecklistStatusSchema,
    source: onboardingChecklistSourceSchema,
    evidenceReference: z.string().max(240).nullable(),
    evidence: onboardingEvidenceResponseSchema,
    actorIdentityId: idSchema.nullable(),
    verifiedAt: z.iso.datetime({ offset: true }).nullable(),
    waiverReason: z.string().max(500).nullable(),
  })
  .strict();

export const onboardingChecklistItemsResponseSchema = z
  .object({
    business: onboardingChecklistEvidenceResponseSchema,
    unit: onboardingChecklistEvidenceResponseSchema,
    plan: onboardingChecklistEvidenceResponseSchema,
    fiscalChoice: onboardingChecklistEvidenceResponseSchema,
    catalog: onboardingChecklistEvidenceResponseSchema,
    tables: onboardingChecklistEvidenceResponseSchema,
    team: onboardingChecklistEvidenceResponseSchema,
    qr: onboardingChecklistEvidenceResponseSchema,
    production: onboardingChecklistEvidenceResponseSchema,
    cashier: onboardingChecklistEvidenceResponseSchema,
    training: onboardingChecklistEvidenceResponseSchema,
    rehearsal: onboardingChecklistEvidenceResponseSchema,
  })
  .strict();

export const onboardingPlanResponseSchema = z
  .object({
    id: idSchema,
    slug: z.enum(["operacao", "crescimento", "rede"]),
    catalogVersion: z.number().int().nonnegative().max(INT32_MAX),
    monthlyPriceCents: moneyCentsSchema,
    annualPriceCents: moneyCentsSchema,
    includedUnits: z.number().int().positive().max(INT32_MAX),
    entitlements: z.array(z.string().min(1).max(120)).max(100),
  })
  .strict();

export const onboardingSelectionResponseSchema = z
  .object({
    selectedUnitId: idSchema,
    plan: onboardingPlanResponseSchema,
    revision: z.number().int().positive().max(INT32_MAX),
    selectedAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const provisioningStateSchema = z.enum([
  "requested",
  "validating",
  "provisioning",
  "activating",
  "publishing",
  "retryable_failed",
  "compensating",
  "compensated",
  "terminal_failed",
  "completed",
]);

export const provisioningCheckpointSchema = z.enum([
  "requested",
  "validated",
  "internal_provisioned",
  "activation_committed",
  "published",
  "compensated",
]);

export const provisioningSummaryResponseSchema = z
  .object({
    id: idSchema,
    state: provisioningStateSchema,
    checkpoint: provisioningCheckpointSchema,
    attempts: z.number().int().nonnegative().max(INT32_MAX),
    lastErrorCode: z.string().max(120).nullable(),
    nextRetryAt: z.iso.datetime({ offset: true }).nullable(),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    failedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const onboardingResponseSchema = z
  .object({
    organizationId: idSchema,
    activatedAt: z.iso.datetime({ offset: true }).nullable(),
    items: onboardingChecklistItemsResponseSchema,
    ready: z.boolean(),
    missingItems: z.array(onboardingChecklistItemSchema).max(12),
    selection: onboardingSelectionResponseSchema.nullable(),
    provisioning: provisioningSummaryResponseSchema.nullable(),
  })
  .strict();

export const provisioningStepResponseSchema = z
  .object({
    step: z.enum([
      "validation",
      "internal_provisioning",
      "activation",
      "publication",
      "compensation",
    ]),
    status: z.enum(["pending", "in_progress", "completed", "failed", "compensated"]),
    attempts: z.number().int().nonnegative().max(INT32_MAX),
    startedAt: z.iso.datetime({ offset: true }).nullable(),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
    compensatedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const provisioningStatusResponseSchema = provisioningSummaryResponseSchema.extend({
  steps: z.array(provisioningStepResponseSchema).max(5),
});

export const trialActivationResponseSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    commercialPlanId: idSchema,
    provisioningRunId: idSchema,
    subscriptionId: idSchema,
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    state: z.literal("completed"),
    entitlements: z.array(z.string().min(1).max(120)).max(100),
  })
  .strict();

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

const privacyReasonSchema = z.string().trim().min(10).max(500);
export const privacyRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("access_export") }).strict(),
  z
    .object({
      type: z.literal("correction"),
      corrections: z.object({ displayName: z.string().trim().min(2).max(120) }).strict(),
      reason: privacyReasonSchema,
    })
    .strict(),
  z.object({ type: z.literal("anonymization"), reason: privacyReasonSchema }).strict(),
  z.object({ type: z.literal("deletion"), reason: privacyReasonSchema }).strict(),
]);
export const privacyDecisionSchema = z
  .object({ reason: privacyReasonSchema.optional() })
  .strict();

const publicOrderAddressSchema = z
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
    address: publicOrderAddressSchema.optional(),
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
export type RequestEmailVerificationInput = z.infer<typeof requestEmailVerificationSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type EnrollDeviceInput = z.infer<typeof enrollDeviceSchema>;
export type InviteMembershipInput = z.infer<typeof inviteMembershipSchema>;
export type AcceptMembershipInviteInput = z.infer<typeof acceptMembershipInviteSchema>;
export type UpdateOnboardingInput = z.infer<typeof updateOnboardingSchema>;
export type OnboardingSelectionInput = z.infer<typeof onboardingSelectionSchema>;
export type ActivateTrialInput = z.infer<typeof activateTrialSchema>;
export type OnboardingResponsePayload = z.infer<typeof onboardingResponseSchema>;
export type OnboardingSelectionResponsePayload = z.infer<typeof onboardingSelectionResponseSchema>;
export type ProvisioningStatusResponsePayload = z.infer<typeof provisioningStatusResponseSchema>;
export type TrialActivationResponsePayload = z.infer<typeof trialActivationResponseSchema>;
export type OperationalCommandInput = z.infer<typeof operationalCommandSchema>;
export type BillingEventInput = z.infer<typeof billingEventSchema>;
export type TrialApplicationInput = z.infer<typeof trialApplicationSchema>;
export type PublicTrialApplicationInput = z.infer<typeof publicTrialApplicationSchema>;
export type ContactRequestInput = z.infer<typeof contactRequestSchema>;
export type PublicMenuCommandInput = z.infer<typeof publicMenuCommandSchema>;
export type PublicOrderInput = z.infer<typeof publicOrderSchema>;
export type RegisterRequestInput = z.infer<typeof registerRequestSchema>;
export type LoginRequestInput = z.infer<typeof loginRequestSchema>;
export type TrialApplicationRequestInput = z.infer<typeof trialApplicationRequestSchema>;
export type PrivacyRequestInput = z.infer<typeof privacyRequestSchema>;
export type PrivacyDecisionInput = z.infer<typeof privacyDecisionSchema>;

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
