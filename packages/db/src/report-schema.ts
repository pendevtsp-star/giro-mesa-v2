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
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { posOrderItems } from "./operations-schema.js";
import { identities, units } from "./schema.js";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const managementReportViewVisibility = pgEnum("management_report_view_visibility", [
  "private",
  "unit",
  "organization",
]);
export const managementReportAlertStatus = pgEnum("management_report_alert_status", [
  "open",
  "claimed",
  "resolved",
  "dismissed",
]);
export const managementReportCostConfidence = pgEnum("management_report_cost_confidence", [
  "exact",
  "estimated",
]);

export const managementReportViews = pgTable(
  "management_report_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    ownerIdentityId: uuid("owner_identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    visibility: managementReportViewVisibility("visibility").notNull().default("private"),
    query: jsonb("query")
      .$type<{
        from: string;
        to: string;
        comparisonMode: "previous_period" | "previous_year" | "none";
        family: string;
      }>()
      .notNull(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("management_report_views_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_report_views_owner_name_unique").on(
      table.organizationId,
      table.unitId,
      table.ownerIdentityId,
      table.name,
    ),
    index("management_report_views_visible_idx").on(
      table.organizationId,
      table.unitId,
      table.visibility,
      table.updatedAt,
    ),
    foreignKey({
      name: "management_report_views_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check("management_report_views_version_check", sql`${table.version} >= 1`),
  ],
);

export const managementReportAlerts = pgTable(
  "management_report_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    occurrenceKey: varchar("occurrence_key", { length: 160 }).notNull(),
    kind: varchar("kind", { length: 80 }).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    detail: text("detail").notNull(),
    severity: varchar("severity", { length: 12 })
      .$type<"info" | "warning" | "critical">()
      .notNull(),
    status: managementReportAlertStatus("status").notNull().default("open"),
    actualCents: integer("actual_cents"),
    targetCents: integer("target_cents"),
    source: jsonb("source").$type<Record<string, unknown>>().notNull().default({}),
    assignedToIdentityId: uuid("assigned_to_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByIdentityId: uuid("resolved_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    updatedByIdentityId: uuid("updated_by_identity_id")
      .notNull()
      .references(() => identities.id),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("management_report_alerts_occurrence_unique").on(
      table.organizationId,
      table.unitId,
      table.occurrenceKey,
    ),
    index("management_report_alerts_work_queue_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.dueAt,
    ),
    foreignKey({
      name: "management_report_alerts_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check(
      "management_report_alerts_severity_check",
      sql`${table.severity} in ('info','warning','critical')`,
    ),
    check(
      "management_report_alerts_resolution_check",
      sql`(${table.status} = 'resolved' and ${table.resolvedAt} is not null and ${table.resolvedByIdentityId} is not null) or (${table.status} <> 'resolved' and ${table.resolvedAt} is null and ${table.resolvedByIdentityId} is null)`,
    ),
    check("management_report_alerts_version_check", sql`${table.version} >= 1`),
  ],
);

export const managementReportCostBackfills = pgTable(
  "management_report_cost_backfills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    from: date("from_date").notNull(),
    to: date("to_date").notNull(),
    allowEstimated: boolean("allow_estimated").notNull().default(false),
    exactCount: integer("exact_count").notNull().default(0),
    estimatedCount: integer("estimated_count").notNull().default(0),
    unavailableCount: integer("unavailable_count").notNull().default(0),
    requestedByIdentityId: uuid("requested_by_identity_id")
      .notNull()
      .references(() => identities.id),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("management_report_cost_backfills_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    index("management_report_cost_backfills_period_idx").on(
      table.organizationId,
      table.unitId,
      table.from,
      table.to,
    ),
    foreignKey({
      name: "management_report_cost_backfills_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check("management_report_cost_backfills_period_check", sql`${table.to} >= ${table.from}`),
    check(
      "management_report_cost_backfills_counts_check",
      sql`${table.exactCount} >= 0 and ${table.estimatedCount} >= 0 and ${table.unavailableCount} >= 0`,
    ),
  ],
);

export const managementReportCostSnapshots = pgTable(
  "management_report_cost_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    backfillId: uuid("backfill_id"),
    costCents: integer("cost_cents").notNull(),
    source: varchar("source", { length: 48 })
      .$type<"inventory_consumption" | "catalog_cost_estimate">()
      .notNull(),
    confidence: managementReportCostConfidence("confidence").notNull(),
    recordedByIdentityId: uuid("recorded_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("management_report_cost_snapshots_order_item_unique").on(
      table.organizationId,
      table.unitId,
      table.orderItemId,
    ),
    foreignKey({
      name: "management_report_cost_snapshots_order_item_fk",
      columns: [table.organizationId, table.unitId, table.orderItemId],
      foreignColumns: [posOrderItems.organizationId, posOrderItems.unitId, posOrderItems.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_report_cost_snapshots_backfill_fk",
      columns: [table.organizationId, table.unitId, table.backfillId],
      foreignColumns: [
        managementReportCostBackfills.organizationId,
        managementReportCostBackfills.unitId,
        managementReportCostBackfills.id,
      ],
    }).onDelete("restrict"),
    check("management_report_cost_snapshots_cost_check", sql`${table.costCents} >= 0`),
    check(
      "management_report_cost_snapshots_source_check",
      sql`(${table.source} = 'inventory_consumption' and ${table.confidence} = 'exact') or (${table.source} = 'catalog_cost_estimate' and ${table.confidence} = 'estimated')`,
    ),
  ],
);
