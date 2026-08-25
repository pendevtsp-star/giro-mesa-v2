import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  ForeignKeyBuilder,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  authSessions,
  deviceEnrollments,
  hubCommands,
  identities,
  memberships,
  organizations,
  units,
} from "./schema.js";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export type PosAvailabilitySchedule = {
  windows: { dayOfWeek: number; start: string; end: string }[];
};

export type PosCatalogMetadata = Record<string, unknown>;

export type PosTableQrSettingsSnapshot = {
  displayName: string;
  headline: string;
  instructions: string;
  logoUrl: string | null;
  primaryColor: string;
  wifiNotice: string | null;
  serviceChargeNotice: string | null;
  template: "classic" | "compact" | "minimal";
  presenceProtection: "session_only" | "daily_code";
};

export type PosTableQrBatchTableSnapshot = {
  tableId: string;
  label: string;
  tokenVersion: number;
};

export type PosFloorPoint = { x: number; y: number };

export const posTabStatus = pgEnum("pos_tab_status", ["open", "merged", "closed", "canceled"]);
export const posOrderStatus = pgEnum("pos_order_status", [
  "draft",
  "sent",
  "preparing",
  "ready",
  "served",
  "canceled",
]);
export const posItemStatus = pgEnum("pos_item_status", [
  "draft",
  "queued",
  "preparing",
  "ready",
  "served",
  "canceled",
]);
export const posKdsStatus = pgEnum("pos_kds_status", [
  "pending",
  "preparing",
  "ready",
  "done",
  "canceled",
]);
export const posKdsBatchStatus = pgEnum("pos_kds_batch_status", [
  "active",
  "completed",
  "canceled",
]);
export const posKdsTerminalMode = pgEnum("pos_kds_terminal_mode", ["station", "pass"]);
export const posTableStatus = pgEnum("pos_table_status", [
  "available",
  "occupied",
  "reserved",
  "needs_cleaning",
  "cleaning",
]);
export const posTableGroupMode = pgEnum("pos_table_group_mode", ["physical_only", "single_tab"]);
export const posApprovalAction = pgEnum("pos_approval_action", ["discount", "cancel"]);
export const posFulfillmentType = pgEnum("pos_fulfillment_type", ["dine_in", "pickup", "delivery"]);
export const posOrderCourse = pgEnum("pos_order_course", ["anytime", "starter", "main", "dessert"]);
export const posServiceCallKind = pgEnum("pos_service_call_kind", [
  "assistance",
  "bill",
  "water",
  "other",
]);
export const posServiceCallStatus = pgEnum("pos_service_call_status", [
  "open",
  "acknowledged",
  "resolved",
]);
export const posPaymentMethod = pgEnum("pos_payment_method", [
  "cash",
  "credit_card",
  "debit_card",
  "pix",
  "other",
]);
export const posPaymentAttemptStatus = pgEnum("pos_payment_attempt_status", [
  "created",
  "processing",
  "approved",
  "declined",
  "canceled",
  "unknown",
  "reversed",
]);
export const posPaymentReversalStatus = pgEnum("pos_payment_reversal_status", [
  "pending",
  "processing",
  "approved",
  "declined",
  "canceled",
  "unknown",
]);
export const posPaymentCertificationStatus = pgEnum("pos_payment_certification_status", [
  "approved",
  "suspended",
]);
export const posPaymentReconciliationStatus = pgEnum("pos_payment_reconciliation_status", [
  "pending",
  "matched",
  "divergent",
  "settled",
  "reversed",
]);
export const posServiceMode = pgEnum("pos_service_mode", [
  "full_service",
  "quick_service",
  "bar",
  "hybrid",
]);
export const posOperationalShiftStatus = pgEnum("pos_operational_shift_status", [
  "active",
  "closed",
]);
export const posSectionStaffRole = pgEnum("pos_section_staff_role", ["primary", "support"]);
export const posPrintDocumentType = pgEnum("pos_print_document_type", [
  "partial_statement",
  "payment_statement",
  "final_receipt",
  "kds_ticket",
]);
export const posPrintJobStatus = pgEnum("pos_print_job_status", [
  "queued",
  "printing",
  "confirmation_required",
  "printed",
  "failed",
]);
export const posProductionDeliveryMode = pgEnum("pos_production_delivery_mode", [
  "kds_only",
  "printer_only",
  "both",
  "disabled",
]);
export const posPrinterApplyStatus = pgEnum("pos_printer_apply_status", [
  "pending",
  "applied",
  "error",
]);
export const posPrinterHealthStatus = pgEnum("pos_printer_health_status", [
  "unknown",
  "pending",
  "online",
  "error",
  "confirmation_required",
]);

export const posCatalogCategories = pgTable(
  "pos_catalog_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    slug: varchar("slug", { length: 100 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pos_categories_org_slug_unique").on(table.organizationId, table.slug),
    unique("pos_categories_org_id_unique").on(table.organizationId, table.id),
  ],
);

export const posAllergens = pgTable(
  "pos_allergens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 40 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pos_allergens_org_code_unique").on(table.organizationId, table.code),
    unique("pos_allergens_org_id_unique").on(table.organizationId, table.id),
  ],
);

export const posModifierGroups = pgTable(
  "pos_modifier_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    minimumSelections: integer("minimum_selections").notNull().default(0),
    maximumSelections: integer("maximum_selections").notNull().default(1),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("pos_modifier_groups_org_id_unique").on(table.organizationId, table.id),
    check(
      "pos_modifier_selection_range_check",
      sql`${table.minimumSelections} >= 0 AND ${table.maximumSelections} >= ${table.minimumSelections}`,
    ),
  ],
);

export const posModifierOptions = pgTable(
  "pos_modifier_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    groupId: uuid("group_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    priceDeltaCents: integer("price_delta_cents").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("pos_modifier_options_org_id_unique").on(table.organizationId, table.id),
    foreignKey({
      name: "pos_modifier_options_group_fk",
      columns: [table.organizationId, table.groupId],
      foreignColumns: [posModifierGroups.organizationId, posModifierGroups.id],
    }).onDelete("cascade"),
    check("pos_modifier_option_price_check", sql`${table.priceDeltaCents} >= 0`),
  ],
);

export const posProducts = pgTable(
  "pos_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").notNull(),
    sku: varchar("sku", { length: 80 }),
    ean: varchar("ean", { length: 14 }),
    productType: varchar("product_type", { length: 30 }).notNull().default("prepared"),
    sortOrder: integer("sort_order").notNull().default(0),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    estimatedPrepTimeMinutes: integer("estimated_prep_time_minutes"),
    metadata: jsonb("metadata").$type<PosCatalogMetadata>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("pos_products_org_id_unique").on(table.organizationId, table.id),
    uniqueIndex("pos_products_org_sku_unique").on(table.organizationId, table.sku),
    uniqueIndex("pos_products_org_ean_unique").on(table.organizationId, table.ean),
    index("pos_products_category_idx").on(table.organizationId, table.categoryId),
    foreignKey({
      name: "pos_products_category_fk",
      columns: [table.organizationId, table.categoryId],
      foreignColumns: [posCatalogCategories.organizationId, posCatalogCategories.id],
    }).onDelete("restrict"),
  ],
);

export const posProductAllergens = pgTable(
  "pos_product_allergens",
  {
    organizationId: uuid("organization_id").notNull(),
    productId: uuid("product_id").notNull(),
    allergenId: uuid("allergen_id").notNull(),
    mayContain: boolean("may_contain").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.allergenId] }),
    foreignKey({
      name: "pos_product_allergens_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_product_allergens_allergen_fk",
      columns: [table.organizationId, table.allergenId],
      foreignColumns: [posAllergens.organizationId, posAllergens.id],
    }).onDelete("restrict"),
  ],
);

export const posProductModifierGroups = pgTable(
  "pos_product_modifier_groups",
  {
    organizationId: uuid("organization_id").notNull(),
    productId: uuid("product_id").notNull(),
    groupId: uuid("group_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.groupId] }),
    foreignKey({
      name: "pos_product_modifier_groups_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_product_modifier_groups_group_fk",
      columns: [table.organizationId, table.groupId],
      foreignColumns: [posModifierGroups.organizationId, posModifierGroups.id],
    }).onDelete("restrict"),
  ],
);

export const posCombos = pgTable(
  "pos_combos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    priceCents: integer("price_cents").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("pos_combos_org_id_unique").on(table.organizationId, table.id),
    check("pos_combos_price_check", sql`${table.priceCents} >= 0`),
  ],
);

