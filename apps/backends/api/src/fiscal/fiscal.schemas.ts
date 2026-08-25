import { z } from "zod";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value, {
    message: "Informe uma data válida.",
  });

export const competenceSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const idempotencyKeySchema = z.string().trim().min(8).max(160);

export const fiscalDocumentListQuerySchema = z.object({
  status: z
    .enum(["pending", "processing", "authorized", "rejected", "contingency", "canceled"])
    .optional(),
  model: z.enum(["nfce", "nfe", "nfse"]).optional(),
  from: date.optional(),
  to: date.optional(),
  search: z.string().trim().max(160).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const fiscalPackageQuerySchema = z.object({ competence: competenceSchema });

const fiscalSeriesSchema = z.object({
  nfce: z.string().trim().min(1).max(20).optional(),
  nfe: z.string().trim().min(1).max(20).optional(),
  nfse: z.string().trim().min(1).max(20).optional(),
});

export const fiscalProfileSchema = z.object({
  legalEntityId: z.string().uuid(),
  taxRegime: z.enum(["simples_nacional", "simples_excesso", "lucro_presumido", "lucro_real"]),
  crt: z.string().regex(/^[1-4]$/),
  municipalRegistration: z.string().trim().min(1).max(30).optional(),
  cnae: z
    .string()
    .trim()
    .regex(/^\d{7}$/)
    .optional(),
  stateCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
  cityCode: z
    .string()
    .trim()
    .regex(/^\d{7}$/),
  environment: z.enum(["homologation", "production"]).default("homologation"),
  provider: z.literal("focus").nullable().optional(),
  series: fiscalSeriesSchema.default({}),
});

const optionalDigits = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${minimum},${maximum}}$`))
    .optional();

export const focusCompanyOnboardingSchema = z
  .object({
    tradeName: z.string().trim().min(2).max(120),
    stateRegistration: z.string().trim().min(2).max(30),
    email: z.string().trim().email().max(160),
    phone: z
      .string()
      .trim()
      .transform((value) => value.replace(/\D/g, ""))
      .pipe(z.string().regex(/^\d{10,11}$/)),
    street: z.string().trim().min(2).max(160),
    number: z.coerce.number().int().positive().max(99_999_999),
    complement: z.string().trim().max(120).optional(),
    district: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(120),
    postalCode: z
      .string()
      .trim()
      .transform((value) => value.replace(/\D/g, ""))
      .pipe(z.string().regex(/^\d{8}$/)),
    accountantDocument: optionalDigits(11, 14),
    certificateBase64: z
      .string()
      .trim()
      .min(64)
      .max(12_000_000)
      .regex(/^[A-Za-z\d+/]+={0,2}$/),
    certificatePassword: z.string().min(1).max(256),
    enableNfce: z.boolean().default(true),
    enableNfe: z.boolean().default(false),
    enableNfse: z.boolean().default(false),
    cscProduction: z.string().trim().min(1).max(128).optional(),
    cscProductionId: optionalDigits(1, 6),
    cscHomologation: z.string().trim().min(1).max(128).optional(),
    cscHomologationId: optionalDigits(1, 6),
  })
  .superRefine((value, context) => {
    if (!value.enableNfce || value.enableNfe || value.enableNfse) {
      context.addIssue({
        code: "custom",
        message: "O GiroMesa emite somente NFC-e nesta versão.",
        path: ["enableNfce"],
      });
    }
    for (const [code, id, path] of [
      [value.cscProduction, value.cscProductionId, "cscProduction"],
      [value.cscHomologation, value.cscHomologationId, "cscHomologation"],
    ] as const) {
      if (Boolean(code) !== Boolean(id)) {
        context.addIssue({
          code: "custom",
          message: "Informe o CSC e o respectivo ID em conjunto.",
          path: [path],
        });
      }
    }
  });

export const cancelFiscalDocumentSchema = z.object({
  justification: z.string().trim().min(15).max(255),
});

export const productTaxRevisionListQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  status: z.enum(["draft", "active", "revoked"]).optional(),
});

const taxClassificationSchema = z
  .object({
    ncm: z.string().regex(/^\d{8}$/),
    cfop: z.string().regex(/^\d{4}$/),
    cest: z
      .string()
      .regex(/^\d{7}$/)
      .optional(),
    origin: z.number().int().min(0).max(8),
    cstIcms: z.string().trim().min(2).max(3).optional(),
    csosn: z
      .string()
      .regex(/^\d{3}$/)
      .optional(),
    cstPis: z.string().regex(/^\d{2}$/),
    cstCofins: z.string().regex(/^\d{2}$/),
    cstIbsCbs: z
      .string()
      .regex(/^\d{3}$/)
      .optional(),
    cClassTrib: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .catchall(z.unknown())
  .refine((value) => Boolean(value.cstIcms || value.csosn), {
    message: "Informe CST ICMS ou CSOSN.",
    path: ["csosn"],
  })
  .refine((value) => Boolean(value.cstIbsCbs) === Boolean(value.cClassTrib), {
    message: "Informe CST IBS/CBS e cClassTrib em conjunto.",
    path: ["cClassTrib"],
  })
  .refine((value) => JSON.stringify(value).length <= 32_000, "Classificação fiscal muito grande.");

export const productTaxRevisionSchema = z
  .object({
    productId: z.string().uuid(),
    status: z.enum(["draft", "active"]).default("draft"),
    effectiveFrom: date,
    effectiveUntil: date.optional(),
    classification: taxClassificationSchema,
  })
  .refine((value) => !value.effectiveUntil || value.effectiveUntil >= value.effectiveFrom, {
    message: "A vigência final deve ser posterior à inicial.",
    path: ["effectiveUntil"],
  });

export const productTaxRevisionBulkSchema = z
  .object({
    productIds: z.array(z.string().uuid()).min(1).max(100),
    status: z.enum(["draft", "active"]).default("active"),
    effectiveFrom: date,
    effectiveUntil: date.optional(),
    classification: taxClassificationSchema,
  })
  .refine((value) => !value.effectiveUntil || value.effectiveUntil >= value.effectiveFrom, {
    message: "A vigência final deve ser posterior à inicial.",
    path: ["effectiveUntil"],
  });

export const productTaxRevisionImportSchema = z
  .object({ rows: z.array(productTaxRevisionSchema).min(1).max(500) })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.rows.forEach((row, index) => {
      if (!seen.has(row.productId)) {
        seen.add(row.productId);
        return;
      }
      context.addIssue({
        code: "custom",
        message: "Cada produto deve aparecer apenas uma vez na importação.",
        path: ["rows", index, "productId"],
      });
    });
  });

export const accountantRequestListQuerySchema = z.object({
  status: z.enum(["open", "resolved"]).optional(),
  competence: competenceSchema.optional(),
  targetAudience: z.enum(["accountant", "establishment"]).optional(),
  overdue: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const accountantRequestSchema = z.object({
  competence: competenceSchema,
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(5_000),
  dueDate: date.optional(),
});

export const resolveAccountantRequestSchema = z.object({
  resolution: z.string().trim().min(3).max(5_000),
});

export const accountantAttachmentUploadSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .refine(
      (value) =>
        !/[<>:"/\\|?*]/.test(value) &&
        ![...value].some((character) => character.charCodeAt(0) < 32),
      "Nome de arquivo inválido.",
    ),
  contentType: z.enum([
    "application/pdf",
    "application/xml",
    "text/xml",
    "text/csv",
    "image/jpeg",
    "image/png",
  ]),
  contentBase64: z
    .string()
    .min(4)
    .max(4_194_304)
    .regex(/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/),
});

export const reopenFiscalPeriodSchema = z.object({
  reason: z.string().trim().min(10).max(2_000),
});

export const fiscalNumberInvalidationSchema = z
  .object({
    series: z
      .string()
      .trim()
      .regex(/^\d{1,3}$/),
    initialNumber: z.number().int().positive().max(999_999_999),
    finalNumber: z.number().int().positive().max(999_999_999),
    justification: z.string().trim().min(15).max(255),
  })
  .refine((value) => value.finalNumber >= value.initialNumber, {
    message: "O número final deve ser maior ou igual ao inicial.",
    path: ["finalNumber"],
  });

const fiscalResultStatus = z.enum([
  "processing",
  "authorized",
  "rejected",
  "contingency",
  "canceled",
]);
const fiscalResultPayload = z
  .object({
    kind: z.enum([
      "fiscal.document.issue_result",
      "fiscal.document.reconciled",
      "fiscal.document.cancel_result",
    ]),
    orderId: z.string().uuid().optional(),
    idempotencyKey: idempotencyKeySchema,
    providerReference: z.string().trim().min(1).max(160).optional(),
    status: fiscalResultStatus,
    totalCents: z.number().int().nonnegative().optional(),
    errorCode: z.string().trim().min(1).max(40).optional(),
  })
  .superRefine((payload, context) => {
    if (payload.kind === "fiscal.document.issue_result" && !payload.orderId) {
      context.addIssue({ code: "custom", message: "orderId é obrigatório na emissão." });
    }
    if (!payload.orderId && !payload.providerReference) {
      context.addIssue({
        code: "custom",
        message: "Informe orderId ou providerReference para reconciliar o documento.",
      });
    }
  });
const fiscalInvalidationPayload = z
  .object({
    kind: z.literal("fiscal.number_invalidation_result"),
    idempotencyKey: idempotencyKeySchema,
    providerReference: z.string().trim().min(1).max(160).optional(),
    status: z.enum(["processing", "invalidated", "rejected"]),
    cnpj: z
      .string()
      .trim()
      .regex(/^[A-Z\d]{14}$/i),
    series: z.string().trim().min(1).max(20),
    initialNumber: z.number().int().positive(),
    finalNumber: z.number().int().positive(),
    errorCode: z.string().trim().min(1).max(40).optional(),
  })
  .refine((payload) => payload.finalNumber >= payload.initialNumber, {
    message: "O número final deve ser maior ou igual ao inicial.",
    path: ["finalNumber"],
  });

export const edgeFiscalEventSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    type: z.enum([
      "fiscal.document.issue_result",
      "fiscal.document.reconciled",
      "fiscal.document.cancel_result",
      "fiscal.number_invalidation_result",
    ]),
    occurredAt: z.string().datetime({ offset: true }),
    payload: z.union([fiscalResultPayload, fiscalInvalidationPayload]),
  })
  .refine((event) => event.type === event.payload.kind, {
    message: "O tipo do evento deve corresponder ao kind do payload.",
    path: ["payload", "kind"],
  });

export type FiscalDocumentListQuery = z.infer<typeof fiscalDocumentListQuerySchema>;
export type FiscalPackageQuery = z.infer<typeof fiscalPackageQuerySchema>;
export type FiscalProfileInput = z.infer<typeof fiscalProfileSchema>;
export type FocusCompanyOnboardingInput = z.infer<typeof focusCompanyOnboardingSchema>;
export type CancelFiscalDocumentInput = z.infer<typeof cancelFiscalDocumentSchema>;
export type ProductTaxRevisionListQuery = z.infer<typeof productTaxRevisionListQuerySchema>;
export type ProductTaxRevisionInput = z.infer<typeof productTaxRevisionSchema>;
export type ProductTaxRevisionBulkInput = z.infer<typeof productTaxRevisionBulkSchema>;
export type ProductTaxRevisionImportInput = z.infer<typeof productTaxRevisionImportSchema>;
export type AccountantRequestListQuery = z.infer<typeof accountantRequestListQuerySchema>;
export type AccountantRequestInput = z.infer<typeof accountantRequestSchema>;
export type ResolveAccountantRequestInput = z.infer<typeof resolveAccountantRequestSchema>;
export type AccountantAttachmentUploadInput = z.infer<typeof accountantAttachmentUploadSchema>;
export type ReopenFiscalPeriodInput = z.infer<typeof reopenFiscalPeriodSchema>;
export type FiscalNumberInvalidationInput = z.infer<typeof fiscalNumberInvalidationSchema>;
export type EdgeFiscalEvent = z.infer<typeof edgeFiscalEventSchema>;
