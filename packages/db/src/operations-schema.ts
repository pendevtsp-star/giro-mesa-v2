import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { deviceEnrollments, identities, memberships, organizations, units } from "./schema.js";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export type PosAvailabilitySchedule = {
  windows: { dayOfWeek: number; start: string; end: string }[];
};

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
export const posTableStatus = pgEnum("pos_table_status", ["available", "occupied", "reserved"]);
export const posApprovalAction = pgEnum("pos_approval_action", ["discount", "cancel"]);
export const layoutVersionState = pgEnum("layout_version_state", ["draft", "published"]);
export const serviceShiftState = pgEnum("service_shift_state", [
  "scheduled",
  "open",
  "handoff",
  "closed",
]);
export const tableOccupancyState = pgEnum("table_occupancy_state", [
  "reserved",
  "open",
  "paying",
  "closed",
]);
export const salonExceptionState = pgEnum("salon_exception_state", [
  "open",
  "acknowledged",
  "resolved",
]);
export const productionDispatchMode = pgEnum("production_dispatch_mode", [
  "kds",
  "print",
  "both",
  "kds_with_contingency_print",
  "off",
]);
export const dispatchDestination = pgEnum("dispatch_destination", ["kds", "printer"]);
export const dispatchEffectState = pgEnum("dispatch_effect_state", [
  "pending",
  "delivered",
  "acked",
  "canceled",
  "dlq",
]);
export const dispatchOperation = pgEnum("dispatch_operation", [
  "dispatch",
  "reprint",
  "cancel",
  "contingency",
]);

export const posCatalogCategories = pgTable(
  "pos_catalog_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
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
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("pos_products_org_id_unique").on(table.organizationId, table.id),
    uniqueIndex("pos_products_org_sku_unique").on(table.organizationId, table.sku),
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

export const posDiningRooms = pgTable(
  "pos_dining_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
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
    occupancyEpoch: uuid("occupancy_epoch").notNull().defaultRandom(),
    resourceVersion: integer("resource_version").notNull().default(0),
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
    check("pos_tables_resource_version_check", sql`${table.resourceVersion} >= 0`),
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
    occupancyEpoch: uuid("occupancy_epoch").notNull().defaultRandom(),
    resourceVersion: integer("resource_version").notNull().default(0),
    openedByIdentityId: uuid("opened_by_identity_id")
      .notNull()
      .references(() => identities.id),
    label: varchar("label", { length: 120 }),
    guestCount: integer("guest_count").notNull().default(1),
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
    foreignKey({
      name: "pos_tabs_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "pos_tabs_table_fk",
      columns: [table.organizationId, table.unitId, table.tableId],
      foreignColumns: [posDiningTables.organizationId, posDiningTables.unitId, posDiningTables.id],
    }).onDelete("restrict"),
    check("pos_tabs_guest_count_check", sql`${table.guestCount} > 0`),
    check(
      "pos_tabs_service_rate_check",
      sql`${table.serviceChargeBasisPoints} BETWEEN 0 AND 10000`,
    ),
    check(
      "pos_tabs_totals_check",
      sql`${table.tipCents} >= 0 AND ${table.subtotalCents} >= 0 AND ${table.discountCents} >= 0 AND ${table.serviceChargeCents} >= 0 AND ${table.totalCents} >= 0`,
    ),
    check("pos_tabs_resource_version_check", sql`${table.resourceVersion} >= 0`),
  ],
);

export const posOrders = pgTable(
  "pos_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tabId: uuid("tab_id").notNull(),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    status: posOrderStatus("status").notNull().default("draft"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
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
    status: posItemStatus("status").notNull().default("draft"),
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
    startedAt: timestamp("started_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pos_kds_order_station_unique").on(table.orderId, table.stationId),
    unique("pos_kds_scope_id_unique").on(table.organizationId, table.unitId, table.id),
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
  ],
);

export const posKdsTicketItems = pgTable(
  "pos_kds_ticket_items",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ticketId, table.orderItemId] }),
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

