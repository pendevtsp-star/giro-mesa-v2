import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
import { identities, memberships, organizations, units } from "./schema.js";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export type PosAvailabilitySchedule = {
  windows: { dayOfWeek: number; start: string; end: string }[];
};

export type PosCatalogMetadata = Record<string, unknown>;

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
]);
export const posPrintJobStatus = pgEnum("pos_print_job_status", [
  "queued",
  "printing",
  "printed",
  "failed",
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

export const posProductionStations = pgTable(
  "pos_production_stations",
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
  },
  (table) => [
    primaryKey({ columns: [table.unitId, table.productId, table.stationId] }),
    foreignKey({
      name: "pos_product_stations_product_fk",
      columns: [table.organizationId, table.productId],
      foreignColumns: [posProducts.organizationId, posProducts.id],
    }).onDelete("cascade"),
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
      sql`${table.layoutX} BETWEEN -1000000 AND 1000000 AND ${table.layoutY} BETWEEN -1000000 AND 1000000`,
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
    check(
      "pos_shift_table_transfers_distinct_sections_check",
      sql`${table.sourceShiftSectionId} <> ${table.targetShiftSectionId}`,
    ),
    check("pos_shift_table_transfers_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
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
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("pos_tab_payments_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    index("pos_tab_payments_tab_idx").on(table.organizationId, table.unitId, table.tabId),
    foreignKey({
      name: "pos_tab_payments_tab_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
    check("pos_tab_payments_amount_check", sql`${table.amountCents} > 0`),
  ],
);

export const posPrintJobs = pgTable(
  "pos_print_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tabId: uuid("tab_id").notNull(),
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
    foreignKey({
      name: "pos_print_jobs_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_print_jobs_tab_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
    check("pos_print_jobs_copies_check", sql`${table.copies} BETWEEN 1 AND 10`),
    check("pos_print_jobs_attempts_check", sql`${table.attempts} >= 0`),
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
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    dissolvedAt: timestamp("dissolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("pos_table_groups_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    index("pos_table_groups_active_idx").on(table.organizationId, table.unitId, table.dissolvedAt),
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
