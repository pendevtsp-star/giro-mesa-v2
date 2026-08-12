import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { managementInventoryItems, managementStockLocations } from "./management-schema.js";
import { posProducts } from "./operations-schema.js";
import { organizations, units } from "./schema.js";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export type DoseClubPurchaseSnapshot = {
  volumeMlAtPurchase: number;
  doseMlAtPurchase: number;
  totalDoses: number;
  remainingDoses: number;
};

export const doseClubProductMappings = pgTable(
  "doseclub_product_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    externalProductId: varchar("external_product_id", { length: 180 }).notNull(),
    productId: uuid("product_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    stockLocationId: uuid("stock_location_id").notNull(),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("doseclub_product_mappings_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("doseclub_product_mappings_external_unique").on(
      table.organizationId,
      table.unitId,
      table.externalProductId,
    ),
    foreignKey({
      name: "doseclub_product_mappings_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "doseclub_product_mappings_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "doseclub_product_mappings_inventory_item_fk",
      columns: [table.organizationId, table.unitId, table.inventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "doseclub_product_mappings_stock_location_fk",
      columns: [table.organizationId, table.unitId, table.stockLocationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    check("doseclub_product_mappings_version_check", sql`${table.version} > 0`),
  ],
);

export const doseClubStates = pgTable(
  "doseclub_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    externalClubId: varchar("external_club_id", { length: 180 }).notNull(),
    externalOfferId: varchar("external_offer_id", { length: 180 }),
    externalCustomerId: varchar("external_customer_id", { length: 180 }),
    saleType: varchar("sale_type", { length: 24 }).notNull(),
    eligibleProductIds: jsonb("eligible_product_ids").$type<string[]>().notNull(),
    purchaseSnapshot: jsonb("purchase_snapshot").$type<DoseClubPurchaseSnapshot>().notNull(),
    contractVersion: varchar("contract_version", { length: 8 }).notNull(),
    version: integer("version").notNull(),
    remainingDoses: integer("remaining_doses").notNull(),
    reservedDoses: integer("reserved_doses").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique("doseclub_states_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    unique("doseclub_states_external_scope_unique").on(
      table.organizationId,
      table.unitId,
      table.externalClubId,
    ),
    index("doseclub_states_updated_idx").on(table.organizationId, table.unitId, table.updatedAt),
    foreignKey({
      name: "doseclub_states_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check("doseclub_states_sale_type_check", sql`${table.saleType} in ('individual','combo_pool')`),
    check("doseclub_states_contract_check", sql`${table.contractVersion} in ('v1','v2')`),
    check("doseclub_states_version_check", sql`${table.version} >= 0`),
    check(
      "doseclub_states_doses_check",
      sql`${table.remainingDoses} >= 0 and ${table.reservedDoses} >= 0 and ${table.reservedDoses} <= ${table.remainingDoses}`,
    ),
  ],
);

export const doseClubOperations = pgTable(
  "doseclub_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    stateId: uuid("state_id"),
    externalClubId: varchar("external_club_id", { length: 180 }).notNull(),
    operationId: varchar("operation_id", { length: 180 }).notNull(),
    originalOperationId: varchar("original_operation_id", { length: 180 }),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    contractVersion: varchar("contract_version", { length: 8 }).notNull(),
    operation: varchar("operation", { length: 24 }).notNull(),
    version: integer("version").notNull(),
    outcome: varchar("outcome", { length: 24 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("doseclub_operations_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("doseclub_operations_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    uniqueIndex("doseclub_operations_operation_unique").on(
      table.organizationId,
      table.unitId,
      table.operationId,
    ),
    uniqueIndex("doseclub_operations_v2_sequence_unique")
      .on(table.organizationId, table.unitId, table.externalClubId, table.version)
      .where(sql`${table.contractVersion} = 'v2'`),
    uniqueIndex("doseclub_operations_reversal_unique")
      .on(table.organizationId, table.unitId, table.originalOperationId)
      .where(sql`${table.operation} = 'reversal' and ${table.originalOperationId} is not null`),
    index("doseclub_operations_reconcile_idx").on(
      table.organizationId,
      table.unitId,
      table.externalClubId,
      table.createdAt,
    ),
    foreignKey({
      name: "doseclub_operations_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "doseclub_operations_state_fk",
      columns: [table.organizationId, table.unitId, table.stateId],
      foreignColumns: [doseClubStates.organizationId, doseClubStates.unitId, doseClubStates.id],
    }).onDelete("restrict"),
    check("doseclub_operations_contract_check", sql`${table.contractVersion} in ('v1','v2')`),
    check(
      "doseclub_operations_operation_check",
      sql`${table.operation} in ('sale','reservation','consumption','reversal','reconcile')`,
    ),
    check("doseclub_operations_version_check", sql`${table.version} >= 0`),
    check(
      "doseclub_operations_outcome_check",
      sql`${table.outcome} in ('accepted','duplicate','reconciled')`,
    ),
  ],
);

export const doseClubTenantTables = [
  doseClubProductMappings,
  doseClubStates,
  doseClubOperations,
] as const;

for (const table of doseClubTenantTables) table.enableRLS();
