import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { growthIntegrations } from "./growth-schema.js";
import { posOrderItems, posOrders } from "./operations-schema.js";
import { organizations, units } from "./schema.js";

export type DoseClubRedemptionStatus =
  | "pending_reservation"
  | "reserved"
  | "commit_pending"
  | "committed"
  | "cancel_pending"
  | "canceled"
  | "expired"
  | "reverse_pending"
  | "reversed"
  | "failed";

export const doseClubRedemptions = pgTable(
  "doseclub_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => growthIntegrations.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    externalCustomerId: varchar("external_customer_id", { length: 180 }).notNull(),
    externalClubId: varchar("external_club_id", { length: 180 }).notNull(),
    externalProductId: varchar("external_product_id", { length: 180 }).notNull(),
    doses: integer("doses").notNull(),
    status: varchar("status", { length: 32 })
      .$type<DoseClubRedemptionStatus>()
      .notNull()
      .default("pending_reservation"),
    operationId: varchar("operation_id", { length: 180 }),
    reserveIdempotencyKey: varchar("reserve_idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    availableDoses: integer("available_doses"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    lastErrorMessage: varchar("last_error_message", { length: 500 }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("doseclub_redemptions_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    uniqueIndex("doseclub_redemptions_order_item_unique").on(
      table.organizationId,
      table.unitId,
      table.orderItemId,
    ),
    uniqueIndex("doseclub_redemptions_reserve_key_unique").on(
      table.integrationId,
      table.reserveIdempotencyKey,
    ),
    uniqueIndex("doseclub_redemptions_operation_unique").on(table.integrationId, table.operationId),
    index("doseclub_redemptions_order_idx").on(table.organizationId, table.unitId, table.orderId),
    index("doseclub_redemptions_status_idx").on(table.status, table.updatedAt),
    foreignKey({
      name: "doseclub_redemptions_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "doseclub_redemptions_order_fk",
      columns: [table.organizationId, table.unitId, table.orderId],
      foreignColumns: [posOrders.organizationId, posOrders.unitId, posOrders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "doseclub_redemptions_order_item_fk",
      columns: [table.organizationId, table.unitId, table.orderItemId],
      foreignColumns: [posOrderItems.organizationId, posOrderItems.unitId, posOrderItems.id],
    }).onDelete("restrict"),
    check("doseclub_redemptions_doses_check", sql`${table.doses} between 1 and 500`),
    check(
      "doseclub_redemptions_status_check",
      sql`${table.status} in ('pending_reservation','reserved','commit_pending','committed','cancel_pending','canceled','expired','reverse_pending','reversed','failed')`,
    ),
    check(
      "doseclub_redemptions_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check("doseclub_redemptions_version_check", sql`${table.version} > 0`),
  ],
);
