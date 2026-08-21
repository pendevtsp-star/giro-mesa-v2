import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  posOrderItems,
  posOrders,
  posProductionStations,
  posProducts,
} from "./operations-schema.js";
import { identities, organizations, units } from "./schema.js";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const managementPurchaseStatus = pgEnum("management_purchase_status", [
  "draft",
  "rejected",
  "approved",
  "partially_received",
  "received",
  "canceled",
]);
export const managementSupplierInvoiceStatus = pgEnum("management_supplier_invoice_status", [
  "pending",
  "matched",
  "divergent",
  "confirmed",
  "canceled",
  "reversed",
]);
export const managementPurchaseReceiptStatus = pgEnum("management_purchase_receipt_status", [
  "posted",
  "reversed",
]);
export const managementPayableStatus = pgEnum("management_payable_status", [
  "open",
  "partially_paid",
  "paid",
  "canceled",
]);
export const managementTimeTrackingMode = pgEnum("management_time_tracking_mode", [
  "off",
  "all",
  "selected",
]);
export const managementBreakType = pgEnum("management_break_type", ["meal", "temporary"]);
export const managementTimeCorrectionStatus = pgEnum("management_time_correction_status", [
  "pending",
  "approved",
  "rejected",
]);
export const managementReportFrequency = pgEnum("management_report_frequency", [
  "weekly",
  "monthly",
]);
export const managementReportRange = pgEnum("management_report_range", [
  "previous_week",
  "previous_month",
]);
export const managementReportDelivery = pgEnum("management_report_delivery", ["in_app", "email"]);
export const managementReportExportStatus = pgEnum("management_report_export_status", [
  "ready",
  "failed",
]);
export const managementReportExportFormat = pgEnum("management_report_export_format", [
  "csv",
  "pdf",
  "xlsx",
]);
export const managementTimeTrackingClosureStatus = pgEnum(
  "management_time_tracking_closure_status",
  ["closed", "reopened"],
);
export const managementTimeTrackingLowAccuracyPolicy = pgEnum(
  "management_time_tracking_low_accuracy_policy",
  ["block", "flag"],
);
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
export const managementInventoryItemKind = pgEnum("management_inventory_item_kind", [
  "ingredient",
  "prepared",
  "resale",
  "reusable",
  "returnable_container",
]);
export const managementNfeImportStatus = pgEnum("management_nfe_import_status", [
  "staged",
  "reviewing",
  "ready",
  "confirmed",
  "canceled",
  "failed",
]);
export const managementNfeImportLineStatus = pgEnum("management_nfe_import_line_status", [
  "pending",
  "matched",
  "suggested",
  "new",
  "conflict",
  "ignored",
]);
export const managementReturnableCustodyMovementType = pgEnum(
  "management_returnable_custody_movement_type",
  ["issue", "return", "incident", "correction", "supplier_exchange"],
);
export const managementReturnableIncidentType = pgEnum("management_returnable_incident_type", [
  "breakage",
  "loss",
  "suspected_theft",
  "recording_error",
  "other",
]);
export const managementReturnableIncidentStatus = pgEnum("management_returnable_incident_status", [
  "pending",
  "approved",
  "rejected",
]);
export const managementInventoryReviewStatus = pgEnum("management_inventory_review_status", [
  "pending",
  "approved",
  "rejected",
  "posted",
]);
export const managementInventoryTransferStatus = pgEnum("management_inventory_transfer_status", [
  "in_transit",
  "partially_received",
  "received",
  "divergent",
  "canceled",
]);
export const managementStockLocationKind = pgEnum("management_stock_location_kind", [
  "warehouse",
  "cooler",
  "freezer",
  "bar",
  "kitchen",
  "returnables",
  "other",
]);
export const managementReturnableSupplierExchangeStatus = pgEnum(
  "management_returnable_supplier_exchange_status",
  ["in_transit", "received", "canceled"],
);
export const managementInventoryAssetStatus = pgEnum("management_inventory_asset_status", [
  "in_use",
  "maintenance",
  "damaged",
  "retired",
]);
export const managementInventoryAssetCondition = pgEnum("management_inventory_asset_condition", [
  "good",
  "fair",
  "poor",
  "unusable",
]);
export const managementInventoryReservationStatus = pgEnum(
  "management_inventory_reservation_status",
  ["active", "consumed", "released", "canceled"],
);
export const managementProductionBatchStatus = pgEnum("management_production_batch_status", [
  "planned",
  "completed",
  "canceled",
]);
export const managementInterunitTransferStatus = pgEnum("management_interunit_transfer_status", [
  "in_transit",
  "partially_received",
  "received",
  "canceled",
]);

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
    address: text("address"),
    notes: text("notes"),
    normalizedDocument: varchar("normalized_document", { length: 20 }),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("management_suppliers_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    index("management_suppliers_scope_name_idx").on(table.organizationId, table.unitId, table.name),
    uniqueIndex("management_suppliers_document_unique")
      .on(table.organizationId, table.unitId, table.normalizedDocument)
      .where(sql`${table.normalizedDocument} is not null`),
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
    barcode: varchar("barcode", { length: 80 }),
    kind: managementStockLocationKind("kind").notNull().default("other"),
    responsibleIdentityId: uuid("responsible_identity_id").references(() => identities.id),
    requireDistinctTransferReceiver: boolean("require_distinct_transfer_receiver")
      .notNull()
      .default(false),
    transferSlaMinutes: integer("transfer_sla_minutes").notNull().default(30),
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
    uniqueIndex("management_stock_locations_barcode_unique")
      .on(table.organizationId, table.unitId, table.barcode)
      .where(sql`${table.barcode} is not null`),
    foreignKey({
      name: "management_stock_locations_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check("management_stock_locations_sla_check", sql`${table.transferSlaMinutes} > 0`),
  ],
);

export const managementInventoryItems = pgTable(
  "management_inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    productId: uuid("product_id"),
    preferredSupplierId: uuid("preferred_supplier_id"),
    kind: managementInventoryItemKind("kind").notNull().default("ingredient"),
    name: varchar("name", { length: 160 }).notNull(),
    sku: varchar("sku", { length: 80 }),
    barcode: varchar("barcode", { length: 80 }),
    unit: varchar("unit", { length: 20 }).notNull(),
    purchaseUnit: varchar("purchase_unit", { length: 20 }),
    purchaseToStockFactor: numeric("purchase_to_stock_factor", { precision: 16, scale: 3 })
      .notNull()
      .default("1"),
    minimumQuantity: numeric("minimum_quantity", { precision: 16, scale: 3 })
      .notNull()
      .default("0"),
    reorderQuantity: numeric("reorder_quantity", { precision: 16, scale: 3 })
      .notNull()
      .default("0"),
    leadTimeDays: integer("lead_time_days").notNull().default(0),
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
    uniqueIndex("management_inventory_items_barcode_unique").on(
      table.organizationId,
      table.unitId,
      table.barcode,
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
    foreignKey({
      name: "management_inventory_items_supplier_fk",
      columns: [table.organizationId, table.unitId, table.preferredSupplierId],
      foreignColumns: [
        managementSuppliers.organizationId,
        managementSuppliers.unitId,
        managementSuppliers.id,
      ],
    }).onDelete("restrict"),
    check("management_inventory_items_minimum_check", sql`${table.minimumQuantity} >= 0`),
    check(
      "management_inventory_items_kind_product_check",
      sql`(${table.kind} = 'resale' and ${table.productId} is not null) or (${table.kind} <> 'resale' and ${table.productId} is null)`,
    ),
    check(
      "management_inventory_items_purchase_factor_check",
      sql`${table.purchaseToStockFactor} > 0`,
    ),
    check("management_inventory_items_reorder_check", sql`${table.reorderQuantity} >= 0`),
    check("management_inventory_items_lead_time_check", sql`${table.leadTimeDays} >= 0`),
  ],
);

export const managementStockLocationItemSettings = pgTable(
  "management_stock_location_item_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    locationId: uuid("location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    minimumQuantity: numeric("minimum_quantity", { precision: 16, scale: 3 })
      .notNull()
      .default("0"),
    targetQuantity: numeric("target_quantity", { precision: 16, scale: 3 }).notNull().default("0"),
    transferUnitLabel: varchar("transfer_unit_label", { length: 40 }),
    unitsPerTransferUnit: numeric("units_per_transfer_unit", { precision: 16, scale: 3 })
      .notNull()
      .default("1"),
    ...timestamps,
  },
  (table) => [
    unique("management_stock_location_item_settings_unique").on(
      table.organizationId,
      table.unitId,
      table.locationId,
      table.inventoryItemId,
    ),
    foreignKey({
      name: "management_stock_location_item_settings_location_fk",
      columns: [table.organizationId, table.unitId, table.locationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_stock_location_item_settings_item_fk",
      columns: [table.organizationId, table.unitId, table.inventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("cascade"),
    check(
      "management_stock_location_item_settings_values_check",
      sql`${table.minimumQuantity} >= 0 and ${table.targetQuantity} >= ${table.minimumQuantity} and ${table.unitsPerTransferUnit} > 0`,
    ),
  ],
);

export const managementProductReturnables = pgTable(
  "management_product_returnables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    productId: uuid("product_id").notNull(),
    containerInventoryItemId: uuid("container_inventory_item_id").notNull(),
    quantityPerUnit: numeric("quantity_per_unit", { precision: 16, scale: 3 })
      .notNull()
      .default("1"),
    depositCents: integer("deposit_cents").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("management_product_returnables_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_product_returnables_product_container_unique").on(
      table.organizationId,
      table.unitId,
      table.productId,
      table.containerInventoryItemId,
    ),
    foreignKey({
      name: "management_product_returnables_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_product_returnables_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_product_returnables_container_fk",
      columns: [table.organizationId, table.unitId, table.containerInventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    check("management_product_returnables_quantity_check", sql`${table.quantityPerUnit} > 0`),
    check("management_product_returnables_deposit_check", sql`${table.depositCents} >= 0`),
  ],
);

export const managementInventoryIssueRoutes = pgTable(
  "management_inventory_issue_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    productId: uuid("product_id").notNull(),
    stationId: uuid("station_id"),
    locationId: uuid("location_id").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("management_inventory_issue_routes_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_inventory_issue_routes_default_unique")
      .on(table.organizationId, table.unitId, table.productId)
      .where(sql`${table.stationId} is null`),
    uniqueIndex("management_inventory_issue_routes_station_unique")
      .on(table.organizationId, table.unitId, table.productId, table.stationId)
      .where(sql`${table.stationId} is not null`),
    foreignKey({
      name: "management_inventory_issue_routes_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_inventory_issue_routes_station_fk",
      columns: [table.organizationId, table.unitId, table.stationId],
      foreignColumns: [
        posProductionStations.organizationId,
        posProductionStations.unitId,
        posProductionStations.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_inventory_issue_routes_location_fk",
      columns: [table.organizationId, table.unitId, table.locationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
  ],
);

export const managementInventorySupplierAliases = pgTable(
  "management_inventory_supplier_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    supplierProductCode: varchar("supplier_product_code", { length: 120 }).notNull(),
    supplierBarcode: varchar("supplier_barcode", { length: 80 }),
    supplierDescription: varchar("supplier_description", { length: 240 }),
    purchaseUnit: varchar("purchase_unit", { length: 20 }),
    purchaseToStockFactor: numeric("purchase_to_stock_factor", { precision: 16, scale: 3 })
      .notNull()
      .default("1"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("management_inventory_supplier_aliases_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_inventory_supplier_aliases_code_unique").on(
      table.organizationId,
      table.unitId,
      table.supplierId,
      table.supplierProductCode,
    ),
    uniqueIndex("management_inventory_supplier_aliases_barcode_unique")
      .on(table.organizationId, table.unitId, table.supplierId, table.supplierBarcode)
      .where(sql`${table.supplierBarcode} is not null`),
    index("management_inventory_supplier_aliases_item_idx").on(
      table.organizationId,
      table.unitId,
      table.inventoryItemId,
    ),
    foreignKey({
      name: "management_inventory_supplier_aliases_supplier_fk",
      columns: [table.organizationId, table.unitId, table.supplierId],
      foreignColumns: [
        managementSuppliers.organizationId,
        managementSuppliers.unitId,
        managementSuppliers.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_inventory_supplier_aliases_item_fk",
      columns: [table.organizationId, table.unitId, table.inventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    check(
      "management_inventory_supplier_aliases_factor_check",
      sql`${table.purchaseToStockFactor} > 0`,
    ),
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
    check(
      "management_recipe_component_loss_check",
      sql`${table.lossBasisPoints} between 0 and 9999`,
    ),
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
    quantity: numeric("quantity", { precision: 16, scale: 3 }).notNull().default("0"),
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

export const managementInventoryLots = pgTable(
  "management_inventory_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    locationId: uuid("location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    batchCode: varchar("batch_code", { length: 80 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    quantity: numeric("quantity", { precision: 16, scale: 3 }).notNull().default("0"),
    unitCostCents: integer("unit_cost_cents"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("management_inventory_lots_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_inventory_lots_batch_unique").on(
      table.organizationId,
      table.unitId,
      table.locationId,
      table.inventoryItemId,
      table.batchCode,
    ),
    index("management_inventory_lots_expiry_idx").on(
      table.organizationId,
      table.unitId,
      table.expiresAt,
    ),
    foreignKey({
      name: "management_inventory_lots_location_fk",
      columns: [table.organizationId, table.unitId, table.locationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_inventory_lots_item_fk",
      columns: [table.organizationId, table.unitId, table.inventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    check("management_inventory_lots_quantity_check", sql`${table.quantity} >= 0`),
    check(
      "management_inventory_lots_cost_check",
      sql`${table.unitCostCents} is null or ${table.unitCostCents} >= 0`,
    ),
  ],
);

export const managementInventoryAssets = pgTable(
  "management_inventory_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    locationId: uuid("location_id").notNull(),
    assetTag: varchar("asset_tag", { length: 80 }).notNull(),
    status: managementInventoryAssetStatus("status").notNull().default("in_use"),
    condition: managementInventoryAssetCondition("condition").notNull().default("good"),
    responsibleIdentityId: uuid("responsible_identity_id").references(() => identities.id),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }),
    lastMaintenanceAt: timestamp("last_maintenance_at", { withTimezone: true }),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("management_inventory_assets_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_inventory_assets_tag_unique").on(
      table.organizationId,
      table.unitId,
      table.assetTag,
    ),
    index("management_inventory_assets_item_status_idx").on(
      table.organizationId,
      table.unitId,
      table.inventoryItemId,
      table.status,
    ),
    foreignKey({
      name: "management_inventory_assets_item_fk",
      columns: [table.organizationId, table.unitId, table.inventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_inventory_assets_location_fk",
      columns: [table.organizationId, table.unitId, table.locationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    check("management_inventory_assets_version_check", sql`${table.version} > 0`),
  ],
);

export const managementInventoryEvents = pgTable(
  "management_inventory_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    type: varchar("type", { length: 24 })
      .$type<"loss" | "count" | "adjustment" | "transfer">()
      .notNull(),
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
      sql`${table.type} in ('loss','count','adjustment','transfer')`,
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
    lotId: uuid("lot_id"),
    previousQuantity: numeric("previous_quantity", { precision: 16, scale: 3 }).notNull(),
    quantityDelta: numeric("quantity_delta", { precision: 16, scale: 3 }).notNull(),
    resultingQuantity: numeric("resulting_quantity", { precision: 16, scale: 3 }).notNull(),
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
    foreignKey({
      name: "management_inventory_event_lines_lot_fk",
      columns: [table.organizationId, table.unitId, table.lotId],
      foreignColumns: [
        managementInventoryLots.organizationId,
        managementInventoryLots.unitId,
        managementInventoryLots.id,
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
    lotId: uuid("lot_id"),
    type: varchar("type", { length: 32 }).notNull(),
    quantityDelta: numeric("quantity_delta", { precision: 16, scale: 3 }).notNull(),
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
    foreignKey({
      name: "management_inventory_movements_lot_fk",
      columns: [table.organizationId, table.unitId, table.lotId],
      foreignColumns: [
        managementInventoryLots.organizationId,
        managementInventoryLots.unitId,
        managementInventoryLots.id,
      ],
    }).onDelete("restrict"),
    check("management_inventory_movements_delta_check", sql`${table.quantityDelta} <> 0`),
    check(
      "management_inventory_movements_cost_check",
      sql`${table.unitCostCents} is null or ${table.unitCostCents} >= 0`,
    ),
  ],
);

export const managementInventoryReviewRequests = pgTable(
  "management_inventory_review_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    type: varchar("type", { length: 24 }).$type<"loss" | "count" | "adjustment">().notNull(),
    reason: text("reason").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    riskSummary: jsonb("risk_summary").$type<Record<string, unknown>>().notNull(),
    status: managementInventoryReviewStatus("status").notNull().default("pending"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestedByIdentityId: uuid("requested_by_identity_id")
      .notNull()
      .references(() => identities.id),
    reviewedByIdentityId: uuid("reviewed_by_identity_id").references(() => identities.id),
    reviewReason: text("review_reason"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    postedEventId: uuid("posted_event_id"),
    ...timestamps,
  },
  (table) => [
    unique("management_inventory_review_requests_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_inventory_review_requests_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    index("management_inventory_review_requests_status_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.createdAt,
    ),
    foreignKey({
      name: "management_inventory_review_requests_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_inventory_review_requests_event_fk",
      columns: [table.organizationId, table.unitId, table.postedEventId],
      foreignColumns: [
        managementInventoryEvents.organizationId,
        managementInventoryEvents.unitId,
        managementInventoryEvents.id,
      ],
    }).onDelete("restrict"),
    check(
      "management_inventory_review_requests_type_check",
      sql`${table.type} in ('loss','count','adjustment')`,
    ),
    check(
      "management_inventory_review_requests_review_check",
      sql`(${table.status} = 'pending' and ${table.reviewedByIdentityId} is null and ${table.reviewedAt} is null) or (${table.status} in ('approved','rejected','posted') and ${table.reviewedByIdentityId} is not null and ${table.reviewedAt} is not null)`,
    ),
  ],
);

export const managementInventoryTransfers = pgTable(
  "management_inventory_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    batchId: uuid("batch_id").notNull().defaultRandom(),
    lineNumber: integer("line_number").notNull().default(1),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    sourceLocationId: uuid("source_location_id").notNull(),
    destinationLocationId: uuid("destination_location_id").notNull(),
    sourceLotId: uuid("source_lot_id"),
    destinationLotId: uuid("destination_lot_id"),
    eventId: uuid("event_id").notNull(),
    quantity: numeric("quantity", { precision: 16, scale: 3 }).notNull(),
    quantityReceived: numeric("quantity_received", { precision: 16, scale: 3 })
      .notNull()
      .default("0"),
    quantityDivergent: numeric("quantity_divergent", { precision: 16, scale: 3 })
      .notNull()
      .default("0"),
    reason: text("reason").notNull(),
    status: managementInventoryTransferStatus("status").notNull().default("in_transit"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    sentByIdentityId: uuid("sent_by_identity_id")
      .notNull()
      .references(() => identities.id),
    receivedByIdentityId: uuid("received_by_identity_id").references(() => identities.id),
    canceledByIdentityId: uuid("canceled_by_identity_id").references(() => identities.id),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 minutes'`),
    resolutionNote: text("resolution_note"),
    ...timestamps,
  },
  (table) => [
    unique("management_inventory_transfers_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_inventory_transfers_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    unique("management_inventory_transfers_batch_line_unique").on(
      table.organizationId,
      table.unitId,
      table.batchId,
      table.lineNumber,
    ),
    index("management_inventory_transfers_status_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.createdAt,
    ),
    foreignKey({
      name: "management_inventory_transfers_item_fk",
      columns: [table.organizationId, table.unitId, table.inventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_inventory_transfers_source_fk",
      columns: [table.organizationId, table.unitId, table.sourceLocationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_inventory_transfers_destination_fk",
      columns: [table.organizationId, table.unitId, table.destinationLocationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_inventory_transfers_source_lot_fk",
      columns: [table.organizationId, table.unitId, table.sourceLotId],
      foreignColumns: [
        managementInventoryLots.organizationId,
        managementInventoryLots.unitId,
        managementInventoryLots.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_inventory_transfers_destination_lot_fk",
      columns: [table.organizationId, table.unitId, table.destinationLotId],
      foreignColumns: [
        managementInventoryLots.organizationId,
        managementInventoryLots.unitId,
        managementInventoryLots.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_inventory_transfers_event_fk",
      columns: [table.organizationId, table.unitId, table.eventId],
      foreignColumns: [
        managementInventoryEvents.organizationId,
        managementInventoryEvents.unitId,
        managementInventoryEvents.id,
      ],
    }).onDelete("restrict"),
    check(
      "management_inventory_transfers_quantity_check",
      sql`${table.quantity} > 0 and ${table.quantityReceived} >= 0 and ${table.quantityDivergent} >= 0 and ${table.quantityReceived} + ${table.quantityDivergent} <= ${table.quantity}`,
    ),
    check("management_inventory_transfers_line_number_check", sql`${table.lineNumber} > 0`),
    check(
      "management_inventory_transfers_locations_check",
      sql`${table.sourceLocationId} <> ${table.destinationLocationId}`,
    ),
    check(
      "management_inventory_transfers_resolution_check",
      sql`(${table.status} in ('in_transit', 'partially_received') and ${table.canceledAt} is null) or (${table.status} in ('received', 'divergent') and ${table.receivedAt} is not null and ${table.receivedByIdentityId} is not null and ${table.canceledAt} is null) or (${table.status} = 'canceled' and ${table.canceledAt} is not null and ${table.canceledByIdentityId} is not null)`,
    ),
  ],
);

export const managementInventoryTransferReceipts = pgTable(
  "management_inventory_transfer_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    transferId: uuid("transfer_id").notNull(),
    quantityReceived: numeric("quantity_received", { precision: 16, scale: 3 })
      .notNull()
      .default("0"),
    quantityDivergent: numeric("quantity_divergent", { precision: 16, scale: 3 })
      .notNull()
      .default("0"),
    divergenceReason: text("divergence_reason"),
    evidenceMetadata: jsonb("evidence_metadata")
      .$type<{ urls: string[] }>()
      .notNull()
      .default({ urls: [] }),
    note: text("note").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    receivedByIdentityId: uuid("received_by_identity_id")
      .notNull()
      .references(() => identities.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("management_inventory_transfer_receipts_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_inventory_transfer_receipts_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    index("management_inventory_transfer_receipts_transfer_idx").on(
      table.organizationId,
      table.unitId,
      table.transferId,
      table.receivedAt,
    ),
    foreignKey({
      name: "management_inventory_transfer_receipts_transfer_fk",
      columns: [table.organizationId, table.unitId, table.transferId],
      foreignColumns: [
        managementInventoryTransfers.organizationId,
        managementInventoryTransfers.unitId,
        managementInventoryTransfers.id,
      ],
    }).onDelete("restrict"),
    check(
      "management_inventory_transfer_receipts_quantity_check",
      sql`${table.quantityReceived} >= 0 and ${table.quantityDivergent} >= 0 and ${table.quantityReceived} + ${table.quantityDivergent} > 0`,
    ),
    check(
      "management_inventory_transfer_receipts_divergence_check",
      sql`${table.quantityDivergent} = 0 or length(trim(${table.divergenceReason})) >= 3`,
    ),
  ],
);

export const managementInventoryReservations = pgTable(
  "management_inventory_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    locationId: uuid("location_id").notNull(),
    quantity: numeric("quantity", { precision: 16, scale: 3 }).notNull(),
    status: managementInventoryReservationStatus("status").notNull().default("active"),
    sourceType: varchar("source_type", { length: 32 }).notNull(),
    sourceId: varchar("source_id", { length: 160 }).notNull(),
    reason: text("reason").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    resolvedByIdentityId: uuid("resolved_by_identity_id").references(() => identities.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("management_inventory_reservations_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_inventory_reservations_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    uniqueIndex("management_inventory_reservations_source_unique").on(
      table.organizationId,
      table.unitId,
      table.sourceType,
      table.sourceId,
      table.inventoryItemId,
      table.locationId,
    ),
    index("management_inventory_reservations_active_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.expiresAt,
    ),
    foreignKey({
      name: "management_inventory_reservations_balance_fk",
      columns: [table.organizationId, table.unitId, table.locationId, table.inventoryItemId],
      foreignColumns: [
        managementStockBalances.organizationId,
        managementStockBalances.unitId,
        managementStockBalances.locationId,
        managementStockBalances.inventoryItemId,
      ],
    }).onDelete("restrict"),
    check("management_inventory_reservations_quantity_check", sql`${table.quantity} > 0`),
    check(
      "management_inventory_reservations_resolution_check",
      sql`(${table.status} = 'active' and ${table.resolvedAt} is null and ${table.resolvedByIdentityId} is null) or (${table.status} <> 'active' and ${table.resolvedAt} is not null and ${table.resolvedByIdentityId} is not null)`,
    ),
  ],
);

export const managementInventoryCountSchedules = pgTable(
  "management_inventory_count_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    locationId: uuid("location_id").notNull(),
    classification: varchar("classification", { length: 1 }).$type<"A" | "B" | "C">().notNull(),
    riskScore: integer("risk_score").notNull(),
    frequencyDays: integer("frequency_days").notNull(),
    nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull(),
    lastCountedAt: timestamp("last_counted_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    updatedByIdentityId: uuid("updated_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    unique("management_inventory_count_schedules_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_inventory_count_schedules_item_unique").on(
      table.organizationId,
      table.unitId,
      table.inventoryItemId,
      table.locationId,
    ),
    index("management_inventory_count_schedules_due_idx").on(
      table.organizationId,
      table.unitId,
      table.active,
      table.nextDueAt,
    ),
    foreignKey({
      name: "management_inventory_count_schedules_balance_fk",
      columns: [table.organizationId, table.unitId, table.locationId, table.inventoryItemId],
      foreignColumns: [
        managementStockBalances.organizationId,
        managementStockBalances.unitId,
        managementStockBalances.locationId,
        managementStockBalances.inventoryItemId,
      ],
    }).onDelete("cascade"),
    check(
      "management_inventory_count_schedules_classification_check",
      sql`${table.classification} in ('A','B','C')`,
    ),
    check(
      "management_inventory_count_schedules_values_check",
      sql`${table.riskScore} between 0 and 100 and ${table.frequencyDays} > 0`,
    ),
  ],
);

export const managementProductionBatches = pgTable(
  "management_production_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    outputInventoryItemId: uuid("output_inventory_item_id").notNull(),
    outputLocationId: uuid("output_location_id").notNull(),
    outputLotId: uuid("output_lot_id"),
    batchCode: varchar("batch_code", { length: 80 }).notNull(),
    plannedQuantity: numeric("planned_quantity", { precision: 16, scale: 3 }).notNull(),
    actualQuantity: numeric("actual_quantity", { precision: 16, scale: 3 }),
    status: managementProductionBatchStatus("status").notNull().default("planned"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    notes: text("notes"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    completedByIdentityId: uuid("completed_by_identity_id").references(() => identities.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledByIdentityId: uuid("canceled_by_identity_id").references(() => identities.id),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("management_production_batches_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_production_batches_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    uniqueIndex("management_production_batches_code_unique").on(
      table.organizationId,
      table.unitId,
      table.batchCode,
    ),
    index("management_production_batches_status_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.createdAt,
    ),
    foreignKey({
      name: "management_production_batches_output_item_fk",
      columns: [table.organizationId, table.unitId, table.outputInventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_production_batches_output_location_fk",
      columns: [table.organizationId, table.unitId, table.outputLocationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_production_batches_output_lot_fk",
      columns: [table.organizationId, table.unitId, table.outputLotId],
      foreignColumns: [
        managementInventoryLots.organizationId,
        managementInventoryLots.unitId,
        managementInventoryLots.id,
      ],
    }).onDelete("restrict"),
    check("management_production_batches_planned_check", sql`${table.plannedQuantity} > 0`),
    check(
      "management_production_batches_actual_check",
      sql`${table.actualQuantity} is null or ${table.actualQuantity} > 0`,
    ),
    check(
      "management_production_batches_resolution_check",
      sql`(${table.status} = 'planned' and ${table.actualQuantity} is null and ${table.completedAt} is null and ${table.canceledAt} is null) or (${table.status} = 'completed' and ${table.actualQuantity} is not null and ${table.completedAt} is not null and ${table.completedByIdentityId} is not null and ${table.canceledAt} is null) or (${table.status} = 'canceled' and ${table.canceledAt} is not null and ${table.canceledByIdentityId} is not null and ${table.completedAt} is null)`,
    ),
  ],
);

export const managementProductionBatchInputs = pgTable(
  "management_production_batch_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    productionBatchId: uuid("production_batch_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    locationId: uuid("location_id").notNull(),
    lotId: uuid("lot_id"),
    plannedQuantity: numeric("planned_quantity", { precision: 16, scale: 3 }).notNull(),
    actualQuantity: numeric("actual_quantity", { precision: 16, scale: 3 }),
    unitCostCents: integer("unit_cost_cents"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "management_production_batch_inputs_batch_fk",
      columns: [table.organizationId, table.unitId, table.productionBatchId],
      foreignColumns: [
        managementProductionBatches.organizationId,
        managementProductionBatches.unitId,
        managementProductionBatches.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_production_batch_inputs_balance_fk",
      columns: [table.organizationId, table.unitId, table.locationId, table.inventoryItemId],
      foreignColumns: [
        managementStockBalances.organizationId,
        managementStockBalances.unitId,
        managementStockBalances.locationId,
        managementStockBalances.inventoryItemId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_production_batch_inputs_lot_fk",
      columns: [table.organizationId, table.unitId, table.lotId],
      foreignColumns: [
        managementInventoryLots.organizationId,
        managementInventoryLots.unitId,
        managementInventoryLots.id,
      ],
    }).onDelete("restrict"),
    check("management_production_batch_inputs_planned_check", sql`${table.plannedQuantity} > 0`),
    check(
      "management_production_batch_inputs_actual_check",
      sql`${table.actualQuantity} is null or ${table.actualQuantity} > 0`,
    ),
    check(
      "management_production_batch_inputs_cost_check",
      sql`${table.unitCostCents} is null or ${table.unitCostCents} >= 0`,
    ),
  ],
);

export const managementInterunitTransfers = pgTable(
  "management_interunit_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    sourceUnitId: uuid("source_unit_id").notNull(),
    destinationUnitId: uuid("destination_unit_id").notNull(),
    status: managementInterunitTransferStatus("status").notNull().default("in_transit"),
    reason: text("reason").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    sentByIdentityId: uuid("sent_by_identity_id")
      .notNull()
      .references(() => identities.id),
    lastReceivedByIdentityId: uuid("last_received_by_identity_id").references(() => identities.id),
    canceledByIdentityId: uuid("canceled_by_identity_id").references(() => identities.id),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    ...timestamps,
  },
  (table) => [
    unique("management_interunit_transfers_scope_id_unique").on(
      table.organizationId,
      table.sourceUnitId,
      table.id,
    ),
    uniqueIndex("management_interunit_transfers_idempotency_unique").on(
      table.organizationId,
      table.sourceUnitId,
      table.idempotencyKey,
    ),
    index("management_interunit_transfers_source_idx").on(
      table.organizationId,
      table.sourceUnitId,
      table.status,
      table.sentAt,
    ),
    index("management_interunit_transfers_destination_idx").on(
      table.organizationId,
      table.destinationUnitId,
      table.status,
      table.sentAt,
    ),
    foreignKey({
      name: "management_interunit_transfers_source_unit_fk",
      columns: [table.organizationId, table.sourceUnitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_interunit_transfers_destination_unit_fk",
      columns: [table.organizationId, table.destinationUnitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    check(
      "management_interunit_transfers_units_check",
      sql`${table.sourceUnitId} <> ${table.destinationUnitId}`,
    ),
    check(
      "management_interunit_transfers_resolution_check",
      sql`(${table.status} in ('in_transit','partially_received') and ${table.canceledAt} is null) or (${table.status} = 'received' and ${table.lastReceivedAt} is not null and ${table.lastReceivedByIdentityId} is not null and ${table.canceledAt} is null) or (${table.status} = 'canceled' and ${table.canceledAt} is not null and ${table.canceledByIdentityId} is not null and ${table.cancelReason} is not null)`,
    ),
  ],
);

export const managementInterunitTransferLines = pgTable(
  "management_interunit_transfer_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    sourceUnitId: uuid("source_unit_id").notNull(),
    destinationUnitId: uuid("destination_unit_id").notNull(),
    transferId: uuid("transfer_id").notNull(),
    sourceInventoryItemId: uuid("source_inventory_item_id").notNull(),
    destinationInventoryItemId: uuid("destination_inventory_item_id").notNull(),
    sourceLocationId: uuid("source_location_id").notNull(),
    destinationLocationId: uuid("destination_location_id").notNull(),
    sourceLotId: uuid("source_lot_id"),
    quantitySent: numeric("quantity_sent", { precision: 16, scale: 3 }).notNull(),
    quantityReceived: numeric("quantity_received", { precision: 16, scale: 3 })
      .notNull()
      .default("0"),
    unitCostCents: integer("unit_cost_cents"),
    batchCode: varchar("batch_code", { length: 80 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("management_interunit_transfer_lines_scope_id_unique").on(
      table.organizationId,
      table.sourceUnitId,
      table.id,
    ),
    foreignKey({
      name: "management_interunit_transfer_lines_transfer_fk",
      columns: [table.organizationId, table.sourceUnitId, table.transferId],
      foreignColumns: [
        managementInterunitTransfers.organizationId,
        managementInterunitTransfers.sourceUnitId,
        managementInterunitTransfers.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_interunit_transfer_lines_source_balance_fk",
      columns: [
        table.organizationId,
        table.sourceUnitId,
        table.sourceLocationId,
        table.sourceInventoryItemId,
      ],
      foreignColumns: [
        managementStockBalances.organizationId,
        managementStockBalances.unitId,
        managementStockBalances.locationId,
        managementStockBalances.inventoryItemId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_interunit_transfer_lines_destination_item_fk",
      columns: [table.organizationId, table.destinationUnitId, table.destinationInventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_interunit_transfer_lines_destination_location_fk",
      columns: [table.organizationId, table.destinationUnitId, table.destinationLocationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_interunit_transfer_lines_source_lot_fk",
      columns: [table.organizationId, table.sourceUnitId, table.sourceLotId],
      foreignColumns: [
        managementInventoryLots.organizationId,
        managementInventoryLots.unitId,
        managementInventoryLots.id,
      ],
    }).onDelete("restrict"),
    check(
      "management_interunit_transfer_lines_quantities_check",
      sql`${table.quantitySent} > 0 and ${table.quantityReceived} >= 0 and ${table.quantityReceived} <= ${table.quantitySent}`,
    ),
    check(
      "management_interunit_transfer_lines_cost_check",
      sql`${table.unitCostCents} is null or ${table.unitCostCents} >= 0`,
    ),
  ],
);

export const managementInterunitTransferReceipts = pgTable(
  "management_interunit_transfer_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    sourceUnitId: uuid("source_unit_id").notNull(),
    transferId: uuid("transfer_id").notNull(),
    lines: jsonb("lines").$type<Array<{ lineId: string; quantity: string }>>().notNull(),
    note: text("note").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    receivedByIdentityId: uuid("received_by_identity_id")
      .notNull()
      .references(() => identities.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("management_interunit_transfer_receipts_idempotency_unique").on(
      table.organizationId,
      table.sourceUnitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_interunit_transfer_receipts_transfer_fk",
      columns: [table.organizationId, table.sourceUnitId, table.transferId],
      foreignColumns: [
        managementInterunitTransfers.organizationId,
        managementInterunitTransfers.sourceUnitId,
        managementInterunitTransfers.id,
      ],
    }).onDelete("cascade"),
  ],
);

export const managementInventoryClosings = pgTable(
  "management_inventory_closings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    locationId: uuid("location_id"),
    shiftReference: varchar("shift_reference", { length: 80 }),
    period: date("period", { mode: "string" }).notNull(),
    totalValueCents: integer("total_value_cents").notNull(),
    totalReservedValueCents: integer("total_reserved_value_cents").notNull(),
    lineCount: integer("line_count").notNull(),
    notes: text("notes"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    closedByIdentityId: uuid("closed_by_identity_id")
      .notNull()
      .references(() => identities.id),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("management_inventory_closings_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_inventory_closings_period_unique").on(
      table.organizationId,
      table.unitId,
      table.period,
      sql`coalesce(${table.locationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${table.shiftReference}, '')`,
    ),
    uniqueIndex("management_inventory_closings_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_inventory_closings_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_inventory_closings_location_fk",
      columns: [table.organizationId, table.unitId, table.locationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    check(
      "management_inventory_closings_values_check",
      sql`${table.totalReservedValueCents} >= 0 and ${table.lineCount} >= 0`,
    ),
  ],
);

export const managementInventoryClosingLines = pgTable(
  "management_inventory_closing_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    closingId: uuid("closing_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    locationId: uuid("location_id").notNull(),
    quantity: numeric("quantity", { precision: 16, scale: 3 }).notNull(),
    reservedQuantity: numeric("reserved_quantity", { precision: 16, scale: 3 })
      .notNull()
      .default("0"),
    averageCostCents: integer("average_cost_cents"),
    valueCents: integer("value_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("management_inventory_closing_lines_unique").on(
      table.closingId,
      table.inventoryItemId,
      table.locationId,
    ),
    foreignKey({
      name: "management_inventory_closing_lines_closing_fk",
      columns: [table.organizationId, table.unitId, table.closingId],
      foreignColumns: [
        managementInventoryClosings.organizationId,
        managementInventoryClosings.unitId,
        managementInventoryClosings.id,
      ],
    }).onDelete("restrict"),
    check(
      "management_inventory_closing_lines_values_check",
      sql`${table.reservedQuantity} >= 0 and (${table.averageCostCents} is null or ${table.averageCostCents} >= 0)`,
    ),
  ],
);

export const managementReturnableCustodyMovements = pgTable(
  "management_returnable_custody_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    containerInventoryItemId: uuid("container_inventory_item_id").notNull(),
    locationId: uuid("location_id"),
    type: managementReturnableCustodyMovementType("type").notNull(),
    quantityDelta: numeric("quantity_delta", { precision: 16, scale: 3 }).notNull(),
    orderId: uuid("order_id"),
    orderItemId: uuid("order_item_id"),
    sourceType: varchar("source_type", { length: 48 }).notNull(),
    sourceId: uuid("source_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("management_returnable_custody_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_returnable_custody_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    uniqueIndex("management_returnable_custody_source_unique").on(
      table.organizationId,
      table.unitId,
      table.sourceType,
      table.sourceId,
      table.containerInventoryItemId,
    ),
    index("management_returnable_custody_ledger_idx").on(
      table.organizationId,
      table.unitId,
      table.containerInventoryItemId,
      table.occurredAt,
    ),
    foreignKey({
      name: "management_returnable_custody_container_fk",
      columns: [table.organizationId, table.unitId, table.containerInventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_returnable_custody_location_fk",
      columns: [table.organizationId, table.unitId, table.locationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_returnable_custody_order_fk",
      columns: [table.organizationId, table.unitId, table.orderId],
      foreignColumns: [posOrders.organizationId, posOrders.unitId, posOrders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_returnable_custody_order_item_fk",
      columns: [table.organizationId, table.unitId, table.orderItemId],
      foreignColumns: [posOrderItems.organizationId, posOrderItems.unitId, posOrderItems.id],
    }).onDelete("restrict"),
    check("management_returnable_custody_delta_check", sql`${table.quantityDelta} <> 0`),
    check(
      "management_returnable_custody_direction_check",
      sql`(${table.type} = 'issue' and ${table.quantityDelta} > 0) or (${table.type} in ('return', 'incident', 'supplier_exchange') and ${table.quantityDelta} < 0) or (${table.type} = 'correction' and ${table.quantityDelta} <> 0)`,
    ),
  ],
);

export const managementReturnableIncidents = pgTable(
  "management_returnable_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    containerInventoryItemId: uuid("container_inventory_item_id").notNull(),
    locationId: uuid("location_id"),
    custodyMovementId: uuid("custody_movement_id"),
    type: managementReturnableIncidentType("type").notNull(),
    status: managementReturnableIncidentStatus("status").notNull().default("pending"),
    quantity: numeric("quantity", { precision: 16, scale: 3 }).notNull(),
    estimatedCostCents: integer("estimated_cost_cents"),
    notes: text("notes").notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    approverIdentityId: uuid("approver_identity_id").references(() => identities.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewReason: text("review_reason"),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    evidenceMetadata: jsonb("evidence_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    unique("management_returnable_incidents_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    index("management_returnable_incidents_movement_idx").on(
      table.organizationId,
      table.unitId,
      table.custodyMovementId,
    ),
    index("management_returnable_incidents_status_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.occurredAt,
    ),
    foreignKey({
      name: "management_returnable_incidents_container_fk",
      columns: [table.organizationId, table.unitId, table.containerInventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_returnable_incidents_location_fk",
      columns: [table.organizationId, table.unitId, table.locationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_returnable_incidents_movement_fk",
      columns: [table.organizationId, table.unitId, table.custodyMovementId],
      foreignColumns: [
        managementReturnableCustodyMovements.organizationId,
        managementReturnableCustodyMovements.unitId,
        managementReturnableCustodyMovements.id,
      ],
    }).onDelete("restrict"),
    check("management_returnable_incidents_quantity_check", sql`${table.quantity} > 0`),
    check(
      "management_returnable_incidents_cost_check",
      sql`${table.estimatedCostCents} is null or ${table.estimatedCostCents} >= 0`,
    ),
    check(
      "management_returnable_incidents_review_check",
      sql`(${table.status} = 'pending' and ${table.approverIdentityId} is null and ${table.reviewedAt} is null) or (${table.status} in ('approved', 'rejected') and ${table.approverIdentityId} is not null and ${table.reviewedAt} is not null)`,
    ),
  ],
);

export const managementReturnableSupplierExchanges = pgTable(
  "management_returnable_supplier_exchanges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    containerInventoryItemId: uuid("container_inventory_item_id").notNull(),
    locationId: uuid("location_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    quantity: numeric("quantity", { precision: 16, scale: 3 }).notNull(),
    status: managementReturnableSupplierExchangeStatus("status").notNull().default("in_transit"),
    note: text("note").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    sentByIdentityId: uuid("sent_by_identity_id")
      .notNull()
      .references(() => identities.id),
    receivedByIdentityId: uuid("received_by_identity_id").references(() => identities.id),
    canceledByIdentityId: uuid("canceled_by_identity_id").references(() => identities.id),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("management_returnable_supplier_exchanges_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_returnable_supplier_exchanges_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    index("management_returnable_supplier_exchanges_status_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.sentAt,
    ),
    foreignKey({
      name: "management_returnable_supplier_exchanges_container_fk",
      columns: [table.organizationId, table.unitId, table.containerInventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_returnable_supplier_exchanges_location_fk",
      columns: [table.organizationId, table.unitId, table.locationId],
      foreignColumns: [
        managementStockLocations.organizationId,
        managementStockLocations.unitId,
        managementStockLocations.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_returnable_supplier_exchanges_supplier_fk",
      columns: [table.organizationId, table.unitId, table.supplierId],
      foreignColumns: [
        managementSuppliers.organizationId,
        managementSuppliers.unitId,
        managementSuppliers.id,
      ],
    }).onDelete("restrict"),
    check("management_returnable_supplier_exchanges_quantity_check", sql`${table.quantity} > 0`),
    check(
      "management_returnable_supplier_exchanges_status_check",
      sql`(${table.status} = 'in_transit' and ${table.receivedAt} is null and ${table.canceledAt} is null) or (${table.status} = 'received' and ${table.receivedAt} is not null and ${table.receivedByIdentityId} is not null and ${table.canceledAt} is null) or (${table.status} = 'canceled' and ${table.canceledAt} is not null and ${table.canceledByIdentityId} is not null and ${table.receivedAt} is null)`,
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
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedByIdentityId: uuid("rejected_by_identity_id").references(() => identities.id),
    rejectionReason: text("rejection_reason"),
    humanNumber: integer("human_number").generatedAlwaysAsIdentity(),
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
    index("management_purchase_orders_created_idx").on(
      table.organizationId,
      table.unitId,
      table.createdAt,
    ),
    index("management_purchase_orders_status_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.createdAt,
    ),
    index("management_purchase_orders_supplier_created_idx").on(
      table.organizationId,
      table.unitId,
      table.supplierId,
      table.createdAt,
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
    unique("management_purchase_orders_human_number_unique").on(table.humanNumber),
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
    quantity: numeric("quantity", { precision: 16, scale: 3 }).notNull(),
    receivedQuantity: numeric("received_quantity", { precision: 16, scale: 3 })
      .notNull()
      .default("0"),
    unitCostCents: integer("unit_cost_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    purchaseUnit: varchar("purchase_unit", { length: 20 }).notNull(),
    stockUnit: varchar("stock_unit", { length: 20 }).notNull(),
    purchaseToStockFactor: numeric("purchase_to_stock_factor", {
      precision: 16,
      scale: 3,
    }).notNull(),
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
    check("management_purchase_order_items_cost_check", sql`${table.unitCostCents} > 0`),
    check("management_purchase_order_items_total_check", sql`${table.totalCents} > 0`),
    check("management_purchase_order_items_factor_check", sql`${table.purchaseToStockFactor} > 0`),
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
    status: managementPurchaseReceiptStatus("status").notNull().default("posted"),
    totalCents: integer("total_cents").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    receivedByIdentityId: uuid("received_by_identity_id")
      .notNull()
      .references(() => identities.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    reversalReason: text("reversal_reason"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedByIdentityId: uuid("reversed_by_identity_id").references(() => identities.id),
    version: integer("version").notNull().default(1),
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
    index("management_purchase_receipts_order_idx").on(
      table.organizationId,
      table.unitId,
      table.purchaseOrderId,
      table.receivedAt,
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
    check("management_purchase_receipts_version_check", sql`${table.version} > 0`),
    check(
      "management_purchase_receipts_reversal_check",
      sql`(${table.status} = 'posted' and ${table.reversalReason} is null and ${table.reversedAt} is null and ${table.reversedByIdentityId} is null) or (${table.status} = 'reversed' and ${table.reversalReason} is not null and length(trim(${table.reversalReason})) > 0 and ${table.reversedAt} is not null and ${table.reversedByIdentityId} is not null and ${table.reversedAt} >= ${table.receivedAt})`,
    ),
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
    quantity: numeric("quantity", { precision: 16, scale: 3 }).notNull(),
    stockQuantity: numeric("stock_quantity", { precision: 16, scale: 3 }).notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    stockUnitCostCents: integer("stock_unit_cost_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    lotId: uuid("lot_id"),
  },
  (table) => [
    index("management_purchase_receipt_lines_order_item_idx").on(
      table.organizationId,
      table.unitId,
      table.purchaseOrderItemId,
    ),
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
    foreignKey({
      name: "management_purchase_receipt_lines_lot_fk",
      columns: [table.organizationId, table.unitId, table.lotId],
      foreignColumns: [
        managementInventoryLots.organizationId,
        managementInventoryLots.unitId,
        managementInventoryLots.id,
      ],
    }).onDelete("restrict"),
    check("management_purchase_receipt_lines_quantity_check", sql`${table.quantity} > 0`),
    check(
      "management_purchase_receipt_lines_stock_quantity_check",
      sql`${table.stockQuantity} > 0`,
    ),
    check("management_purchase_receipt_lines_cost_check", sql`${table.unitCostCents} > 0`),
    check(
      "management_purchase_receipt_lines_stock_cost_check",
      sql`${table.stockUnitCostCents} >= 0`,
    ),
    check("management_purchase_receipt_lines_total_check", sql`${table.totalCents} > 0`),
  ],
);

export const managementSupplierInvoices = pgTable(
  "management_supplier_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    documentNumber: varchar("document_number", { length: 80 }).notNull(),
    normalizedDocumentNumber: varchar("normalized_document_number", { length: 80 }).notNull(),
    accessKey: varchar("access_key", { length: 44 }),
    xmlContent: text("xml_content"),
    series: varchar("series", { length: 3 }),
    model: varchar("model", { length: 2 }),
    taxTotalCents: integer("tax_total_cents"),
    status: managementSupplierInvoiceStatus("status").notNull().default("pending"),
    totalCents: integer("total_cents").notNull(),
    competenceDate: date("competence_date").notNull(),
    dueDate: date("due_date").notNull(),
    issuedAt: date("issued_at").notNull(),
    toleranceCents: integer("tolerance_cents").notNull().default(0),
    reconciliation: jsonb("reconciliation").$type<Record<string, unknown>>(),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedByIdentityId: uuid("confirmed_by_identity_id").references(() => identities.id),
    reversalReason: text("reversal_reason"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedByIdentityId: uuid("reversed_by_identity_id").references(() => identities.id),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("management_supplier_invoices_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_supplier_invoices_document_unique").on(
      table.organizationId,
      table.unitId,
      table.supplierId,
      table.normalizedDocumentNumber,
    ),
    uniqueIndex("management_supplier_invoices_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    uniqueIndex("management_supplier_invoices_access_key_unique")
      .on(table.accessKey)
      .where(sql`${table.accessKey} is not null`),
    unique("management_supplier_invoices_order_unique").on(
      table.organizationId,
      table.unitId,
      table.purchaseOrderId,
    ),
    foreignKey({
      name: "management_supplier_invoices_order_fk",
      columns: [table.organizationId, table.unitId, table.purchaseOrderId],
      foreignColumns: [
        managementPurchaseOrders.organizationId,
        managementPurchaseOrders.unitId,
        managementPurchaseOrders.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_supplier_invoices_supplier_fk",
      columns: [table.organizationId, table.unitId, table.supplierId],
      foreignColumns: [
        managementSuppliers.organizationId,
        managementSuppliers.unitId,
        managementSuppliers.id,
      ],
    }).onDelete("restrict"),
    check("management_supplier_invoices_total_check", sql`${table.totalCents} > 0`),
    check("management_supplier_invoices_tolerance_check", sql`${table.toleranceCents} >= 0`),
    check("management_supplier_invoices_dates_check", sql`${table.dueDate} >= ${table.issuedAt}`),
    check("management_supplier_invoices_version_check", sql`${table.version} > 0`),
    check(
      "management_supplier_invoices_access_key_check",
      sql`${table.accessKey} is null or ${table.accessKey} ~ '^[0-9]{44}$'`,
    ),
    check(
      "management_supplier_invoices_xml_check",
      sql`${table.xmlContent} is null or (octet_length(${table.xmlContent}) > 0 and octet_length(${table.xmlContent}) <= 2097152)`,
    ),
    check(
      "management_supplier_invoices_nfe_fields_check",
      sql`(${table.accessKey} is null and ${table.xmlContent} is null and ${table.series} is null and ${table.model} is null and ${table.taxTotalCents} is null) or (${table.accessKey} is not null and ${table.xmlContent} is not null and ${table.series} is not null and ${table.series} ~ '^[0-9]{1,3}$' and ${table.model} is not null and ${table.model} ~ '^[0-9]{2}$' and ${table.taxTotalCents} is not null and ${table.taxTotalCents} >= 0)`,
    ),
    check(
      "management_supplier_invoices_reversal_check",
      sql`(${table.status}::text = 'reversed' and ${table.reversalReason} is not null and length(trim(${table.reversalReason})) > 0 and ${table.reversedAt} is not null and ${table.reversedByIdentityId} is not null and ${table.reversedAt} >= ${table.createdAt}) or (${table.status}::text <> 'reversed' and ${table.reversalReason} is null and ${table.reversedAt} is null and ${table.reversedByIdentityId} is null)`,
    ),
  ],
);

export const managementSupplierInvoiceLines = pgTable(
  "management_supplier_invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    purchaseOrderItemId: uuid("purchase_order_item_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    quantity: numeric("quantity", { precision: 16, scale: 3 }).notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
  },
  (table) => [
    unique("management_supplier_invoice_lines_item_unique").on(
      table.invoiceId,
      table.purchaseOrderItemId,
    ),
    index("management_supplier_invoice_lines_order_item_idx").on(
      table.organizationId,
      table.unitId,
      table.purchaseOrderItemId,
    ),
    foreignKey({
      name: "management_supplier_invoice_lines_invoice_fk",
      columns: [table.organizationId, table.unitId, table.invoiceId],
      foreignColumns: [
        managementSupplierInvoices.organizationId,
        managementSupplierInvoices.unitId,
        managementSupplierInvoices.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_supplier_invoice_lines_order_item_fk",
      columns: [table.organizationId, table.unitId, table.purchaseOrderItemId],
      foreignColumns: [
        managementPurchaseOrderItems.organizationId,
        managementPurchaseOrderItems.unitId,
        managementPurchaseOrderItems.id,
      ],
    }).onDelete("restrict"),
    check("management_supplier_invoice_lines_quantity_check", sql`${table.quantity} > 0`),
    check("management_supplier_invoice_lines_cost_check", sql`${table.unitCostCents} > 0`),
    check("management_supplier_invoice_lines_total_check", sql`${table.totalCents} > 0`),
  ],
);

export const managementNfeImports = pgTable(
  "management_nfe_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    purchaseOrderId: uuid("purchase_order_id"),
    accessKey: varchar("access_key", { length: 44 }).notNull(),
    xmlSha256: varchar("xml_sha256", { length: 64 }).notNull(),
    xmlContent: text("xml_content").notNull(),
    status: managementNfeImportStatus("status").notNull().default("staged"),
    documentNumber: varchar("document_number", { length: 80 }),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    totalCents: integer("total_cents"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    importedByIdentityId: uuid("imported_by_identity_id")
      .notNull()
      .references(() => identities.id),
    confirmedByIdentityId: uuid("confirmed_by_identity_id").references(() => identities.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    unique("management_nfe_imports_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_nfe_imports_access_key_unique").on(
      table.organizationId,
      table.unitId,
      table.accessKey,
    ),
    uniqueIndex("management_nfe_imports_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    index("management_nfe_imports_hash_idx").on(
      table.organizationId,
      table.unitId,
      table.xmlSha256,
    ),
    foreignKey({
      name: "management_nfe_imports_supplier_fk",
      columns: [table.organizationId, table.unitId, table.supplierId],
      foreignColumns: [
        managementSuppliers.organizationId,
        managementSuppliers.unitId,
        managementSuppliers.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_nfe_imports_order_fk",
      columns: [table.organizationId, table.unitId, table.purchaseOrderId],
      foreignColumns: [
        managementPurchaseOrders.organizationId,
        managementPurchaseOrders.unitId,
        managementPurchaseOrders.id,
      ],
    }).onDelete("restrict"),
    check("management_nfe_imports_access_key_check", sql`length(${table.accessKey}) = 44`),
    check("management_nfe_imports_hash_check", sql`length(${table.xmlSha256}) = 64`),
    check(
      "management_nfe_imports_total_check",
      sql`${table.totalCents} is null or ${table.totalCents} >= 0`,
    ),
    check(
      "management_nfe_imports_confirmation_check",
      sql`(${table.status} = 'confirmed' and ${table.confirmedByIdentityId} is not null and ${table.confirmedAt} is not null) or ${table.status} <> 'confirmed'`,
    ),
  ],
);

export const managementNfeImportLines = pgTable(
  "management_nfe_import_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    nfeImportId: uuid("nfe_import_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    status: managementNfeImportLineStatus("status").notNull().default("pending"),
    inventoryItemId: uuid("inventory_item_id"),
    supplierProductCode: varchar("supplier_product_code", { length: 120 }),
    gtin: varchar("gtin", { length: 80 }),
    description: varchar("description", { length: 240 }).notNull(),
    ncm: varchar("ncm", { length: 10 }),
    cfop: varchar("cfop", { length: 4 }),
    purchaseUnit: varchar("purchase_unit", { length: 20 }).notNull(),
    quantity: numeric("quantity", { precision: 16, scale: 3 }).notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    purchaseToStockFactor: numeric("purchase_to_stock_factor", { precision: 16, scale: 3 })
      .notNull()
      .default("1"),
    matchScore: numeric("match_score", { precision: 5, scale: 4 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    unique("management_nfe_import_lines_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_nfe_import_lines_number_unique").on(
      table.organizationId,
      table.unitId,
      table.nfeImportId,
      table.lineNumber,
    ),
    index("management_nfe_import_lines_status_idx").on(
      table.organizationId,
      table.unitId,
      table.nfeImportId,
      table.status,
    ),
    foreignKey({
      name: "management_nfe_import_lines_import_fk",
      columns: [table.organizationId, table.unitId, table.nfeImportId],
      foreignColumns: [
        managementNfeImports.organizationId,
        managementNfeImports.unitId,
        managementNfeImports.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_nfe_import_lines_item_fk",
      columns: [table.organizationId, table.unitId, table.inventoryItemId],
      foreignColumns: [
        managementInventoryItems.organizationId,
        managementInventoryItems.unitId,
        managementInventoryItems.id,
      ],
    }).onDelete("restrict"),
    check("management_nfe_import_lines_number_check", sql`${table.lineNumber} > 0`),
    check("management_nfe_import_lines_quantity_check", sql`${table.quantity} > 0`),
    check("management_nfe_import_lines_cost_check", sql`${table.unitCostCents} >= 0`),
    check("management_nfe_import_lines_total_check", sql`${table.totalCents} >= 0`),
    check("management_nfe_import_lines_factor_check", sql`${table.purchaseToStockFactor} > 0`),
    check(
      "management_nfe_import_lines_match_score_check",
      sql`${table.matchScore} is null or (${table.matchScore} >= 0 and ${table.matchScore} <= 1)`,
    ),
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
    supplierInvoiceId: uuid("supplier_invoice_id"),
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
      name: "management_payables_supplier_invoice_fk",
      columns: [table.organizationId, table.unitId, table.supplierInvoiceId],
      foreignColumns: [
        managementSupplierInvoices.organizationId,
        managementSupplierInvoices.unitId,
        managementSupplierInvoices.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("management_payables_supplier_invoice_unique")
      .on(table.organizationId, table.unitId, table.supplierInvoiceId)
      .where(sql`${table.supplierInvoiceId} is not null`),
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
    updatedByIdentityId: uuid("updated_by_identity_id").references(() => identities.id),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    statusChangedByIdentityId: uuid("status_changed_by_identity_id").references(
      () => identities.id,
    ),
    statusChangeReason: varchar("status_change_reason", { length: 1_000 }),
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
    check(
      "management_people_status_actor_check",
      sql`(${table.statusChangedAt} is null and ${table.statusChangedByIdentityId} is null) or (${table.statusChangedAt} is not null and ${table.statusChangedByIdentityId} is not null)`,
    ),
    check(
      "management_people_inactive_reason_check",
      sql`${table.active} or (${table.statusChangedAt} is not null and ${table.statusChangedByIdentityId} is not null and nullif(btrim(${table.statusChangeReason}), '') is not null)`,
    ),
  ],
);

export const managementTimeTrackingSettings = pgTable(
  "management_time_tracking_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    mode: managementTimeTrackingMode("mode").notNull().default("off"),
    geofenceEnabled: boolean("geofence_enabled").notNull().default(true),
    locationLabel: varchar("location_label", { length: 160 }),
    locationAddress: varchar("location_address", { length: 300 }),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    radiusMeters: integer("radius_meters").notNull().default(100),
    accuracyToleranceMeters: integer("accuracy_tolerance_meters").notNull().default(50),
    maxLocationAccuracyMeters: integer("max_location_accuracy_meters").notNull().default(100),
    lowAccuracyPolicy: managementTimeTrackingLowAccuracyPolicy("low_accuracy_policy")
      .notNull()
      .default("block"),
    additionalLocations: jsonb("additional_locations")
      .$type<
        Array<{
          id: string;
          label: string;
          address?: string;
          latitude: number;
          longitude: number;
          radiusMeters: number;
          accuracyToleranceMeters: number;
        }>
      >()
      .notNull()
      .default([]),
    managerCanView: boolean("manager_can_view").notNull().default(false),
    financeCanView: boolean("finance_can_view").notNull().default(false),
    antiFraudEnabled: boolean("anti_fraud_enabled").notNull().default(true),
    offlineEnabled: boolean("offline_enabled").notNull().default(true),
    offlineMaxDelayMinutes: integer("offline_max_delay_minutes").notNull().default(120),
    offlineRequiresJustification: boolean("offline_requires_justification").notNull().default(true),
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
    emailAlertsEnabled: boolean("email_alerts_enabled").notNull().default(false),
    managerAlertOnAnomaly: boolean("manager_alert_on_anomaly").notNull().default(true),
    locationRetentionDays: integer("location_retention_days").notNull().default(365),
    lateToleranceMinutes: integer("late_tolerance_minutes").notNull().default(15),
    minimumBreakMinutes: integer("minimum_break_minutes").notNull().default(0),
    maxOvertimeMinutes: integer("max_overtime_minutes").notNull().default(120),
    longShiftAlertMinutes: integer("long_shift_alert_minutes").notNull().default(720),
    reminderBeforeShiftMinutes: integer("reminder_before_shift_minutes").notNull().default(15),
    reminderAfterShiftMinutes: integer("reminder_after_shift_minutes").notNull().default(15),
    updatedByIdentityId: uuid("updated_by_identity_id").references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_time_tracking_settings_unit_unique").on(
      table.organizationId,
      table.unitId,
    ),
    foreignKey({
      name: "management_time_tracking_settings_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "management_time_tracking_settings_coordinates_check",
      sql`(${table.latitude} is null and ${table.longitude} is null) or (${table.latitude} between -90 and 90 and ${table.longitude} between -180 and 180)`,
    ),
    check(
      "management_time_tracking_settings_radius_check",
      sql`${table.radiusMeters} between 25 and 5000 and ${table.accuracyToleranceMeters} between 0 and 500 and ${table.maxLocationAccuracyMeters} between 5 and 2000`,
    ),
    check(
      "management_time_tracking_settings_rules_check",
      sql`${table.lateToleranceMinutes} between 0 and 120 and ${table.minimumBreakMinutes} between 0 and 1440 and ${table.maxOvertimeMinutes} between 0 and 720 and ${table.longShiftAlertMinutes} between 60 and 1440 and ${table.reminderBeforeShiftMinutes} between 0 and 240 and ${table.reminderAfterShiftMinutes} between 0 and 240 and ${table.offlineMaxDelayMinutes} between 5 and 2880 and ${table.locationRetentionDays} between 30 and 1825`,
    ),
  ],
);

export const managementTimeTrackingAssignments = pgTable(
  "management_time_tracking_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    personId: uuid("person_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedByIdentityId: uuid("updated_by_identity_id").references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_time_tracking_assignment_person_unique").on(
      table.organizationId,
      table.unitId,
      table.personId,
    ),
    foreignKey({
      name: "management_time_tracking_assignment_unit_fk",
      columns: [table.organizationId, table.unitId, table.personId],
      foreignColumns: [
        managementPeople.organizationId,
        managementPeople.unitId,
        managementPeople.id,
      ],
    }).onDelete("cascade"),
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
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    canceledByIdentityId: uuid("canceled_by_identity_id").references(() => identities.id),
    cancellationReason: varchar("cancellation_reason", { length: 1_000 }),
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
    check(
      "management_schedules_cancellation_check",
      sql`(${table.canceledAt} is null and ${table.canceledByIdentityId} is null and ${table.cancellationReason} is null) or (${table.canceledAt} is not null and ${table.canceledByIdentityId} is not null and nullif(btrim(${table.cancellationReason}), '') is not null)`,
    ),
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
    clockInLatitude: doublePrecision("clock_in_latitude"),
    clockInLongitude: doublePrecision("clock_in_longitude"),
    clockInAccuracyMeters: integer("clock_in_accuracy_meters"),
    clockInServerAt: timestamp("clock_in_server_at", { withTimezone: true }),
    clockInDeviceId: varchar("clock_in_device_id", { length: 160 }),
    clockInSessionId: varchar("clock_in_session_id", { length: 160 }),
    clockInIpAddress: varchar("clock_in_ip_address", { length: 64 }),
    clockInUserAgent: varchar("clock_in_user_agent", { length: 512 }),
    clockInGeofenceLabel: varchar("clock_in_geofence_label", { length: 160 }),
    clockInOfflineJustification: varchar("clock_in_offline_justification", { length: 1_000 }),
    clockInFlags: jsonb("clock_in_flags").$type<string[]>().notNull().default([]),
    clockOutLatitude: doublePrecision("clock_out_latitude"),
    clockOutLongitude: doublePrecision("clock_out_longitude"),
    clockOutAccuracyMeters: integer("clock_out_accuracy_meters"),
    clockOutServerAt: timestamp("clock_out_server_at", { withTimezone: true }),
    clockOutDeviceId: varchar("clock_out_device_id", { length: 160 }),
    clockOutSessionId: varchar("clock_out_session_id", { length: 160 }),
    clockOutIpAddress: varchar("clock_out_ip_address", { length: 64 }),
    clockOutUserAgent: varchar("clock_out_user_agent", { length: 512 }),
    clockOutGeofenceLabel: varchar("clock_out_geofence_label", { length: 160 }),
    clockOutOfflineJustification: varchar("clock_out_offline_justification", { length: 1_000 }),
    clockOutFlags: jsonb("clock_out_flags").$type<string[]>().notNull().default([]),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    recordedByIdentityId: uuid("recorded_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    unique("management_time_entries_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
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

export const managementTimeEntryBreaks = pgTable(
  "management_time_entry_breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    timeEntryId: uuid("time_entry_id").notNull(),
    type: managementBreakType("type").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    startLatitude: doublePrecision("start_latitude"),
    startLongitude: doublePrecision("start_longitude"),
    startAccuracyMeters: integer("start_accuracy_meters"),
    startServerAt: timestamp("start_server_at", { withTimezone: true }),
    startDeviceId: varchar("start_device_id", { length: 160 }),
    startSessionId: varchar("start_session_id", { length: 160 }),
    startIpAddress: varchar("start_ip_address", { length: 64 }),
    startUserAgent: varchar("start_user_agent", { length: 512 }),
    startGeofenceLabel: varchar("start_geofence_label", { length: 160 }),
    startOfflineJustification: varchar("start_offline_justification", { length: 1_000 }),
    startFlags: jsonb("start_flags").$type<string[]>().notNull().default([]),
    endLatitude: doublePrecision("end_latitude"),
    endLongitude: doublePrecision("end_longitude"),
    endAccuracyMeters: integer("end_accuracy_meters"),
    endServerAt: timestamp("end_server_at", { withTimezone: true }),
    endDeviceId: varchar("end_device_id", { length: 160 }),
    endSessionId: varchar("end_session_id", { length: 160 }),
    endIpAddress: varchar("end_ip_address", { length: 64 }),
    endUserAgent: varchar("end_user_agent", { length: 512 }),
    endGeofenceLabel: varchar("end_geofence_label", { length: 160 }),
    endOfflineJustification: varchar("end_offline_justification", { length: 1_000 }),
    endFlags: jsonb("end_flags").$type<string[]>().notNull().default([]),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    recordedByIdentityId: uuid("recorded_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_time_entry_break_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    uniqueIndex("management_time_entry_break_one_open_unique")
      .on(table.organizationId, table.unitId, table.timeEntryId)
      .where(sql`${table.endedAt} is null`),
    foreignKey({
      name: "management_time_entry_break_entry_fk",
      columns: [table.organizationId, table.unitId, table.timeEntryId],
      foreignColumns: [
        managementTimeEntries.organizationId,
        managementTimeEntries.unitId,
        managementTimeEntries.id,
      ],
    }).onDelete("cascade"),
    check(
      "management_time_entry_break_window_check",
      sql`${table.endedAt} is null or ${table.endedAt} > ${table.startedAt}`,
    ),
    check(
      "management_time_entry_break_accuracy_check",
      sql`(${table.startAccuracyMeters} is null or ${table.startAccuracyMeters} >= 0) and (${table.endAccuracyMeters} is null or ${table.endAccuracyMeters} >= 0)`,
    ),
  ],
);

export const managementTimeCorrections = pgTable(
  "management_time_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    personId: uuid("person_id").notNull(),
    timeEntryId: uuid("time_entry_id").notNull(),
    requestedClockedInAt: timestamp("requested_clocked_in_at", { withTimezone: true }).notNull(),
    requestedClockedOutAt: timestamp("requested_clocked_out_at", { withTimezone: true }),
    reason: varchar("reason", { length: 1_000 }).notNull(),
    status: managementTimeCorrectionStatus("status").notNull().default("pending"),
    requestedByIdentityId: uuid("requested_by_identity_id")
      .notNull()
      .references(() => identities.id),
    reviewedByIdentityId: uuid("reviewed_by_identity_id").references(() => identities.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: varchar("review_note", { length: 1_000 }),
    requiresSpecialApproval: boolean("requires_special_approval").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("management_time_corrections_scope_status_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.createdAt,
    ),
    foreignKey({
      name: "management_time_corrections_person_fk",
      columns: [table.organizationId, table.unitId, table.personId],
      foreignColumns: [
        managementPeople.organizationId,
        managementPeople.unitId,
        managementPeople.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_time_corrections_entry_fk",
      columns: [table.organizationId, table.unitId, table.timeEntryId],
      foreignColumns: [
        managementTimeEntries.organizationId,
        managementTimeEntries.unitId,
        managementTimeEntries.id,
      ],
    }).onDelete("cascade"),
    check(
      "management_time_corrections_window_check",
      sql`${table.requestedClockedOutAt} is null or ${table.requestedClockedOutAt} > ${table.requestedClockedInAt}`,
    ),
  ],
);

export const managementTimeTrackingClosures = pgTable(
  "management_time_tracking_closures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: managementTimeTrackingClosureStatus("status").notNull().default("closed"),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    closedByIdentityId: uuid("closed_by_identity_id")
      .notNull()
      .references(() => identities.id),
    reason: varchar("reason", { length: 1_000 }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenedByIdentityId: uuid("reopened_by_identity_id").references(() => identities.id),
    reopenReason: varchar("reopen_reason", { length: 1_000 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_time_tracking_closure_period_unique").on(
      table.organizationId,
      table.unitId,
      table.periodStart,
      table.periodEnd,
    ),
    index("management_time_tracking_closure_scope_idx").on(
      table.organizationId,
      table.unitId,
      table.periodStart,
      table.periodEnd,
    ),
    uniqueIndex("management_time_tracking_closure_idempotency_unique")
      .on(table.organizationId, table.unitId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    foreignKey({
      name: "management_time_tracking_closure_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "management_time_tracking_closure_window_check",
      sql`${table.periodEnd} >= ${table.periodStart}`,
    ),
    check(
      "management_time_tracking_closure_lifecycle_check",
      sql`(${table.status} = 'closed' and ${table.reopenedAt} is null and ${table.reopenedByIdentityId} is null and ${table.reopenReason} is null) or (${table.status} = 'reopened' and ${table.reopenedAt} is not null and ${table.reopenedByIdentityId} is not null and nullif(btrim(${table.reopenReason}), '') is not null)`,
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
      .$type<"pending" | "approved" | "rejected" | "paid" | "canceled">()
      .notNull()
      .default("pending"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByIdentityId: uuid("reviewed_by_identity_id").references(() => identities.id),
    reviewNote: varchar("review_note", { length: 1_000 }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidByIdentityId: uuid("paid_by_identity_id").references(() => identities.id),
    paymentNote: varchar("payment_note", { length: 1_000 }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    canceledByIdentityId: uuid("canceled_by_identity_id").references(() => identities.id),
    cancellationReason: varchar("cancellation_reason", { length: 1_000 }),
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
    check(
      "management_commissions_status_check",
      sql`${table.status} in ('pending','approved','rejected','paid','canceled')`,
    ),
    check(
      "management_commissions_actor_pairs_check",
      sql`((${table.reviewedAt} is null) = (${table.reviewedByIdentityId} is null)) and ((${table.paidAt} is null) = (${table.paidByIdentityId} is null)) and ((${table.canceledAt} is null) = (${table.canceledByIdentityId} is null))`,
    ),
    check(
      "management_commissions_lifecycle_check",
      sql`(${table.status} = 'pending' and ${table.reviewedAt} is null and ${table.paidAt} is null and ${table.canceledAt} is null) or (${table.status} = 'approved' and ${table.reviewedAt} is not null and ${table.reviewedByIdentityId} is not null and ${table.paidAt} is null and ${table.canceledAt} is null) or (${table.status} = 'rejected' and ${table.reviewedAt} is not null and ${table.reviewedByIdentityId} is not null and nullif(btrim(${table.reviewNote}), '') is not null and ${table.paidAt} is null and ${table.canceledAt} is null) or (${table.status} = 'paid' and ${table.reviewedAt} is not null and ${table.reviewedByIdentityId} is not null and ${table.paidAt} is not null and ${table.paidByIdentityId} is not null and ${table.canceledAt} is null) or (${table.status} = 'canceled' and ${table.paidAt} is null and ${table.canceledAt} is not null and ${table.canceledByIdentityId} is not null and nullif(btrim(${table.cancellationReason}), '') is not null)`,
    ),
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

export const managementOverviewPriorityStatus = pgEnum("management_overview_priority_status", [
  "claimed",
  "snoozed",
  "resolved",
]);

export const managementOverviewPriorityStates = pgTable(
  "management_overview_priority_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    priorityId: varchar("priority_id", { length: 80 }).notNull(),
    occurrenceKey: varchar("occurrence_key", { length: 64 }).notNull(),
    status: managementOverviewPriorityStatus("status").notNull(),
    assignedToIdentityId: uuid("assigned_to_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    updatedByIdentityId: uuid("updated_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_overview_priority_occurrence_unique").on(
      table.organizationId,
      table.unitId,
      table.priorityId,
      table.occurrenceKey,
    ),
    index("management_overview_priority_active_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.snoozedUntil,
    ),
    foreignKey({
      name: "management_overview_priority_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "management_overview_priority_snooze_check",
      sql`(${table.status} = 'snoozed' and ${table.snoozedUntil} is not null) or (${table.status} <> 'snoozed' and ${table.snoozedUntil} is null)`,
    ),
  ],
);

export const managementOverviewPreferences = pgTable(
  "management_overview_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    alertsEnabled: boolean("alerts_enabled").notNull().default(true),
    minimumTone: varchar("minimum_tone", { length: 10 })
      .$type<"info" | "warning" | "danger">()
      .notNull()
      .default("warning"),
    digestMinutes: integer("digest_minutes").notNull().default(15),
    thresholds: jsonb("thresholds").$type<Record<string, number>>().notNull().default({}),
    lastVisitedAt: timestamp("last_visited_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_overview_preferences_identity_unique").on(
      table.organizationId,
      table.unitId,
      table.identityId,
    ),
    foreignKey({
      name: "management_overview_preferences_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "management_overview_preferences_tone_check",
      sql`${table.minimumTone} in ('info', 'warning', 'danger')`,
    ),
    check(
      "management_overview_preferences_digest_check",
      sql`${table.digestMinutes} between 5 and 1440`,
    ),
  ],
);

export const managementReportBudgets = pgTable(
  "management_report_budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    month: date("month").notNull(),
    metric: varchar("metric", { length: 80 }).notNull(),
    targetCents: integer("target_cents").notNull(),
    version: integer("version").notNull().default(1),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    updatedByIdentityId: uuid("updated_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_report_budgets_scope_month_metric_unique").on(
      table.organizationId,
      table.unitId,
      table.month,
      table.metric,
    ),
    foreignKey({
      name: "management_report_budgets_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "management_report_budgets_month_check",
      sql`${table.month} = date_trunc('month', ${table.month})::date`,
    ),
    check(
      "management_report_budgets_metric_check",
      sql`${table.metric} in ('pos_revenue', 'cash_inflows', 'cash_outflows', 'competence_revenue', 'competence_expenses', 'average_ticket', 'gross_margin', 'inventory_loss', 'canceled_value')`,
    ),
    check("management_report_budgets_target_check", sql`${table.targetCents} >= 0`),
    check("management_report_budgets_version_check", sql`${table.version} >= 1`),
  ],
);

export const managementReportSchedules = pgTable(
  "management_report_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    frequency: managementReportFrequency("frequency").notNull(),
    weekday: integer("weekday"),
    dayOfMonth: integer("day_of_month"),
    localTime: time("local_time").notNull(),
    range: managementReportRange("range").notNull(),
    comparisonMode: varchar("comparison_mode", { length: 32 }).notNull().default("previous_period"),
    family: varchar("family", { length: 32 }).notNull().default("overview"),
    format: managementReportExportFormat("format").notNull().default("csv"),
    delivery: managementReportDelivery("delivery").notNull(),
    recipientIdentityId: uuid("recipient_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    updatedByIdentityId: uuid("updated_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    unique("management_report_schedules_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    index("management_report_schedules_due_idx").on(table.enabled, table.nextRunAt),
    foreignKey({
      name: "management_report_schedules_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "management_report_schedules_recurrence_check",
      sql`(${table.frequency} = 'weekly' and ${table.weekday} between 0 and 6 and ${table.dayOfMonth} is null) or (${table.frequency} = 'monthly' and ${table.dayOfMonth} between 1 and 28 and ${table.weekday} is null)`,
    ),
    check(
      "management_report_schedules_comparison_mode_check",
      sql`${table.comparisonMode} in ('previous_period', 'previous_year', 'none')`,
    ),
    check(
      "management_report_schedules_family_check",
      sql`${table.family} in ('overview', 'sales', 'exceptions', 'inventory', 'purchasing', 'operations', 'profitability', 'multiunit', 'quality', 'labor', 'reconciliation', 'forecast')`,
    ),
    check(
      "management_report_schedules_delivery_check",
      sql`${table.delivery} <> 'email' or ${table.recipientIdentityId} is not null`,
    ),
    check("management_report_schedules_version_check", sql`${table.version} >= 1`),
  ],
);

export const managementReportExports = pgTable(
  "management_report_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    scheduleId: uuid("schedule_id"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    query: jsonb("query").$type<Record<string, unknown>>().notNull(),
    content: text("content"),
    contentEncoding: varchar("content_encoding", { length: 12 })
      .$type<"utf8" | "base64">()
      .notNull()
      .default("utf8"),
    mimeType: varchar("mime_type", { length: 120 }).notNull().default("text/csv; charset=utf-8"),
    status: managementReportExportStatus("status").notNull(),
    format: managementReportExportFormat("format").notNull().default("csv"),
    sha256: varchar("sha256", { length: 64 }),
    rowCount: integer("row_count").notNull().default(0),
    errorCode: varchar("error_code", { length: 120 }),
    requestedByIdentityId: uuid("requested_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("management_report_exports_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    uniqueIndex("management_report_exports_schedule_execution_unique")
      .on(table.organizationId, table.unitId, table.scheduleId, table.scheduledFor)
      .where(sql`${table.scheduleId} is not null and ${table.scheduledFor} is not null`),
    index("management_report_exports_expiry_idx").on(table.expiresAt),
    foreignKey({
      name: "management_report_exports_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_report_exports_schedule_fk",
      columns: [table.organizationId, table.unitId, table.scheduleId],
      foreignColumns: [
        managementReportSchedules.organizationId,
        managementReportSchedules.unitId,
        managementReportSchedules.id,
      ],
    }).onDelete("restrict"),
    check("management_report_exports_row_count_check", sql`${table.rowCount} >= 0`),
    check(
      "management_report_exports_encoding_check",
      sql`${table.contentEncoding} in ('utf8','base64')`,
    ),
    check(
      "management_report_exports_completion_check",
      sql`(${table.status} = 'ready' and ${table.content} is not null and ${table.sha256} is not null and ${table.completedAt} is not null and ${table.errorCode} is null) or (${table.status} = 'failed' and ${table.content} is null and ${table.sha256} is null and ${table.completedAt} is not null and ${table.errorCode} is not null)`,
    ),
  ],
);
