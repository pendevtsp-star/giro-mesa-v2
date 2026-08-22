import type { OpenAPIObject } from "@nestjs/swagger";

type ComponentSchemas = NonNullable<NonNullable<OpenAPIObject["components"]>["schemas"]>;
type SchemaOrReference = ComponentSchemas[string];
type SchemaObject = Exclude<ComponentSchemas[string], { $ref: string }>;

const date: SchemaObject = { type: "string", format: "date" };
const cents: SchemaObject = { type: "integer", format: "int64" };
const nullableCents: SchemaObject = { ...cents, nullable: true };
const coverage: SchemaObject = {
  type: "string",
  enum: ["complete", "partial", "unavailable"],
};
const reportFamilies = [
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
];
const familyComparison: SchemaObject = {
  type: "object",
  additionalProperties: {
    type: "object",
    required: ["current", "previous", "change", "changePercent"],
    properties: {
      current: { type: "number", nullable: true },
      previous: { type: "number", nullable: true },
      change: { type: "number", nullable: true },
      changePercent: { type: "number", nullable: true },
    },
  },
};

const period: SchemaObject = {
  type: "object",
  required: ["from", "to"],
  properties: { from: date, to: date },
};

const breakdownLine: SchemaObject = {
  type: "object",
  required: ["key", "label", "revenueCents", "quantity"],
  properties: {
    key: { type: "string" },
    label: { type: "string" },
    revenueCents: cents,
    quantity: { type: "number" },
  },
};

