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
                ],
                properties: {
                  key: { type: "string", format: "uuid" },
                  label: { type: "string" },
                  closedTabs: { type: "integer" },
                  revenueCents: cents,
                  averageTicketCents: nullableCents,
                  changePercent: { type: "number", nullable: true },
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
      },
    },
    meta: {
      type: "object",
      required: ["generatedAt", "dataThrough", "sourceCounts", "coverage"],
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
          required: ["sales", "cashFlow", "costs", "budget"],
          properties: Object.fromEntries(
            ["sales", "cashFlow", "costs", "budget"].map((key) => [
              key,
              { type: "string", enum: ["complete", "partial", "unavailable"] },
            ]),
          ),
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
        "emailDeliveryConfigured",
      ],
      properties: Object.fromEntries(
        [
          "viewCosts",
          "drillDown",
          "export",
          "manageBudget",
          "manageSchedules",
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
      format: { type: "string", enum: ["csv"] },
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
    required: ["filename", "content", "sha256"],
    properties: {
      filename: { type: "string" },
      content: { type: "string" },
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
        ],
      },
      delivery: { type: "string", enum: ["in_app", "email"] },
      enabled: { type: "boolean" },
      nextRunAt: { type: "string", format: "date-time" },
      lastRunAt: { type: "string", format: "date-time", nullable: true },
      version: { type: "integer" },
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
          "$ref" in parameter || !["from", "to", "comparisonMode"].includes(parameter.name),
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
  }
}
