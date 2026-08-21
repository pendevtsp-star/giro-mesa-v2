import { z } from "zod";
import { reportPeriodSchema } from "./management.schemas.js";

const id = z.string().uuid();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const cents = z.number().int().min(0).max(2_147_483_647);
const version = z.number().int().min(1);
const reportDrillDownMetricSchema = z.enum([
  "pos_revenue",
  "cash_inflows",
  "cash_outflows",
  "competence_revenue",
  "cmv",
  "competence_expenses",
]);

export const reportMetricSchema = z.enum([
  "pos_revenue",
  "cash_inflows",
  "cash_outflows",
  "competence_revenue",
  "competence_expenses",
  "average_ticket",
  "gross_margin",
  "inventory_loss",
  "canceled_value",
]);

export const reportFamilySchema = z.enum([
  "overview",
  "sales",
  "exceptions",
  "inventory",
  "purchasing",
  "operations",
  "profitability",
  "multiunit",
  "quality",
  "labor",
  "reconciliation",
  "forecast",
]);

export const reportDrillDownQuerySchema = reportPeriodSchema
  .extend({
    dimension: z.enum([
      "metric",
      "product",
      "category",
      "channel",
      "payment_method",
      "exception",
      "inventory",
      "purchase",
      "operation",
      "labor",
      "reconciliation",
      "forecast",
    ]),
    key: z.string().trim().min(1).max(160),
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .superRefine((value, context) => {
    const valid =
      (value.dimension === "metric" && reportDrillDownMetricSchema.safeParse(value.key).success) ||
      ((value.dimension === "product" || value.dimension === "category") &&
        id.safeParse(value.key).success) ||
      (value.dimension === "channel" && ["dine_in", "pickup", "delivery"].includes(value.key)) ||
      (value.dimension === "payment_method" &&
        ["cash", "credit_card", "debit_card", "pix", "other"].includes(value.key)) ||
      (value.dimension === "exception" &&
        ["canceled_items", "discounted_items"].includes(value.key)) ||
      (value.dimension === "inventory" && ["loss", "stockout", "low_stock"].includes(value.key)) ||
      (value.dimension === "purchase" &&
        (["orders", "receipts"].includes(value.key) || id.safeParse(value.key).success)) ||
      (value.dimension === "operation" && ["closed_tabs", "table_turnovers"].includes(value.key)) ||
      (value.dimension === "labor" && ["summary", "overtime"].includes(value.key)) ||
      (value.dimension === "reconciliation" &&
        ["fiscal", "payments", "unmatched"].includes(value.key)) ||
      (value.dimension === "forecast" && ["revenue", "cash", "purchases"].includes(value.key));
    if (!valid) context.addIssue({ code: "custom", path: ["key"], message: "Chave inválida." });
  });

export const reportBudgetMonthSchema = month;
export const reportBudgetInputSchema = z.object({
  metric: reportMetricSchema,
  targetCents: cents,
  version: version.optional(),
});

export const reportExportInputSchema = reportPeriodSchema.extend({
  family: reportFamilySchema.default("overview"),
  format: z.enum(["csv", "pdf", "xlsx"]).default("csv"),
});
export const reportExportListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(512).optional(),
});

const scheduleBaseSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    frequency: z.enum(["weekly", "monthly"]),
    weekday: z.number().int().min(0).max(6).nullable().default(null),
    dayOfMonth: z.number().int().min(1).max(28).nullable().default(null),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    range: z.enum(["previous_week", "previous_month"]),
    comparisonMode: z.enum(["previous_period", "previous_year", "none"]),
    family: reportFamilySchema.default("overview"),
    format: z.enum(["csv", "pdf", "xlsx"]).default("csv"),
    delivery: z.enum(["in_app", "email"]).default("in_app"),
    enabled: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (value.frequency === "weekly" && value.weekday === null)
      context.addIssue({ code: "custom", path: ["weekday"], message: "Informe o dia da semana." });
    if (value.frequency === "monthly" && value.dayOfMonth === null)
      context.addIssue({ code: "custom", path: ["dayOfMonth"], message: "Informe o dia do mês." });
  });

export const reportScheduleCreateSchema = scheduleBaseSchema;
export const reportScheduleUpdateSchema = scheduleBaseSchema.extend({ version });
export const reportScheduleDeleteSchema = z.object({
  version: z.coerce.number().int().min(1).optional(),
});

const reportViewBaseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  visibility: z.enum(["private", "unit", "organization"]).default("private"),
  query: reportPeriodSchema.extend({ family: reportFamilySchema.default("overview") }),
});
export const reportViewCreateSchema = reportViewBaseSchema;
export const reportViewUpdateSchema = reportViewBaseSchema.extend({ version });
export const reportViewDeleteSchema = z.object({ version: z.coerce.number().int().min(1) });

export const reportAlertListQuerySchema = z.object({
  status: z.enum(["open", "claimed", "resolved", "dismissed"]).optional(),
});
export const reportAlertEvaluateSchema = reportPeriodSchema.extend({
  dueInDays: z.number().int().min(0).max(90).default(2),
});
export const reportAlertActionSchema = z.object({
  status: z.enum(["open", "claimed", "resolved", "dismissed"]),
  assignedToIdentityId: id.nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  version,
});

export const reportCostBackfillSchema = reportPeriodSchema.extend({
  allowEstimated: z.literal(true),
});

export type ReportMetric = z.infer<typeof reportMetricSchema>;
export type ReportDrillDownQuery = z.infer<typeof reportDrillDownQuerySchema>;
export type ReportBudgetInput = z.infer<typeof reportBudgetInputSchema>;
export type ReportExportInput = z.infer<typeof reportExportInputSchema>;
export type ReportExportListQuery = z.infer<typeof reportExportListQuerySchema>;
export type ReportScheduleCreateInput = z.infer<typeof reportScheduleCreateSchema>;
export type ReportScheduleUpdateInput = z.infer<typeof reportScheduleUpdateSchema>;
export type ReportScheduleDeleteInput = z.infer<typeof reportScheduleDeleteSchema>;
export type ReportViewCreateInput = z.infer<typeof reportViewCreateSchema>;
export type ReportViewUpdateInput = z.infer<typeof reportViewUpdateSchema>;
export type ReportViewDeleteInput = z.infer<typeof reportViewDeleteSchema>;
export type ReportAlertListQuery = z.infer<typeof reportAlertListQuerySchema>;
export type ReportAlertEvaluateInput = z.infer<typeof reportAlertEvaluateSchema>;
export type ReportAlertActionInput = z.infer<typeof reportAlertActionSchema>;
export type ReportCostBackfillInput = z.infer<typeof reportCostBackfillSchema>;
