import { createOrganizationSchema, emailSchema } from "@giromesa/contracts";
import { z } from "zod";
import { platformInvitableRoles } from "./platform-access.js";

export const platformIdempotencyKeySchema = z.string().trim().min(8).max(160);
export const platformReasonSchema = z.string().trim().min(8).max(500);

export const tenantDirectoryQuerySchema = z.object({
  search: z.string().trim().max(120).optional().default(""),
  status: z
    .enum([
      "draft",
      "onboarding",
      "trial_active",
      "active",
      "grace",
      "restricted",
      "suspended",
      "canceled",
    ])
    .optional(),
  cursor: z.coerce.number().int().min(1).max(10_000).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type TenantDirectoryQuery = z.infer<typeof tenantDirectoryQuerySchema>;

export const platformIncidentQuerySchema = z.object({
  search: z.string().trim().max(120).optional().default(""),
  status: z.enum(["active", "all", "open", "claimed", "snoozed", "resolved"]).optional(),
  state: z
    .enum(["active", "all", "open", "claimed", "snoozed", "resolved"])
    .optional()
    .default("active"),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  organizationId: z.string().uuid().optional(),
  assignee: z.string().uuid().optional(),
  cursor: z.coerce.number().int().min(1).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});
export type PlatformIncidentQuery = z.infer<typeof platformIncidentQuerySchema>;

export const platformIncidentActionSchema = z
  .object({
    action: z.enum(["claim", "snooze", "resolve"]),
    reason: platformReasonSchema,
    snoozedUntil: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((value, context) => {
    if (value.action === "snooze" && !value.snoozedUntil) {
      context.addIssue({ code: "custom", path: ["snoozedUntil"], message: "Obrigatório." });
    }
    if (value.snoozedUntil && new Date(value.snoozedUntil) <= new Date()) {
      context.addIssue({
        code: "custom",
        path: ["snoozedUntil"],
        message: "Deve estar no futuro.",
      });
    }
  });
export type PlatformIncidentAction = z.infer<typeof platformIncidentActionSchema>;

export const platformReasonBodySchema = z.object({ reason: platformReasonSchema }).strict();
export type PlatformReasonBody = z.infer<typeof platformReasonBodySchema>;

export const platformTenantRegistrationSchema = createOrganizationSchema
  .extend({
    ownerEmail: emailSchema,
    reason: platformReasonSchema,
  })
  .strict();
export type PlatformTenantRegistration = z.infer<typeof platformTenantRegistrationSchema>;

export const platformStaffInviteSchema = z
  .object({
    email: emailSchema,
    role: z.enum(platformInvitableRoles),
    reason: platformReasonSchema,
    reauth: z.object({ mfaCode: z.string().regex(/^\d{6}$/) }).strict(),
  })
  .strict();
export type PlatformStaffInviteInput = z.infer<typeof platformStaffInviteSchema>;

export const platformStaffInvitationAcceptSchema = z
  .object({ token: z.string().trim().min(32).max(256) })
  .strict();
export type PlatformStaffInvitationAcceptInput = z.infer<
  typeof platformStaffInvitationAcceptSchema
>;

export const platformStaffActionSchema = z
  .object({
    reason: platformReasonSchema,
    reauth: z.object({ mfaCode: z.string().regex(/^\d{6}$/) }).strict(),
  })
  .strict();
export type PlatformStaffActionInput = z.infer<typeof platformStaffActionSchema>;

export const platformIncidentFingerprintSchema = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .regex(/^[a-z0-9:._-]+$/i);

const commercialPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^\/[a-z0-9/_?#=&.-]*$/i);
const commercialTextSchema = (max: number) => z.string().trim().min(1).max(max);
const commercialDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const commercialItemSchema = z.object({
  title: commercialTextSchema(120),
  description: commercialTextSchema(500),
});

const commercialLegalDocumentSchema = z
  .object({
    version: commercialTextSchema(40),
    effectiveAt: z.string().datetime({ offset: true }),
    title: commercialTextSchema(160),
    sections: z
      .array(
        z
          .object({ heading: commercialTextSchema(160), body: commercialTextSchema(8_000) })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict();

export const commercialLandingSchema = z
  .object({
    hero: z
      .object({
        eyebrow: commercialTextSchema(80),
        title: commercialTextSchema(160),
        description: commercialTextSchema(700),
        primaryCtaLabel: commercialTextSchema(80),
        primaryCtaHref: commercialPathSchema,
        secondaryCtaLabel: commercialTextSchema(80).optional(),
        secondaryCtaHref: commercialPathSchema.optional(),
        mediaId: z.string().uuid().optional(),
      })
      .strict(),
    socialProof: z
      .object({
        title: commercialTextSchema(120),
        items: z
          .array(z.object({ label: commercialTextSchema(100), value: commercialTextSchema(80) }))
          .max(12),
      })
      .strict(),
    benefits: z
      .object({
        title: commercialTextSchema(120),
        items: z
          .array(
            commercialItemSchema.extend({
              icon: z.enum(["operations", "growth", "finance", "insights", "support", "security"]),
            }),
          )
          .min(1)
          .max(12),
      })
      .strict(),
    howItWorks: z
      .object({
        title: commercialTextSchema(120),
        steps: z.array(commercialItemSchema).min(1).max(8),
      })
      .strict(),
    testimonials: z
      .object({
        title: commercialTextSchema(120),
        items: z
          .array(
            z.object({
              quote: commercialTextSchema(700),
              name: commercialTextSchema(100),
              role: commercialTextSchema(120),
            }),
          )
          .max(12),
      })
      .strict(),
    faq: z
      .object({
        title: commercialTextSchema(120),
        items: z
          .array(
            z.object({ question: commercialTextSchema(180), answer: commercialTextSchema(1_200) }),
          )
          .min(1)
          .max(20),
      })
      .strict(),
    finalCta: z
      .object({
        title: commercialTextSchema(160),
        description: commercialTextSchema(500),
        ctaLabel: commercialTextSchema(80),
        ctaHref: commercialPathSchema,
      })
      .strict(),
    legal: z
      .object({
        terms: commercialLegalDocumentSchema,
        privacy: commercialLegalDocumentSchema,
      })
      .strict(),
  })
  .strict();

export const commercialSeoSchema = z
  .object({
    title: commercialTextSchema(70),
    description: commercialTextSchema(180),
    canonicalPath: commercialPathSchema,
    ogMediaId: z.string().uuid().optional(),
  })
  .strict();

export const commercialPlanInputSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: commercialTextSchema(100),
    description: commercialTextSchema(700),
    monthlyPriceCents: z.number().int().positive(),
    annualPriceCents: z.number().int().positive(),
    includedUnits: z.number().int().positive().max(10_000),
    entitlements: z.array(z.string().trim().min(2).max(100)).max(100),
    features: z.array(commercialTextSchema(180)).max(30),
    featured: z.boolean(),
    displayOrder: z.number().int().min(0).max(1_000),
    ctaLabel: commercialTextSchema(80),
    ctaHref: commercialPathSchema,
  })
  .strict();

export const commercialPromotionInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: commercialTextSchema(120),
    type: z.enum(["percentage", "fixed", "price"]),
    value: z.number().int().positive(),
    planSlugs: z.array(z.string().trim().min(2).max(60)).min(1).max(30),
    cycles: z
      .array(z.enum(["monthly", "annual"]))
      .min(1)
      .max(2),
    startsAt: commercialDateTimeSchema,
    endsAt: commercialDateTimeSchema.optional(),
    newCustomersOnly: z.boolean().default(true),
    code: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/)
      .transform((value) => value.toUpperCase())
      .optional(),
    redemptionLimit: z.number().int().positive().optional(),
    active: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.type === "percentage" && value.value > 10_000)
      context.addIssue({ code: "custom", path: ["value"], message: "Percentual inválido." });
    if (value.endsAt && value.endsAt <= value.startsAt)
      context.addIssue({ code: "custom", path: ["endsAt"], message: "Vigência inválida." });
  });

export const commercialExperimentInputSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    status: z.enum(["draft", "active", "paused", "ended"]),
    startsAt: commercialDateTimeSchema.optional(),
    endsAt: commercialDateTimeSchema.optional(),
    variants: z
      .array(
        z
          .object({
            key: z
              .string()
              .trim()
              .min(1)
              .max(40)
              .regex(/^[a-z0-9_-]+$/i),
            weight: z.number().int().min(1).max(99),
            headline: commercialTextSchema(160),
            description: commercialTextSchema(700),
            ctaLabel: commercialTextSchema(80),
            ctaHref: commercialPathSchema,
          })
          .strict(),
      )
      .min(2)
      .max(8),
  })
  .superRefine((value, context) => {
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt)
      context.addIssue({ code: "custom", path: ["endsAt"], message: "Vigência inválida." });
    if (value.variants.reduce((sum, variant) => sum + variant.weight, 0) !== 100)
      context.addIssue({ code: "custom", path: ["variants"], message: "Pesos devem somar 100." });
    if (new Set(value.variants.map((variant) => variant.key)).size !== value.variants.length)
      context.addIssue({ code: "custom", path: ["variants"], message: "Chaves duplicadas." });
  });

