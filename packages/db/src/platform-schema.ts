import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { identities, organizations, units } from "./schema.js";

export const platformIncidentStates = pgTable(
  "platform_incident_states",
  {
    fingerprint: varchar("fingerprint", { length: 255 }).primaryKey(),
    source: varchar("source", { length: 24 }).notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 })
      .$type<"open" | "claimed" | "snoozed" | "resolved">()
      .notNull()
      .default("open"),
    claimedByIdentityId: uuid("claimed_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    reason: text("reason"),
    updatedByIdentityId: uuid("updated_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("platform_incident_states_status_idx").on(table.status, table.snoozedUntil),
    index("platform_incident_states_org_idx").on(table.organizationId, table.updatedAt),
    check(
      "platform_incident_states_status_check",
      sql`${table.status} in ('open', 'claimed', 'snoozed', 'resolved')`,
    ),
  ],
);

export const platformActionReceipts = pgTable(
  "platform_action_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    targetType: varchar("target_type", { length: 40 }).notNull(),
    targetId: varchar("target_id", { length: 255 }).notNull(),
    reason: text("reason").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_action_receipts_actor_key_unique").on(
      table.actorIdentityId,
      table.idempotencyKey,
    ),
    index("platform_action_receipts_target_idx").on(table.targetType, table.targetId),
    check("platform_action_receipts_reason_check", sql`length(trim(${table.reason})) >= 8`),
  ],
);