export const serviceAreas = pgTable(
  "service_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    roomId: uuid("room_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    code: varchar("code", { length: 60 }).notNull(),
    resourceVersion: integer("resource_version").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("service_areas_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("service_areas_room_code_unique").on(table.roomId, table.code),
    foreignKey({
      name: "service_areas_room_scope_fk",
      columns: [table.organizationId, table.unitId, table.roomId],
      foreignColumns: [posDiningRooms.organizationId, posDiningRooms.unitId, posDiningRooms.id],
    }).onDelete("cascade"),
    check("service_areas_resource_version_check", sql`${table.resourceVersion} >= 0`),
  ],
);

export const tableLayoutVersions = pgTable(
  "table_layout_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    roomId: uuid("room_id").notNull(),
    version: integer("version").notNull(),
    state: layoutVersionState("state").notNull().default("draft"),
    resourceVersion: integer("resource_version").notNull().default(0),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("table_layout_versions_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("table_layout_versions_room_version_unique").on(table.roomId, table.version),
    foreignKey({
      name: "table_layout_versions_room_scope_fk",
      columns: [table.organizationId, table.unitId, table.roomId],
      foreignColumns: [posDiningRooms.organizationId, posDiningRooms.unitId, posDiningRooms.id],
    }).onDelete("restrict"),
    check("table_layout_versions_version_check", sql`${table.version} > 0`),
    check("table_layout_versions_resource_check", sql`${table.resourceVersion} >= 0`),
  ],
);