export const commercialDraftCreateSchema = z
  .object({ reason: platformReasonSchema, sourceVersionId: z.string().uuid().optional() })
  .strict();
export const commercialDraftUpdateSchema = z
  .object({
    reason: platformReasonSchema,
    plans: z.array(commercialPlanInputSchema).min(1).max(30),
    landing: commercialLandingSchema,
    seo: commercialSeoSchema,
    promotions: z.array(commercialPromotionInputSchema).max(100),
    experiments: z.array(commercialExperimentInputSchema).max(20),
  })
  .superRefine((value, context) => {
    if (new Set(value.plans.map((plan) => plan.slug)).size !== value.plans.length)
      context.addIssue({ code: "custom", path: ["plans"], message: "Slugs duplicados." });
    const codes = value.promotions.flatMap((promotion) => (promotion.code ? [promotion.code] : []));
    if (new Set(codes).size !== codes.length)
      context.addIssue({ code: "custom", path: ["promotions"], message: "Códigos duplicados." });
    const planSlugs = new Set(value.plans.map((plan) => plan.slug));
    if (
      value.promotions.some((promotion) => promotion.planSlugs.some((slug) => !planSlugs.has(slug)))
    )
      context.addIssue({ code: "custom", path: ["promotions"], message: "Plano inexistente." });
    if (
      new Set(value.experiments.map((experiment) => experiment.slug)).size !==
      value.experiments.length
    )
      context.addIssue({
        code: "custom",
        path: ["experiments"],
        message: "Experimentos duplicados.",
      });
  });

