import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { identities, organizations, units } from "./schema.js";

export const commandInboxStatus = pgEnum("command_inbox_status", [
  "applied",
  "quarantined",
  "rejected",
]);
export const commandQuarantineStatus = pgEnum("command_quarantine_status", [
  "pending",
  "recovered",
]);

export type CommandResult = {
  status: "applied" | "quarantined" | "rejected";
  code?: string;
  expectedSequence?: number;
  receivedSequence?: number;
  effect?: Record<string, unknown> | null;
};

export const commandInbox = pgTable(
  "command_inbox",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    commandId: uuid("command_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    deviceId: uuid("device_id").notNull(),
    commandType: varchar("command_type", { length: 100 }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    occupancyEpoch: uuid("occupancy_epoch").notNull(),
    resourceVersion: integer("resource_version").notNull(),
    aggregateSequence: integer("aggregate_sequence").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: commandInboxStatus("status").notNull(),
    result: jsonb("result").$type<CommandResult>().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.unitId, table.commandId] }),
    uniqueIndex("command_inbox_scope_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    index("command_inbox_aggregate_sequence_idx").on(
      table.organizationId,
      table.unitId,
      table.aggregateType,
      table.aggregateId,
      table.occupancyEpoch,
      table.aggregateSequence,
    ),
    index("command_inbox_received_idx").on(table.organizationId, table.unitId, table.receivedAt),
    foreignKey({
      name: "command_inbox_organization_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check("command_inbox_resource_version_check", sql`${table.resourceVersion} >= 0`),
    check("command_inbox_aggregate_sequence_check", sql`${table.aggregateSequence} > 0`),
    check("command_inbox_fingerprint_check", sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const aggregateSequenceStates = pgTable(
  "aggregate_sequence_states",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    occupancyEpoch: uuid("occupancy_epoch").notNull(),
    lastSequence: integer("last_sequence").notNull(),
    resourceVersion: integer("resource_version").notNull(),
    lastCommandId: uuid("last_command_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.organizationId,
        table.unitId,
        table.aggregateType,
        table.aggregateId,
        table.occupancyEpoch,
      ],
    }),
    foreignKey({
      name: "aggregate_sequence_states_organization_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    check("aggregate_sequence_states_last_sequence_check", sql`${table.lastSequence} > 0`),
    check("aggregate_sequence_states_resource_version_check", sql`${table.resourceVersion} >= 0`),
  ],
);

export const commandQuarantine = pgTable(
  "command_quarantine",
  {
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    commandId: uuid("command_id").notNull(),
    reason: varchar("reason", { length: 100 }).notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    status: commandQuarantineStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.unitId, table.commandId] }),
    index("command_quarantine_pending_idx").on(
      table.organizationId,
      table.unitId,
      table.status,
      table.createdAt,
    ),
    foreignKey({
      name: "command_quarantine_inbox_fk",
      columns: [table.organizationId, table.unitId, table.commandId],
      foreignColumns: [commandInbox.organizationId, commandInbox.unitId, commandInbox.commandId],
    }).onDelete("cascade"),
  ],
);

export const eventTenantTables = [
  commandInbox,
  aggregateSequenceStates,
  commandQuarantine,
] as const;

for (const table of eventTenantTables) table.enableRLS();
