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
    cstPis: z
      .string()
      .regex(/^\d{2}$/)
      .optional(),
    cstCofins: z
      .string()
      .regex(/^\d{2}$/)
      .optional(),
    cstIbsCbs: z.string().trim().min(1).max(10).optional(),
    cClassTrib: z.string().trim().min(1).max(20).optional(),
  })
  .catchall(z.unknown())
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

const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(240),
  storageKey: z.string().trim().min(1).max(1_000),
  sha256: z
    .string()
    .regex(/^[a-f\d]{64}$/i)
    .optional(),
});

export const accountantRequestListQuerySchema = z.object({
  status: z.enum(["open", "resolved"]).optional(),
  competence: competenceSchema.optional(),
});

export const accountantRequestSchema = z.object({
  competence: competenceSchema,
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(5_000),
  dueDate: date.optional(),
  attachments: z.array(attachmentSchema).max(20).default([]),
});

export const resolveAccountantRequestSchema = z.object({
  resolution: z.string().trim().min(3).max(5_000),
});

export const reopenFiscalPeriodSchema = z.object({
  reason: z.string().trim().min(10).max(2_000),
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
export type ProductTaxRevisionListQuery = z.infer<typeof productTaxRevisionListQuerySchema>;
export type ProductTaxRevisionInput = z.infer<typeof productTaxRevisionSchema>;
export type AccountantRequestListQuery = z.infer<typeof accountantRequestListQuerySchema>;
export type AccountantRequestInput = z.infer<typeof accountantRequestSchema>;
export type ResolveAccountantRequestInput = z.infer<typeof resolveAccountantRequestSchema>;
export type ReopenFiscalPeriodInput = z.infer<typeof reopenFiscalPeriodSchema>;
export type EdgeFiscalEvent = z.infer<typeof edgeFiscalEventSchema>;
