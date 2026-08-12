import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { posOrders, posProducts } from "./operations-schema.js";
import { identities, organizations, units } from "./schema.js";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const managementPurchaseStatus = pgEnum("management_purchase_status", [
  "draft",
  "approved",
  "partially_received",
  "received",
  "canceled",
]);
export const managementPayableStatus = pgEnum("management_payable_status", [
  "open",
  "partially_paid",
  "paid",
  "canceled",
]);
export const managementReceivableStatus = pgEnum("management_receivable_status", [
  "open",
  "partially_received",
  "received",
  "canceled",
]);
export const managementCashShiftStatus = pgEnum("management_cash_shift_status", [
  "open",
  "closed",
  "reviewed",
]);

export const financialLedgerTransactions = pgTable(
  "financial_ledger_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    kind: varchar("kind", { length: 24 })
      .$type<"sale" | "payment" | "refund" | "chargeback" | "adjustment" | "reversal">()
      .notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("BRL"),
    referenceType: varchar("reference_type", { length: 48 }).notNull(),
    referenceId: varchar("reference_id", { length: 160 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    reversalOf: uuid("reversal_of"),
    debitCents: integer("debit_cents").notNull(),
    creditCents: integer("credit_cents").notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("financial_ledger_transactions_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("financial_ledger_transactions_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    uniqueIndex("financial_ledger_transactions_reversal_unique")
      .on(table.organizationId, table.unitId, table.reversalOf)
      .where(sql`${table.reversalOf} is not null`),
    index("financial_ledger_transactions_reference_idx").on(
      table.organizationId,
      table.unitId,
      table.referenceType,
      table.referenceId,
      table.postedAt,
    ),
    foreignKey({
      name: "financial_ledger_transactions_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "financial_ledger_transactions_reversal_fk",
      columns: [table.organizationId, table.unitId, table.reversalOf],
      foreignColumns: [table.organizationId, table.unitId, table.id],
    }).onDelete("restrict"),
    check(
      "financial_ledger_transactions_balanced_check",
      sql`${table.debitCents} > 0 and ${table.debitCents} = ${table.creditCents}`,
    ),
    check("financial_ledger_transactions_currency_check", sql`${table.currency} = 'BRL'`),
    check(
      "financial_ledger_transactions_reversal_check",
      sql`(${table.kind} = 'reversal') = (${table.reversalOf} is not null)`,
    ),
  ],
);

export const financialLedgerEntries = pgTable(
  "financial_ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    transactionId: uuid("transaction_id").notNull(),
    sequence: integer("sequence").notNull(),
    account: varchar("account", { length: 80 }).notNull(),
    component: varchar("component", { length: 24 }),
    debitCents: integer("debit_cents").notNull().default(0),
    creditCents: integer("credit_cents").notNull().default(0),
    memo: varchar("memo", { length: 240 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("financial_ledger_entries_sequence_unique").on(table.transactionId, table.sequence),
    foreignKey({
      name: "financial_ledger_entries_transaction_fk",
      columns: [table.organizationId, table.unitId, table.transactionId],
      foreignColumns: [
        financialLedgerTransactions.organizationId,
        financialLedgerTransactions.unitId,
        financialLedgerTransactions.id,
      ],
    }).onDelete("restrict"),
    check("financial_ledger_entries_sequence_check", sql`${table.sequence} >= 0`),
    check(
      "financial_ledger_entries_one_side_check",
      sql`(${table.debitCents} > 0 and ${table.creditCents} = 0) or (${table.creditCents} > 0 and ${table.debitCents} = 0)`,
    ),
  ],
);

export const paymentTerminals = pgTable(
  "payment_terminals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    adapter: varchar("adapter", { length: 48 }).notNull(),
    externalReference: varchar("external_reference", { length: 160 }),
    status: varchar("status", { length: 24 })
      .$type<"active" | "offline" | "revoked">()
      .notNull()
      .default("active"),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
    pairedAt: timestamp("paired_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("payment_terminals_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("payment_terminals_external_unique")
      .on(table.organizationId, table.unitId, table.adapter, table.externalReference)
      .where(sql`${table.externalReference} is not null`),
    foreignKey({
      name: "payment_terminals_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    sourceType: varchar("source_type", { length: 48 }).notNull(),
    sourceId: varchar("source_id", { length: 160 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    capturedCents: integer("captured_cents").notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("BRL"),
    status: varchar("status", { length: 24 })
      .$type<"pending" | "partially_paid" | "paid" | "cancelled">()
      .notNull()
      .default("pending"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("payment_intents_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("payment_intents_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "payment_intents_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    check(
      "payment_intents_amount_check",
      sql`${table.amountCents} > 0 and ${table.capturedCents} >= 0 and ${table.capturedCents} <= ${table.amountCents}`,
    ),
    check("payment_intents_currency_check", sql`${table.currency} = 'BRL'`),
    check("payment_intents_version_check", sql`${table.version} > 0`),
  ],
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    intentId: uuid("intent_id").notNull(),
    terminalId: uuid("terminal_id"),
    adapter: varchar("adapter", { length: 48 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: varchar("status", { length: 24 })
      .$type<
        | "created"
        | "processing"
        | "authorized"
        | "declined"
        | "unknown"
        | "reconciled"
        | "cancelled"
      >()
      .notNull()
      .default("created"),
    providerReference: varchar("provider_reference", { length: 160 }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    reviewRequired: boolean("review_required").notNull().default(false),
    reviewReason: varchar("review_reason", { length: 240 }),
    lastLookupAt: timestamp("last_lookup_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("payment_attempts_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("payment_attempts_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    index("payment_attempts_review_idx").on(
      table.organizationId,
      table.unitId,
      table.reviewRequired,
      table.createdAt,
    ),
    foreignKey({
      name: "payment_attempts_intent_fk",
      columns: [table.organizationId, table.unitId, table.intentId],
      foreignColumns: [paymentIntents.organizationId, paymentIntents.unitId, paymentIntents.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_attempts_terminal_fk",
      columns: [table.organizationId, table.unitId, table.terminalId],
      foreignColumns: [
        paymentTerminals.organizationId,
        paymentTerminals.unitId,
        paymentTerminals.id,
      ],
    }).onDelete("restrict"),
    check("payment_attempts_amount_check", sql`${table.amountCents} > 0`),
    check("payment_attempts_version_check", sql`${table.version} > 0`),
    check(
      "payment_attempts_review_check",
      sql`${table.status} <> 'unknown' or (${table.reviewRequired} and ${table.reviewReason} is not null)`,
    ),
  ],
);

export const paymentProviderEvents = pgTable(
  "payment_provider_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    adapter: varchar("adapter", { length: 48 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 160 }).notNull(),
    outcome: varchar("outcome", { length: 24 }).notNull(),
    safePayload: jsonb("safe_payload").$type<Record<string, unknown>>().notNull().default({}),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payment_provider_events_provider_unique").on(
      table.organizationId,
      table.unitId,
      table.adapter,
      table.providerEventId,
    ),
    foreignKey({
      name: "payment_provider_events_attempt_fk",
      columns: [table.organizationId, table.unitId, table.attemptId],
      foreignColumns: [paymentAttempts.organizationId, paymentAttempts.unitId, paymentAttempts.id],
    }).onDelete("restrict"),
  ],
);

export const fiscalDocuments = pgTable(
  "fiscal_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    saleReference: varchar("sale_reference", { length: 160 }).notNull(),
    documentType: varchar("document_type", { length: 24 }).notNull(),
    totalCents: integer("total_cents").notNull(),
    documentPayload: jsonb("document_payload").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 24 })
      .$type<"pending" | "submitted" | "authorized" | "rejected" | "cancelled">()
      .notNull()
      .default("pending"),
    adapter: varchar("adapter", { length: 48 }).notNull(),
    adapterHomologated: boolean("adapter_homologated").notNull().default(false),
    documentReference: varchar("document_reference", { length: 160 }),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    attemptCount: integer("attempt_count").notNull().default(0),
    version: integer("version").notNull().default(1),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("fiscal_documents_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("fiscal_documents_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    index("fiscal_documents_sale_idx").on(table.organizationId, table.unitId, table.saleReference),
    foreignKey({
      name: "fiscal_documents_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    check("fiscal_documents_total_check", sql`${table.totalCents} > 0`),
    check("fiscal_documents_attempt_check", sql`${table.attemptCount} >= 0`),
    check("fiscal_documents_version_check", sql`${table.version} > 0`),
  ],
);

export const fiscalDocumentEvents = pgTable(
  "fiscal_document_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    documentId: uuid("document_id").notNull(),
    fromStatus: varchar("from_status", { length: 24 }),
    toStatus: varchar("to_status", { length: 24 }).notNull(),
    event: varchar("event", { length: 24 }).notNull(),
    errorCode: varchar("error_code", { length: 80 }),
    actorIdentityId: uuid("actor_identity_id").references(() => identities.id),
    safePayload: jsonb("safe_payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fiscal_document_events_document_idx").on(table.documentId, table.createdAt),
    foreignKey({
      name: "fiscal_document_events_document_fk",
      columns: [table.organizationId, table.unitId, table.documentId],
      foreignColumns: [fiscalDocuments.organizationId, fiscalDocuments.unitId, fiscalDocuments.id],
    }).onDelete("restrict"),
  ],
);

export const managementSuppliers = pgTable(
  "management_suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    document: varchar("document", { length: 20 }),
    contactName: varchar("contact_name", { length: 120 }),
    email: varchar("email", { length: 254 }),
    phone: varchar("phone", { length: 24 }),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("management_suppliers_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    index("management_suppliers_scope_name_idx").on(table.organizationId, table.unitId, table.name),
    foreignKey({
      name: "management_suppliers_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const managementStockLocations = pgTable(
  "management_stock_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    code: varchar("code", { length: 40 }).notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("management_stock_locations_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_stock_locations_code_unique").on(
      table.organizationId,
      table.unitId,
      table.code,
    ),
    foreignKey({
      name: "management_stock_locations_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const managementInventoryItems = pgTable(
  "management_inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    productId: uuid("product_id"),
    name: varchar("name", { length: 160 }).notNull(),
    sku: varchar("sku", { length: 80 }),
    unit: varchar("unit", { length: 20 }).notNull(),
    dimension: varchar("dimension", { length: 16 })
      .$type<"mass" | "volume" | "count">()
      .notNull()
      .default("count"),
    quantityScale: smallint("quantity_scale").notNull().default(6),
    minimumQuantity: numeric("minimum_quantity", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    allowNegative: boolean("allow_negative").notNull().default(false),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("management_inventory_items_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_inventory_items_sku_unique").on(
      table.organizationId,
      table.unitId,
      table.sku,
    ),
    foreignKey({
      name: "management_inventory_items_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_inventory_items_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("restrict"),
    check("management_inventory_items_minimum_check", sql`${table.minimumQuantity} >= 0`),
    check(
      "management_inventory_items_dimension_check",
      sql`${table.dimension} in ('mass','volume','count')`,
    ),
    check("management_inventory_items_scale_check", sql`${table.quantityScale} = 6`),
  ],
);

export const managementRecipeVersions = pgTable(
  "management_recipe_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    productId: uuid("product_id").notNull(),
    version: integer("version").notNull(),
    yieldQuantity: numeric("yield_quantity", { precision: 20, scale: 6 }).notNull().default("1"),
    yieldUnit: varchar("yield_unit", { length: 20 }).notNull().default("unit"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("management_recipe_versions_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    unique("management_recipe_versions_number_unique").on(
      table.organizationId,
      table.unitId,
      table.productId,
      table.version,
    ),
    uniqueIndex("management_recipe_versions_active_unique")
      .on(table.organizationId, table.unitId, table.productId)
      .where(sql`${table.validUntil} is null`),
    foreignKey({
      name: "management_recipe_versions_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_recipe_versions_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("restrict"),
    check("management_recipe_version_positive_check", sql`${table.version} > 0`),
    check("management_recipe_version_yield_check", sql`${table.yieldQuantity} > 0`),
    check(
      "management_recipe_version_yield_unit_check",
      sql`${table.yieldUnit} in ('unit', 'dozen')`,
    ),
    check(
      "management_recipe_version_window_check",
      sql`${table.validUntil} is null or ${table.validUntil} > ${table.validFrom}`,
    ),
  ],
);

export const managementRecipeComponents = pgTable(
  "management_recipe_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    recipeVersionId: uuid("recipe_version_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    locationId: uuid("location_id").notNull(),
    quantityMilli: integer("quantity_milli").notNull(),
    quantityMicros: bigint("quantity_micros", { mode: "bigint" }).notNull(),
    unit: varchar("unit", { length: 20 }).notNull(),
    lossBasisPoints: integer("loss_basis_points").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("management_recipe_component_unique").on(
      table.recipeVersionId,
      table.inventoryItemId,
      table.locationId,
    ),
    foreignKey({
      name: "management_recipe_component_version_fk",
      columns: [table.organizationId, table.unitId, table.recipeVersionId],
      foreignColumns: [
        managementRecipeVersions.organizationId,
        managementRecipeVersions.unitId,
        managementRecipeVersions.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_recipe_component_item_fk",
      columns: [table.organizationId, table.unitId, table.inventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_recipe_component_location_fk",
      columns: [table.organizationId, table.unitId, table.locationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    check("management_recipe_component_quantity_check", sql`${table.quantityMilli} > 0`),
    check("management_recipe_component_micros_check", sql`${table.quantityMicros} > 0`),
    check(
      "management_recipe_component_loss_check",
      sql`${table.lossBasisPoints} between 0 and 9999`,
    ),
  ],
);

export const managementUnitConversions = pgTable(
  "management_unit_conversions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    fromUnit: varchar("from_unit", { length: 20 }).notNull(),
    toUnit: varchar("to_unit", { length: 20 }).notNull(),
    dimension: varchar("dimension", { length: 16 }).$type<"mass" | "volume" | "count">().notNull(),
    numerator: bigint("numerator", { mode: "bigint" }).notNull(),
    denominator: bigint("denominator", { mode: "bigint" }).notNull(),
    rounding: varchar("rounding", { length: 16 })
      .$type<"exact" | "up" | "down" | "half_up">()
      .notNull()
      .default("exact"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("management_unit_conversions_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_unit_conversions_active_unique")
      .on(table.organizationId, table.unitId, table.fromUnit, table.toUnit)
      .where(sql`${table.validUntil} is null`),
    foreignKey({
      name: "management_unit_conversions_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "management_unit_conversions_ratio_check",
      sql`${table.numerator} > 0 and ${table.denominator} > 0`,
    ),
    check(
      "management_unit_conversions_window_check",
      sql`${table.validUntil} is null or ${table.validUntil} > ${table.validFrom}`,
    ),
  ],
);

export const managementReturnableAssets = pgTable(
  "management_returnable_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    sku: varchar("sku", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    trackingMode: varchar("tracking_mode", { length: 16 })
      .$type<"aggregate" | "serialized">()
      .notNull(),
    depositCents: integer("deposit_cents"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("management_returnable_assets_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    unique("management_returnable_assets_sku_unique").on(
      table.organizationId,
      table.unitId,
      table.sku,
    ),
    unique("management_returnable_assets_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_returnable_assets_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    check(
      "management_returnable_assets_mode_check",
      sql`${table.trackingMode} in ('aggregate','serialized')`,
    ),
    check(
      "management_returnable_assets_deposit_check",
      sql`${table.depositCents} is null or ${table.depositCents} >= 0`,
    ),
  ],
);

export const managementReturnableSerials = pgTable(
  "management_returnable_serials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    serialNumber: varchar("serial_number", { length: 120 }).notNull(),
    state: varchar("state", { length: 24 })
      .$type<"available" | "in_custody" | "with_supplier" | "broken" | "lost">()
      .notNull()
      .default("available"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("management_returnable_serials_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    unique("management_returnable_serials_number_unique").on(
      table.organizationId,
      table.unitId,
      table.assetId,
      table.serialNumber,
    ),
    foreignKey({
      name: "management_returnable_serials_asset_fk",
      columns: [table.organizationId, table.unitId, table.assetId],
      foreignColumns: [
        managementReturnableAssets.organizationId,
        managementReturnableAssets.unitId,
        managementReturnableAssets.id,
      ],
    }).onDelete("restrict"),
    check(
      "management_returnable_serials_state_check",
      sql`${table.state} in ('available','in_custody','with_supplier','broken','lost')`,
    ),
    check("management_returnable_serials_version_check", sql`${table.version} > 0`),
  ],
);

export const managementReturnableMovements = pgTable(
  "management_returnable_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    serialId: uuid("serial_id"),
    movementType: varchar("movement_type", { length: 32 })
      .$type<
        | "receive"
        | "circulate"
        | "return_empty"
        | "send_supplier"
        | "receive_supplier"
        | "broken"
        | "lost"
        | "reconcile_adjustment"
      >()
      .notNull(),
    quantity: integer("quantity").notNull(),
    fromCustodyType: varchar("from_custody_type", { length: 24 }),
    fromCustodyId: varchar("from_custody_id", { length: 160 }),
    toCustodyType: varchar("to_custody_type", { length: 24 }),
    toCustodyId: varchar("to_custody_id", { length: 160 }),
    supplierReference: varchar("supplier_reference", { length: 160 }),
    lotReference: varchar("lot_reference", { length: 160 }),
    reason: varchar("reason", { length: 240 }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    approverIdentityId: uuid("approver_identity_id").references(() => identities.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("management_returnable_movements_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    unique("management_returnable_movements_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_returnable_movements_asset_fk",
      columns: [table.organizationId, table.unitId, table.assetId],
      foreignColumns: [
        managementReturnableAssets.organizationId,
        managementReturnableAssets.unitId,
        managementReturnableAssets.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_returnable_movements_serial_fk",
      columns: [table.organizationId, table.unitId, table.serialId],
      foreignColumns: [
        managementReturnableSerials.organizationId,
        managementReturnableSerials.unitId,
        managementReturnableSerials.id,
      ],
    }).onDelete("restrict"),
    check("management_returnable_movements_quantity_check", sql`${table.quantity} > 0`),
  ],
);

export const managementIncidents = pgTable(
  "management_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    incidentType: varchar("incident_type", { length: 48 }).notNull(),
    status: varchar("status", { length: 24 })
      .$type<"reported" | "under_review" | "approved" | "rejected" | "closed">()
      .notNull()
      .default("reported"),
    neutralSummary: text("neutral_summary").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>[]>().notNull().default([]),
    amountCents: integer("amount_cents"),
    payrollAction: boolean("payroll_action").notNull().default(false),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    reporterIdentityId: uuid("reporter_identity_id")
      .notNull()
      .references(() => identities.id),
    approverIdentityId: uuid("approver_identity_id").references(() => identities.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("management_incidents_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    unique("management_incidents_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_incidents_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    check(
      "management_incidents_status_check",
      sql`${table.status} in ('reported','under_review','approved','rejected','closed')`,
    ),
    check(
      "management_incidents_amount_check",
      sql`${table.amountCents} is null or ${table.amountCents} >= 0`,
    ),
    check("management_incidents_no_payroll_check", sql`${table.payrollAction} = false`),
  ],
);

export const managementIncidentEvents = pgTable(
  "management_incident_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    event: varchar("event", { length: 32 }).notNull(),
    fromStatus: varchar("from_status", { length: 24 }),
    toStatus: varchar("to_status", { length: 24 }).notNull(),
    neutralNote: text("neutral_note"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("management_incident_events_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_incident_events_incident_fk",
      columns: [table.organizationId, table.unitId, table.incidentId],
      foreignColumns: [
        managementIncidents.organizationId,
        managementIncidents.unitId,
        managementIncidents.id,
      ],
    }).onDelete("restrict"),
  ],
);

export const remunerationRuleSets = pgTable(
  "remuneration_rule_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    kind: varchar("kind", { length: 24 })
      .$type<"service" | "commission" | "profit_sharing">()
      .notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    active: boolean("active").notNull().default(true),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    unique("remuneration_rule_sets_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    unique("remuneration_rule_sets_name_unique").on(
      table.organizationId,
      table.unitId,
      table.kind,
      table.name,
    ),
    unique("remuneration_rule_sets_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "remuneration_rule_sets_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    check(
      "remuneration_rule_sets_kind_check",
      sql`${table.kind} in ('service','commission','profit_sharing')`,
    ),
  ],
);

export const remunerationRuleVersions = pgTable(
  "remuneration_rule_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    ruleSetId: uuid("rule_set_id").notNull(),
    version: integer("version").notNull(),
    expression: jsonb("expression").$type<Record<string, unknown>>().notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true }),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("remuneration_rule_versions_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    unique("remuneration_rule_versions_number_unique").on(table.ruleSetId, table.version),
    uniqueIndex("remuneration_rule_versions_active_unique")
      .on(table.organizationId, table.unitId, table.ruleSetId)
      .where(sql`${table.effectiveUntil} is null`),
    foreignKey({
      name: "remuneration_rule_versions_set_fk",
      columns: [table.organizationId, table.unitId, table.ruleSetId],
      foreignColumns: [
        remunerationRuleSets.organizationId,
        remunerationRuleSets.unitId,
        remunerationRuleSets.id,
      ],
    }).onDelete("restrict"),
    check("remuneration_rule_versions_positive_check", sql`${table.version} > 0`),
    check(
      "remuneration_rule_versions_window_check",
      sql`${table.effectiveUntil} is null or ${table.effectiveUntil} > ${table.effectiveFrom}`,
    ),
  ],
);

export const remunerationCalculationRuns = pgTable(
  "remuneration_calculation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    kind: varchar("kind", { length: 24 })
      .$type<"service" | "commission" | "profit_sharing">()
      .notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: varchar("status", { length: 16 })
      .$type<"estimated" | "approved" | "closed">()
      .notNull()
      .default("estimated"),
    ruleVersionId: uuid("rule_version_id").notNull(),
    frozenRule: jsonb("frozen_rule").$type<Record<string, unknown>>().notNull(),
    frozenMetrics: jsonb("frozen_metrics").$type<Record<string, number>>().notNull(),
    sourceReferences: jsonb("source_references").$type<string[]>().notNull(),
    evaluationTrace: jsonb("evaluation_trace").$type<Record<string, unknown>[]>().notNull(),
    outputCents: integer("output_cents").notNull(),
    memoryHash: varchar("memory_hash", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    adjustmentOf: uuid("adjustment_of").references(
      (): AnyPgColumn => remunerationCalculationRuns.id,
      { onDelete: "restrict" },
    ),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    approvedByIdentityId: uuid("approved_by_identity_id").references(() => identities.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    closedByIdentityId: uuid("closed_by_identity_id").references(() => identities.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("remuneration_calculation_runs_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    unique("remuneration_calculation_runs_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "remuneration_calculation_runs_rule_fk",
      columns: [table.organizationId, table.unitId, table.ruleVersionId],
      foreignColumns: [
        remunerationRuleVersions.organizationId,
        remunerationRuleVersions.unitId,
        remunerationRuleVersions.id,
      ],
    }).onDelete("restrict"),
    check(
      "remuneration_calculation_runs_kind_check",
      sql`${table.kind} in ('service','commission','profit_sharing')`,
    ),
    check(
      "remuneration_calculation_runs_status_check",
      sql`${table.status} in ('estimated','approved','closed')`,
    ),
    check("remuneration_calculation_runs_output_check", sql`${table.outputCents} >= 0`),
    check(
      "remuneration_calculation_runs_period_check",
      sql`${table.periodEnd} >= ${table.periodStart}`,
    ),
  ],
);

export const remunerationCalculationEntries = pgTable(
  "remuneration_calculation_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    runId: uuid("run_id").notNull(),
    recipientReference: varchar("recipient_reference", { length: 160 }).notNull(),
    recipientLabel: varchar("recipient_label", { length: 160 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("remuneration_calculation_entries_recipient_unique").on(
      table.runId,
      table.recipientReference,
    ),
    foreignKey({
      name: "remuneration_calculation_entries_run_fk",
      columns: [table.organizationId, table.unitId, table.runId],
      foreignColumns: [
        remunerationCalculationRuns.organizationId,
        remunerationCalculationRuns.unitId,
        remunerationCalculationRuns.id,
      ],
    }).onDelete("restrict"),
    check("remuneration_calculation_entries_amount_check", sql`${table.amountCents} >= 0`),
  ],
);

export const managementStockBalances = pgTable(
  "management_stock_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    locationId: uuid("location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull().default("0"),
    averageCostCents: integer("average_cost_cents"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("management_stock_balance_unique").on(
      table.organizationId,
      table.unitId,
      table.locationId,
      table.inventoryItemId,
    ),
    foreignKey({
      name: "management_stock_balance_location_fk",
      columns: [table.organizationId, table.unitId, table.locationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_stock_balance_item_fk",
      columns: [table.organizationId, table.unitId, table.inventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    check("management_stock_balance_version_check", sql`${table.version} > 0`),
    check(
      "management_stock_balance_cost_check",
      sql`${table.averageCostCents} is null or ${table.averageCostCents} >= 0`,
    ),
  ],
);

export const managementInventoryEvents = pgTable(
  "management_inventory_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    type: varchar("type", { length: 24 }).$type<"loss" | "count" | "adjustment">().notNull(),
    reason: text("reason").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_inventory_events_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    unique("management_inventory_events_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    foreignKey({
      name: "management_inventory_events_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "management_inventory_events_type_check",
      sql`${table.type} in ('loss','count','adjustment')`,
    ),
  ],
);

export const managementInventoryEventLines = pgTable(
  "management_inventory_event_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    eventId: uuid("event_id").notNull(),
    locationId: uuid("location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    previousQuantity: numeric("previous_quantity", { precision: 20, scale: 6 }).notNull(),
    quantityDelta: numeric("quantity_delta", { precision: 20, scale: 6 }).notNull(),
    resultingQuantity: numeric("resulting_quantity", { precision: 20, scale: 6 }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "management_inventory_event_lines_event_fk",
      columns: [table.organizationId, table.unitId, table.eventId],
      foreignColumns: [
        managementInventoryEvents.organizationId,
        managementInventoryEvents.unitId,
        managementInventoryEvents.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_inventory_event_lines_balance_fk",
      columns: [table.organizationId, table.unitId, table.locationId, table.inventoryItemId],
      foreignColumns: [
        managementStockBalances.organizationId,
        managementStockBalances.unitId,
        managementStockBalances.locationId,
        managementStockBalances.inventoryItemId,
      ],
    }).onDelete("restrict"),
    check("management_inventory_event_lines_delta_check", sql`${table.quantityDelta} <> 0`),
  ],
);

export const managementInventoryMovements = pgTable(
  "management_inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    locationId: uuid("location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    quantityDelta: numeric("quantity_delta", { precision: 20, scale: 6 }).notNull(),
    unitCostCents: integer("unit_cost_cents"),
    sourceType: varchar("source_type", { length: 48 }).notNull(),
    sourceId: uuid("source_id").notNull(),
    actorIdentityId: uuid("actor_identity_id").references(() => identities.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    index("management_inventory_movements_ledger_idx").on(
      table.organizationId,
      table.unitId,
      table.locationId,
      table.inventoryItemId,
      table.occurredAt,
    ),
    uniqueIndex("management_inventory_movements_source_unique").on(
      table.organizationId,
      table.unitId,
      table.sourceType,
      table.sourceId,
      table.inventoryItemId,
      table.locationId,
    ),
    foreignKey({
      name: "management_inventory_movements_balance_fk",
      columns: [table.organizationId, table.unitId, table.locationId, table.inventoryItemId],
      foreignColumns: [
        managementStockBalances.organizationId,
        managementStockBalances.unitId,
        managementStockBalances.locationId,
        managementStockBalances.inventoryItemId,
      ],
    }).onDelete("restrict"),
    check("management_inventory_movements_delta_check", sql`${table.quantityDelta} <> 0`),
    check(
      "management_inventory_movements_cost_check",
      sql`${table.unitCostCents} is null or ${table.unitCostCents} >= 0`,
    ),
  ],
);

export const managementPurchaseOrders = pgTable(
  "management_purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    status: managementPurchaseStatus("status").notNull().default("draft"),
    totalCents: integer("total_cents").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    expectedAt: timestamp("expected_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByIdentityId: uuid("approved_by_identity_id").references(() => identities.id),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("management_purchase_orders_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_purchase_orders_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    index("management_purchase_orders_status_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
    ),
    foreignKey({
      name: "management_purchase_orders_supplier_fk",
      columns: [table.organizationId, table.unitId, table.supplierId],
      foreignColumns: [
        managementSuppliers.organizationId,
        managementSuppliers.unitId,
        managementSuppliers.id,
      ],
    }).onDelete("restrict"),
    check("management_purchase_orders_total_check", sql`${table.totalCents} >= 0`),
    check("management_purchase_orders_version_check", sql`${table.version} > 0`),
  ],
);

export const managementPurchaseOrderItems = pgTable(
  "management_purchase_order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    receivedQuantity: numeric("received_quantity", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    unitCostCents: integer("unit_cost_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("management_purchase_order_items_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    foreignKey({
      name: "management_purchase_order_items_order_fk",
      columns: [table.organizationId, table.unitId, table.purchaseOrderId],
      foreignColumns: [
        managementPurchaseOrders.organizationId,
        managementPurchaseOrders.unitId,
        managementPurchaseOrders.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_purchase_order_items_inventory_fk",
      columns: [table.organizationId, table.unitId, table.inventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    check("management_purchase_order_items_quantity_check", sql`${table.quantity} > 0`),
    check(
      "management_purchase_order_items_received_check",
      sql`${table.receivedQuantity} >= 0 and ${table.receivedQuantity} <= ${table.quantity}`,
    ),
    check("management_purchase_order_items_cost_check", sql`${table.unitCostCents} >= 0`),
    check("management_purchase_order_items_total_check", sql`${table.totalCents} >= 0`),
  ],
);

export const managementPurchaseReceipts = pgTable(
  "management_purchase_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    totalCents: integer("total_cents").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    receivedByIdentityId: uuid("received_by_identity_id")
      .notNull()
      .references(() => identities.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    unique("management_purchase_receipts_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_purchase_receipts_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_purchase_receipts_order_fk",
      columns: [table.organizationId, table.unitId, table.purchaseOrderId],
      foreignColumns: [
        managementPurchaseOrders.organizationId,
        managementPurchaseOrders.unitId,
        managementPurchaseOrders.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_purchase_receipts_supplier_fk",
      columns: [table.organizationId, table.unitId, table.supplierId],
      foreignColumns: [
        managementSuppliers.organizationId,
        managementSuppliers.unitId,
        managementSuppliers.id,
      ],
    }).onDelete("restrict"),
    check("management_purchase_receipts_total_check", sql`${table.totalCents} > 0`),
  ],
);

export const managementPurchaseReceiptLines = pgTable(
  "management_purchase_receipt_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    receiptId: uuid("receipt_id").notNull(),
    purchaseOrderItemId: uuid("purchase_order_item_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    locationId: uuid("location_id").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
  },
  (table) => [
    foreignKey({
      name: "management_purchase_receipt_lines_receipt_fk",
      columns: [table.organizationId, table.unitId, table.receiptId],
      foreignColumns: [
        managementPurchaseReceipts.organizationId,
        managementPurchaseReceipts.unitId,
        managementPurchaseReceipts.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_purchase_receipt_lines_item_fk",
      columns: [table.organizationId, table.unitId, table.purchaseOrderItemId],
      foreignColumns: [
        managementPurchaseOrderItems.organizationId,
        managementPurchaseOrderItems.unitId,
        managementPurchaseOrderItems.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_purchase_receipt_lines_inventory_fk",
      columns: [table.organizationId, table.unitId, table.inventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_purchase_receipt_lines_location_fk",
      columns: [table.organizationId, table.unitId, table.locationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    check("management_purchase_receipt_lines_quantity_check", sql`${table.quantity} > 0`),
    check("management_purchase_receipt_lines_cost_check", sql`${table.unitCostCents} >= 0`),
  ],
);

export const managementAccountsPayable = pgTable(
  "management_accounts_payable",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    supplierId: uuid("supplier_id"),
    purchaseReceiptId: uuid("purchase_receipt_id"),
    description: varchar("description", { length: 240 }).notNull(),
    status: managementPayableStatus("status").notNull().default("open"),
    amountCents: integer("amount_cents").notNull(),
    paidCents: integer("paid_cents").notNull().default(0),
    competenceDate: date("competence_date").notNull(),
    dueDate: date("due_date").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("management_payables_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("management_payables_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    index("management_payables_due_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.dueDate,
    ),
    foreignKey({
      name: "management_payables_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_payables_supplier_fk",
      columns: [table.organizationId, table.unitId, table.supplierId],
      foreignColumns: [
        managementSuppliers.organizationId,
        managementSuppliers.unitId,
        managementSuppliers.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_payables_receipt_fk",
      columns: [table.organizationId, table.unitId, table.purchaseReceiptId],
      foreignColumns: [
        managementPurchaseReceipts.organizationId,
        managementPurchaseReceipts.unitId,
        managementPurchaseReceipts.id,
      ],
    }).onDelete("restrict"),
    check("management_payables_amount_check", sql`${table.amountCents} > 0`),
    check(
      "management_payables_paid_check",
      sql`${table.paidCents} >= 0 and ${table.paidCents} <= ${table.amountCents}`,
    ),
  ],
);

export const managementPayablePayments = pgTable(
  "management_payable_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    payableId: uuid("payable_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    method: varchar("method", { length: 32 }).notNull(),
    reference: varchar("reference", { length: 160 }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    paidByIdentityId: uuid("paid_by_identity_id")
      .notNull()
      .references(() => identities.id),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_payable_payments_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_payable_payments_payable_fk",
      columns: [table.organizationId, table.unitId, table.payableId],
      foreignColumns: [
        managementAccountsPayable.organizationId,
        managementAccountsPayable.unitId,
        managementAccountsPayable.id,
      ],
    }).onDelete("restrict"),
    check("management_payable_payments_amount_check", sql`${table.amountCents} > 0`),
  ],
);

export const managementAccountsReceivable = pgTable(
  "management_accounts_receivable",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    sourceOrderId: uuid("source_order_id"),
    description: varchar("description", { length: 240 }).notNull(),
    status: managementReceivableStatus("status").notNull().default("open"),
    amountCents: integer("amount_cents").notNull(),
    receivedCents: integer("received_cents").notNull().default(0),
    competenceDate: date("competence_date").notNull(),
    dueDate: date("due_date").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("management_receivables_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_receivables_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_receivables_order_fk",
      columns: [table.organizationId, table.unitId, table.sourceOrderId],
      foreignColumns: [posOrders.organizationId, posOrders.unitId, posOrders.id],
    }).onDelete("restrict"),
    check("management_receivables_amount_check", sql`${table.amountCents} > 0`),
    check(
      "management_receivables_received_check",
      sql`${table.receivedCents} >= 0 and ${table.receivedCents} <= ${table.amountCents}`,
    ),
  ],
);

export const managementReceivableLines = pgTable(
  "management_receivable_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    receivableId: uuid("receivable_id").notNull(),
    productId: uuid("product_id"),
    description: varchar("description", { length: 180 }).notNull(),
    revenueCents: integer("revenue_cents").notNull(),
    costCents: integer("cost_cents"),
  },
  (table) => [
    foreignKey({
      name: "management_receivable_lines_receivable_fk",
      columns: [table.organizationId, table.unitId, table.receivableId],
      foreignColumns: [
        managementAccountsReceivable.organizationId,
        managementAccountsReceivable.unitId,
        managementAccountsReceivable.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_receivable_lines_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("restrict"),
    check("management_receivable_lines_revenue_check", sql`${table.revenueCents} >= 0`),
    check(
      "management_receivable_lines_cost_check",
      sql`${table.costCents} is null or ${table.costCents} >= 0`,
    ),
  ],
);

export const managementCashShifts = pgTable(
  "management_cash_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    operatorIdentityId: uuid("operator_identity_id")
      .notNull()
      .references(() => identities.id),
    status: managementCashShiftStatus("status").notNull().default("open"),
    openingCents: integer("opening_cents").notNull(),
    expectedCents: integer("expected_cents"),
    countedCents: integer("counted_cents"),
    differenceCents: integer("difference_cents"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeReason: text("close_reason"),
    openIdempotencyKey: varchar("open_idempotency_key", { length: 160 }).notNull(),
    closeIdempotencyKey: varchar("close_idempotency_key", { length: 160 }),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("management_cash_shifts_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_cash_shifts_open_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.openIdempotencyKey,
    ),
    uniqueIndex("management_cash_shifts_close_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.closeIdempotencyKey,
    ),
    uniqueIndex("management_cash_shifts_one_open_unique")
      .on(table.organizationId, table.unitId)
      .where(sql`${table.status} = 'open'`),
    foreignKey({
      name: "management_cash_shifts_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check("management_cash_shifts_opening_check", sql`${table.openingCents} >= 0`),
  ],
);

export const managementCashMovements = pgTable(
  "management_cash_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    cashShiftId: uuid("cash_shift_id").notNull(),
    type: varchar("type", { length: 20 }).$type<"supply" | "withdrawal">().notNull(),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_cash_movements_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_cash_movements_shift_fk",
      columns: [table.organizationId, table.unitId, table.cashShiftId],
      foreignColumns: [
        managementCashShifts.organizationId,
        managementCashShifts.unitId,
        managementCashShifts.id,
      ],
    }).onDelete("restrict"),
    check("management_cash_movements_type_check", sql`${table.type} in ('supply','withdrawal')`),
    check("management_cash_movements_amount_check", sql`${table.amountCents} > 0`),
  ],
);

export const managementReceivablePayments = pgTable(
  "management_receivable_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    receivableId: uuid("receivable_id").notNull(),
    cashShiftId: uuid("cash_shift_id"),
    amountCents: integer("amount_cents").notNull(),
    method: varchar("method", { length: 32 }).notNull(),
    reference: varchar("reference", { length: 160 }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    receivedByIdentityId: uuid("received_by_identity_id")
      .notNull()
      .references(() => identities.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_receivable_payments_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_receivable_payments_receivable_fk",
      columns: [table.organizationId, table.unitId, table.receivableId],
      foreignColumns: [
        managementAccountsReceivable.organizationId,
        managementAccountsReceivable.unitId,
        managementAccountsReceivable.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_receivable_payments_shift_fk",
      columns: [table.organizationId, table.unitId, table.cashShiftId],
      foreignColumns: [
        managementCashShifts.organizationId,
        managementCashShifts.unitId,
        managementCashShifts.id,
      ],
    }).onDelete("restrict"),
    check("management_receivable_payments_amount_check", sql`${table.amountCents} > 0`),
  ],
);

export const managementReconciliationImports = pgTable(
  "management_reconciliation_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    source: varchar("source", { length: 32 }).$type<"manual" | "imported">().notNull(),
    fileHash: varchar("file_hash", { length: 64 }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    importedByIdentityId: uuid("imported_by_identity_id")
      .notNull()
      .references(() => identities.id),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_reconciliation_import_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    unique("management_reconciliation_import_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    foreignKey({
      name: "management_reconciliation_import_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "management_reconciliation_import_source_check",
      sql`${table.source} in ('manual','imported')`,
    ),
  ],
);

export const managementReconciliationEntries = pgTable(
  "management_reconciliation_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    importId: uuid("import_id").notNull(),
    paymentDirection: varchar("payment_direction", { length: 16 })
      .$type<"payable" | "receivable">()
      .notNull(),
    paymentId: uuid("payment_id"),
    externalKey: varchar("external_key", { length: 160 }).notNull(),
    grossCents: integer("gross_cents").notNull(),
    feeCents: integer("fee_cents").notNull().default(0),
    netCents: integer("net_cents").notNull(),
    status: varchar("status", { length: 20 })
      .$type<"matched" | "unmatched" | "divergent" | "resolved">()
      .notNull(),
    resolutionNote: text("resolution_note"),
    resolvedByIdentityId: uuid("resolved_by_identity_id").references(() => identities.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_reconciliation_entry_unique").on(
      table.organizationId,
      table.unitId,
      table.importId,
      table.externalKey,
    ),
    foreignKey({
      name: "management_reconciliation_entry_import_fk",
      columns: [table.organizationId, table.unitId, table.importId],
      foreignColumns: [
        managementReconciliationImports.organizationId,
        managementReconciliationImports.unitId,
        managementReconciliationImports.id,
      ],
    }).onDelete("cascade"),
    check(
      "management_reconciliation_entry_direction_check",
      sql`${table.paymentDirection} in ('payable','receivable')`,
    ),
    check(
      "management_reconciliation_entry_amount_check",
      sql`${table.grossCents} > 0 and ${table.feeCents} >= 0 and ${table.netCents} >= 0`,
    ),
  ],
);

export const managementPeople = pgTable(
  "management_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    identityId: uuid("identity_id").references(() => identities.id),
    name: varchar("name", { length: 160 }).notNull(),
    employmentCode: varchar("employment_code", { length: 80 }),
    roleLabel: varchar("role_label", { length: 80 }).notNull(),
    hourlyRateCents: integer("hourly_rate_cents"),
    active: boolean("active").notNull().default(true),
    hiredAt: date("hired_at"),
    ...timestamps,
  },
  (table) => [
    unique("management_people_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("management_people_identity_unique").on(
      table.organizationId,
      table.unitId,
      table.identityId,
    ),
    foreignKey({
      name: "management_people_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "management_people_hourly_rate_check",
      sql`${table.hourlyRateCents} is null or ${table.hourlyRateCents} >= 0`,
    ),
  ],
);

export const managementSchedules = pgTable(
  "management_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    personId: uuid("person_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    breakMinutes: integer("break_minutes").notNull().default(0),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    index("management_schedules_person_time_idx").on(
      table.organizationId,
      table.unitId,
      table.personId,
      table.startsAt,
    ),
    foreignKey({
      name: "management_schedules_person_fk",
      columns: [table.organizationId, table.unitId, table.personId],
      foreignColumns: [
        managementPeople.organizationId,
        managementPeople.unitId,
        managementPeople.id,
      ],
    }).onDelete("cascade"),
    check("management_schedules_window_check", sql`${table.endsAt} > ${table.startsAt}`),
    check("management_schedules_break_check", sql`${table.breakMinutes} >= 0`),
  ],
);

export const managementTimeEntries = pgTable(
  "management_time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    personId: uuid("person_id").notNull(),
    clockedInAt: timestamp("clocked_in_at", { withTimezone: true }).notNull(),
    clockedOutAt: timestamp("clocked_out_at", { withTimezone: true }),
    source: varchar("source", { length: 24 }).notNull().default("manual"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    recordedByIdentityId: uuid("recorded_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_time_entries_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    uniqueIndex("management_time_entries_one_open_unique")
      .on(table.organizationId, table.unitId, table.personId)
      .where(sql`${table.clockedOutAt} is null`),
    foreignKey({
      name: "management_time_entries_person_fk",
      columns: [table.organizationId, table.unitId, table.personId],
      foreignColumns: [
        managementPeople.organizationId,
        managementPeople.unitId,
        managementPeople.id,
      ],
    }).onDelete("cascade"),
    check(
      "management_time_entries_window_check",
      sql`${table.clockedOutAt} is null or ${table.clockedOutAt} > ${table.clockedInAt}`,
    ),
  ],
);

export const managementCommissionRules = pgTable(
  "management_commission_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    basisPoints: integer("basis_points").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("management_commission_rules_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    foreignKey({
      name: "management_commission_rules_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "management_commission_rules_rate_check",
      sql`${table.basisPoints} >= 0 and ${table.basisPoints} <= 10000`,
    ),
  ],
);

export const managementCommissions = pgTable(
  "management_commissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    personId: uuid("person_id").notNull(),
    ruleId: uuid("rule_id"),
    sourceOrderId: uuid("source_order_id"),
    baseCents: integer("base_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: varchar("status", { length: 20 })
      .$type<"pending" | "approved" | "paid" | "canceled">()
      .notNull()
      .default("pending"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_commissions_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_commissions_person_fk",
      columns: [table.organizationId, table.unitId, table.personId],
      foreignColumns: [
        managementPeople.organizationId,
        managementPeople.unitId,
        managementPeople.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_commissions_rule_fk",
      columns: [table.organizationId, table.unitId, table.ruleId],
      foreignColumns: [
        managementCommissionRules.organizationId,
        managementCommissionRules.unitId,
        managementCommissionRules.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_commissions_order_fk",
      columns: [table.organizationId, table.unitId, table.sourceOrderId],
      foreignColumns: [posOrders.organizationId, posOrders.unitId, posOrders.id],
    }).onDelete("restrict"),
    check("management_commissions_base_check", sql`${table.baseCents} >= 0`),
    check("management_commissions_amount_check", sql`${table.amountCents} >= 0`),
  ],
);

export const managementIdempotency = pgTable(
  "management_idempotency",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    operation: varchar("operation", { length: 80 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    response: jsonb("response").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("management_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.operation,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_idempotency_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const managementTenantTables = [
  managementSuppliers,
  managementStockLocations,
  managementInventoryItems,
  managementRecipeVersions,
  managementRecipeComponents,
  managementStockBalances,
  managementInventoryEvents,
  managementInventoryEventLines,
  managementInventoryMovements,
  managementPurchaseOrders,
  managementPurchaseOrderItems,
  managementPurchaseReceipts,
  managementPurchaseReceiptLines,
  managementAccountsPayable,
  managementPayablePayments,
  managementAccountsReceivable,
  managementReceivableLines,
  managementCashShifts,
  managementCashMovements,
  managementReceivablePayments,
  managementReconciliationImports,
  managementReconciliationEntries,
  managementPeople,
  managementSchedules,
  managementTimeEntries,
  managementCommissionRules,
  managementCommissions,
  managementIdempotency,
] as const;

for (const table of managementTenantTables) table.enableRLS();