export const tableLayoutNodes = pgTable(
  "table_layout_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    layoutVersionId: uuid("layout_version_id").notNull(),
    tableId: uuid("table_id").notNull(),
    areaId: uuid("area_id"),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    rotation: integer("rotation").notNull().default(0),
    zIndex: integer("z_index").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique("table_layout_nodes_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("table_layout_nodes_layout_table_unique").on(table.layoutVersionId, table.tableId),
    foreignKey({
      name: "table_layout_nodes_version_scope_fk",
      columns: [table.organizationId, table.unitId, table.layoutVersionId],
      foreignColumns: [
        tableLayoutVersions.organizationId,
        tableLayoutVersions.unitId,
        tableLayoutVersions.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "table_layout_nodes_table_scope_fk",
      columns: [table.organizationId, table.unitId, table.tableId],
      foreignColumns: [posDiningTables.organizationId, posDiningTables.unitId, posDiningTables.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "table_layout_nodes_area_scope_fk",
      columns: [table.organizationId, table.unitId, table.areaId],
      foreignColumns: [serviceAreas.organizationId, serviceAreas.unitId, serviceAreas.id],
    }).onDelete("restrict"),
    check(
      "table_layout_nodes_geometry_check",
      sql`${table.x} >= 0 and ${table.y} >= 0 and ${table.width} between 1 and 10000 and ${table.height} between 1 and 10000 and ${table.x} + ${table.width} <= 10000 and ${table.y} + ${table.height} <= 10000`,
    ),
    check("table_layout_nodes_rotation_check", sql`${table.rotation} between -180 and 180`),
  ],
);

export const serviceShifts = pgTable(
  "service_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    state: serviceShiftState("state").notNull().default("scheduled"),
    resourceVersion: integer("resource_version").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    openedByIdentityId: uuid("opened_by_identity_id").references(() => identities.id),
    closedByIdentityId: uuid("closed_by_identity_id").references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    unique("service_shifts_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("service_shifts_one_live_unit_unique")
      .on(table.unitId)
      .where(sql`${table.state} in ('open', 'handoff')`),
    foreignKey({
      name: "service_shifts_unit_scope_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    check("service_shifts_resource_check", sql`${table.resourceVersion} >= 0`),
    check(
      "service_shifts_time_check",
      sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

export const areaAssignments = pgTable(
  "area_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    shiftId: uuid("shift_id").notNull(),
    areaId: uuid("area_id").notNull(),
    primaryIdentityId: uuid("primary_identity_id")
      .notNull()
      .references(() => identities.id),
    supportIdentityId: uuid("support_identity_id").references(() => identities.id),
    fallbackRole: varchar("fallback_role", { length: 30 }).notNull().default("manager"),
    resourceVersion: integer("resource_version").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique("area_assignments_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("area_assignments_shift_area_unique").on(table.shiftId, table.areaId),
    foreignKey({
      name: "area_assignments_shift_scope_fk",
      columns: [table.organizationId, table.unitId, table.shiftId],
      foreignColumns: [serviceShifts.organizationId, serviceShifts.unitId, serviceShifts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "area_assignments_area_scope_fk",
      columns: [table.organizationId, table.unitId, table.areaId],
      foreignColumns: [serviceAreas.organizationId, serviceAreas.unitId, serviceAreas.id],
    }).onDelete("restrict"),
  ],
);

export const tableGroups = pgTable(
  "table_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    occupancyEpoch: uuid("occupancy_epoch").notNull().defaultRandom(),
    resourceVersion: integer("resource_version").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("table_groups_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("table_groups_epoch_unique").on(table.occupancyEpoch),
    foreignKey({
      name: "table_groups_unit_scope_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
  ],
);

export const tableOccupancies = pgTable(
  "table_occupancies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tableId: uuid("table_id").notNull(),
    groupId: uuid("group_id"),
    tabId: uuid("tab_id"),
    reservationId: uuid("reservation_id"),
    assignedIdentityId: uuid("assigned_identity_id").references(() => identities.id),
    state: tableOccupancyState("state").notNull(),
    occupancyEpoch: uuid("occupancy_epoch").notNull().defaultRandom(),
    resourceVersion: integer("resource_version").notNull().default(0),
    guestCount: integer("guest_count").notNull().default(1),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("table_occupancies_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    unique("table_occupancies_scope_epoch_unique").on(
      table.organizationId,
      table.unitId,
      table.occupancyEpoch,
    ),
    uniqueIndex("table_occupancies_one_live_table_unique")
      .on(table.organizationId, table.unitId, table.tableId)
      .where(sql`${table.state} in ('reserved', 'open', 'paying')`),
    foreignKey({
      name: "table_occupancies_table_scope_fk",
      columns: [table.organizationId, table.unitId, table.tableId],
      foreignColumns: [posDiningTables.organizationId, posDiningTables.unitId, posDiningTables.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "table_occupancies_group_scope_fk",
      columns: [table.organizationId, table.unitId, table.groupId],
      foreignColumns: [tableGroups.organizationId, tableGroups.unitId, tableGroups.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "table_occupancies_tab_scope_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
    check("table_occupancies_resource_check", sql`${table.resourceVersion} >= 0`),
    check("table_occupancies_guest_count_check", sql`${table.guestCount} > 0`),
    check(
      "table_occupancies_closed_at_check",
      sql`(${table.state} = 'closed') = (${table.closedAt} is not null)`,
    ),
  ],
);

export const tableGroupMembers = pgTable(
  "table_group_members",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    groupId: uuid("group_id").notNull(),
    occupancyId: uuid("occupancy_id").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.unitId, table.groupId, table.occupancyId] }),
    foreignKey({
      name: "table_group_members_group_scope_fk",
      columns: [table.organizationId, table.unitId, table.groupId],
      foreignColumns: [tableGroups.organizationId, tableGroups.unitId, tableGroups.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "table_group_members_occupancy_scope_fk",
      columns: [table.organizationId, table.unitId, table.occupancyId],
      foreignColumns: [
        tableOccupancies.organizationId,
        tableOccupancies.unitId,
        tableOccupancies.id,
      ],
    }).onDelete("restrict"),
  ],
);

export const tableOccupancyEvents = pgTable(
  "table_occupancy_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    occupancyId: uuid("occupancy_id").notNull(),
    occupancyEpoch: uuid("occupancy_epoch").notNull(),
    sequence: integer("sequence").notNull(),
    type: varchar("type", { length: 60 }).notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    before: jsonb("before").$type<Record<string, unknown>>().notNull(),
    after: jsonb("after").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("table_occupancy_events_sequence_unique").on(table.occupancyId, table.sequence),
    uniqueIndex("table_occupancy_events_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "table_occupancy_events_occupancy_scope_fk",
      columns: [table.organizationId, table.unitId, table.occupancyId],
      foreignColumns: [
        tableOccupancies.organizationId,
        tableOccupancies.unitId,
        tableOccupancies.id,
      ],
    }).onDelete("restrict"),
    check("table_occupancy_events_sequence_check", sql`${table.sequence} > 0`),
  ],
);

export const serviceIncidents = pgTable(
  "service_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    occupancyId: uuid("occupancy_id"),
    tableId: uuid("table_id"),
    type: varchar("type", { length: 60 }).notNull(),
    summary: varchar("summary", { length: 300 }).notNull(),
    state: varchar("state", { length: 20 }).notNull().default("open"),
    reportedByIdentityId: uuid("reported_by_identity_id")
      .notNull()
      .references(() => identities.id),
    resolvedByIdentityId: uuid("resolved_by_identity_id").references(() => identities.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("service_incidents_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    foreignKey({
      name: "service_incidents_unit_scope_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
  ],
);

export const staffPresenceLeases = pgTable(
  "staff_presence_leases",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id),
    deviceId: uuid("device_id").notNull(),
    leaseEpoch: uuid("lease_epoch").notNull().defaultRandom(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resourceVersion: integer("resource_version").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.unitId, table.identityId, table.deviceId] }),
    foreignKey({
      name: "staff_presence_device_scope_fk",
      columns: [table.organizationId, table.unitId, table.deviceId],
      foreignColumns: [
        deviceEnrollments.organizationId,
        deviceEnrollments.unitId,
        deviceEnrollments.id,
      ],
    }).onDelete("cascade"),
  ],
);

export const salonExceptions = pgTable(
  "salon_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    occupancyId: uuid("occupancy_id"),
    tableId: uuid("table_id"),
    code: varchar("code", { length: 80 }).notNull(),
    severity: varchar("severity", { length: 20 }).notNull(),
    state: salonExceptionState("state").notNull().default("open"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    acknowledgedByIdentityId: uuid("acknowledged_by_identity_id").references(() => identities.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("salon_exceptions_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    index("salon_exceptions_open_idx").on(table.organizationId, table.unitId, table.state),
    foreignKey({
      name: "salon_exceptions_unit_scope_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
  ],
);

export const productionStationRoutes = pgTable(
  "production_station_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    stationId: uuid("station_id").notNull(),
    mode: productionDispatchMode("mode").notNull().default("kds"),
    kdsTargetRef: varchar("kds_target_ref", { length: 160 }),
    printerTargetRef: varchar("printer_target_ref", { length: 160 }),
    fallbackAfterSeconds: integer("fallback_after_seconds").notNull().default(45),
    active: boolean("active").notNull().default(true),
    resourceVersion: integer("resource_version").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique("production_station_routes_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("production_station_routes_station_unique").on(
      table.organizationId,
      table.unitId,
      table.stationId,
    ),
    foreignKey({
      name: "production_station_routes_station_scope_fk",
      columns: [table.organizationId, table.unitId, table.stationId],
      foreignColumns: [
        posProductionStations.organizationId,
        posProductionStations.unitId,
        posProductionStations.id,
      ],
    }).onDelete("cascade"),
    check(
      "production_station_routes_fallback_check",
      sql`${table.fallbackAfterSeconds} between 5 and 3600`,
    ),
  ],
);

export const dispatchEffects = pgTable(
  "dispatch_effects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    orderId: uuid("order_id").notNull(),
    stationId: uuid("station_id").notNull(),
    routeId: uuid("route_id"),
    destination: dispatchDestination("destination").notNull(),
    targetRef: varchar("target_ref", { length: 160 }).notNull(),
    operation: dispatchOperation("operation").notNull().default("dispatch"),
    effectKey: varchar("effect_key", { length: 240 }).notNull(),
    state: dispatchEffectState("state").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    resourceVersion: integer("resource_version").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    unique("dispatch_effects_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("dispatch_effects_exactly_once_unique").on(
      table.organizationId,
      table.unitId,
      table.effectKey,
    ),
    index("dispatch_effects_pending_idx").on(
      table.organizationId,
      table.unitId,
      table.state,
      table.nextAttemptAt,
    ),
    foreignKey({
      name: "dispatch_effects_order_scope_fk",
      columns: [table.organizationId, table.unitId, table.orderId],
      foreignColumns: [posOrders.organizationId, posOrders.unitId, posOrders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "dispatch_effects_station_scope_fk",
      columns: [table.organizationId, table.unitId, table.stationId],
      foreignColumns: [
        posProductionStations.organizationId,
        posProductionStations.unitId,
        posProductionStations.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "dispatch_effects_route_scope_fk",
      columns: [table.organizationId, table.unitId, table.routeId],
      foreignColumns: [
        productionStationRoutes.organizationId,
        productionStationRoutes.unitId,
        productionStationRoutes.id,
      ],
    }).onDelete("restrict"),
    check("dispatch_effects_attempt_check", sql`${table.attemptCount} >= 0`),
  ],
);

export const dispatchAttempts = pgTable(
  "dispatch_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    effectId: uuid("effect_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    deliveryKey: varchar("delivery_key", { length: 240 }).notNull(),
    state: varchar("state", { length: 24 }).$type<"scheduled" | "delivered" | "failed">().notNull(),
    error: text("error"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dispatch_attempts_number_unique").on(table.effectId, table.attemptNumber),
    uniqueIndex("dispatch_attempts_delivery_key_unique").on(table.deliveryKey),
    foreignKey({
      name: "dispatch_attempts_effect_scope_fk",
      columns: [table.organizationId, table.unitId, table.effectId],
      foreignColumns: [dispatchEffects.organizationId, dispatchEffects.unitId, dispatchEffects.id],
    }).onDelete("restrict"),
  ],
);

export const dispatchAcknowledgements = pgTable(
  "dispatch_acknowledgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    effectId: uuid("effect_id").notNull(),
    acknowledgementKey: varchar("acknowledgement_key", { length: 160 }).notNull(),
    acknowledgedByIdentityId: uuid("acknowledged_by_identity_id").references(() => identities.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dispatch_acknowledgements_key_unique").on(
      table.effectId,
      table.acknowledgementKey,
    ),
    foreignKey({
      name: "dispatch_acknowledgements_effect_scope_fk",
      columns: [table.organizationId, table.unitId, table.effectId],
      foreignColumns: [dispatchEffects.organizationId, dispatchEffects.unitId, dispatchEffects.id],
    }).onDelete("restrict"),
  ],
);

export const dispatchDeadLetters = pgTable(
  "dispatch_dead_letters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    effectId: uuid("effect_id").notNull(),
    reason: text("reason").notNull(),
    resolvedByIdentityId: uuid("resolved_by_identity_id").references(() => identities.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dispatch_dead_letters_open_unique")
      .on(table.effectId)
      .where(sql`${table.resolvedAt} is null`),
    foreignKey({
      name: "dispatch_dead_letters_effect_scope_fk",
      columns: [table.organizationId, table.unitId, table.effectId],
      foreignColumns: [dispatchEffects.organizationId, dispatchEffects.unitId, dispatchEffects.id],
    }).onDelete("restrict"),
  ],
);

export const operationsTenantTables = [
  posCatalogCategories,
  posAllergens,
  posModifierGroups,
  posModifierOptions,
  posProducts,
  posProductAllergens,
  posProductModifierGroups,
  posRecipeComponents,
  posProductionStations,
  posProductPrices,
  posProductAvailability,
  posProductStations,
  posDiningRooms,
  posDiningTables,
  posManagerPins,
  posTabs,
  posOrders,
  posOrderItems,
  posOrderItemModifiers,
  posKdsTickets,
  posKdsTicketItems,
  posOperationApprovals,
  posTabEvents,
  posIdempotencyReceipts,
  serviceAreas,
  tableLayoutVersions,
  tableLayoutNodes,
  serviceShifts,
  areaAssignments,
  tableGroups,
  tableOccupancies,
  tableGroupMembers,
  tableOccupancyEvents,
  serviceIncidents,
  staffPresenceLeases,
  salonExceptions,
  productionStationRoutes,
  dispatchEffects,
  dispatchAttempts,
  dispatchAcknowledgements,
  dispatchDeadLetters,
] as const;

for (const table of operationsTenantTables) table.enableRLS();
