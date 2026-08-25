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
import { managementPeople } from "./management-schema.js";
import { posOperationalShifts, posOrders, posTabs } from "./operations-schema.js";
import { identities, organizations, units } from "./schema.js";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export type WaiterSettlementConfiguration = {
  serviceChargeEnabled: boolean;
  defaultServiceChargeBasisPoints: number;
  serviceChargeApplication: "manual" | "suggest_dine_in";
  attributionMode: "final_responsible" | "order_creator";
  transferMode: "move_to_final" | "preserve_origin";
  serviceBase: "gross" | "net_after_discounts";
  eligibleTabs: "closed" | "fully_paid";
  serviceDistribution: "individual_sales" | "equal_pool";
  serviceTeamShareBasisPoints: number;
  partnershipBase: "gross" | "net" | "received" | "net_excluding_service";
  tierApplication: "all_revenue" | "progressive";
  discountTreatment: "deduct" | "ignore";
  cancellationTreatment: "exclude" | "deduct";
  refundTreatment: "deduct" | "informational";
  periodMode: "calendar_month" | "custom";
  customPeriodStartDay: number;
  aggregateAcrossUnits: boolean;
};

export const managementOperationalLossType = pgEnum("management_operational_loss_type", [
  "unpaid_tab",
  "refund",
  "chargeback",
  "other",
]);
export const managementOperationalLossStatus = pgEnum("management_operational_loss_status", [
  "pending",
  "approved",
  "rejected",
  "reversed",
]);
export const managementSettlementStatus = pgEnum("management_settlement_status", [
  "closed",
  "approved",
  "paid",
  "canceled",
]);
export const managementPartnershipRewardType = pgEnum("management_partnership_reward_type", [
  "percentage",
  "fixed",
]);