export const posComboItems = pgTable(
  "pos_combo_items",
  {
    organizationId: uuid("organization_id").notNull(),
    comboId: uuid("combo_id").notNull(),
    productId: uuid("product_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.comboId, table.productId] }),
    foreignKey({
      name: "pos_combo_items_combo_fk",
      columns: [table.organizationId, table.comboId],
      foreignColumns: [posCombos.organizationId, posCombos.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_combo_items_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("restrict"),
    check("pos_combo_items_quantity_check", sql`${table.quantity} > 0`),
  ],
);

export const posRecipeComponents = pgTable(
  "pos_recipe_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    productId: uuid("product_id").notNull(),
    ingredientName: varchar("ingredient_name", { length: 160 }).notNull(),
    quantityMilli: integer("quantity_milli").notNull(),
    unit: varchar("unit", { length: 20 }).notNull(),
    lossBasisPoints: integer("loss_basis_points").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "pos_recipe_components_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("cascade"),
    check("pos_recipe_quantity_check", sql`${table.quantityMilli} > 0`),
    check("pos_recipe_loss_check", sql`${table.lossBasisPoints} BETWEEN 0 AND 10000`),
  ],
);

export const posProductionPrinters = pgTable(
  "pos_production_printers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    hubId: uuid("hub_id").notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    host: varchar("host", { length: 45 }).notNull(),
    port: integer("port").notNull().default(9100),
    paperWidthMm: integer("paper_width_mm").notNull().default(80),
    charactersPerLine: integer("characters_per_line").notNull().default(48),
    codeTable: integer("code_table").notNull().default(16),
    cut: boolean("cut").notNull().default(true),
    supportsRasterGraphics: boolean("supports_raster_graphics").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    documentTypes: jsonb("document_types")
      .$type<Array<"partial_statement" | "payment_statement" | "final_receipt" | "kds_ticket">>()
      .notNull()
      .default(["kds_ticket"]),
    fallbackPrinterId: uuid("fallback_printer_id"),
    active: boolean("active").notNull().default(true),
    revision: integer("revision").notNull().default(1),
    appliedRevision: integer("applied_revision"),
    applyStatus: posPrinterApplyStatus("apply_status").notNull().default("pending"),
    pendingCommandId: uuid("pending_command_id").references(() => hubCommands.id, {
      onDelete: "set null",
    }),
    lastAppliedAt: timestamp("last_applied_at", { withTimezone: true }),
    lastTestCommandId: uuid("last_test_command_id").references(() => hubCommands.id, {
      onDelete: "set null",
    }),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    lastStatus: posPrinterHealthStatus("last_status").notNull().default("unknown"),
    lastError: varchar("last_error", { length: 500 }),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    updatedByIdentityId: uuid("updated_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    unique("pos_production_printers_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("pos_production_printers_default_unique")
      .on(table.organizationId, table.unitId, table.hubId)
      .where(sql`${table.isDefault} = true AND ${table.active} = true`),
    index("pos_production_printers_unit_idx").on(table.organizationId, table.unitId, table.active),
    foreignKey({
      name: "pos_production_printers_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_production_printers_hub_fk",
      columns: [table.organizationId, table.unitId, table.hubId],
      foreignColumns: [
        deviceEnrollments.organizationId,
        deviceEnrollments.unitId,
        deviceEnrollments.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_production_printers_fallback_fk",
      columns: [table.organizationId, table.unitId, table.fallbackPrinterId],
      foreignColumns: [table.organizationId, table.unitId, table.id],
    }).onDelete("restrict"),
    check("pos_production_printers_port_check", sql`${table.port} BETWEEN 1 AND 65535`),
    check("pos_production_printers_paper_width_check", sql`${table.paperWidthMm} IN (58, 80)`),
    check(
      "pos_production_printers_characters_check",
      sql`${table.charactersPerLine} BETWEEN 24 AND 64`,
    ),
    check("pos_production_printers_code_table_check", sql`${table.codeTable} BETWEEN 0 AND 255`),
    check("pos_production_printers_revision_check", sql`${table.revision} > 0`),
    check(
      "pos_production_printers_applied_revision_check",
      sql`${table.appliedRevision} IS NULL OR (${table.appliedRevision} > 0 AND ${table.appliedRevision} <= ${table.revision})`,
    ),
    check(
      "pos_production_printers_fallback_check",
      sql`${table.fallbackPrinterId} IS NULL OR ${table.fallbackPrinterId} <> ${table.id}`,
    ),
  ],
);

export const posProductionStations = pgTable(
  "pos_production_stations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    code: varchar("code", { length: 40 }).notNull(),
    active: boolean("active").notNull().default(true),
    deliveryMode: posProductionDeliveryMode("delivery_mode").notNull().default("kds_only"),
    printCopies: integer("print_copies").notNull().default(1),
    printPrinterId: uuid("print_printer_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pos_stations_org_unit_code_unique").on(
      table.organizationId,
      table.unitId,
      table.code,
    ),
    unique("pos_stations_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    foreignKey({
      name: "pos_stations_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_stations_print_printer_fk",
      columns: [table.organizationId, table.unitId, table.printPrinterId],
      foreignColumns: [
        posProductionPrinters.organizationId,
        posProductionPrinters.unitId,
        posProductionPrinters.id,
      ],
    }).onDelete("restrict"),
    check("pos_stations_print_copies_check", sql`${table.printCopies} BETWEEN 1 AND 5`),
    check(
      "pos_stations_print_policy_check",
      sql`((${table.deliveryMode} IN ('printer_only', 'both') AND ${table.printPrinterId} IS NOT NULL) OR (${table.deliveryMode} IN ('kds_only', 'disabled') AND ${table.printPrinterId} IS NULL))`,
    ),
  ],
);

export const posProductPrices = pgTable(
  "pos_product_prices",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    productId: uuid("product_id").notNull(),
    priceCents: integer("price_cents").notNull(),
    deliveryPriceCents: integer("delivery_price_cents"),
    costCents: integer("cost_cents"),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.unitId, table.productId] }),
    foreignKey({
      name: "pos_product_prices_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_product_prices_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("cascade"),
    check("pos_product_price_check", sql`${table.priceCents} >= 0`),
    check(
      "pos_product_channel_prices_check",
      sql`(${table.deliveryPriceCents} IS NULL OR ${table.deliveryPriceCents} >= 0) AND (${table.costCents} IS NULL OR ${table.costCents} >= 0)`,
    ),
  ],
);

export const posProductAvailability = pgTable(
  "pos_product_availability",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    productId: uuid("product_id").notNull(),
    available: boolean("available").notNull().default(true),
    schedule: jsonb("schedule").$type<PosAvailabilitySchedule | null>(),
    dailyStock: integer("daily_stock"),
    soldToday: integer("sold_today").notNull().default(0),
    autoDeductStock: boolean("auto_deduct_stock").notNull().default(false),
    stockDate: date("stock_date"),
    operationalReason: text("operational_reason"),
    operationalUpdatedByIdentityId: uuid("operational_updated_by_identity_id").references(
      () => identities.id,
    ),
    operationalResetAt: timestamp("operational_reset_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.unitId, table.productId] }),
    foreignKey({
      name: "pos_product_availability_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_product_availability_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("cascade"),
    check(
      "pos_product_daily_stock_check",
      sql`(${table.dailyStock} IS NULL OR ${table.dailyStock} >= 0) AND ${table.soldToday} >= 0`,
    ),
    check(
      "pos_product_operational_reset_check",
      sql`${table.operationalResetAt} IS NULL OR ${table.available} = false`,
    ),
  ],
);

export const posCategoryUnitConfigs = pgTable(
  "pos_category_unit_configs",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    available: boolean("available").notNull().default(true),
    channels: jsonb("channels")
      .$type<string[]>()
      .notNull()
      .default(["salon", "delivery", "qr", "pickup"]),
    schedule: jsonb("schedule").$type<PosAvailabilitySchedule | null>(),
    defaultStationId: uuid("default_station_id"),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.unitId, table.categoryId] }),
    foreignKey({
      name: "pos_category_unit_config_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_category_unit_config_category_fk",
      columns: [table.organizationId, table.categoryId],
      foreignColumns: [posCatalogCategories.organizationId, posCatalogCategories.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_category_unit_config_station_fk",
      columns: [table.organizationId, table.unitId, table.defaultStationId],
      foreignColumns: [
        posProductionStations.organizationId,
        posProductionStations.unitId,
        posProductionStations.id,
      ],
    }).onDelete("set null"),
  ],
);

