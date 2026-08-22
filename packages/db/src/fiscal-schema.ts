import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { posOrders, posProducts, posTabs } from "./operations-schema.js";
import { identities, legalEntities, organizations, units } from "./schema.js";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const fiscalEnvironment = pgEnum("fiscal_environment", ["homologation", "production"]);
export const fiscalRevisionStatus = pgEnum("fiscal_revision_status", [
  "draft",
  "active",
  "revoked",
]);
export const fiscalDocumentModel = pgEnum("fiscal_document_model", ["nfce", "nfe", "nfse"]);
export const fiscalDocumentStatus = pgEnum("fiscal_document_status", [
  "pending",
  "processing",
  "authorized",
  "rejected",
  "contingency",
  "canceled",
]);
export const fiscalPeriodStatus = pgEnum("fiscal_period_status", ["open", "reviewing", "closed"]);
export const accountantRequestStatus = pgEnum("accountant_request_status", ["open", "resolved"]);
export const accountingExportStatus = pgEnum("accounting_export_status", [
  "pending",
  "ready",
  "failed",
]);
export const fiscalNumberInvalidationStatus = pgEnum("fiscal_number_invalidation_status", [
  "processing",
  "invalidated",
  "rejected",
]);

export const fiscalProfiles = pgTable(
  "fiscal_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    taxRegime: varchar("tax_regime", { length: 40 }).notNull(),
    crt: varchar("crt", { length: 2 }).notNull(),
    municipalRegistration: varchar("municipal_registration", { length: 30 }),
    cnae: varchar("cnae", { length: 10 }),
    stateCode: varchar("state_code", { length: 2 }).notNull(),
    cityCode: varchar("city_code", { length: 7 }).notNull(),
    environment: fiscalEnvironment("environment").notNull().default("homologation"),
    provider: varchar("provider", { length: 40 }),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    approvedByIdentityId: uuid("approved_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("fiscal_profiles_unit_unique").on(table.organizationId, table.unitId),
    foreignKey({
      name: "fiscal_profiles_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const productTaxRevisions = pgTable(
  "product_tax_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    productId: uuid("product_id").notNull(),
    version: integer("version").notNull(),
    status: fiscalRevisionStatus("status").notNull().default("draft"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    classification: jsonb("classification").$type<Record<string, unknown>>().notNull(),
    createdByIdentityId: uuid("created_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    approvedByIdentityId: uuid("approved_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("product_tax_revisions_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("product_tax_revisions_version_unique").on(
      table.organizationId,
      table.unitId,
      table.productId,
      table.version,
    ),
    index("product_tax_revisions_active_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.effectiveFrom,
    ),
    foreignKey({
      name: "product_tax_revisions_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "product_tax_revisions_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("restrict"),
  ],
);

export const fiscalDocuments = pgTable(
  "fiscal_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    tabId: uuid("tab_id"),
    orderId: uuid("order_id"),
    model: fiscalDocumentModel("model").notNull(),
    environment: fiscalEnvironment("environment").notNull(),
    status: fiscalDocumentStatus("status").notNull().default("pending"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    providerReference: varchar("provider_reference", { length: 160 }),
    accessKey: varchar("access_key", { length: 64 }),
    series: varchar("series", { length: 20 }),
    number: integer("number"),
    totalCents: integer("total_cents").notNull(),
    taxCents: integer("tax_cents").notNull().default(0),
    customerDocument: varchar("customer_document", { length: 32 }),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    xmlStorageKey: text("xml_storage_key"),
    xmlSha256: varchar("xml_sha256", { length: 64 }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("fiscal_documents_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("fiscal_documents_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    uniqueIndex("fiscal_documents_provider_reference_unique").on(
      table.organizationId,
      table.providerReference,
    ),
    uniqueIndex("fiscal_documents_access_key_unique").on(table.accessKey),
    index("fiscal_documents_unit_status_time_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.issuedAt,
    ),
    index("fiscal_documents_tab_idx").on(table.organizationId, table.unitId, table.tabId),
    foreignKey({
      name: "fiscal_documents_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fiscal_documents_tab_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fiscal_documents_order_fk",
      columns: [table.organizationId, table.unitId, table.orderId],
      foreignColumns: [posOrders.organizationId, posOrders.unitId, posOrders.id],
    }).onDelete("restrict"),
  ],
);

export const fiscalDocumentArtifacts = pgTable(
  "fiscal_document_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    documentId: uuid("document_id").notNull(),
    kind: varchar("kind", { length: 24 }).notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    bytes: integer("bytes").notNull(),
    contentType: varchar("content_type", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fiscal_document_artifacts_kind_unique").on(table.documentId, table.kind),
    index("fiscal_document_artifacts_scope_idx").on(
      table.organizationId,
      table.unitId,
      table.documentId,
    ),
    foreignKey({
      name: "fiscal_document_artifacts_document_fk",
      columns: [table.organizationId, table.unitId, table.documentId],
      foreignColumns: [fiscalDocuments.organizationId, fiscalDocuments.unitId, fiscalDocuments.id],
    }).onDelete("cascade"),
    check(
      "fiscal_document_artifacts_kind_check",
      sql`${table.kind} IN ('authorization_xml', 'cancellation_xml', 'danfe_pdf')`,
    ),
    check("fiscal_document_artifacts_bytes_check", sql`${table.bytes} > 0`),
    check("fiscal_document_artifacts_sha_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const fiscalDocumentItems = pgTable(
  "fiscal_document_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    documentId: uuid("document_id").notNull(),
    productId: uuid("product_id"),
    taxRevisionId: uuid("tax_revision_id"),
    lineNumber: integer("line_number").notNull(),
    description: varchar("description", { length: 240 }).notNull(),
    quantityMilli: integer("quantity_milli").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    taxCents: integer("tax_cents").notNull().default(0),
    taxSnapshot: jsonb("tax_snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fiscal_document_items_line_unique").on(table.documentId, table.lineNumber),
    foreignKey({
      name: "fiscal_document_items_document_fk",
      columns: [table.organizationId, table.unitId, table.documentId],
      foreignColumns: [fiscalDocuments.organizationId, fiscalDocuments.unitId, fiscalDocuments.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fiscal_document_items_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fiscal_document_items_revision_fk",
      columns: [table.organizationId, table.unitId, table.taxRevisionId],
      foreignColumns: [
        productTaxRevisions.organizationId,
        productTaxRevisions.unitId,
        productTaxRevisions.id,
      ],
    }).onDelete("restrict"),
  ],
);

export const fiscalDocumentEvents = pgTable(
  "fiscal_document_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    documentId: uuid("document_id").notNull(),
    providerEventId: varchar("provider_event_id", { length: 160 }),
    type: varchar("type", { length: 80 }).notNull(),
    status: fiscalDocumentStatus("status"),
    code: varchar("code", { length: 40 }),
    message: text("message"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fiscal_document_events_provider_unique").on(
      table.organizationId,
      table.providerEventId,
    ),
    index("fiscal_document_events_document_time_idx").on(table.documentId, table.occurredAt),
    foreignKey({
      name: "fiscal_document_events_document_fk",
      columns: [table.organizationId, table.unitId, table.documentId],
      foreignColumns: [fiscalDocuments.organizationId, fiscalDocuments.unitId, fiscalDocuments.id],
    }).onDelete("cascade"),
  ],
);

export const fiscalPeriods = pgTable(
  "fiscal_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    competence: date("competence").notNull(),
    status: fiscalPeriodStatus("status").notNull().default("open"),
    snapshotSha256: varchar("snapshot_sha256", { length: 64 }),
    closedByIdentityId: uuid("closed_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reopenedByIdentityId: uuid("reopened_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenReason: text("reopen_reason"),
    ...timestamps,
  },
  (table) => [
    unique("fiscal_periods_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("fiscal_periods_competence_unique").on(
      table.organizationId,
      table.unitId,
      table.competence,
    ),
    foreignKey({
      name: "fiscal_periods_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
  ],
);

export const accountantRequests = pgTable(
  "accountant_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    competence: date("competence").notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description").notNull(),
    status: accountantRequestStatus("status").notNull().default("open"),
    dueDate: date("due_date"),
    attachments: jsonb("attachments")
      .$type<{ name: string; storageKey: string; sha256?: string }[]>()
      .notNull()
      .default([]),
    resolvedByIdentityId: uuid("resolved_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("accountant_requests_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    index("accountant_requests_unit_status_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
    ),
    index("accountant_requests_competence_idx").on(
      table.organizationId,
      table.unitId,
      table.competence,
    ),
    foreignKey({
      name: "accountant_requests_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const accountingExports = pgTable(
  "accounting_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    periodId: uuid("period_id").notNull(),
    format: varchar("format", { length: 40 }).notNull(),
    status: accountingExportStatus("status").notNull().default("pending"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    storageKey: text("storage_key"),
    sha256: varchar("sha256", { length: 64 }),
    requestedByIdentityId: uuid("requested_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    error: text("error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("accounting_exports_period_format_unique").on(table.periodId, table.format),
    index("accounting_exports_unit_time_idx").on(
      table.organizationId,
      table.unitId,
      table.createdAt,
    ),
    foreignKey({
      name: "accounting_exports_period_fk",
      columns: [table.organizationId, table.unitId, table.periodId],
      foreignColumns: [fiscalPeriods.organizationId, fiscalPeriods.unitId, fiscalPeriods.id],
    }).onDelete("cascade"),
  ],
);

export const fiscalWebhookReceipts = pgTable(
  "fiscal_webhook_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 160 }).notNull(),
    bodySha256: varchar("body_sha256", { length: 64 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (table) => [
    uniqueIndex("fiscal_webhook_receipts_provider_event_unique").on(
      table.organizationId,
      table.provider,
      table.providerEventId,
    ),
    foreignKey({
      name: "fiscal_webhook_receipts_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const fiscalNumberInvalidations = pgTable(
  "fiscal_number_invalidations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    environment: fiscalEnvironment("environment").notNull(),
    series: varchar("series", { length: 20 }).notNull(),
    initialNumber: integer("initial_number").notNull(),
    finalNumber: integer("final_number").notNull(),
    justification: text("justification").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    status: fiscalNumberInvalidationStatus("status").notNull().default("processing"),
    providerReference: varchar("provider_reference", { length: 160 }),
    xmlStorageKey: text("xml_storage_key"),
    xmlSha256: varchar("xml_sha256", { length: 64 }),
    errorCode: varchar("error_code", { length: 80 }),
    errorMessage: text("error_message"),
    requestedByIdentityId: uuid("requested_by_identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "restrict" }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("fiscal_number_invalidations_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    index("fiscal_number_invalidations_scope_time_idx").on(
      table.organizationId,
      table.unitId,
      table.createdAt,
    ),
    foreignKey({
      name: "fiscal_number_invalidations_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    check(
      "fiscal_number_invalidations_range_check",
      sql`${table.initialNumber} > 0 AND ${table.finalNumber} >= ${table.initialNumber}`,
    ),
  ],
);
