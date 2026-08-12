import type { OpenAPIObject } from "@nestjs/swagger";

type SchemaObject = Record<string, unknown>;

const uuid: SchemaObject = { type: "string", format: "uuid" };
const text: SchemaObject = { type: "string" };
const timestamp: SchemaObject = { type: "string", format: "date-time" };
const date: SchemaObject = { type: "string", format: "date" };
const int4: SchemaObject = {
  type: "integer",
  format: "int32",
  minimum: -2_147_483_648,
  maximum: 2_147_483_647,
};
const nonNegativeInt4: SchemaObject = { ...int4, minimum: 0 };
const flag: SchemaObject = { type: "boolean" };
const freeObject: SchemaObject = { type: "object", additionalProperties: true };
const freeList: SchemaObject = { type: "array", items: freeObject };

const scopedProperties: Record<string, SchemaObject> = {
  id: uuid,
  organizationId: uuid,
  unitId: uuid,
  status: text,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const managementCommandProperties: Record<string, SchemaObject> = {
  ...scopedProperties,
  locationId: uuid,
  inventoryItemId: uuid,
  eventId: uuid,
  recipeVersionId: uuid,
  supplierId: uuid,
  purchaseOrderId: uuid,
  receiptId: uuid,
  payableId: uuid,
  paymentId: uuid,
  receivableId: uuid,
  cashShiftId: uuid,
  movementId: uuid,
  importId: uuid,
  personId: uuid,
  scheduleId: uuid,
  timeEntryId: uuid,
  commissionRuleId: uuid,
  commissionId: uuid,
  amountCents: int4,
  totalCents: int4,
  version: nonNegativeInt4,
  lines: freeList,
  results: freeList,
  idempotentReplay: flag,
};

const components: Record<string, SchemaObject> = {
  FiscalDocumentResponse: {
    type: "object",
    additionalProperties: false,
    required: [
      "documentId",
      "saleReference",
      "status",
      "attemptCount",
      "adapter",
      "adapterHomologated",
      "salePreserved",
    ],
    properties: {
      documentId: uuid,
      saleReference: text,
      status: text,
      documentReference: { ...text, nullable: true },
      lastErrorCode: { ...text, nullable: true },
      attemptCount: nonNegativeInt4,
      adapter: text,
      adapterHomologated: flag,
      salePreserved: flag,
      idempotentReplay: flag,
    },
  },
  IncidentResponse: {
    type: "object",
    additionalProperties: false,
    required: [
      "incidentId",
      "incidentType",
      "status",
      "neutralSummary",
      "evidence",
      "amountCents",
      "payrollAction",
      "reporterIdentityId",
      "occurredAt",
      "idempotentReplay",
    ],
    properties: {
      incidentId: uuid,
      incidentType: text,
      status: text,
      neutralSummary: text,
      evidence: freeList,
      amountCents: { ...int4, nullable: true },
      payrollAction: { type: "boolean", enum: [false] },
      reporterIdentityId: uuid,
      approverIdentityId: { ...uuid, nullable: true },
      occurredAt: timestamp,
      idempotentReplay: flag,
    },
  },
  IncidentReportResponse: {
    type: "object",
    additionalProperties: false,
    required: [
      "incidentId",
      "incidentType",
      "status",
      "neutralSummary",
      "evidence",
      "amountCents",
      "payrollAction",
      "reporterIdentityId",
      "occurredAt",
      "idempotentReplay",
      "events",
    ],
    properties: {
      incidentId: uuid,
      incidentType: text,
      status: text,
      neutralSummary: text,
      evidence: freeList,
      amountCents: { ...int4, nullable: true },
      payrollAction: { type: "boolean", enum: [false] },
      reporterIdentityId: uuid,
      approverIdentityId: { ...uuid, nullable: true },
      occurredAt: timestamp,
      idempotentReplay: flag,
      events: freeList,
    },
  },
  ManagementCommandResponse: {
    type: "object",
    additionalProperties: true,
    properties: managementCommandProperties,
  },
  ManagementInventoryEventResponse: {
    type: "object",
    additionalProperties: false,
    required: ["eventId", "lines"],
    properties: { eventId: uuid, lines: freeList, results: freeList },
  },
  ManagementEntityListResponse: {
    type: "array",
    items: { type: "object", additionalProperties: true, properties: managementCommandProperties },
  },
  ManagementInventoryDashboardResponse: {
    type: "object",
    additionalProperties: false,
    required: ["locations", "items", "balances", "recentMovements"],
    properties: {
      locations: freeList,
      items: freeList,
      balances: freeList,
      recentMovements: freeList,
    },
  },
  ManagementPurchasesResponse: {
    type: "object",
    additionalProperties: false,
    required: ["orders", "items", "receipts"],
    properties: { orders: freeList, items: freeList, receipts: freeList },
  },
  ManagementCashShiftsResponse: {
    type: "object",
    additionalProperties: false,
    required: ["shifts", "movements"],
    properties: { shifts: freeList, movements: freeList },
  },
  ManagementFinanceDashboardResponse: {
    type: "object",
    additionalProperties: false,
    required: [
      "payables",
      "payablePayments",
      "receivables",
      "receivablePayments",
      "reconciliationImports",
      "reconciliationEntries",
    ],
    properties: {
      payables: freeList,
      payablePayments: freeList,
      receivables: freeList,
      receivablePayments: freeList,
      reconciliationImports: freeList,
      reconciliationEntries: freeList,
    },
  },
  ManagementPeopleDashboardResponse: {
    type: "object",
    additionalProperties: false,
    required: ["people", "schedules", "timeEntries", "commissionRules", "commissions"],
    properties: {
      people: freeList,
      schedules: freeList,
      timeEntries: freeList,
      commissionRules: freeList,
      commissions: freeList,
    },
  },
  ManagementReportResponse: {
    type: "object",
    additionalProperties: false,
    required: ["period", "cashFlow", "incomeStatement"],
    properties: { period: freeObject, cashFlow: freeObject, incomeStatement: freeObject },
  },
  PaymentIntentResponse: {
    type: "object",
    additionalProperties: false,
    required: ["intentId", "amountCents", "capturedCents", "status", "idempotentReplay"],
    properties: {
      intentId: uuid,
      amountCents: nonNegativeInt4,
      capturedCents: nonNegativeInt4,
      status: text,
      idempotentReplay: flag,
    },
  },
  PaymentAttemptResponse: {
    type: "object",
    additionalProperties: false,
    required: [
      "attemptId",
      "intentId",
      "status",
      "intentStatus",
      "amountCents",
      "reviewRequired",
      "nextAction",
      "idempotentReplay",
    ],
    properties: {
      attemptId: uuid,
      intentId: uuid,
      status: text,
      intentStatus: text,
      amountCents: nonNegativeInt4,
      providerReference: { ...text, nullable: true },
      reviewRequired: flag,
      nextAction: text,
      idempotentReplay: flag,
    },
  },
  RemunerationRuleResponse: {
    type: "object",
    additionalProperties: false,
    required: ["ruleSetId", "ruleVersionId", "version", "idempotentReplay"],
    properties: {
      ruleSetId: uuid,
      ruleVersionId: uuid,
      version: nonNegativeInt4,
      idempotentReplay: flag,
    },
  },
  RemunerationSimulationResponse: {
    type: "object",
    additionalProperties: false,
    required: ["outputCents", "trace"],
    properties: { outputCents: nonNegativeInt4, trace: freeList, results: freeList },
  },
  RemunerationRunResponse: {
    type: "object",
    additionalProperties: false,
    required: [
      "runId",
      "kind",
      "periodStart",
      "periodEnd",
      "status",
      "outputCents",
      "memoryHash",
      "idempotentReplay",
      "estimated",
    ],
    properties: {
      runId: uuid,
      kind: text,
      periodStart: date,
      periodEnd: date,
      status: text,
      outputCents: nonNegativeInt4,
      memoryHash: text,
      adjustmentOf: { ...uuid, nullable: true },
      approvedAt: { ...timestamp, nullable: true },
      closedAt: { ...timestamp, nullable: true },
      idempotentReplay: flag,
      estimated: flag,
    },
  },
  RemunerationPortfolioResponse: {
    type: "object",
    additionalProperties: false,
    required: ["periodStart", "periodEnd", "byKind", "disclaimer"],
    properties: { periodStart: date, periodEnd: date, byKind: freeObject, disclaimer: text },
  },
  RemunerationExportResponse: {
    type: "object",
    additionalProperties: false,
    required: ["contentType", "fileName"],
    properties: {
      contentType: text,
      fileName: { ...text, nullable: true },
      body: text,
      bodyBase64: text,
    },
  },
  ReturnableAssetResponse: {
    type: "object",
    additionalProperties: false,
    required: ["assetId", "sku", "name", "trackingMode", "depositCents", "serials", "idempotentReplay"],
    properties: {
      assetId: uuid,
      sku: text,
      name: text,
      trackingMode: text,
      depositCents: int4,
      serials: freeList,
      idempotentReplay: flag,
    },
  },
  ReturnableMovementResponse: {
    type: "object",
    additionalProperties: true,
    required: ["movementId", "assetId", "movementType", "quantity", "occurredAt", "idempotentReplay"],
    properties: {
      movementId: uuid,
      assetId: uuid,
      movementType: text,
      quantity: nonNegativeInt4,
      occurredAt: timestamp,
      idempotentReplay: flag,
    },
  },
  ReturnableReconciliationResponse: {
    type: "object",
    additionalProperties: false,
    required: ["expectedQuantity", "physicalQuantity", "adjustmentQuantity", "movementId", "movementIds"],
    properties: {
      expectedQuantity: nonNegativeInt4,
      physicalQuantity: nonNegativeInt4,
      adjustmentQuantity: int4,
      movementId: { ...uuid, nullable: true },
      movementIds: { type: "array", items: uuid },
      idempotentReplay: flag,
    },
  },
  ReturnableLedgerResponse: {
    type: "array",
    items: { $ref: "#/components/schemas/ReturnableMovementResponse" },
  },
};

const responseByOperation = {
  FiscalController_cancel: "FiscalDocumentResponse",
  FiscalController_issue: "FiscalDocumentResponse",
  FiscalController_retry: "FiscalDocumentResponse",
  IncidentsController_close: "IncidentResponse",
  IncidentsController_decide: "IncidentResponse",
  IncidentsController_report: "IncidentResponse",
  IncidentsController_reportView: "IncidentReportResponse",
  IncidentsController_review: "IncidentResponse",
  ManagementController_approvePurchaseOrder: "ManagementCommandResponse",
  ManagementController_cashMovement: "ManagementCommandResponse",
  ManagementController_cashShifts: "ManagementCashShiftsResponse",
  ManagementController_clockOut: "ManagementCommandResponse",
  ManagementController_closeCashShift: "ManagementCommandResponse",
  ManagementController_configureRecipe: "ManagementCommandResponse",
  ManagementController_createCommission: "ManagementCommandResponse",
  ManagementController_createCommissionRule: "ManagementCommandResponse",
  ManagementController_createInventoryEvent: "ManagementInventoryEventResponse",
  ManagementController_createItem: "ManagementCommandResponse",
  ManagementController_createLocation: "ManagementCommandResponse",
  ManagementController_createPayable: "ManagementCommandResponse",
  ManagementController_createPerson: "ManagementCommandResponse",
  ManagementController_createPurchaseOrder: "ManagementCommandResponse",
  ManagementController_createReceivable: "ManagementCommandResponse",
  ManagementController_createSchedule: "ManagementCommandResponse",
  ManagementController_createSupplier: "ManagementCommandResponse",
  ManagementController_createTimeEntry: "ManagementCommandResponse",
  ManagementController_finance: "ManagementFinanceDashboardResponse",
  ManagementController_inventory: "ManagementInventoryDashboardResponse",
  ManagementController_openCashShift: "ManagementCommandResponse",
  ManagementController_payPayable: "ManagementCommandResponse",
  ManagementController_people: "ManagementPeopleDashboardResponse",
  ManagementController_purchases: "ManagementPurchasesResponse",
  ManagementController_receivePurchaseOrder: "ManagementCommandResponse",
  ManagementController_receiveReceivable: "ManagementCommandResponse",
  ManagementController_recipes: "ManagementEntityListResponse",
  ManagementController_reconciliation: "ManagementCommandResponse",
  ManagementController_reports: "ManagementReportResponse",
  ManagementController_suppliers: "ManagementEntityListResponse",
  PaymentCallbacksController_callback: "PaymentAttemptResponse",
  PaymentsController_createIntent: "PaymentIntentResponse",
  PaymentsController_executeAttempt: "PaymentAttemptResponse",
  PaymentsController_manualReview: "PaymentAttemptResponse",
  PaymentsController_reconcile: "PaymentAttemptResponse",
  RemunerationController_adjustClosed: "RemunerationRunResponse",
  RemunerationController_approve: "RemunerationRunResponse",
  RemunerationController_calculate: "RemunerationRunResponse",
  RemunerationController_close: "RemunerationRunResponse",
  RemunerationController_createRule: "RemunerationRuleResponse",
  RemunerationController_exportRun: "RemunerationExportResponse",
  RemunerationController_portfolio: "RemunerationPortfolioResponse",
  RemunerationController_publishVersion: "RemunerationRuleResponse",
  RemunerationController_simulate: "RemunerationSimulationResponse",
  ReturnablesController_createAsset: "ReturnableAssetResponse",
  ReturnablesController_ledger: "ReturnableLedgerResponse",
  ReturnablesController_move: "ReturnableMovementResponse",
  ReturnablesController_reconcile: "ReturnableReconciliationResponse",
} as const;

const httpMethods = ["get", "post", "put", "patch", "delete"] as const;

export function addFinanceResponses(document: OpenAPIObject) {
  document.components ??= {};
  document.components.schemas = {
    ...document.components.schemas,
    ...(components as NonNullable<NonNullable<OpenAPIObject["components"]>["schemas"]>),
  };
  const seen = new Set<string>();

  for (const path of Object.values(document.paths)) {
    for (const method of httpMethods) {
      const operation = path?.[method];
      if (!operation?.operationId) continue;
      const handler = operation.operationId.replace(/\[\d+\]$/, "");
      const responseName = responseByOperation[handler as keyof typeof responseByOperation];
      if (!responseName) continue;
      seen.add(handler);
      const response = operation.responses?.["200"] ?? operation.responses?.["201"];
      if (!response || "$ref" in response) throw new Error(`Finance response missing for ${handler}.`);
      response.content = {
        "application/json": { schema: { $ref: `#/components/schemas/${responseName}` } },
      };
    }
  }

  const missing = Object.keys(responseByOperation).filter((handler) => !seen.has(handler));
  if (missing.length > 0) throw new Error(`Finance OpenAPI handlers missing: ${missing.join(", ")}`);
}