export const posCatalogBranding = pgTable(
  "pos_catalog_branding",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    config: jsonb("config").$type<PosCatalogMetadata>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.unitId] }),
    foreignKey({
      name: "pos_catalog_branding_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const posTableQrSettings = pgTable(
  "pos_table_qr_settings",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    revision: integer("revision").notNull().default(1),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    headline: varchar("headline", { length: 160 }).notNull(),
    instructions: varchar("instructions", { length: 500 }).notNull(),
    logoUrl: varchar("logo_url", { length: 2_000 }),
    primaryColor: varchar("primary_color", { length: 7 }).notNull(),
    wifiNotice: varchar("wifi_notice", { length: 200 }),
    serviceChargeNotice: varchar("service_charge_notice", { length: 200 }),
    template: varchar("template", { length: 24 }).notNull().default("classic"),
    presenceProtection: varchar("presence_protection", { length: 24 })
      .notNull()
      .default("session_only"),
    updatedByIdentityId: uuid("updated_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.unitId] }),
    foreignKey({
      name: "pos_table_qr_settings_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check("pos_table_qr_settings_revision_check", sql`${table.revision} > 0`),
    check("pos_table_qr_settings_color_check", sql`${table.primaryColor} ~ '^#[0-9A-Fa-f]{6}$'`),
    check(
      "pos_table_qr_settings_template_check",
      sql`${table.template} IN ('classic', 'compact', 'minimal')`,
    ),
    check(
      "pos_table_qr_settings_presence_check",
      sql`${table.presenceProtection} IN ('session_only', 'daily_code')`,
    ),
  ],
);

export const posTableQrPrintBatches = pgTable(
  "pos_table_qr_print_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    format: varchar("format", { length: 24 }).notNull(),
    output: varchar("output", { length: 8 }).notNull(),
    template: varchar("template", { length: 24 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("generated"),
    menuSlug: varchar("menu_slug", { length: 100 }).notNull(),
    includeWifi: boolean("include_wifi").notNull().default(false),
    settingsRevision: integer("settings_revision").notNull(),
    settingsSnapshot: jsonb("settings_snapshot").$type<PosTableQrSettingsSnapshot>().notNull(),
    tablesSnapshot: jsonb("tables_snapshot").$type<PosTableQrBatchTableSnapshot[]>().notNull(),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    printedByIdentityId: uuid("printed_by_identity_id").references(() => identities.id),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    printedAt: timestamp("printed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("pos_table_qr_print_batches_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    index("pos_table_qr_print_batches_unit_time_idx").on(
      table.organizationId,
      table.unitId,
      table.generatedAt,
    ),
    foreignKey({
      name: "pos_table_qr_print_batches_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "pos_table_qr_print_batches_format_check",
      sql`${table.format} IN ('a4_2', 'a4_4', 'a4_6', 'a5', 'table_tent', 'sticker')`,
    ),
    check(
      "pos_table_qr_print_batches_output_check",
      sql`${table.output} IN ('print', 'svg', 'png', 'pdf')`,
    ),
    check(
      "pos_table_qr_print_batches_template_check",
      sql`${table.template} IN ('classic', 'compact', 'minimal')`,
    ),
    check(
      "pos_table_qr_print_batches_status_check",
      sql`${table.status} IN ('generated', 'printed')`,
    ),
    check("pos_table_qr_print_batches_revision_check", sql`${table.settingsRevision} >= 0`),
    check(
      "pos_table_qr_print_batches_printed_check",
      sql`(${table.status} = 'generated' AND ${table.printedAt} IS NULL AND ${table.printedByIdentityId} IS NULL) OR (${table.status} = 'printed' AND ${table.printedAt} IS NOT NULL AND ${table.printedByIdentityId} IS NOT NULL)`,
    ),
  ],
);

export const posCatalogPromotions = pgTable(
  "pos_catalog_promotions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    discountType: varchar("discount_type", { length: 20 }).notNull(),
    discountValue: integer("discount_value").notNull(),
    productIds: jsonb("product_ids").$type<string[]>().notNull().default([]),
    comboIds: jsonb("combo_ids").$type<string[]>().notNull().default([]),
    categoryIds: jsonb("category_ids").$type<string[]>().notNull().default([]),
    channels: jsonb("channels").$type<string[]>().notNull().default(["salon"]),
    daysOfWeek: jsonb("days_of_week").$type<number[]>().notNull().default([]),
    startTime: varchar("start_time", { length: 5 }),
    endTime: varchar("end_time", { length: 5 }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("pos_catalog_promotions_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    foreignKey({
      name: "pos_catalog_promotions_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "pos_catalog_promotion_discount_check",
      sql`${table.discountValue} > 0 AND (${table.discountType} <> 'percentage' OR ${table.discountValue} <= 10000)`,
    ),
  ],
);

export const posProductStations = pgTable(
  "pos_product_stations",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    productId: uuid("product_id").notNull(),
    stationId: uuid("station_id").notNull(),
    stage: integer("stage").notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.unitId, table.productId, table.stationId] }),
    foreignKey({
      name: "pos_product_stations_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("cascade"),
    check("pos_product_stations_stage_check", sql`${table.stage} BETWEEN 1 AND 20`),
    foreignKey({
      name: "pos_product_stations_station_fk",
      columns: [table.organizationId, table.unitId, table.stationId],
      foreignColumns: [
        posProductionStations.organizationId,
        posProductionStations.unitId,
        posProductionStations.id,
      ],
    }).onDelete("cascade"),
  ],
);

export const posKdsTerminalProfiles = pgTable(
  "pos_kds_terminal_profiles",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    mode: posKdsTerminalMode("mode").notNull(),
    stationId: uuid("station_id"),
    label: varchar("label", { length: 120 }).notNull(),
    soundEnabled: boolean("sound_enabled").notNull().default(false),
    fullscreenPreferred: boolean("fullscreen_preferred").notNull().default(false),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    updatedByIdentityId: uuid("updated_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.unitId, table.installationId],
    }),
    index("pos_kds_terminal_profiles_unit_idx").on(table.organizationId, table.unitId),
    foreignKey({
      name: "pos_kds_terminal_profiles_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_kds_terminal_profiles_station_fk",
      columns: [table.organizationId, table.unitId, table.stationId],
      foreignColumns: [
        posProductionStations.organizationId,
        posProductionStations.unitId,
        posProductionStations.id,
      ],
    }).onDelete("restrict"),
    check(
      "pos_kds_terminal_profiles_mode_station_check",
      sql`(${table.mode} = 'station' AND ${table.stationId} IS NOT NULL) OR (${table.mode} = 'pass' AND ${table.stationId} IS NULL)`,
    ),
  ],
);

export const posPaymentTerminalCertifications = pgTable(
  "pos_payment_terminal_certifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    provider: varchar("provider", { length: 24 }).notNull(),
    status: posPaymentCertificationStatus("status").notNull().default("suspended"),
    manufacturer: varchar("manufacturer", { length: 120 }).notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    androidVersion: varchar("android_version", { length: 64 }).notNull(),
    firmwareVersion: varchar("firmware_version", { length: 120 }).notNull(),
    appVersion: varchar("app_version", { length: 64 }).notNull(),
    packageName: varchar("package_name", { length: 180 }).notNull(),
    signingCertificateSha256: varchar("signing_certificate_sha256", { length: 64 }).notNull(),
    methods: jsonb("methods").$type<string[]>().notNull().default([]),
    maxInstallments: integer("max_installments").notNull().default(1),
    supportsCancel: boolean("supports_cancel").notNull().default(false),
    supportsRecover: boolean("supports_recover").notNull().default(false),
    supportsReversal: boolean("supports_reversal").notNull().default(false),
    killSwitchEnabled: boolean("kill_switch_enabled").notNull().default(false),
    killSwitchReason: varchar("kill_switch_reason", { length: 500 }),
    ...timestamps,
  },
  (table) => [
    unique("pos_payment_terminal_certifications_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    foreignKey({
      name: "pos_payment_terminal_certifications_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "pos_payment_terminal_certifications_provider_check",
      sql`${table.provider} IN ('rede', 'paygo', 'stone', 'getnet', 'cielo', 'pagbank')`,
    ),
    check(
      "pos_payment_terminal_certifications_installments_check",
      sql`${table.maxInstallments} BETWEEN 1 AND 24`,
    ),
    check(
      "pos_payment_terminal_certifications_kill_switch_reason_check",
      sql`NOT ${table.killSwitchEnabled} OR ${table.killSwitchReason} IS NOT NULL`,
    ),
  ],
);

export const posTerminalProfiles = pgTable(
  "pos_terminal_profiles",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    mode: varchar("mode", { length: 32 }).notNull(),
    defaultRoute: varchar("default_route", { length: 48 }).notNull(),
    printerId: varchar("printer_id", { length: 120 }),
    stationId: uuid("station_id"),
    compact: boolean("compact").notNull().default(true),
    quickActions: jsonb("quick_actions").$type<string[]>().notNull().default([]),
    paymentProvider: varchar("payment_provider", { length: 24 }),
    paymentStatus: varchar("payment_status", { length: 24 }).notNull().default("disabled"),
    paymentCertificationId: uuid("payment_certification_id"),
    paymentMethods: jsonb("payment_methods").$type<string[]>().notNull().default([]),
    maxPaymentInstallments: integer("max_payment_installments").notNull().default(1),
    paymentSupportsCancel: boolean("payment_supports_cancel").notNull().default(false),
    paymentSupportsRecover: boolean("payment_supports_recover").notNull().default(false),
    paymentSupportsReversal: boolean("payment_supports_reversal").notNull().default(false),
    paymentMode: varchar("payment_mode", { length: 24 }).notNull().default("disabled"),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    updatedByIdentityId: uuid("updated_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.unitId, table.installationId] }),
    index("pos_terminal_profiles_unit_idx").on(table.organizationId, table.unitId),
    foreignKey({
      name: "pos_terminal_profiles_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_terminal_profiles_station_fk",
      columns: [table.organizationId, table.unitId, table.stationId],
      foreignColumns: [
        posProductionStations.organizationId,
        posProductionStations.unitId,
        posProductionStations.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_terminal_profiles_payment_certification_fk",
      columns: [table.organizationId, table.unitId, table.paymentCertificationId],
      foreignColumns: [
        posPaymentTerminalCertifications.organizationId,
        posPaymentTerminalCertifications.unitId,
        posPaymentTerminalCertifications.id,
      ],
    }).onDelete("restrict"),
    check(
      "pos_terminal_profiles_mode_check",
      sql`${table.mode} IN ('waiter_mobile', 'reception', 'cashier', 'kds', 'expedition', 'shared')`,
    ),
    check(
      "pos_terminal_profiles_route_check",
      sql`${table.defaultRoute} IN ('dashboard', 'reservations', 'salon', 'counter', 'cash', 'kds')`,
    ),
    check(
      "pos_terminal_profiles_payment_provider_check",
      sql`${table.paymentProvider} IS NULL OR ${table.paymentProvider} IN ('rede', 'paygo', 'stone', 'getnet', 'cielo', 'pagbank')`,
    ),
    check(
      "pos_terminal_profiles_payment_status_check",
      sql`${table.paymentStatus} IN ('disabled', 'pending', 'homologated', 'suspended')`,
    ),
    check(
      "pos_terminal_profiles_payment_mode_check",
      sql`${table.paymentMode} IN ('disabled', 'cashier', 'homologated_pos')`,
    ),
    check(
      "pos_terminal_profiles_payment_installments_check",
      sql`${table.maxPaymentInstallments} BETWEEN 1 AND 24`,
    ),
  ],
);

export const posPaymentDevicePairingCodes = pgTable(
  "pos_payment_device_pairing_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedByInstallationId: uuid("consumed_by_installation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pos_payment_device_pairing_codes_hash_unique").on(table.codeHash),
    index("pos_payment_device_pairing_codes_scope_idx").on(
      table.organizationId,
      table.unitId,
      table.expiresAt,
    ),
    foreignKey({
      name: "pos_payment_device_pairing_codes_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_payment_device_pairing_codes_consumed_device_fk",
      columns: [table.organizationId, table.unitId, table.consumedByInstallationId],
      foreignColumns: [
        deviceEnrollments.organizationId,
        deviceEnrollments.unitId,
        deviceEnrollments.id,
      ],
    }).onDelete("restrict"),
  ],
);

export const posPaymentDeviceCredentials = pgTable(
  "pos_payment_device_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    publicKeySpki: varchar("public_key_spki", { length: 512 }).notNull(),
    rotationId: uuid("rotation_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    rotateAfter: timestamp("rotate_after", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("pos_payment_device_credentials_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("pos_payment_device_credentials_rotation_unique")
      .on(table.organizationId, table.unitId, table.installationId, table.rotationId)
      .where(sql`${table.rotationId} IS NOT NULL`),
    index("pos_payment_device_credentials_active_idx").on(
      table.organizationId,
      table.unitId,
      table.installationId,
      table.expiresAt,
    ),
    foreignKey({
      name: "pos_payment_device_credentials_device_fk",
      columns: [table.organizationId, table.unitId, table.installationId],
      foreignColumns: [
        deviceEnrollments.organizationId,
        deviceEnrollments.unitId,
        deviceEnrollments.id,
      ],
    }).onDelete("cascade"),
  ],
);

export const posPaymentDeviceRequestNonces = pgTable(
  "pos_payment_device_request_nonces",
  {
    credentialId: uuid("credential_id").notNull(),
    nonce: varchar("nonce", { length: 96 }).notNull(),
    requestTimestamp: timestamp("request_timestamp", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.credentialId, table.nonce] }),
    index("pos_payment_device_request_nonces_created_idx").on(table.createdAt),
    foreignKey({
      name: "pos_payment_device_request_nonces_credential_fk",
      columns: [table.credentialId],
      foreignColumns: [posPaymentDeviceCredentials.id],
    }).onDelete("cascade"),
  ],
);

export const posPaymentDeviceDiagnostics = pgTable(
  "pos_payment_device_diagnostics",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    manufacturer: varchar("manufacturer", { length: 120 }).notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    androidVersion: varchar("android_version", { length: 64 }).notNull(),
    firmwareVersion: varchar("firmware_version", { length: 120 }).notNull(),
    appVersion: varchar("app_version", { length: 64 }).notNull(),
    packageName: varchar("package_name", { length: 180 }).notNull(),
    signingCertificateSha256: varchar("signing_certificate_sha256", { length: 64 }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.unitId, table.installationId] }),
    index("pos_payment_device_diagnostics_last_seen_idx").on(
      table.organizationId,
      table.unitId,
      table.lastSeenAt,
    ),
    foreignKey({
      name: "pos_payment_device_diagnostics_device_fk",
      columns: [table.organizationId, table.unitId, table.installationId],
      foreignColumns: [
        deviceEnrollments.organizationId,
        deviceEnrollments.unitId,
        deviceEnrollments.id,
      ],
    }).onDelete("cascade"),
  ],
);

export const posDiningRooms = pgTable(
  "pos_dining_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    layoutPolygon: jsonb("layout_polygon").$type<PosFloorPoint[] | null>(),
    // Legacy only: responsibility now belongs to a shift section, never to the physical room.
    legacyResponsibleIdentityId: uuid("responsible_identity_id").references(() => identities.id),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("pos_rooms_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    foreignKey({
      name: "pos_rooms_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const posDiningTables = pgTable(
  "pos_dining_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    roomId: uuid("room_id").notNull(),
    label: varchar("label", { length: 60 }).notNull(),
    seats: integer("seats").notNull().default(4),
    status: posTableStatus("status").notNull().default("available"),
    publicAccessVersion: integer("public_access_version").notNull().default(1),
    layoutX: integer("layout_x"),
    layoutY: integer("layout_y"),
    layoutWidth: integer("layout_width").notNull().default(122),
    layoutHeight: integer("layout_height").notNull().default(76),
    layoutRotation: integer("layout_rotation").notNull().default(0),
    layoutShape: varchar("layout_shape", { length: 16 }).notNull().default("rectangle"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("pos_tables_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("pos_tables_room_label_unique").on(table.roomId, table.label),
    foreignKey({
      name: "pos_tables_room_fk",
      columns: [table.organizationId, table.unitId, table.roomId],
      foreignColumns: [posDiningRooms.organizationId, posDiningRooms.unitId, posDiningRooms.id],
    }).onDelete("cascade"),
    check("pos_tables_seats_check", sql`${table.seats} > 0`),
    check(
      "pos_tables_layout_check",
      sql`(${table.layoutX} IS NULL AND ${table.layoutY} IS NULL) OR (${table.layoutX} BETWEEN -1000000 AND 1000000 AND ${table.layoutY} BETWEEN -1000000 AND 1000000)`,
    ),
    check(
      "pos_tables_geometry_check",
      sql`${table.layoutWidth} BETWEEN 24 AND 2000 AND ${table.layoutHeight} BETWEEN 24 AND 2000 AND ${table.layoutRotation} BETWEEN 0 AND 359 AND ${table.layoutShape} IN ('rectangle', 'round', 'square') AND (${table.layoutShape} <> 'square' OR ${table.layoutWidth} = ${table.layoutHeight})`,
    ),
  ],
);

export const posTableQrMetrics = pgTable(
  "pos_table_qr_metrics",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tableId: uuid("table_id").notNull(),
    scanCount: integer("scan_count").notNull().default(0),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.unitId, table.tableId] }),
    foreignKey({
      name: "pos_table_qr_metrics_table_fk",
      columns: [table.organizationId, table.unitId, table.tableId],
      foreignColumns: [posDiningTables.organizationId, posDiningTables.unitId, posDiningTables.id],
    }).onDelete("cascade"),
    check("pos_table_qr_metrics_scan_count_check", sql`${table.scanCount} >= 0`),
  ],
);