export const commercialPublishSchema = z
  .object({ reason: platformReasonSchema, publishAt: commercialDateTimeSchema.optional() })
  .strict();
export const commercialRollbackSchema = z
  .object({ reason: platformReasonSchema, versionId: z.string().uuid() })
  .strict();
export const commercialMediaUploadSchema = z
  .object({
    reason: platformReasonSchema,
    fileName: commercialTextSchema(180),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    base64: z.string().min(4).max(2_700_000),
    alt: commercialTextSchema(180),
  })
  .strict();
export const commercialCampaignSchema = z
  .object({
    reason: platformReasonSchema,
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: commercialTextSchema(120),
    status: z.enum(["draft", "active", "paused", "ended"]),
    startsAt: commercialDateTimeSchema.optional(),
    endsAt: commercialDateTimeSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt)
      context.addIssue({ code: "custom", path: ["endsAt"], message: "Vigência inválida." });
  });
export const commercialLeadQuerySchema = z.object({
  search: z.string().trim().max(120).optional().default(""),
  type: z.enum(["all", "trial", "contact"]).optional().default("all"),
  stage: z.enum(["new", "qualified", "contacted", "converted", "lost"]).optional(),
  assignedToIdentityId: z.string().uuid().optional(),
  campaignSlug: z.string().trim().max(80).optional(),
  cursor: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export const commercialLeadStateSchema = z
  .object({
    reason: platformReasonSchema,
    stage: z.enum(["new", "qualified", "contacted", "converted", "lost"]),
    assignedToIdentityId: z.string().uuid().nullable().optional(),
    organizationId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(2_000).nullable().optional(),
    lastContactAt: commercialDateTimeSchema.nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.stage === "converted" && !value.organizationId)
      context.addIssue({
        code: "custom",
        path: ["organizationId"],
        message: "Organização obrigatória na conversão.",
      });
  });

export type CommercialDraftCreate = z.infer<typeof commercialDraftCreateSchema>;
export type CommercialDraftUpdate = z.infer<typeof commercialDraftUpdateSchema>;
export type CommercialPublish = z.infer<typeof commercialPublishSchema>;
export type CommercialRollback = z.infer<typeof commercialRollbackSchema>;
export type CommercialMediaUpload = z.infer<typeof commercialMediaUploadSchema>;
export type CommercialCampaignInput = z.infer<typeof commercialCampaignSchema>;
export type CommercialLeadQuery = z.infer<typeof commercialLeadQuerySchema>;
export type CommercialLeadStateInput = z.infer<typeof commercialLeadStateSchema>;
export type CommercialPromotionInput = z.infer<typeof commercialPromotionInputSchema>;