export const managementReportsResponseSchema: SchemaObject = {
  type: "object",
  required: [
    "timezone",
    "period",
    "previousPeriod",
    "cashFlow",
    "incomeStatement",
    "comparison",
    "dailySeries",
    "breakdowns",
    "reportFamilies",
    "meta",
    "budget",
    "capabilities",
  ],
  properties: {
    timezone: { type: "string" },
    period,
    previousPeriod: { ...period, nullable: true },
    cashFlow: {
      type: "object",
      required: ["inflowsCents", "outflowsCents", "netCents", "basis"],
      properties: {
        inflowsCents: cents,
        outflowsCents: cents,
        netCents: cents,
        basis: { type: "string", enum: ["realized_payments_unit_timezone"] },
      },
    },
    incomeStatement: {
      type: "object",
      required: [
        "revenueCents",
        "cmvCents",
        "grossMarginCents",
        "operatingExpensesCents",
        "operatingResultCents",
        "costCoverage",
        "basis",
      ],
      properties: {
        revenueCents: cents,
        cmvCents: nullableCents,
        grossMarginCents: nullableCents,
        operatingExpensesCents: nullableCents,
        operatingResultCents: nullableCents,
        costCoverage: {
          type: "object",
          required: [
            "coverage",
            "revenueCents",
            "coveredRevenueCents",
            "missingCostLines",
            "cmvCents",
            "grossMarginCents",
            "completeForRevenue",
          ],
          properties: {
            coverage: { type: "string", enum: ["complete", "partial", "unavailable"] },
            revenueCents: cents,
            coveredRevenueCents: cents,
            missingCostLines: { type: "integer" },
            cmvCents: nullableCents,
            grossMarginCents: nullableCents,
            completeForRevenue: { type: "boolean" },
          },
        },
        basis: { type: "string", enum: ["competence"] },
      },
    },
    comparison: {
      type: "object",
      required: [
        "mode",
        "period",
        "revenueCents",
        "previousRevenueCents",
        "changeCents",
        "changePercent",
      ],
      properties: {
        mode: { type: "string", enum: ["previous_period", "previous_year", "none"] },
        period: { ...period, nullable: true },
        revenueCents: cents,
        previousRevenueCents: nullableCents,
        changeCents: nullableCents,
        changePercent: { type: "number", nullable: true },
      },
    },
    dailySeries: {
      type: "array",
      items: {
        type: "object",
        required: ["date", "revenueCents", "previousRevenueCents"],
        properties: {
          date,
          revenueCents: cents,
          previousRevenueCents: nullableCents,
        },
      },
    },
    breakdowns: {
      type: "object",
      required: ["products", "categories", "channels", "paymentMethods"],
      properties: Object.fromEntries(
        ["products", "categories", "channels", "paymentMethods"].map((key) => [
          key,
          { type: "array", items: breakdownLine },
        ]),
      ),
    },
    reportFamilies: {
      type: "object",
      required: [
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
      ],
      properties: {
        sales: {
          type: "object",
          required: [
            "coverage",
            "closedTabs",
            "subtotalCents",
            "discountsCents",
            "netRevenueCents",
            "averageTicketCents",
            "guests",
            "averageSpendPerGuestCents",
            "hourly",
            "comparison",
          ],
          properties: {
            coverage: { type: "string", enum: ["complete", "partial", "unavailable"] },
            closedTabs: { type: "integer" },
            subtotalCents: cents,
            discountsCents: cents,
            netRevenueCents: cents,
            averageTicketCents: nullableCents,
            guests: { type: "integer" },
            averageSpendPerGuestCents: nullableCents,
            hourly: {
              type: "array",
              items: {
                type: "object",
                required: ["hour", "closedTabs", "revenueCents"],
                properties: {
                  hour: { type: "integer", minimum: 0, maximum: 23 },
                  closedTabs: { type: "integer" },
                  revenueCents: cents,
                },
              },
            },
            comparison: familyComparison,
          },
        },
        exceptions: {
          type: "object",
          required: [
            "coverage",
            "canceledItems",
            "canceledValueCents",
            "discountedItems",
            "itemDiscountCents",
            "tabDiscountCents",
            "cancellationReasons",
            "comparison",
          ],
          properties: {
            coverage: { type: "string", enum: ["complete", "partial", "unavailable"] },
            canceledItems: { type: "integer" },
            canceledValueCents: cents,
            discountedItems: { type: "integer" },
            itemDiscountCents: cents,
            tabDiscountCents: cents,
            cancellationReasons: {
              type: "array",
              items: {
                type: "object",
                required: ["label", "quantity", "amountCents"],
                properties: {
                  label: { type: "string" },
                  quantity: { type: "integer" },
                  amountCents: cents,
                },
              },
            },
            comparison: familyComparison,
          },
        },
        inventory: {
          type: "object",
          required: [
            "coverage",
            "basis",
            "lossEvents",
            "lossQuantity",
            "lossValueCents",
            "stockoutItems",
            "lowStockItems",
            "currentInventoryValueCents",
            "analysis",
            "comparison",
          ],
          properties: {
            coverage: { type: "string", enum: ["complete", "partial", "unavailable"] },
            basis: { type: "string", enum: ["period_events_and_current_balance"] },
            lossEvents: { type: "integer" },
            lossQuantity: { type: "number" },
            lossValueCents: nullableCents,
            stockoutItems: { type: "integer" },
            lowStockItems: { type: "integer" },
            currentInventoryValueCents: nullableCents,
            analysis: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "key",
                  "label",
                  "abcClass",
                  "consumedQuantity",
                  "consumedValueCents",
                  "currentQuantity",
                  "coverageDays",
                ],
                properties: {
                  key: { type: "string", format: "uuid" },
                  label: { type: "string" },
                  abcClass: { type: "string", enum: ["A", "B", "C"], nullable: true },
                  consumedQuantity: { type: "number" },
                  consumedValueCents: nullableCents,
                  currentQuantity: { type: "number" },
                  coverageDays: { type: "number", nullable: true },
                },
              },
            },
            comparison: familyComparison,
          },
        },
        purchasing: {
          type: "object",
          required: [
            "coverage",
            "orderCount",
            "orderedCents",
            "canceledOrders",
            "receiptCount",
            "receivedCents",
            "suppliers",
            "supplierPerformance",
            "comparison",
          ],
          properties: {
            coverage: { type: "string", enum: ["complete", "partial", "unavailable"] },
            orderCount: { type: "integer" },
            orderedCents: nullableCents,
            canceledOrders: { type: "integer" },
            receiptCount: { type: "integer" },
            receivedCents: nullableCents,
            suppliers: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "key",
                  "label",
                  "orderCount",
                  "orderedCents",
                  "receiptCount",
                  "receivedCents",
                ],
                properties: {
                  key: { type: "string", format: "uuid" },
                  label: { type: "string" },
                  orderCount: { type: "integer" },
                  orderedCents: nullableCents,
                  receiptCount: { type: "integer" },
                  receivedCents: nullableCents,
                },
              },
            },
            supplierPerformance: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "key",
                  "label",
                  "orderCount",
                  "receiptCount",
                  "onTimeRatePercent",
                  "averageLeadDays",
                  "priceVariancePercent",
                ],
                properties: {
                  key: { type: "string", format: "uuid" },
                  label: { type: "string" },
                  orderCount: { type: "integer" },
                  receiptCount: { type: "integer" },
                  onTimeRatePercent: { type: "number", nullable: true },
                  averageLeadDays: { type: "number", nullable: true },
                  priceVariancePercent: { type: "number", nullable: true },
                },
              },
            },
            comparison: familyComparison,
          },
        },
        operations: {
          type: "object",
          required: [
            "coverage",
            "closedTabs",
            "dineInTabs",
            "tableTurnovers",
            "guests",
            "averageGuestsPerTab",
            "averageServiceMinutes",
            "shifts",
            "comparison",
          ],
          properties: {
            coverage: { type: "string", enum: ["complete", "partial", "unavailable"] },
            closedTabs: { type: "integer" },
            dineInTabs: { type: "integer" },
            tableTurnovers: { type: "integer" },
            guests: { type: "integer" },
            averageGuestsPerTab: { type: "number", nullable: true },
            averageServiceMinutes: { type: "number", nullable: true },
            shifts: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "key",
                  "label",
                  "closedTabs",
                  "guests",
                  "revenueCents",
                  "averageServiceMinutes",
                ],
                properties: {
                  key: { type: "string" },
                  label: { type: "string" },
                  closedTabs: { type: "integer" },
                  guests: { type: "integer" },
                  revenueCents: cents,
                  averageServiceMinutes: { type: "number", nullable: true },
                },
              },
            },
            comparison: familyComparison,
          },
        },
        profitability: {
          type: "object",
          required: [
            "coverage",
            "grossMarginPercent",
            "productProfitabilityCoverage",
            "products",
            "comparison",
          ],
          properties: {
            coverage: { type: "string", enum: ["complete", "partial", "unavailable"] },
            grossMarginPercent: { type: "number", nullable: true },
            productProfitabilityCoverage: coverage,
            products: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "key",
                  "label",
                  "quantity",
                  "revenueCents",
                  "costCents",
                  "grossMarginCents",
                  "grossMarginPercent",
                ],
                properties: {
                  key: { type: "string", format: "uuid" },
                  label: { type: "string" },
                  quantity: { type: "integer" },
                  revenueCents: cents,
                  costCents: nullableCents,
                  grossMarginCents: nullableCents,
                  grossMarginPercent: { type: "number", nullable: true },
                },
              },
            },
            comparison: familyComparison,
          },
        },
        multiunit: {
          type: "object",
          required: ["coverage", "units"],
          properties: {
            coverage,
            units: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "key",
                  "label",
                  "closedTabs",
                  "revenueCents",
                  "averageTicketCents",
                  "changePercent",
                  "rank",
                  "operatingDays",
                  "revenuePerOperatingDayCents",
                  "organizationRevenueSharePercent",
                  "sameStoreChangePercent",
                  "minimumComparableOperatingDays",
                  "comparableStoreEligible",
                  "seatCount",
                  "activeEmployees",
                  "openHours",
                  "revenuePerSeatCents",
                  "revenuePerOpenHourCents",
                  "revenuePerEmployeeCents",
                ],
                properties: {
                  key: { type: "string", format: "uuid" },
                  label: { type: "string" },
                  closedTabs: { type: "integer" },
                  revenueCents: cents,
                  averageTicketCents: nullableCents,
                  changePercent: { type: "number", nullable: true },
                  rank: { type: "integer" },
                  operatingDays: { type: "integer" },
                  revenuePerOperatingDayCents: nullableCents,
                  organizationRevenueSharePercent: { type: "number", nullable: true },
                  sameStoreChangePercent: { type: "number", nullable: true },
                  minimumComparableOperatingDays: { type: "integer" },
                  comparableStoreEligible: { type: "boolean" },
                  seatCount: { type: "integer" },
                  activeEmployees: { type: "integer" },
                  openHours: { type: "number", nullable: true },
                  revenuePerSeatCents: nullableCents,
                  revenuePerOpenHourCents: nullableCents,
                  revenuePerEmployeeCents: nullableCents,
                },
              },
            },
          },
        },
        quality: {
          type: "object",
          required: ["scorePercent", "issues"],
          properties: {
            scorePercent: { type: "number", minimum: 0, maximum: 100 },
            issues: {
              type: "array",
              items: {
                type: "object",
                required: ["key", "label", "count", "severity"],
                properties: {
                  key: { type: "string" },
                  label: { type: "string" },
                  count: { type: "integer" },
                  severity: { type: "string", enum: ["info", "warning", "critical"] },
                },
              },
            },
          },
        },
        labor: {
          type: "object",
          required: [
            "coverage",
            "costCoverage",
            "scheduleCoverage",
            "people",
            "workedMinutes",
            "scheduledMinutes",
            "overtimeMinutes",
            "laborCostCents",
            "laborCostPercent",
            "salesPerLaborHourCents",
            "roles",
          ],
          properties: {
            coverage,
            costCoverage: coverage,
            scheduleCoverage: coverage,
            people: { type: "integer" },
            workedMinutes: { type: "integer" },
            scheduledMinutes: { type: "integer" },
            overtimeMinutes: { type: "integer", nullable: true },
            laborCostCents: nullableCents,
            laborCostPercent: { type: "number", nullable: true },
            salesPerLaborHourCents: nullableCents,
            roles: { type: "array", items: { type: "object", additionalProperties: true } },
          },
        },
        reconciliation: {
          type: "object",
          required: [
            "coverage",
            "posRevenueCents",
            "paymentCents",
            "paymentDifferenceCents",
            "fiscalAuthorizedCents",
            "fiscalDifferenceCents",
            "taxCents",
            "documents",
            "external",
            "closure",
          ],
          properties: {
            coverage,
            posRevenueCents: cents,
            paymentCents: cents,
            paymentDifferenceCents: cents,
            fiscalAuthorizedCents: cents,
            fiscalDifferenceCents: cents,
            taxCents: cents,
            documents: { type: "object", additionalProperties: { type: "integer" } },
            external: { type: "object", additionalProperties: { type: "integer" } },
            closure: { type: "object", additionalProperties: true },
          },
        },
        forecast: {
          type: "object",
          required: [
            "method",
            "available",
            "minimumSampleDays",
            "horizonDays",
            "sampleDays",
            "confidence",
            "errorPercent",
            "revenue",
            "cash",
            "calendarSignals",
            "purchases",
          ],
          properties: {
            method: { type: "string", enum: ["weekday_seasonality_v2"] },
            available: { type: "boolean" },
            minimumSampleDays: { type: "integer", minimum: 14 },
            horizonDays: { type: "integer" },
            sampleDays: { type: "integer" },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            errorPercent: { type: "number", nullable: true },
            revenue: { type: "object", additionalProperties: cents },
            cash: { type: "object", additionalProperties: cents },
            calendarSignals: {
              type: "array",
              items: { type: "object", additionalProperties: true },
            },
            purchases: { type: "array", items: { type: "object", additionalProperties: true } },
          },
        },
      },
    },
    meta: {
      type: "object",
      required: ["generatedAt", "dataThrough", "sourceCounts", "coverage", "indicators"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        dataThrough: { ...date, nullable: true },
        sourceCounts: {
          type: "object",
          required: [
            "posSales",
            "receivablePayments",
            "payablePayments",
            "receivables",
            "payables",
            "costLines",
          ],
          properties: Object.fromEntries(
            [
              "posSales",
              "receivablePayments",
              "payablePayments",
              "receivables",
              "payables",
              "costLines",
            ].map((key) => [key, { type: "integer" }]),
          ),
        },
        coverage: {
          type: "object",
          required: ["sales", "cashFlow", "costs", "budget", "labor", "reconciliation", "forecast"],
          properties: Object.fromEntries(
            ["sales", "cashFlow", "costs", "budget", "labor", "reconciliation", "forecast"].map(
              (key) => [key, { type: "string", enum: ["complete", "partial", "unavailable"] }],
            ),
          ),
        },
        indicators: {
          type: "object",
          additionalProperties: {
            type: "object",
            required: ["coverage", "dataThrough", "sources"],
            properties: {
              coverage,
              dataThrough: { ...date, nullable: true },
              sources: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    budget: {
      type: "object",
      nullable: true,
      required: ["coverage", "basis", "targets", "alerts"],
      properties: {
        coverage: { type: "string", enum: ["complete", "partial", "unavailable"] },
        basis: { type: "string", enum: ["calendar_month_prorated_by_days"] },
        targets: {
          type: "object",
          required: [
            "posRevenueCents",
            "cashInflowsCents",
            "cashOutflowsCents",
            "competenceRevenueCents",
            "competenceExpensesCents",
            "averageTicketCents",
            "grossMarginCents",
            "inventoryLossCents",
            "canceledValueCents",
          ],
          properties: Object.fromEntries(
            [
              "posRevenueCents",
              "cashInflowsCents",
              "cashOutflowsCents",
              "competenceRevenueCents",
              "competenceExpensesCents",
              "averageTicketCents",
              "grossMarginCents",
              "inventoryLossCents",
              "canceledValueCents",
            ].map((key) => [key, nullableCents]),
          ),
        },
        alerts: {
          type: "array",
          items: {
            type: "object",
            required: [
              "key",
              "actualCents",
              "targetCents",
              "differenceCents",
              "status",
              "direction",
            ],
            properties: {
              key: { type: "string" },
              actualCents: cents,
              targetCents: cents,
              differenceCents: cents,
              status: { type: "string", enum: ["on_track", "attention"] },
              direction: { type: "string", enum: ["minimum", "maximum"] },
            },
          },
        },
      },
    },
    capabilities: {
      type: "object",
      required: [
        "viewCosts",
        "drillDown",
        "export",
        "manageBudget",
        "manageSchedules",
        "manageViews",
        "manageAlerts",
        "backfillCosts",
        "emailDeliveryConfigured",
      ],
      properties: Object.fromEntries(
        [
          "viewCosts",
          "drillDown",
          "export",
          "manageBudget",
          "manageSchedules",
          "manageViews",
          "manageAlerts",
          "backfillCosts",
          "emailDeliveryConfigured",
        ].map((key) => [key, { type: "boolean" }]),
      ),
    },
  },
};

export function addManagementReportsOpenApi(document: OpenAPIObject) {
  document.components ??= { schemas: {} };
  document.components.schemas ??= {};
  document.components.schemas.ManagementReportsResponse = managementReportsResponseSchema;
  document.components.schemas.ManagementReportDrillDownResponse = {
    type: "object",
    required: ["timezone", "period", "dimension", "key", "totals", "rows", "page"],
    properties: {
      timezone: { type: "string" },
      period,
      dimension: {
        type: "string",
        enum: [
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
        ],
      },
      key: { type: "string" },
      totals: {
        type: "object",
        required: ["amountCents", "quantity"],
        properties: { amountCents: cents, quantity: { type: "number" } },
      },
      rows: {
        type: "array",
        items: {
          type: "object",
          required: [
            "referenceId",
            "occurredAt",
            "localDate",
            "referenceType",
            "label",
            "amountCents",
            "quantity",
          ],
          properties: {
            referenceId: { type: "string", format: "uuid" },
            occurredAt: { type: "string", format: "date-time", nullable: true },
            localDate: date,
            referenceType: { type: "string" },
            label: { type: "string" },
            amountCents: cents,
            quantity: { type: "number" },
          },
        },
      },
      page: {
        type: "object",
        required: ["nextCursor"],
        properties: { nextCursor: { type: "string", nullable: true } },
      },
    },
  };
  const exportMetadata: SchemaObject = {
    type: "object",
    required: [
      "id",
      "status",
      "format",
      "filename",
      "sha256",
      "rowCount",
      "requestedAt",
      "completedAt",
      "expiresAt",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      status: { type: "string", enum: ["ready", "failed"] },
      format: { type: "string", enum: ["csv", "pdf", "xlsx"] },
      filename: { type: "string" },
      sha256: { type: "string", nullable: true },
      rowCount: { type: "integer" },
      requestedAt: { type: "string", format: "date-time" },
      completedAt: { type: "string", format: "date-time", nullable: true },
      expiresAt: { type: "string", format: "date-time" },
      idempotentReplay: { type: "boolean" },
    },
  };
  document.components.schemas.ManagementReportExport = exportMetadata;
  document.components.schemas.ManagementReportExportContent = {
    type: "object",
    required: ["filename", "content", "contentEncoding", "mimeType", "sha256"],
    properties: {
      filename: { type: "string" },
      content: { type: "string" },
      contentEncoding: { type: "string", enum: ["utf8", "base64"] },
      mimeType: { type: "string" },
      sha256: { type: "string" },
    },
  };
  document.components.schemas.ManagementReportBudgetMonths = {
    type: "object",
    required: ["months"],
    properties: {
      months: {
        type: "array",
        items: {
          type: "object",
          required: ["month", "items"],
          properties: {
            month: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
            items: {
              type: "array",
              items: {
                type: "object",
                required: ["metric", "targetCents", "version", "updatedAt"],
                properties: {
                  metric: { type: "string" },
                  targetCents: cents,
                  version: { type: "integer" },
                  updatedAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
    },
  };
  document.components.schemas.ManagementReportSchedule = {
    type: "object",
    required: [
      "id",
      "name",
      "frequency",
      "localTime",
      "range",
      "comparisonMode",
      "family",
      "format",
      "delivery",
      "enabled",
      "nextRunAt",
      "version",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      frequency: { type: "string", enum: ["weekly", "monthly"] },
      weekday: { type: "integer", nullable: true },
      dayOfMonth: { type: "integer", nullable: true },
      localTime: { type: "string", pattern: "^\\d{2}:\\d{2}$" },
      range: { type: "string", enum: ["previous_week", "previous_month"] },
      comparisonMode: {
        type: "string",
        enum: ["previous_period", "previous_year", "none"],
      },
      family: {
        type: "string",
        enum: [
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
        ],
      },
      format: { type: "string", enum: ["csv", "pdf", "xlsx"] },
      delivery: { type: "string", enum: ["in_app", "email"] },
      enabled: { type: "boolean" },
      nextRunAt: { type: "string", format: "date-time" },
      lastRunAt: { type: "string", format: "date-time", nullable: true },
      version: { type: "integer" },
    },
  };
  document.components.schemas.ManagementReportView = {
    type: "object",
    required: [
      "id",
      "name",
      "visibility",
      "query",
      "isDefault",
      "sortOrder",
      "ownerIdentityId",
      "version",
      "updatedAt",
    ],
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      visibility: { type: "string", enum: ["private", "unit", "organization"] },
      query: { type: "object", additionalProperties: true },
      isDefault: { type: "boolean" },
      sortOrder: { type: "integer" },
      ownerIdentityId: { type: "string", format: "uuid" },
      version: { type: "integer" },
      updatedAt: { type: "string", format: "date-time" },
    },
  };
  document.components.schemas.ManagementReportViewQuery = {
    type: "object",
    required: ["from", "to", "comparisonMode", "family"],
    properties: {
      from: date,
      to: date,
      comparisonMode: {
        type: "string",
        enum: ["previous_period", "previous_year", "none"],
      },
      family: {
        type: "string",
        enum: [
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
        ],
      },
    },
  };
  document.components.schemas.ManagementReportViewInput = {
    type: "object",
    required: ["name", "visibility", "query"],
    properties: {
      name: { type: "string", maxLength: 80 },
      visibility: { type: "string", enum: ["private", "unit", "organization"] },
      query: { $ref: "#/components/schemas/ManagementReportViewQuery" },
      isDefault: { type: "boolean" },
      sortOrder: { type: "integer", minimum: -10_000, maximum: 10_000 },
      version: { type: "integer", minimum: 1 },
    },
  };
  document.components.schemas.ManagementReportViews = {
    type: "object",
    required: ["views"],
    properties: {
      views: {
        type: "array",
        items: { $ref: "#/components/schemas/ManagementReportView" },
      },
    },
  };
  document.components.schemas.ManagementReportAlert = {
    type: "object",
    required: ["id", "kind", "title", "detail", "severity", "status", "version", "updatedAt"],
    properties: {
      id: { type: "string", format: "uuid" },
      kind: { type: "string" },
      title: { type: "string" },
      detail: { type: "string" },
      severity: { type: "string", enum: ["info", "warning", "critical"] },
      status: { type: "string", enum: ["open", "claimed", "resolved", "dismissed"] },
      actualCents: nullableCents,
      targetCents: nullableCents,
      assignedToIdentityId: { type: "string", format: "uuid", nullable: true },
      dueAt: { type: "string", format: "date-time", nullable: true },
      resolvedAt: { type: "string", format: "date-time", nullable: true },
      source: { type: "object", additionalProperties: true },
      history: { type: "array", items: { type: "object", additionalProperties: true } },
      version: { type: "integer" },
      updatedAt: { type: "string", format: "date-time" },
    },
  };
  document.components.schemas.ManagementReportAlerts = {
    type: "object",
    required: ["alerts"],
    properties: {
      alerts: {
        type: "array",
        items: { $ref: "#/components/schemas/ManagementReportAlert" },
      },
    },
  };

  for (const prefix of ["/api/v1", "/v1"] as const) {
    const operation =
      document.paths[`${prefix}/organizations/{organizationId}/units/{unitId}/management/reports`]
        ?.get;
    if (!operation) throw new Error(`OpenAPI operation missing for ${prefix} management reports`);
    operation.parameters = [
      ...(operation.parameters ?? []).filter(
        (parameter) =>
          "$ref" in parameter ||
          !["from", "to", "comparisonMode", "family", "minimumComparableOperatingDays"].includes(
            parameter.name,
          ),
      ),
      { name: "from", in: "query", required: true, schema: date },
      { name: "to", in: "query", required: true, schema: date },
      {
        name: "comparisonMode",
        in: "query",
        required: false,
        schema: {
          type: "string",
          enum: ["previous_period", "previous_year", "none"],
          default: "previous_period",
        },
      },
      {
        name: "family",
        in: "query",
        required: false,
        schema: { type: "string", enum: reportFamilies, default: "overview" },
      },
      {
        name: "minimumComparableOperatingDays",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 31, default: 7 },
      },
    ];
    operation.responses["200"] = {
      description: "Relatório gerencial do período e comparação anterior equivalente.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ManagementReportsResponse" },
        },
      },
    };

    const base = `${prefix}/organizations/{organizationId}/units/{unitId}/management/reports`;
    const attach = (
      suffix: string,
      method: "get" | "post" | "put" | "patch" | "delete",
      status: string,
      schema: SchemaOrReference,
    ) => {
      const target = document.paths[`${base}${suffix}`]?.[method];
      if (!target) return;
      target.responses[status] = {
        description: "Operação de relatório concluída.",
        content: { "application/json": { schema } },
      };
    };
    const body = (suffix: string, method: "post" | "put" | "patch", schema: SchemaOrReference) => {
      const target = document.paths[`${base}${suffix}`]?.[method];
      if (!target) return;
      target.requestBody = {
        required: true,
        content: { "application/json": { schema } },
      };
    };
    attach("/drill-down", "get", "200", {
      $ref: "#/components/schemas/ManagementReportDrillDownResponse",
    });
    attach("/budgets", "get", "200", {
      $ref: "#/components/schemas/ManagementReportBudgetMonths",
    });
    attach("/budgets/{month}", "get", "200", { type: "object" });
    attach("/budgets/{month}", "put", "200", { type: "object" });
    attach("/exports", "post", "201", {
      $ref: "#/components/schemas/ManagementReportExport",
    });
    attach("/exports", "get", "200", { type: "object" });
    attach("/exports/{exportId}/content", "get", "200", {
      $ref: "#/components/schemas/ManagementReportExportContent",
    });
    attach("/schedules", "get", "200", { type: "object" });
    attach("/schedules", "post", "201", {
      $ref: "#/components/schemas/ManagementReportSchedule",
    });
    attach("/schedules/{scheduleId}", "patch", "200", {
      $ref: "#/components/schemas/ManagementReportSchedule",
    });
    attach("/schedules/{scheduleId}", "delete", "200", { type: "object" });
    attach("/views", "get", "200", { $ref: "#/components/schemas/ManagementReportViews" });
    attach("/views", "post", "201", { $ref: "#/components/schemas/ManagementReportView" });
    body("/views", "post", { $ref: "#/components/schemas/ManagementReportViewInput" });
    attach("/views/{viewId}", "patch", "200", {
      $ref: "#/components/schemas/ManagementReportView",
    });
    body("/views/{viewId}", "patch", { $ref: "#/components/schemas/ManagementReportViewInput" });
    attach("/views/{viewId}", "delete", "200", { type: "object" });
    attach("/alerts", "get", "200", { $ref: "#/components/schemas/ManagementReportAlerts" });
    attach("/alerts/evaluate", "post", "201", { type: "object" });
    body("/alerts/evaluate", "post", {
      type: "object",
      required: ["from", "to", "comparisonMode"],
      properties: {
        from: date,
        to: date,
        comparisonMode: {
          type: "string",
          enum: ["previous_period", "previous_year", "none"],
        },
        dueInDays: { type: "integer", minimum: 1, maximum: 90, default: 3 },
      },
    });
    attach("/alerts/{alertId}", "patch", "200", {
      $ref: "#/components/schemas/ManagementReportAlert",
    });
    body("/alerts/{alertId}", "patch", {
      type: "object",
      required: ["status", "version"],
      properties: {
        status: { type: "string", enum: ["open", "claimed", "resolved", "dismissed"] },
        assignedToIdentityId: { type: "string", format: "uuid", nullable: true },
        dueAt: { type: "string", format: "date-time", nullable: true },
        comment: { type: "string", maxLength: 1_000 },
        version: { type: "integer", minimum: 1 },
      },
    });
    attach("/costs/backfill/preview", "post", "201", { type: "object" });
    body("/costs/backfill/preview", "post", {
      type: "object",
      required: ["from", "to"],
      properties: {
        from: date,
        to: date,
        comparisonMode: {
          type: "string",
          enum: ["previous_period", "previous_year", "none"],
        },
      },
    });
    attach("/reconciliation/closure", "post", "201", { type: "object" });
    body("/reconciliation/closure", "post", {
      type: "object",
      required: ["from", "to", "status", "checklist", "note"],
      properties: {
        from: date,
        to: date,
        comparisonMode: {
          type: "string",
          enum: ["previous_period", "previous_year", "none"],
        },
        status: { type: "string", enum: ["open", "closed"] },
        checklist: { type: "object", additionalProperties: { type: "boolean" } },
        note: { type: "string", maxLength: 1_000 },
        evidence: { type: "array", maxItems: 10, items: { type: "string", format: "uri" } },
      },
    });
    attach("/costs/backfill", "post", "201", { type: "object" });
    body("/costs/backfill", "post", {
      type: "object",
      required: ["from", "to", "allowEstimated"],
      properties: {
        from: date,
        to: date,
        comparisonMode: {
          type: "string",
          enum: ["previous_period", "previous_year", "none"],
          default: "previous_period",
        },
        allowEstimated: { type: "boolean", enum: [true] },
      },
    });
  }
}