export const posFloorLayouts = pgTable(
  "pos_floor_layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    revision: integer("revision").notNull().default(1),
    updatedByIdentityId: uuid("updated_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    unique("pos_floor_layouts_unit_unique").on(table.organizationId, table.unitId),
    foreignKey({
      name: "pos_floor_layouts_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check("pos_floor_layouts_revision_check", sql`${table.revision} > 0`),
  ],
);

export const posFloorElements = pgTable(
  "pos_floor_elements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    roomId: uuid("room_id").notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    label: varchar("label", { length: 120 }),
    layoutX: integer("layout_x").notNull(),
    layoutY: integer("layout_y").notNull(),
    layoutWidth: integer("layout_width").notNull(),
    layoutHeight: integer("layout_height").notNull(),
    layoutRotation: integer("layout_rotation").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique("pos_floor_elements_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    index("pos_floor_elements_room_idx").on(table.organizationId, table.unitId, table.roomId),
    foreignKey({
      name: "pos_floor_elements_room_fk",
      columns: [table.organizationId, table.unitId, table.roomId],
      foreignColumns: [posDiningRooms.organizationId, posDiningRooms.unitId, posDiningRooms.id],
    }).onDelete("cascade"),
    check("pos_floor_elements_kind_check", sql`${table.kind} IN ('label', 'barrier')`),
    check(
      "pos_floor_elements_geometry_check",
      sql`${table.layoutX} BETWEEN -1000000 AND 1000000 AND ${table.layoutY} BETWEEN -1000000 AND 1000000 AND ${table.layoutWidth} BETWEEN 1 AND 1000000 AND ${table.layoutHeight} BETWEEN 1 AND 1000000 AND ${table.layoutRotation} BETWEEN 0 AND 359`,
    ),
  ],
);

export const posServiceSections = pgTable(
  "pos_service_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    color: varchar("color", { length: 7 }).notNull().default("#176B4D"),
    serviceMode: posServiceMode("service_mode").notNull().default("hybrid"),
    defaultResponsibleIdentityId: uuid("default_responsible_identity_id").references(
      () => identities.id,
    ),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("pos_service_sections_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("pos_service_sections_name_unique").on(
      table.organizationId,
      table.unitId,
      table.name,
    ),
    foreignKey({
      name: "pos_service_sections_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check("pos_service_sections_color_check", sql`${table.color} ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

export const posServiceSectionTables = pgTable(
  "pos_service_section_tables",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    sectionId: uuid("section_id").notNull(),
    tableId: uuid("table_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.unitId, table.sectionId, table.tableId],
    }),
    uniqueIndex("pos_service_section_tables_one_section_unique").on(
      table.organizationId,
      table.unitId,
      table.tableId,
    ),
    foreignKey({
      name: "pos_service_section_tables_section_fk",
      columns: [table.organizationId, table.unitId, table.sectionId],
      foreignColumns: [
        posServiceSections.organizationId,
        posServiceSections.unitId,
        posServiceSections.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_service_section_tables_table_fk",
      columns: [table.organizationId, table.unitId, table.tableId],
      foreignColumns: [posDiningTables.organizationId, posDiningTables.unitId, posDiningTables.id],
    }).onDelete("cascade"),
  ],
);

export const posOperationalShifts = pgTable(
  "pos_operational_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    serviceMode: posServiceMode("service_mode").notNull().default("hybrid"),
    status: posOperationalShiftStatus("status").notNull().default("active"),
    openedByIdentityId: uuid("opened_by_identity_id")
      .notNull()
      .references(() => identities.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    assignmentRevision: integer("assignment_revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("pos_operational_shifts_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("pos_operational_shifts_one_active_unique")
      .on(table.organizationId, table.unitId)
      .where(sql`${table.status} = 'active'`),
    index("pos_operational_shifts_history_idx").on(
      table.organizationId,
      table.unitId,
      table.startsAt,
    ),
    foreignKey({
      name: "pos_operational_shifts_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    check("pos_operational_shifts_assignment_revision_check", sql`${table.assignmentRevision} > 0`),
  ],
);

export const posShiftSections = pgTable(
  "pos_shift_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    shiftId: uuid("shift_id").notNull(),
    sectionTemplateId: uuid("section_template_id"),
    name: varchar("name", { length: 120 }).notNull(),
    color: varchar("color", { length: 7 }).notNull(),
    serviceMode: posServiceMode("service_mode").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("pos_shift_sections_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    unique("pos_shift_sections_shift_id_unique").on(
      table.organizationId,
      table.unitId,
      table.shiftId,
      table.id,
    ),
    uniqueIndex("pos_shift_sections_name_unique").on(
      table.organizationId,
      table.unitId,
      table.shiftId,
      table.name,
    ),
    foreignKey({
      name: "pos_shift_sections_shift_fk",
      columns: [table.organizationId, table.unitId, table.shiftId],
      foreignColumns: [
        posOperationalShifts.organizationId,
        posOperationalShifts.unitId,
        posOperationalShifts.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_shift_sections_template_fk",
      columns: [table.organizationId, table.unitId, table.sectionTemplateId],
      foreignColumns: [
        posServiceSections.organizationId,
        posServiceSections.unitId,
        posServiceSections.id,
      ],
    }).onDelete("restrict"),
    check("pos_shift_sections_color_check", sql`${table.color} ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

export const posShiftSectionTables = pgTable(
  "pos_shift_section_tables",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    shiftId: uuid("shift_id").notNull(),
    shiftSectionId: uuid("shift_section_id").notNull(),
    tableId: uuid("table_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.organizationId,
        table.unitId,
        table.shiftId,
        table.shiftSectionId,
        table.tableId,
      ],
    }),
    uniqueIndex("pos_shift_section_tables_one_section_unique").on(
      table.organizationId,
      table.unitId,
      table.shiftId,
      table.tableId,
    ),
    foreignKey({
      name: "pos_shift_section_tables_section_fk",
      columns: [table.organizationId, table.unitId, table.shiftId, table.shiftSectionId],
      foreignColumns: [
        posShiftSections.organizationId,
        posShiftSections.unitId,
        posShiftSections.shiftId,
        posShiftSections.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_shift_section_tables_table_fk",
      columns: [table.organizationId, table.unitId, table.tableId],
      foreignColumns: [posDiningTables.organizationId, posDiningTables.unitId, posDiningTables.id],
    }).onDelete("cascade"),
  ],
);

export const posShiftSectionStaff = pgTable(
  "pos_shift_section_staff",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    shiftId: uuid("shift_id").notNull(),
    shiftSectionId: uuid("shift_section_id").notNull(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id),
    role: posSectionStaffRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.organizationId,
        table.unitId,
        table.shiftId,
        table.shiftSectionId,
        table.identityId,
      ],
    }),
    uniqueIndex("pos_shift_section_staff_one_primary_unique")
      .on(table.organizationId, table.unitId, table.shiftId, table.shiftSectionId)
      .where(sql`${table.role} = 'primary'`),
    foreignKey({
      name: "pos_shift_section_staff_section_fk",
      columns: [table.organizationId, table.unitId, table.shiftId, table.shiftSectionId],
      foreignColumns: [
        posShiftSections.organizationId,
        posShiftSections.unitId,
        posShiftSections.shiftId,
        posShiftSections.id,
      ],
    }).onDelete("cascade"),
  ],
);

export const posShiftTableLayouts = pgTable(
  "pos_shift_table_layouts",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    shiftId: uuid("shift_id").notNull(),
    tableId: uuid("table_id").notNull(),
    roomId: uuid("room_id").notNull(),
    layoutX: integer("layout_x").notNull(),
    layoutY: integer("layout_y").notNull(),
    layoutRotation: integer("layout_rotation").notNull().default(0),
    movedByIdentityId: uuid("moved_by_identity_id")
      .notNull()
      .references(() => identities.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.unitId, table.shiftId, table.tableId],
    }),
    foreignKey({
      name: "pos_shift_table_layouts_shift_fk",
      columns: [table.organizationId, table.unitId, table.shiftId],
      foreignColumns: [
        posOperationalShifts.organizationId,
        posOperationalShifts.unitId,
        posOperationalShifts.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_shift_table_layouts_table_fk",
      columns: [table.organizationId, table.unitId, table.tableId],
      foreignColumns: [posDiningTables.organizationId, posDiningTables.unitId, posDiningTables.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_shift_table_layouts_room_fk",
      columns: [table.organizationId, table.unitId, table.roomId],
      foreignColumns: [posDiningRooms.organizationId, posDiningRooms.unitId, posDiningRooms.id],
    }).onDelete("restrict"),
    check(
      "pos_shift_table_layouts_coordinates_check",
      sql`${table.layoutX} BETWEEN -1000000 AND 1000000 AND ${table.layoutY} BETWEEN -1000000 AND 1000000 AND ${table.layoutRotation} BETWEEN 0 AND 359`,
    ),
  ],
);

export const posShiftTableTransfers = pgTable(
  "pos_shift_table_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    shiftId: uuid("shift_id").notNull(),
    tableId: uuid("table_id").notNull(),
    sourceShiftSectionId: uuid("source_shift_section_id").notNull(),
    targetShiftSectionId: uuid("target_shift_section_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    reason: varchar("reason", { length: 500 }).notNull(),
    reasonCode: varchar("reason_code", { length: 48 }).notNull().default("other"),
    reasonNote: varchar("reason_note", { length: 500 }),
    tabId: uuid("tab_id"),
    previousShiftSectionId: uuid("previous_shift_section_id"),
    previousResponsibleIdentityId: uuid("previous_responsible_identity_id").references(
      () => identities.id,
    ),
    appliedResponsibleIdentityId: uuid("applied_responsible_identity_id").references(
      () => identities.id,
    ),
    appliedTabVersion: integer("applied_tab_version"),
    transferredByIdentityId: uuid("transferred_by_identity_id")
      .notNull()
      .references(() => identities.id),
    endedByIdentityId: uuid("ended_by_identity_id").references(() => identities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pos_shift_table_transfers_one_open_unique")
      .on(table.organizationId, table.unitId, table.shiftId, table.tableId)
      .where(sql`${table.endedAt} IS NULL`),
    index("pos_shift_table_transfers_active_idx").on(
      table.organizationId,
      table.unitId,
      table.shiftId,
      table.expiresAt,
    ),
    foreignKey({
      name: "pos_shift_table_transfers_shift_fk",
      columns: [table.organizationId, table.unitId, table.shiftId],
      foreignColumns: [
        posOperationalShifts.organizationId,
        posOperationalShifts.unitId,
        posOperationalShifts.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_shift_table_transfers_tab_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_shift_table_transfers_table_fk",
      columns: [table.organizationId, table.unitId, table.tableId],
      foreignColumns: [posDiningTables.organizationId, posDiningTables.unitId, posDiningTables.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_shift_table_transfers_source_section_fk",
      columns: [table.organizationId, table.unitId, table.shiftId, table.sourceShiftSectionId],
      foreignColumns: [
        posShiftSections.organizationId,
        posShiftSections.unitId,
        posShiftSections.shiftId,
        posShiftSections.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_shift_table_transfers_target_section_fk",
      columns: [table.organizationId, table.unitId, table.shiftId, table.targetShiftSectionId],
      foreignColumns: [
        posShiftSections.organizationId,
        posShiftSections.unitId,
        posShiftSections.shiftId,
        posShiftSections.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_shift_table_transfers_previous_section_fk",
      columns: [table.organizationId, table.unitId, table.shiftId, table.previousShiftSectionId],
      foreignColumns: [
        posShiftSections.organizationId,
        posShiftSections.unitId,
        posShiftSections.shiftId,
        posShiftSections.id,
      ],
    }).onDelete("restrict"),
    check(
      "pos_shift_table_transfers_distinct_sections_check",
      sql`${table.sourceShiftSectionId} <> ${table.targetShiftSectionId}`,
    ),
    check("pos_shift_table_transfers_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "pos_shift_table_transfers_snapshot_check",
      sql`(${table.tabId} IS NULL AND ${table.appliedTabVersion} IS NULL) OR (${table.tabId} IS NOT NULL AND ${table.appliedTabVersion} IS NOT NULL)`,
    ),
    check(
      "pos_shift_table_transfers_reason_check",
      sql`${table.reasonCode} IN ('service_rebalance', 'staff_coverage', 'operational_reorganization', 'other') AND (${table.reasonCode} <> 'other' OR ${table.reasonNote} IS NOT NULL)`,
    ),
  ],
);

export const posManagerPins = pgTable(
  "pos_manager_pins",
  {
    membershipId: uuid("membership_id")
      .primaryKey()
      .references(() => memberships.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pinHash: text("pin_hash").notNull(),
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("pos_manager_pins_org_idx").on(table.organizationId)],
);

export const posTabs = pgTable(
  "pos_tabs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tableId: uuid("table_id"),
    operationalShiftId: uuid("operational_shift_id"),
    shiftSectionId: uuid("shift_section_id"),
    openedByIdentityId: uuid("opened_by_identity_id")
      .notNull()
      .references(() => identities.id),
    responsibleIdentityId: uuid("responsible_identity_id").references(() => identities.id),
    label: varchar("label", { length: 120 }),
    displayNumber: integer("display_number"),
    fulfillmentType: posFulfillmentType("fulfillment_type").notNull().default("dine_in"),
    customerName: varchar("customer_name", { length: 120 }),
    customerPhone: varchar("customer_phone", { length: 30 }),
    readyNotificationConsent: boolean("ready_notification_consent").notNull().default(false),
    serviceNotes: text("service_notes"),
    deliveryAddress: text("delivery_address"),
    promisedAt: timestamp("promised_at", { withTimezone: true }),
    readyNotifiedAt: timestamp("ready_notified_at", { withTimezone: true }),
    guestCount: integer("guest_count").notNull().default(1),
    version: integer("version").notNull().default(1),
    status: posTabStatus("status").notNull().default("open"),
    mergedIntoTabId: uuid("merged_into_tab_id"),
    serviceChargeBasisPoints: integer("service_charge_basis_points").notNull().default(0),
    tipCents: integer("tip_cents").notNull().default(0),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    discountCents: integer("discount_cents").notNull().default(0),
    serviceChargeCents: integer("service_charge_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("pos_tabs_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("pos_tabs_one_open_per_table_unique")
      .on(table.organizationId, table.unitId, table.tableId)
      .where(sql`${table.status} = 'open' AND ${table.tableId} IS NOT NULL`),
    index("pos_tabs_open_idx").on(table.organizationId, table.unitId, table.status),
    index("pos_tabs_reports_closed_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.closedAt,
    ),
    foreignKey({
      name: "pos_tabs_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_tabs_operational_shift_fk",
      columns: [table.organizationId, table.unitId, table.operationalShiftId],
      foreignColumns: [
        posOperationalShifts.organizationId,
        posOperationalShifts.unitId,
        posOperationalShifts.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_tabs_shift_section_fk",
      columns: [table.organizationId, table.unitId, table.operationalShiftId, table.shiftSectionId],
      foreignColumns: [
        posShiftSections.organizationId,
        posShiftSections.unitId,
        posShiftSections.shiftId,
        posShiftSections.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_tabs_table_fk",
      columns: [table.organizationId, table.unitId, table.tableId],
      foreignColumns: [posDiningTables.organizationId, posDiningTables.unitId, posDiningTables.id],
    }).onDelete("restrict"),
    check("pos_tabs_guest_count_check", sql`${table.guestCount} > 0`),
    check(
      "pos_tabs_display_number_check",
      sql`${table.displayNumber} IS NULL OR ${table.displayNumber} > 0`,
    ),
    check("pos_tabs_version_check", sql`${table.version} > 0`),
    check(
      "pos_tabs_service_rate_check",
      sql`${table.serviceChargeBasisPoints} BETWEEN 0 AND 10000`,
    ),
    check(
      "pos_tabs_totals_check",
      sql`${table.tipCents} >= 0 AND ${table.subtotalCents} >= 0 AND ${table.discountCents} >= 0 AND ${table.serviceChargeCents} >= 0 AND ${table.totalCents} >= 0`,
    ),
  ],
);

export const posPrintSplits = pgTable(
  "pos_print_splits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tabId: uuid("tab_id").notNull(),
    balanceSnapshotCents: integer("balance_snapshot_cents").notNull(),
    method: varchar("method", { length: 24 }).notNull(),
    partCount: integer("part_count").notNull(),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("pos_print_splits_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    foreignKey({
      name: "pos_print_splits_tab_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
    check("pos_print_splits_balance_check", sql`${table.balanceSnapshotCents} > 0`),
    check(
      "pos_print_splits_method_check",
      sql`${table.method} IN ('equal_people', 'fixed_amount')`,
    ),
    check("pos_print_splits_count_check", sql`${table.partCount} BETWEEN 2 AND 50`),
  ],
);

export const posPrintSplitParts = pgTable(
  "pos_print_split_parts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    splitId: uuid("split_id").notNull(),
    partNumber: integer("part_number").notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("pos_print_split_parts_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    unique("pos_print_split_parts_number_unique").on(
      table.organizationId,
      table.unitId,
      table.splitId,
      table.partNumber,
    ),
    foreignKey({
      name: "pos_print_split_parts_split_fk",
      columns: [table.organizationId, table.unitId, table.splitId],
      foreignColumns: [posPrintSplits.organizationId, posPrintSplits.unitId, posPrintSplits.id],
    }).onDelete("cascade"),
    check("pos_print_split_parts_number_check", sql`${table.partNumber} > 0`),
    check("pos_print_split_parts_amount_check", sql`${table.amountCents} > 0`),
  ],
);

export const posServiceCalls = pgTable(
  "pos_service_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tableId: uuid("table_id").notNull(),
    tabId: uuid("tab_id"),
    kind: posServiceCallKind("kind").notNull().default("assistance"),
    status: posServiceCallStatus("status").notNull().default("open"),
    slaMinutes: integer("sla_minutes").notNull().default(3),
    acknowledgedByIdentityId: uuid("acknowledged_by_identity_id").references(() => identities.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedByIdentityId: uuid("resolved_by_identity_id").references(() => identities.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("pos_service_calls_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    index("pos_service_calls_active_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.createdAt,
    ),
    foreignKey({
      name: "pos_service_calls_table_fk",
      columns: [table.organizationId, table.unitId, table.tableId],
      foreignColumns: [posDiningTables.organizationId, posDiningTables.unitId, posDiningTables.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_service_calls_tab_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
    check("pos_service_calls_sla_check", sql`${table.slaMinutes} BETWEEN 1 AND 120`),
  ],
);

export const posOperationalPushSubscriptions = pgTable(
  "pos_operational_push_subscriptions",
  {
    installationId: uuid("installation_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => authSessions.id, { onDelete: "cascade" }),
    endpointHash: varchar("endpoint_hash", { length: 64 }).notNull(),
    encryptedSubscription: text("encrypted_subscription").notNull(),
    encryptionIv: varchar("encryption_iv", { length: 24 }).notNull(),
    encryptionAuthTag: varchar("encryption_auth_tag", { length: 32 }).notNull(),
    subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true }),
    enabled: boolean("enabled").notNull().default(true),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    lastFailureCode: varchar("last_failure_code", { length: 80 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pos_operational_push_endpoint_unique").on(table.endpointHash),
    index("pos_operational_push_scope_idx").on(table.organizationId, table.unitId, table.enabled),
    index("pos_operational_push_identity_idx").on(table.identityId),
    foreignKey({
      name: "pos_operational_push_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const posPaymentAttempts = pgTable(
  "pos_payment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tabId: uuid("tab_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    requestedByIdentityId: uuid("requested_by_identity_id")
      .notNull()
      .references(() => identities.id),
    provider: varchar("provider", { length: 24 }).notNull(),
    method: posPaymentMethod("method").notNull(),
    amountCents: integer("amount_cents").notNull(),
    installments: integer("installments").notNull().default(1),
    status: posPaymentAttemptStatus("status").notNull().default("created"),
    providerReference: varchar("provider_reference", { length: 120 }),
    authorizationCode: varchar("authorization_code", { length: 64 }),
    failureCode: varchar("failure_code", { length: 80 }),
    failureMessage: varchar("failure_message", { length: 500 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    processingAt: timestamp("processing_at", { withTimezone: true }),
    recoveryRequestedAt: timestamp("recovery_requested_at", { withTimezone: true }),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("pos_payment_attempts_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    unique("pos_payment_attempts_device_scope_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
      table.installationId,
    ),
    unique("pos_payment_attempts_tab_scope_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
      table.tabId,
    ),
    index("pos_payment_attempts_tab_status_idx").on(
      table.organizationId,
      table.unitId,
      table.tabId,
      table.status,
    ),
    index("pos_payment_attempts_installation_idx").on(
      table.organizationId,
      table.unitId,
      table.installationId,
      table.createdAt,
    ),
    uniqueIndex("pos_payment_attempts_provider_reference_unique")
      .on(table.organizationId, table.unitId, table.provider, table.providerReference)
      .where(sql`${table.providerReference} IS NOT NULL`),
    foreignKey({
      name: "pos_payment_attempts_tab_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_payment_attempts_device_fk",
      columns: [table.organizationId, table.unitId, table.installationId],
      foreignColumns: [
        deviceEnrollments.organizationId,
        deviceEnrollments.unitId,
        deviceEnrollments.id,
      ],
    }).onDelete("restrict"),
    check("pos_payment_attempts_amount_check", sql`${table.amountCents} > 0`),
    check(
      "pos_payment_attempts_method_check",
      sql`${table.method} IN ('credit_card', 'debit_card', 'pix')`,
    ),
    check("pos_payment_attempts_installments_check", sql`${table.installments} BETWEEN 1 AND 24`),
    check(
      "pos_payment_attempts_non_credit_installments_check",
      sql`${table.method} = 'credit_card' OR ${table.installments} = 1`,
    ),
  ],
);

export const posPaymentAttemptResults = pgTable(
  "pos_payment_attempt_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    attemptId: uuid("attempt_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    deviceResultId: varchar("device_result_id", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    providerReference: varchar("provider_reference", { length: 120 }),
    authorizationCode: varchar("authorization_code", { length: 64 }),
    failureCode: varchar("failure_code", { length: 80 }),
    failureMessage: varchar("failure_message", { length: 500 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pos_payment_attempt_results_device_result_unique").on(
      table.organizationId,
      table.unitId,
      table.installationId,
      table.deviceResultId,
    ),
    index("pos_payment_attempt_results_attempt_idx").on(
      table.organizationId,
      table.unitId,
      table.attemptId,
      table.receivedAt,
    ),
    foreignKey({
      name: "pos_payment_attempt_results_attempt_fk",
      columns: [table.organizationId, table.unitId, table.attemptId, table.installationId],
      foreignColumns: [
        posPaymentAttempts.organizationId,
        posPaymentAttempts.unitId,
        posPaymentAttempts.id,
        posPaymentAttempts.installationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_payment_attempt_results_device_fk",
      columns: [table.organizationId, table.unitId, table.installationId],
      foreignColumns: [
        deviceEnrollments.organizationId,
        deviceEnrollments.unitId,
        deviceEnrollments.id,
      ],
    }).onDelete("restrict"),
    check(
      "pos_payment_attempt_results_status_check",
      sql`${table.status} IN ('processing', 'approved', 'declined', 'canceled', 'unknown')`,
    ),
  ],
);

export const posTabPayments = pgTable(
  "pos_tab_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tabId: uuid("tab_id").notNull(),
    method: posPaymentMethod("method").notNull(),
    amountCents: integer("amount_cents").notNull(),
    reference: varchar("reference", { length: 120 }),
    paymentAttemptId: uuid("payment_attempt_id"),
    source: varchar("source", { length: 24 }).notNull().default("manual"),
    verified: boolean("verified").notNull().default(false),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("pos_tab_payments_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    unique("pos_tab_payments_attempt_scope_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
      table.paymentAttemptId,
    ),
    index("pos_tab_payments_tab_idx").on(table.organizationId, table.unitId, table.tabId),
    uniqueIndex("pos_tab_payments_attempt_unique")
      .on(table.organizationId, table.unitId, table.paymentAttemptId)
      .where(sql`${table.paymentAttemptId} IS NOT NULL`),
    foreignKey({
      name: "pos_tab_payments_tab_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_tab_payments_attempt_fk",
      columns: [table.organizationId, table.unitId, table.paymentAttemptId, table.tabId],
      foreignColumns: [
        posPaymentAttempts.organizationId,
        posPaymentAttempts.unitId,
        posPaymentAttempts.id,
        posPaymentAttempts.tabId,
      ],
    }).onDelete("restrict"),
    check("pos_tab_payments_amount_check", sql`${table.amountCents} > 0`),
    check("pos_tab_payments_source_check", sql`${table.source} IN ('manual', 'terminal')`),
  ],
);

export const posPaymentReversals = pgTable(
  "pos_payment_reversals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    paymentAttemptId: uuid("payment_attempt_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    requestedByIdentityId: uuid("requested_by_identity_id")
      .notNull()
      .references(() => identities.id),
    amountCents: integer("amount_cents").notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    status: posPaymentReversalStatus("status").notNull().default("pending"),
    providerReference: varchar("provider_reference", { length: 120 }),
    failureCode: varchar("failure_code", { length: 80 }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("pos_payment_reversals_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    unique("pos_payment_reversals_device_scope_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
      table.installationId,
    ),
    index("pos_payment_reversals_payment_idx").on(
      table.organizationId,
      table.unitId,
      table.paymentId,
      table.createdAt,
    ),
    uniqueIndex("pos_payment_reversals_one_active_unique")
      .on(table.organizationId, table.unitId, table.paymentId)
      .where(sql`${table.status} IN ('pending', 'processing', 'approved', 'unknown')`),
    foreignKey({
      name: "pos_payment_reversals_payment_fk",
      columns: [table.organizationId, table.unitId, table.paymentId],
      foreignColumns: [posTabPayments.organizationId, posTabPayments.unitId, posTabPayments.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_payment_reversals_payment_attempt_fk",
      columns: [table.organizationId, table.unitId, table.paymentId, table.paymentAttemptId],
      foreignColumns: [
        posTabPayments.organizationId,
        posTabPayments.unitId,
        posTabPayments.id,
        posTabPayments.paymentAttemptId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_payment_reversals_device_fk",
      columns: [table.organizationId, table.unitId, table.installationId],
      foreignColumns: [
        deviceEnrollments.organizationId,
        deviceEnrollments.unitId,
        deviceEnrollments.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_payment_reversals_attempt_device_fk",
      columns: [table.organizationId, table.unitId, table.paymentAttemptId, table.installationId],
      foreignColumns: [
        posPaymentAttempts.organizationId,
        posPaymentAttempts.unitId,
        posPaymentAttempts.id,
        posPaymentAttempts.installationId,
      ],
    }).onDelete("restrict"),
    check("pos_payment_reversals_amount_check", sql`${table.amountCents} > 0`),
  ],
);

export const posPaymentReversalResults = pgTable(
  "pos_payment_reversal_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    reversalId: uuid("reversal_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    deviceResultId: varchar("device_result_id", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    providerReference: varchar("provider_reference", { length: 120 }),
    failureCode: varchar("failure_code", { length: 80 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pos_payment_reversal_results_device_result_unique").on(
      table.organizationId,
      table.unitId,
      table.installationId,
      table.deviceResultId,
    ),
    foreignKey({
      name: "pos_payment_reversal_results_reversal_fk",
      columns: [table.organizationId, table.unitId, table.reversalId, table.installationId],
      foreignColumns: [
        posPaymentReversals.organizationId,
        posPaymentReversals.unitId,
        posPaymentReversals.id,
        posPaymentReversals.installationId,
      ],
    }).onDelete("restrict"),
    check(
      "pos_payment_reversal_results_status_check",
      sql`${table.status} IN ('processing', 'approved', 'declined', 'canceled', 'unknown')`,
    ),
  ],
);

export const posPaymentReconciliations = pgTable(
  "pos_payment_reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    provider: varchar("provider", { length: 24 }).notNull(),
    providerSettlementId: varchar("provider_settlement_id", { length: 160 }).notNull(),
    providerReference: varchar("provider_reference", { length: 120 }).notNull(),
    grossCents: integer("gross_cents").notNull(),
    feeCents: integer("fee_cents").notNull(),
    netCents: integer("net_cents").notNull(),
    expectedSettlementAt: timestamp("expected_settlement_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    status: posPaymentReconciliationStatus("status").notNull().default("pending"),
    source: varchar("source", { length: 24 }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("pos_payment_reconciliations_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    unique("pos_payment_reconciliations_provider_item_unique").on(
      table.organizationId,
      table.unitId,
      table.provider,
      table.providerSettlementId,
      table.providerReference,
    ),
    index("pos_payment_reconciliations_status_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.expectedSettlementAt,
    ),
    foreignKey({
      name: "pos_payment_reconciliations_payment_fk",
      columns: [table.organizationId, table.unitId, table.paymentId],
      foreignColumns: [posTabPayments.organizationId, posTabPayments.unitId, posTabPayments.id],
    }).onDelete("restrict"),
    check(
      "pos_payment_reconciliations_amounts_check",
      sql`${table.grossCents} > 0 AND ${table.feeCents} >= 0 AND ${table.netCents} = ${table.grossCents} - ${table.feeCents}`,
    ),
    check(
      "pos_payment_reconciliations_source_check",
      sql`${table.source} IN ('api', 'webhook', 'import')`,
    ),
    check(
      "pos_payment_reconciliations_settled_at_check",
      sql`${table.status} <> 'settled' OR ${table.settledAt} IS NOT NULL`,
    ),
  ],
);

export const posPaymentHomologationRuns = pgTable(
  "pos_payment_homologation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    certificationId: uuid("certification_id").notNull(),
    installationId: uuid("installation_id").notNull(),
    terminalSerialHash: varchar("terminal_serial_hash", { length: 64 }).notNull(),
    environment: varchar("environment", { length: 24 }).notNull(),
    checklist: jsonb("checklist").$type<Record<string, boolean>>().notNull(),
    evidenceReference: varchar("evidence_reference", { length: 500 }).notNull(),
    notes: text("notes"),
    passed: boolean("passed").notNull(),
    recordedByIdentityId: uuid("recorded_by_identity_id")
      .notNull()
      .references(() => identities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("pos_payment_homologation_runs_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    index("pos_payment_homologation_runs_certification_idx").on(
      table.organizationId,
      table.unitId,
      table.certificationId,
      table.createdAt,
    ),
    foreignKey({
      name: "pos_payment_homologation_runs_certification_fk",
      columns: [table.organizationId, table.unitId, table.certificationId],
      foreignColumns: [
        posPaymentTerminalCertifications.organizationId,
        posPaymentTerminalCertifications.unitId,
        posPaymentTerminalCertifications.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_payment_homologation_runs_device_fk",
      columns: [table.organizationId, table.unitId, table.installationId],
      foreignColumns: [
        deviceEnrollments.organizationId,
        deviceEnrollments.unitId,
        deviceEnrollments.id,
      ],
    }).onDelete("restrict"),
    check(
      "pos_payment_homologation_runs_environment_check",
      sql`${table.environment} IN ('sandbox', 'homologation', 'production')`,
    ),
  ],
);

export const posPrintJobs = pgTable(
  "pos_print_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tabId: uuid("tab_id").notNull(),
    stationId: uuid("station_id"),
    kdsTicketId: uuid("kds_ticket_id"),
    hubCommandId: uuid("hub_command_id"),
    dispatchKey: varchar("dispatch_key", { length: 200 }),
    serviceCallId: uuid("service_call_id"),
    splitPartId: uuid("split_part_id"),
    documentType: posPrintDocumentType("document_type").notNull(),
    status: posPrintJobStatus("status").notNull().default("queued"),
    copies: integer("copies").notNull().default(1),
    terminalId: varchar("terminal_id", { length: 120 }),
    printerId: varchar("printer_id", { length: 120 }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    requestedByIdentityId: uuid("requested_by_identity_id")
      .notNull()
      .references(() => identities.id),
    reprintOfJobId: uuid("reprint_of_job_id"),
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(0),
    printingAt: timestamp("printing_at", { withTimezone: true }),
    printedAt: timestamp("printed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    unique("pos_print_jobs_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    index("pos_print_jobs_queue_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.createdAt,
    ),
    index("pos_print_jobs_tab_idx").on(
      table.organizationId,
      table.unitId,
      table.tabId,
      table.createdAt,
    ),
    index("pos_print_jobs_station_idx").on(
      table.organizationId,
      table.unitId,
      table.stationId,
      table.status,
      table.createdAt,
    ),
    uniqueIndex("pos_print_jobs_dispatch_unique")
      .on(table.organizationId, table.unitId, table.dispatchKey)
      .where(sql`${table.dispatchKey} IS NOT NULL`),
    uniqueIndex("pos_print_jobs_hub_command_unique")
      .on(table.organizationId, table.unitId, table.hubCommandId)
      .where(sql`${table.hubCommandId} IS NOT NULL`),
    foreignKey({
      name: "pos_print_jobs_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_print_jobs_service_call_fk",
      columns: [table.organizationId, table.unitId, table.serviceCallId],
      foreignColumns: [posServiceCalls.organizationId, posServiceCalls.unitId, posServiceCalls.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_print_jobs_split_part_fk",
      columns: [table.organizationId, table.unitId, table.splitPartId],
      foreignColumns: [
        posPrintSplitParts.organizationId,
        posPrintSplitParts.unitId,
        posPrintSplitParts.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_print_jobs_tab_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_print_jobs_station_fk",
      columns: [table.organizationId, table.unitId, table.stationId],
      foreignColumns: [
        posProductionStations.organizationId,
        posProductionStations.unitId,
        posProductionStations.id,
      ],
    }).onDelete("restrict"),
    new ForeignKeyBuilder(() => ({
      name: "pos_print_jobs_kds_ticket_fk",
      columns: [table.organizationId, table.unitId, table.kdsTicketId],
      foreignColumns: [posKdsTickets.organizationId, posKdsTickets.unitId, posKdsTickets.id],
    })).onDelete("restrict"),
    foreignKey({
      name: "pos_print_jobs_hub_command_fk",
      columns: [table.organizationId, table.unitId, table.hubCommandId],
      foreignColumns: [hubCommands.organizationId, hubCommands.unitId, hubCommands.id],
    }).onDelete("set null"),
    check("pos_print_jobs_copies_check", sql`${table.copies} BETWEEN 1 AND 5`),
    check("pos_print_jobs_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "pos_print_jobs_production_scope_check",
      sql`(${table.stationId} IS NULL AND ${table.kdsTicketId} IS NULL) OR (${table.stationId} IS NOT NULL AND ${table.kdsTicketId} IS NOT NULL)`,
    ),
    check(
      "pos_print_jobs_state_timestamps_check",
      sql`(${table.status} <> 'printing' OR ${table.printingAt} IS NOT NULL)
        AND (${table.status} <> 'printed' OR ${table.printedAt} IS NOT NULL)
        AND (${table.status} <> 'failed' OR (${table.failedAt} IS NOT NULL AND ${table.lastError} IS NOT NULL))`,
    ),
  ],
);

export const posTabPresence = pgTable(
  "pos_tab_presence",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tabId: uuid("tab_id").notNull(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.unitId, table.tabId, table.identityId] }),
    index("pos_tab_presence_expiry_idx").on(table.organizationId, table.unitId, table.expiresAt),
    foreignKey({
      name: "pos_tab_presence_tab_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("cascade"),
  ],
);

export const posDiningTableGroups = pgTable(
  "pos_dining_table_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    anchorTableId: uuid("anchor_table_id").notNull(),
    primaryTabId: uuid("primary_tab_id"),
    mode: posTableGroupMode("mode").notNull(),
    responsibleIdentityId: uuid("responsible_identity_id").references(() => identities.id),
    reasonCode: varchar("reason_code", { length: 48 }).notNull().default("other"),
    reasonNote: varchar("reason_note", { length: 500 }),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    dissolvedAt: timestamp("dissolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("pos_table_groups_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    index("pos_table_groups_active_idx").on(table.organizationId, table.unitId, table.dissolvedAt),
    check(
      "pos_table_groups_reason_check",
      sql`${table.reasonCode} IN ('large_party', 'sit_together', 'accessibility', 'operational_reorganization', 'other') AND (${table.reasonCode} <> 'other' OR ${table.reasonNote} IS NOT NULL)`,
    ),
    foreignKey({
      name: "pos_table_groups_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_table_groups_anchor_fk",
      columns: [table.organizationId, table.unitId, table.anchorTableId],
      foreignColumns: [posDiningTables.organizationId, posDiningTables.unitId, posDiningTables.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_table_groups_primary_tab_fk",
      columns: [table.organizationId, table.unitId, table.primaryTabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
  ],
);

export const posDiningTableGroupMembers = pgTable(
  "pos_dining_table_group_members",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    groupId: uuid("group_id").notNull(),
    tableId: uuid("table_id").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.unitId, table.groupId, table.tableId] }),
    uniqueIndex("pos_table_group_member_active_unique").on(
      table.organizationId,
      table.unitId,
      table.tableId,
    ),
    foreignKey({
      name: "pos_table_group_members_group_fk",
      columns: [table.organizationId, table.unitId, table.groupId],
      foreignColumns: [
        posDiningTableGroups.organizationId,
        posDiningTableGroups.unitId,
        posDiningTableGroups.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_table_group_members_table_fk",
      columns: [table.organizationId, table.unitId, table.tableId],
      foreignColumns: [posDiningTables.organizationId, posDiningTables.unitId, posDiningTables.id],
    }).onDelete("restrict"),
  ],
);

export const posOrders = pgTable(
  "pos_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tabId: uuid("tab_id").notNull(),
    originTableId: uuid("origin_table_id"),
    source: varchar("source", { length: 32 }).notNull().default("ops"),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    status: posOrderStatus("status").notNull().default("draft"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readyNotifiedAt: timestamp("ready_notified_at", { withTimezone: true }),
    kdsPriority: integer("kds_priority").notNull().default(0),
    kdsPriorityReason: text("kds_priority_reason"),
    kdsPriorityUpdatedByIdentityId: uuid("kds_priority_updated_by_identity_id").references(
      () => identities.id,
    ),
    kdsPriorityUpdatedAt: timestamp("kds_priority_updated_at", { withTimezone: true }),
    runnerIdentityId: uuid("runner_identity_id").references(() => identities.id),
    runnerClaimedAt: timestamp("runner_claimed_at", { withTimezone: true }),
    runnerPickedUpAt: timestamp("runner_picked_up_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("pos_orders_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    index("pos_orders_tab_idx").on(table.organizationId, table.unitId, table.tabId),
    foreignKey({
      name: "pos_orders_tab_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_orders_origin_table_fk",
      columns: [table.organizationId, table.unitId, table.originTableId],
      foreignColumns: [posDiningTables.organizationId, posDiningTables.unitId, posDiningTables.id],
    }).onDelete("restrict"),
    check("pos_orders_kds_priority_check", sql`${table.kdsPriority} BETWEEN 0 AND 100`),
    check("pos_orders_source_check", sql`${table.source} IN ('ops', 'qr_table')`),
    check(
      "pos_orders_runner_check",
      sql`(${table.runnerIdentityId} IS NULL AND ${table.runnerClaimedAt} IS NULL AND ${table.runnerPickedUpAt} IS NULL) OR (${table.runnerIdentityId} IS NOT NULL AND ${table.runnerClaimedAt} IS NOT NULL AND (${table.runnerPickedUpAt} IS NULL OR ${table.runnerPickedUpAt} >= ${table.runnerClaimedAt}))`,
    ),
  ],
);

export const posOrderItems = pgTable(
  "pos_order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    orderId: uuid("order_id").notNull(),
    productId: uuid("product_id").notNull(),
    stationId: uuid("station_id"),
    productName: varchar("product_name", { length: 160 }).notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    modifiersCents: integer("modifiers_cents").notNull().default(0),
    grossCents: integer("gross_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    netCents: integer("net_cents").notNull(),
    costCents: integer("cost_cents"),
    status: posItemStatus("status").notNull().default("draft"),
    seatNumber: integer("seat_number"),
    course: posOrderCourse("course").notNull().default("anytime"),
    estimatedPrepTimeMinutes: integer("estimated_prep_time_minutes"),
    allergyNote: text("allergy_note"),
    notes: text("notes"),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    canceledReason: text("canceled_reason"),
    ...timestamps,
  },
  (table) => [
    unique("pos_order_items_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    index("pos_order_items_order_idx").on(table.organizationId, table.unitId, table.orderId),
    foreignKey({
      name: "pos_order_items_order_fk",
      columns: [table.organizationId, table.unitId, table.orderId],
      foreignColumns: [posOrders.organizationId, posOrders.unitId, posOrders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_order_items_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("restrict"),
    check(
      "pos_order_items_amounts_check",
      sql`${table.quantity} > 0 AND ${table.unitPriceCents} >= 0 AND ${table.modifiersCents} >= 0 AND ${table.grossCents} >= 0 AND ${table.discountCents} >= 0 AND ${table.netCents} >= 0`,
    ),
    check("pos_order_items_cost_check", sql`${table.costCents} is null or ${table.costCents} >= 0`),
    check(
      "pos_order_items_seat_check",
      sql`${table.seatNumber} IS NULL OR ${table.seatNumber} > 0`,
    ),
    check(
      "pos_order_items_estimated_prep_check",
      sql`${table.estimatedPrepTimeMinutes} IS NULL OR ${table.estimatedPrepTimeMinutes} >= 0`,
    ),
  ],
);

export const posOrderItemModifiers = pgTable(
  "pos_order_item_modifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    optionId: uuid("option_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitDeltaCents: integer("unit_delta_cents").notNull().default(0),
    totalDeltaCents: integer("total_delta_cents").notNull().default(0),
  },
  (table) => [
    foreignKey({
      name: "pos_order_item_modifiers_item_fk",
      columns: [table.organizationId, table.unitId, table.orderItemId],
      foreignColumns: [posOrderItems.organizationId, posOrderItems.unitId, posOrderItems.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_order_item_modifiers_option_fk",
      columns: [table.organizationId, table.optionId],
      foreignColumns: [posModifierOptions.organizationId, posModifierOptions.id],
    }).onDelete("restrict"),
    check("pos_order_item_modifiers_quantity_check", sql`${table.quantity} > 0`),
  ],
);

export const posKdsTickets = pgTable(
  "pos_kds_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    orderId: uuid("order_id").notNull(),
    stationId: uuid("station_id").notNull(),
    status: posKdsStatus("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    handedOffAt: timestamp("handed_off_at", { withTimezone: true }),
    servedAt: timestamp("served_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    recallCount: integer("recall_count").notNull().default(0),
    refireCount: integer("refire_count").notNull().default(0),
    claimedByInstallationId: uuid("claimed_by_installation_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pos_kds_order_station_unique").on(table.orderId, table.stationId),
    unique("pos_kds_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    index("pos_kds_active_queue_idx").on(
      table.organizationId,
      table.unitId,
      table.stationId,
      table.status,
      table.priority,
      table.dueAt,
      table.createdAt,
    ),
    foreignKey({
      name: "pos_kds_order_fk",
      columns: [table.organizationId, table.unitId, table.orderId],
      foreignColumns: [posOrders.organizationId, posOrders.unitId, posOrders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_kds_station_fk",
      columns: [table.organizationId, table.unitId, table.stationId],
      foreignColumns: [
        posProductionStations.organizationId,
        posProductionStations.unitId,
        posProductionStations.id,
      ],
    }).onDelete("restrict"),
    check("pos_kds_priority_check", sql`${table.priority} BETWEEN 0 AND 100`),
    check("pos_kds_counters_check", sql`${table.recallCount} >= 0 AND ${table.refireCount} >= 0`),
    check(
      "pos_kds_claim_check",
      sql`(${table.claimedByInstallationId} IS NULL AND ${table.claimedAt} IS NULL AND ${table.claimExpiresAt} IS NULL) OR (${table.claimedByInstallationId} IS NOT NULL AND ${table.claimedAt} IS NOT NULL AND ${table.claimExpiresAt} > ${table.claimedAt})`,
    ),
  ],
);

export const posKdsTicketItems = pgTable(
  "pos_kds_ticket_items",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
    readyQuantity: integer("ready_quantity").notNull().default(0),
    stage: integer("stage").notNull().default(1),
    courseHeld: boolean("course_held").notNull().default(false),
    dependencyHeld: boolean("dependency_held").notNull().default(false),
    status: posItemStatus("status").notNull().default("queued"),
    held: boolean("held").notNull().default(false),
    heldAt: timestamp("held_at", { withTimezone: true }),
    firedAt: timestamp("fired_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    blockCode: varchar("block_code", { length: 40 }),
    blockReason: text("block_reason"),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockedByIdentityId: uuid("blocked_by_identity_id").references(() => identities.id),
    unblockedAt: timestamp("unblocked_at", { withTimezone: true }),
    unblockedByIdentityId: uuid("unblocked_by_identity_id").references(() => identities.id),
    blockCount: integer("block_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.ticketId, table.orderItemId] }),
    unique("pos_kds_ticket_items_scope_unique").on(
      table.organizationId,
      table.unitId,
      table.ticketId,
      table.orderItemId,
    ),
    index("pos_kds_ticket_items_order_item_idx").on(
      table.organizationId,
      table.unitId,
      table.orderItemId,
    ),
    foreignKey({
      name: "pos_kds_ticket_items_ticket_fk",
      columns: [table.organizationId, table.unitId, table.ticketId],
      foreignColumns: [posKdsTickets.organizationId, posKdsTickets.unitId, posKdsTickets.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_kds_ticket_items_item_fk",
      columns: [table.organizationId, table.unitId, table.orderItemId],
      foreignColumns: [posOrderItems.organizationId, posOrderItems.unitId, posOrderItems.id],
    }).onDelete("restrict"),
    check("pos_kds_ticket_items_quantity_check", sql`${table.quantity} > 0`),
    check("pos_kds_ticket_items_stage_check", sql`${table.stage} BETWEEN 1 AND 20`),
    check(
      "pos_kds_ticket_items_ready_quantity_check",
      sql`${table.readyQuantity} BETWEEN 0 AND ${table.quantity}`,
    ),
    check("pos_kds_ticket_items_block_count_check", sql`${table.blockCount} >= 0`),
    check(
      "pos_kds_ticket_items_block_code_check",
      sql`${table.blockCode} IS NULL OR ${table.blockCode} IN ('missing_ingredient', 'equipment_issue', 'quality_check', 'dependency', 'other')`,
    ),
    check(
      "pos_kds_ticket_items_block_state_check",
      sql`(
        ${table.blockedAt} IS NULL
        AND ${table.blockCode} IS NULL
        AND ${table.blockReason} IS NULL
        AND ${table.blockedByIdentityId} IS NULL
        AND ${table.unblockedAt} IS NULL
        AND ${table.unblockedByIdentityId} IS NULL
      ) OR (
        ${table.blockedAt} IS NOT NULL
        AND ${table.blockCode} IS NOT NULL
        AND ${table.blockReason} IS NOT NULL
        AND ${table.blockedByIdentityId} IS NOT NULL
        AND (
          (${table.unblockedAt} IS NULL AND ${table.unblockedByIdentityId} IS NULL)
          OR (
            ${table.unblockedAt} IS NOT NULL
            AND ${table.unblockedByIdentityId} IS NOT NULL
            AND ${table.unblockedAt} >= ${table.blockedAt}
          )
        )
      )`,
    ),
  ],
);

export const posKdsItemChanges = pgTable(
  "pos_kds_item_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    kind: varchar("kind", { length: 20 }).notNull(),
    revision: varchar("revision", { length: 64 }).notNull(),
    summary: text("summary").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    acknowledgedByIdentityId: uuid("acknowledged_by_identity_id").references(() => identities.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("pos_kds_item_changes_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("pos_kds_item_changes_revision_unique").on(
      table.organizationId,
      table.unitId,
      table.ticketId,
      table.revision,
    ),
    index("pos_kds_item_changes_unacknowledged_idx").on(
      table.organizationId,
      table.unitId,
      table.ticketId,
      table.acknowledgedAt,
      table.createdAt,
    ),
    foreignKey({
      name: "pos_kds_item_changes_assignment_fk",
      columns: [table.organizationId, table.unitId, table.ticketId, table.orderItemId],
      foreignColumns: [
        posKdsTicketItems.organizationId,
        posKdsTicketItems.unitId,
        posKdsTicketItems.ticketId,
        posKdsTicketItems.orderItemId,
      ],
    }).onDelete("cascade"),
    check("pos_kds_item_changes_kind_check", sql`${table.kind} IN ('added', 'updated', 'removed')`),
    check("pos_kds_item_changes_revision_check", sql`${table.revision} ~ '^[0-9a-f]{64}$'`),
    check(
      "pos_kds_item_changes_ack_check",
      sql`(${table.acknowledgedAt} IS NULL AND ${table.acknowledgedByIdentityId} IS NULL) OR (${table.acknowledgedAt} IS NOT NULL AND ${table.acknowledgedByIdentityId} IS NOT NULL)`,
    ),
  ],
);

export const posKdsAttentionAcknowledgements = pgTable(
  "pos_kds_attention_acknowledgements",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    noteId: varchar("note_id", { length: 20 }).notNull(),
    revision: varchar("revision", { length: 64 }).notNull(),
    acknowledgedByIdentityId: uuid("acknowledged_by_identity_id")
      .notNull()
      .references(() => identities.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.organizationId,
        table.unitId,
        table.ticketId,
        table.orderItemId,
        table.noteId,
        table.revision,
      ],
    }),
    index("pos_kds_attention_item_idx").on(
      table.organizationId,
      table.unitId,
      table.ticketId,
      table.orderItemId,
      table.acknowledgedAt,
    ),
    foreignKey({
      name: "pos_kds_attention_assignment_fk",
      columns: [table.organizationId, table.unitId, table.ticketId, table.orderItemId],
      foreignColumns: [
        posKdsTicketItems.organizationId,
        posKdsTicketItems.unitId,
        posKdsTicketItems.ticketId,
        posKdsTicketItems.orderItemId,
      ],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    check("pos_kds_attention_note_check", sql`${table.noteId} IN ('allergy', 'notes')`),
    check("pos_kds_attention_revision_check", sql`${table.revision} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const posKdsBatches = pgTable(
  "pos_kds_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    stationId: uuid("station_id").notNull(),
    productId: uuid("product_id"),
    status: posKdsBatchStatus("status").notNull().default("active"),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    completedByIdentityId: uuid("completed_by_identity_id").references(() => identities.id),
    canceledByIdentityId: uuid("canceled_by_identity_id").references(() => identities.id),
    completionReason: text("completion_reason"),
    cancelReason: text("cancel_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("pos_kds_batches_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    index("pos_kds_batches_active_idx").on(
      table.organizationId,
      table.unitId,
      table.stationId,
      table.status,
      table.createdAt,
    ),
    foreignKey({
      name: "pos_kds_batches_station_fk",
      columns: [table.organizationId, table.unitId, table.stationId],
      foreignColumns: [
        posProductionStations.organizationId,
        posProductionStations.unitId,
        posProductionStations.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_kds_batches_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("restrict"),
    check(
      "pos_kds_batches_state_check",
      sql`(
        ${table.status} = 'active'
        AND ${table.completedAt} IS NULL
        AND ${table.completedByIdentityId} IS NULL
        AND ${table.canceledAt} IS NULL
        AND ${table.canceledByIdentityId} IS NULL
        AND ${table.completionReason} IS NULL
        AND ${table.cancelReason} IS NULL
      ) OR (
        ${table.status} = 'completed'
        AND ${table.completedAt} IS NOT NULL
        AND ${table.completedByIdentityId} IS NOT NULL
        AND ${table.canceledAt} IS NULL
        AND ${table.canceledByIdentityId} IS NULL
        AND ${table.cancelReason} IS NULL
      ) OR (
        ${table.status} = 'canceled'
        AND ${table.canceledAt} IS NOT NULL
        AND ${table.canceledByIdentityId} IS NOT NULL
        AND ${table.cancelReason} IS NOT NULL
        AND ${table.completedAt} IS NULL
        AND ${table.completedByIdentityId} IS NULL
        AND ${table.completionReason} IS NULL
      )`,
    ),
  ],
);

export const posKdsBatchAssignments = pgTable(
  "pos_kds_batch_assignments",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    position: integer("position").notNull(),
    quantity: integer("quantity").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.batchId, table.ticketId, table.orderItemId] }),
    unique("pos_kds_batch_assignments_position_unique").on(table.batchId, table.position),
    uniqueIndex("pos_kds_batch_assignments_active_unique")
      .on(table.organizationId, table.unitId, table.ticketId, table.orderItemId)
      .where(sql`${table.releasedAt} IS NULL`),
    index("pos_kds_batch_assignments_batch_idx").on(
      table.organizationId,
      table.unitId,
      table.batchId,
      table.position,
    ),
    foreignKey({
      name: "pos_kds_batch_assignments_batch_fk",
      columns: [table.organizationId, table.unitId, table.batchId],
      foreignColumns: [posKdsBatches.organizationId, posKdsBatches.unitId, posKdsBatches.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_kds_batch_assignments_assignment_fk",
      columns: [table.organizationId, table.unitId, table.ticketId, table.orderItemId],
      foreignColumns: [
        posKdsTicketItems.organizationId,
        posKdsTicketItems.unitId,
        posKdsTicketItems.ticketId,
        posKdsTicketItems.orderItemId,
      ],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check("pos_kds_batch_assignments_position_check", sql`${table.position} > 0`),
    check("pos_kds_batch_assignments_quantity_check", sql`${table.quantity} > 0`),
    check(
      "pos_kds_batch_assignments_release_check",
      sql`${table.releasedAt} IS NULL OR ${table.releasedAt} >= ${table.joinedAt}`,
    ),
  ],
);

export const posOperationApprovals = pgTable(
  "pos_operation_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    action: posApprovalAction("action").notNull(),
    entityType: varchar("entity_type", { length: 60 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    requestedByIdentityId: uuid("requested_by_identity_id")
      .notNull()
      .references(() => identities.id),
    approvedByMembershipId: uuid("approved_by_membership_id")
      .notNull()
      .references(() => memberships.id),
    reason: text("reason").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pos_approvals_entity_idx").on(table.organizationId, table.unitId, table.entityId),
  ],
);

export const posTabEvents = pgTable(
  "pos_tab_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tabId: uuid("tab_id").notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    type: varchar("type", { length: 80 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pos_tab_events_tab_idx").on(
      table.organizationId,
      table.unitId,
      table.tabId,
      table.createdAt,
    ),
    foreignKey({
      name: "pos_tab_events_tab_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
  ],
);

export const posIdempotencyReceipts = pgTable(
  "pos_idempotency_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    key: varchar("key", { length: 160 }).notNull(),
    operation: varchar("operation", { length: 100 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pos_idempotency_scope_key_unique").on(
      table.organizationId,
      table.unitId,
      table.key,
    ),
    foreignKey({
      name: "pos_idempotency_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);