export const managementSettlementSettings = pgTable(
  "management_settlement_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    configuration: jsonb("configuration").$type<WaiterSettlementConfiguration>().notNull(),
    updatedByIdentityId: uuid("updated_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    unique("management_settlement_settings_unit_unique").on(table.organizationId, table.unitId),
    foreignKey({
      name: "management_settlement_settings_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const managementPartnershipPlans = pgTable(
  "management_partnership_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    active: boolean("active").notNull().default(true),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    ...timestamps,
  },
  (table) => [
    unique("management_partnership_plans_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_partnership_plans_effective_unique").on(
      table.organizationId,
      table.unitId,
      table.effectiveFrom,
    ),
    foreignKey({
      name: "management_partnership_plans_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const managementPartnershipTiers = pgTable(
  "management_partnership_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    planId: uuid("plan_id").notNull(),
    position: integer("position").notNull(),
    minimumCents: integer("minimum_cents").notNull(),
    maximumCents: integer("maximum_cents"),
    rewardType: managementPartnershipRewardType("reward_type").notNull(),
    rewardValue: integer("reward_value").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("management_partnership_tiers_position_unique").on(
      table.organizationId,
      table.unitId,
      table.planId,
      table.position,
    ),
    foreignKey({
      name: "management_partnership_tiers_plan_fk",
      columns: [table.organizationId, table.unitId, table.planId],
      foreignColumns: [
        managementPartnershipPlans.organizationId,
        managementPartnershipPlans.unitId,
        managementPartnershipPlans.id,
      ],
    }).onDelete("cascade"),
    check("management_partnership_tiers_position_check", sql`${table.position} >= 0`),
    check(
      "management_partnership_tiers_range_check",
      sql`${table.minimumCents} >= 0 and (${table.maximumCents} is null or ${table.maximumCents} >= ${table.minimumCents})`,
    ),
    check(
      "management_partnership_tiers_reward_check",
      sql`${table.rewardValue} >= 0 and (${table.rewardType} <> 'percentage' or ${table.rewardValue} <= 10000)`,
    ),
  ],
);

export const managementOperationalLosses = pgTable(
  "management_operational_losses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    tabId: uuid("tab_id").notNull(),
    operationalShiftId: uuid("operational_shift_id"),
    responsibleIdentityId: uuid("responsible_identity_id").references(() => identities.id),
    type: managementOperationalLossType("type").notNull(),
    reason: text("reason").notNull(),
    amountCents: integer("amount_cents").notNull(),
    serviceChargeCents: integer("service_charge_cents").notNull().default(0),
    status: managementOperationalLossStatus("status").notNull().default("pending"),
    requestedByIdentityId: uuid("requested_by_identity_id")
      .notNull()
      .references(() => identities.id),
    reviewedByIdentityId: uuid("reviewed_by_identity_id").references(() => identities.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    reversedByIdentityId: uuid("reversed_by_identity_id").references(() => identities.id),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversalNote: text("reversal_note"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("management_operational_losses_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_operational_losses_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    index("management_operational_losses_tab_idx").on(
      table.organizationId,
      table.unitId,
      table.tabId,
      table.status,
    ),
    foreignKey({
      name: "management_operational_losses_tab_fk",
      columns: [table.organizationId, table.unitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_operational_losses_shift_fk",
      columns: [table.organizationId, table.unitId, table.operationalShiftId],
      foreignColumns: [
        posOperationalShifts.organizationId,
        posOperationalShifts.unitId,
        posOperationalShifts.id,
      ],
    }).onDelete("restrict"),
    check(
      "management_operational_losses_amount_check",
      sql`${table.amountCents} > 0 and ${table.serviceChargeCents} >= 0 and ${table.serviceChargeCents} <= ${table.amountCents}`,
    ),
    check(
      "management_operational_losses_lifecycle_check",
      sql`(${table.status} = 'pending' and ${table.reviewedAt} is null and ${table.reviewedByIdentityId} is null and ${table.reversedAt} is null and ${table.reversedByIdentityId} is null) or (${table.status} in ('approved','rejected') and ${table.reviewedAt} is not null and ${table.reviewedByIdentityId} is not null and nullif(btrim(${table.reviewNote}), '') is not null and ${table.reversedAt} is null and ${table.reversedByIdentityId} is null) or (${table.status} = 'reversed' and ${table.reviewedAt} is not null and ${table.reviewedByIdentityId} is not null and ${table.reversedAt} is not null and ${table.reversedByIdentityId} is not null and nullif(btrim(${table.reversalNote}), '') is not null)`,
    ),
  ],
);

export const managementWaiterSettlements = pgTable(
  "management_waiter_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    aggregationKey: varchar("aggregation_key", { length: 80 }).notNull(),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    operationalShiftId: uuid("operational_shift_id"),
    status: managementSettlementStatus("status").notNull().default("closed"),
    configurationSnapshot: jsonb("configuration_snapshot")
      .$type<WaiterSettlementConfiguration>()
      .notNull(),
    partnershipPlanId: uuid("partnership_plan_id"),
    unassignedGrossCents: integer("unassigned_gross_cents").notNull().default(0),
    operationalLossCents: integer("operational_loss_cents").notNull().default(0),
    createdByIdentityId: uuid("created_by_identity_id")
      .notNull()
      .references(() => identities.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByIdentityId: uuid("approved_by_identity_id").references(() => identities.id),
    approvalNote: text("approval_note"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidByIdentityId: uuid("paid_by_identity_id").references(() => identities.id),
    paymentNote: text("payment_note"),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    canceledByIdentityId: uuid("canceled_by_identity_id").references(() => identities.id),
    cancellationNote: text("cancellation_note"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("management_waiter_settlements_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.id,
    ),
    uniqueIndex("management_waiter_settlements_period_unique").on(
      table.organizationId,
      table.aggregationKey,
      table.periodFrom,
      table.periodTo,
    ),
    uniqueIndex("management_waiter_settlements_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "management_waiter_settlements_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_waiter_settlements_plan_fk",
      columns: [table.organizationId, table.unitId, table.partnershipPlanId],
      foreignColumns: [
        managementPartnershipPlans.organizationId,
        managementPartnershipPlans.unitId,
        managementPartnershipPlans.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_waiter_settlements_shift_fk",
      columns: [table.organizationId, table.unitId, table.operationalShiftId],
      foreignColumns: [
        posOperationalShifts.organizationId,
        posOperationalShifts.unitId,
        posOperationalShifts.id,
      ],
    }).onDelete("restrict"),
    check(
      "management_waiter_settlements_period_check",
      sql`${table.periodTo} >= ${table.periodFrom}`,
    ),
    check(
      "management_waiter_settlements_totals_check",
      sql`${table.unassignedGrossCents} >= 0 and ${table.operationalLossCents} >= 0`,
    ),
    check(
      "management_waiter_settlements_lifecycle_check",
      sql`(${table.status} = 'closed' and ${table.approvedAt} is null and ${table.paidAt} is null and ${table.canceledAt} is null) or (${table.status} = 'approved' and ${table.approvedAt} is not null and ${table.approvedByIdentityId} is not null and nullif(btrim(${table.approvalNote}), '') is not null and ${table.paidAt} is null and ${table.canceledAt} is null) or (${table.status} = 'paid' and ${table.approvedAt} is not null and ${table.approvedByIdentityId} is not null and ${table.paidAt} is not null and ${table.paidByIdentityId} is not null and nullif(btrim(${table.paymentNote}), '') is not null and ${table.canceledAt} is null) or (${table.status} = 'canceled' and ${table.paidAt} is null and ${table.canceledAt} is not null and ${table.canceledByIdentityId} is not null and nullif(btrim(${table.cancellationNote}), '') is not null)`,
    ),
  ],
);

export const managementWaiterSettlementLines = pgTable(
  "management_waiter_settlement_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    settlementId: uuid("settlement_id").notNull(),
    personId: uuid("person_id").references(() => managementPeople.id, { onDelete: "set null" }),
    personIdentityId: uuid("person_identity_id")
      .notNull()
      .references(() => identities.id),
    personName: varchar("person_name", { length: 160 }).notNull(),
    roleLabel: varchar("role_label", { length: 80 }).notNull(),
    eligibleForPayment: boolean("eligible_for_payment").notNull(),
    tabCount: integer("tab_count").notNull(),
    orderCount: integer("order_count").notNull(),
    grossSalesCents: integer("gross_sales_cents").notNull(),
    discountCents: integer("discount_cents").notNull(),
    canceledCents: integer("canceled_cents").notNull(),
    receivedCents: integer("received_cents").notNull(),
    serviceChargeCents: integer("service_charge_cents").notNull(),
    tipCents: integer("tip_cents").notNull(),
    serviceShareCents: integer("service_share_cents").notNull(),
    partnershipBaseCents: integer("partnership_base_cents").notNull(),
    partnershipCents: integer("partnership_cents").notNull(),
    operationalLossCents: integer("operational_loss_cents").notNull().default(0),
    payableCents: integer("payable_cents").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("management_waiter_settlement_lines_scope_id_unique").on(
      table.organizationId,
      table.unitId,
      table.settlementId,
      table.id,
    ),
    unique("management_waiter_settlement_lines_person_unique").on(
      table.organizationId,
      table.unitId,
      table.settlementId,
      table.personIdentityId,
    ),
    foreignKey({
      name: "management_waiter_settlement_lines_settlement_fk",
      columns: [table.organizationId, table.unitId, table.settlementId],
      foreignColumns: [
        managementWaiterSettlements.organizationId,
        managementWaiterSettlements.unitId,
        managementWaiterSettlements.id,
      ],
    }).onDelete("cascade"),
    check(
      "management_waiter_settlement_lines_totals_check",
      sql`${table.tabCount} >= 0 and ${table.orderCount} >= 0 and ${table.grossSalesCents} >= 0 and ${table.discountCents} >= 0 and ${table.canceledCents} >= 0 and ${table.receivedCents} >= 0 and ${table.serviceChargeCents} >= 0 and ${table.tipCents} >= 0 and ${table.serviceShareCents} >= 0 and ${table.partnershipBaseCents} >= 0 and ${table.partnershipCents} >= 0 and ${table.operationalLossCents} >= 0 and ${table.payableCents} >= 0`,
    ),
    check(
      "management_waiter_settlement_lines_payable_check",
      sql`${table.payableCents} = ${table.serviceShareCents} + ${table.partnershipCents} and (${table.eligibleForPayment} or ${table.payableCents} = 0)`,
    ),
  ],
);

export const managementWaiterSettlementSources = pgTable(
  "management_waiter_settlement_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    settlementId: uuid("settlement_id").notNull(),
    settlementLineId: uuid("settlement_line_id").notNull(),
    sourceKey: varchar("source_key", { length: 180 }).notNull(),
    sourceUnitId: uuid("source_unit_id").notNull(),
    tabId: uuid("tab_id").notNull(),
    orderId: uuid("order_id"),
    grossSalesCents: integer("gross_sales_cents").notNull(),
    discountCents: integer("discount_cents").notNull(),
    canceledCents: integer("canceled_cents").notNull(),
    receivedCents: integer("received_cents").notNull(),
    serviceChargeCents: integer("service_charge_cents").notNull(),
    tipCents: integer("tip_cents").notNull(),
    operationalLossCents: integer("operational_loss_cents").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("management_waiter_settlement_sources_key_unique").on(
      table.organizationId,
      table.unitId,
      table.settlementId,
      table.sourceKey,
    ),
    foreignKey({
      name: "management_waiter_settlement_sources_line_fk",
      columns: [table.organizationId, table.unitId, table.settlementId, table.settlementLineId],
      foreignColumns: [
        managementWaiterSettlementLines.organizationId,
        managementWaiterSettlementLines.unitId,
        managementWaiterSettlementLines.settlementId,
        managementWaiterSettlementLines.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "management_waiter_settlement_sources_tab_fk",
      columns: [table.organizationId, table.sourceUnitId, table.tabId],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "management_waiter_settlement_sources_order_fk",
      columns: [table.organizationId, table.sourceUnitId, table.orderId],
      foreignColumns: [posOrders.organizationId, posOrders.unitId, posOrders.id],
    }).onDelete("restrict"),
    check(
      "management_waiter_settlement_sources_totals_check",
      sql`${table.grossSalesCents} >= 0 and ${table.discountCents} >= 0 and ${table.canceledCents} >= 0 and ${table.receivedCents} >= 0 and ${table.serviceChargeCents} >= 0 and ${table.tipCents} >= 0 and ${table.operationalLossCents} >= 0`,
    ),
  ],
);
