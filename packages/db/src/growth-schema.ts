import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { posTabs } from "./operations-schema.js";
import { identities, organizations, units } from "./schema.js";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const consentDecision = pgEnum("growth_consent_decision", ["granted", "withdrawn"]);
export const loyaltyEntryType = pgEnum("growth_loyalty_entry_type", [
  "earn",
  "redeem",
  "expire",
  "reverse",
  "adjustment",
]);
export const campaignStatus = pgEnum("growth_campaign_status", [
  "draft",
  "blocked",
  "queued",
  "sending",
  "sent",
  "failed",
  "canceled",
]);
export const deliveryStatus = pgEnum("growth_delivery_status", [
  "draft",
  "placed",
  "confirmed",
  "preparing",
  "ready",
  "dispatched",
  "completed",
  "canceled",
]);
export const reservationStatus = pgEnum("growth_reservation_status", [
  "booked",
  "confirmed",
  "seated",
  "completed",
  "canceled",
  "no_show",
]);
export const waitlistStatus = pgEnum("growth_waitlist_status", [
  "waiting",
  "notified",
  "seated",
  "left",
  "canceled",
  "no_show",
]);
export const transferStatus = pgEnum("growth_transfer_status", [
  "draft",
  "in_transit",
  "received",
  "canceled",
]);

export const growthCustomers = pgTable(
  "growth_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    defaultUnitId: uuid("default_unit_id").references(() => units.id, { onDelete: "set null" }),
    name: varchar("name", { length: 160 }).notNull(),
    email: varchar("email", { length: 254 }),
    phone: varchar("phone", { length: 40 }),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    birthDate: varchar("birth_date", { length: 10 }),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("growth_customers_org_id_unique").on(table.organizationId, table.id),
    index("growth_customers_org_name_idx").on(table.organizationId, table.name),
    uniqueIndex("growth_customers_org_email_unique")
      .on(table.organizationId, table.email)
      .where(sql`${table.email} is not null`),
    foreignKey({
      name: "growth_customer_default_unit_tenant_fk",
      columns: [table.organizationId, table.defaultUnitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
  ],
);

export const customerConsents = pgTable(
  "growth_customer_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => growthCustomers.id, { onDelete: "cascade" }),
    purpose: varchar("purpose", { length: 60 }).notNull(),
    decision: consentDecision("decision").notNull(),
    channel: varchar("channel", { length: 30 }).notNull(),
    source: varchar("source", { length: 60 }).notNull(),
    legalBasis: varchar("legal_basis", { length: 60 }).notNull(),
    policyVersion: varchar("policy_version", { length: 40 }).notNull(),
    actorIdentityId: uuid("actor_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("growth_consents_customer_time_idx").on(
      table.organizationId,
      table.customerId,
      table.occurredAt,
    ),
    foreignKey({
      name: "growth_consent_customer_tenant_fk",
      columns: [table.organizationId, table.customerId],
      foreignColumns: [growthCustomers.organizationId, growthCustomers.id],
    }).onDelete("cascade"),
  ],
);

export const marketingOptOutTokens = pgTable(
  "growth_marketing_opt_out_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => growthCustomers.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("growth_opt_out_token_hash_unique").on(table.tokenHash),
    foreignKey({
      name: "growth_opt_out_customer_tenant_fk",
      columns: [table.organizationId, table.customerId],
      foreignColumns: [growthCustomers.organizationId, growthCustomers.id],
    }).onDelete("cascade"),
  ],
);

export const loyaltyPrograms = pgTable(
  "growth_loyalty_programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    mode: varchar("mode", { length: 20 }).$type<"points" | "cashback">().notNull(),
    rate: numeric("rate", { precision: 12, scale: 4 }).notNull(),
    minimumOrderCents: integer("minimum_order_cents").notNull().default(0),
    expiresAfterDays: integer("expires_after_days"),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("growth_loyalty_program_org_id_unique").on(table.organizationId, table.id),
    uniqueIndex("growth_loyalty_one_active_unique")
      .on(table.organizationId)
      .where(sql`${table.active} = true`),
    check("growth_loyalty_rate_check", sql`${table.rate} > 0`),
    check("growth_loyalty_minimum_check", sql`${table.minimumOrderCents} >= 0`),
  ],
);

export const loyaltyLedger = pgTable(
  "growth_loyalty_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "set null" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => loyaltyPrograms.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => growthCustomers.id),
    sourceRef: varchar("source_ref", { length: 180 }),
    type: loyaltyEntryType("type").notNull(),
    amount: integer("amount").notNull(),
    description: varchar("description", { length: 240 }),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    reversalOfId: uuid("reversal_of_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("growth_loyalty_idempotency_unique").on(table.organizationId, table.idempotencyKey),
    uniqueIndex("growth_loyalty_reversal_unique")
      .on(table.organizationId, table.reversalOfId)
      .where(sql`${table.reversalOfId} is not null`),
    index("growth_loyalty_customer_time_idx").on(
      table.organizationId,
      table.customerId,
      table.createdAt,
    ),
    check("growth_loyalty_amount_check", sql`${table.amount} <> 0`),
    foreignKey({
      name: "growth_loyalty_reversal_fk",
      columns: [table.reversalOfId],
      foreignColumns: [table.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "growth_loyalty_unit_tenant_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "growth_loyalty_program_tenant_fk",
      columns: [table.organizationId, table.programId],
      foreignColumns: [loyaltyPrograms.organizationId, loyaltyPrograms.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "growth_loyalty_customer_tenant_fk",
      columns: [table.organizationId, table.customerId],
      foreignColumns: [growthCustomers.organizationId, growthCustomers.id],
    }).onDelete("restrict"),
  ],
);

export const coupons = pgTable(
  "growth_coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    type: varchar("type", { length: 20 }).$type<"fixed" | "percentage">().notNull(),
    value: integer("value").notNull(),
    minimumOrderCents: integer("minimum_order_cents").notNull().default(0),
    maximumDiscountCents: integer("maximum_discount_cents"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    channels: jsonb("channels").$type<string[]>().notNull().default([]),
    unitIds: jsonb("unit_ids").$type<string[]>().notNull().default([]),
    perCustomerLimit: integer("per_customer_limit").notNull().default(1),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("growth_coupons_org_id_unique").on(table.organizationId, table.id),
    uniqueIndex("growth_coupons_org_code_unique").on(table.organizationId, table.code),
    check("growth_coupon_value_check", sql`${table.value} > 0`),
    check(
      "growth_coupon_percentage_check",
      sql`${table.type} <> 'percentage' or ${table.value} <= 10000`,
    ),
    foreignKey({
      name: "growth_coupon_unit_tenant_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
  ],
);

export const couponRedemptions = pgTable(
  "growth_coupon_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id),
    customerId: uuid("customer_id").references(() => growthCustomers.id),
    orderRef: uuid("order_ref").notNull(),
    discountCents: integer("discount_cents").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("growth_coupon_redemption_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    uniqueIndex("growth_coupon_redemption_order_unique").on(table.organizationId, table.orderRef),
    foreignKey({
      name: "growth_coupon_redemption_unit_tenant_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "growth_coupon_redemption_coupon_tenant_fk",
      columns: [table.organizationId, table.couponId],
      foreignColumns: [coupons.organizationId, coupons.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "growth_coupon_redemption_customer_tenant_fk",
      columns: [table.organizationId, table.customerId],
      foreignColumns: [growthCustomers.organizationId, growthCustomers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "growth_coupon_redemption_tab_fk",
      columns: [table.organizationId, table.unitId, table.orderRef],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
  ],
);

export const customerSegments = pgTable(
  "growth_customer_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("growth_segments_org_id_unique").on(table.organizationId, table.id),
    uniqueIndex("growth_segments_org_name_unique").on(table.organizationId, table.name),
  ],
);

export const marketingCampaigns = pgTable(
  "growth_marketing_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "set null" }),
    segmentId: uuid("segment_id").references(() => customerSegments.id, { onDelete: "set null" }),
    name: varchar("name", { length: 160 }).notNull(),
    channel: varchar("channel", { length: 20 }).$type<"email" | "whatsapp">().notNull(),
    status: campaignStatus("status").notNull().default("draft"),
    subject: varchar("subject", { length: 180 }),
    content: text("content").notNull(),
    createdByIdentityId: uuid("created_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("growth_campaign_org_id_unique").on(table.organizationId, table.id),
    index("growth_campaign_org_status_idx").on(table.organizationId, table.status),
    foreignKey({
      name: "growth_campaign_unit_tenant_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "growth_campaign_segment_tenant_fk",
      columns: [table.organizationId, table.segmentId],
      foreignColumns: [customerSegments.organizationId, customerSegments.id],
    }).onDelete("restrict"),
  ],
);

export const campaignDeliveries = pgTable(
  "growth_campaign_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => marketingCampaigns.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => growthCustomers.id),
    status: varchar("status", { length: 20 })
      .$type<"pending" | "blocked" | "sent" | "failed" | "skipped">()
      .notNull()
      .default("pending"),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    providerReference: varchar("provider_reference", { length: 180 }),
    errorCode: varchar("error_code", { length: 80 }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("growth_campaign_delivery_target_unique").on(
      table.organizationId,
      table.campaignId,
      table.customerId,
    ),
    uniqueIndex("growth_campaign_delivery_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "growth_campaign_delivery_campaign_tenant_fk",
      columns: [table.organizationId, table.campaignId],
      foreignColumns: [marketingCampaigns.organizationId, marketingCampaigns.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "growth_campaign_delivery_customer_tenant_fk",
      columns: [table.organizationId, table.customerId],
      foreignColumns: [growthCustomers.organizationId, growthCustomers.id],
    }).onDelete("restrict"),
  ],
);

export const reservations = pgTable(
  "growth_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    customerId: uuid("customer_id").references(() => growthCustomers.id),
    guestName: varchar("guest_name", { length: 160 }).notNull(),
    guestPhone: varchar("guest_phone", { length: 40 }),
    partySize: integer("party_size").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(120),
    status: reservationStatus("status").notNull().default("booked"),
    notes: varchar("notes", { length: 500 }),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("growth_reservation_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("growth_reservation_unit_schedule_idx").on(table.unitId, table.scheduledAt),
    foreignKey({
      name: "growth_reservation_org_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "growth_reservation_customer_tenant_fk",
      columns: [table.organizationId, table.customerId],
      foreignColumns: [growthCustomers.organizationId, growthCustomers.id],
    }).onDelete("restrict"),
  ],
);

export const waitlistEntries = pgTable(
  "growth_waitlist_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    customerId: uuid("customer_id").references(() => growthCustomers.id),
    guestName: varchar("guest_name", { length: 160 }).notNull(),
    guestPhone: varchar("guest_phone", { length: 40 }),
    partySize: integer("party_size").notNull(),
    quotedWaitMinutes: integer("quoted_wait_minutes"),
    status: waitlistStatus("status").notNull().default("waiting"),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("growth_waitlist_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("growth_waitlist_unit_status_idx").on(table.unitId, table.status, table.joinedAt),
    foreignKey({
      name: "growth_waitlist_org_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "growth_waitlist_customer_tenant_fk",
      columns: [table.organizationId, table.customerId],
      foreignColumns: [growthCustomers.organizationId, growthCustomers.id],
    }).onDelete("restrict"),
  ],
);

export const deliveryZones = pgTable(
  "growth_delivery_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    feeCents: integer("fee_cents").notNull(),
    minimumOrderCents: integer("minimum_order_cents").notNull().default(0),
    estimatedDeliveryMinutes: integer("estimated_delivery_minutes").notNull().default(45),
    geometry: jsonb("geometry").$type<Record<string, unknown>>().notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique("growth_delivery_zone_org_id_unique").on(table.organizationId, table.id),
    uniqueIndex("growth_delivery_zone_unit_name_unique").on(table.unitId, table.name),
    check(
      "growth_delivery_zone_estimated_minutes_check",
      sql`${table.estimatedDeliveryMinutes} between 5 and 240`,
    ),
    foreignKey({
      name: "growth_delivery_zone_org_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const deliveryCouriers = pgTable(
  "growth_delivery_couriers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    reference: varchar("reference", { length: 80 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    phone: varchar("phone", { length: 40 }),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 })
      .$type<"available" | "assigned" | "delivering" | "offline">()
      .notNull()
      .default("available"),
    active: boolean("active").notNull().default(true),
    lastLatitude: doublePrecision("last_latitude"),
    lastLongitude: doublePrecision("last_longitude"),
    lastPositionAt: timestamp("last_position_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("growth_delivery_courier_org_id_unique").on(table.organizationId, table.id),
    uniqueIndex("growth_delivery_courier_unit_reference_unique").on(table.unitId, table.reference),
    uniqueIndex("growth_delivery_courier_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    check(
      "growth_delivery_courier_status_check",
      sql`${table.status} in ('available', 'assigned', 'delivering', 'offline')`,
    ),
    check(
      "growth_delivery_courier_position_check",
      sql`(${table.lastLatitude} is null and ${table.lastLongitude} is null and ${table.lastPositionAt} is null) or (${table.lastLatitude} between -90 and 90 and ${table.lastLongitude} between -180 and 180 and ${table.lastPositionAt} is not null)`,
    ),
    foreignKey({
      name: "growth_delivery_courier_org_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const deliveryOrders = pgTable(
  "growth_delivery_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    customerId: uuid("customer_id").references(() => growthCustomers.id),
    zoneId: uuid("zone_id").references(() => deliveryZones.id),
    courierId: uuid("courier_id").references(() => deliveryCouriers.id),
    courierAssignedAt: timestamp("courier_assigned_at", { withTimezone: true }),
    orderRef: uuid("order_ref").notNull(),
    publicProtocol: varchar("public_protocol", { length: 40 }),
    customerName: varchar("customer_name", { length: 120 }),
    customerPhone: varchar("customer_phone", { length: 20 }),
    fulfillment: varchar("fulfillment", { length: 20 }).$type<"delivery" | "pickup">().notNull(),
    status: deliveryStatus("status").notNull().default("draft"),
    subtotalCents: integer("subtotal_cents").notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    paymentMethod: varchar("payment_method", { length: 30 })
      .$type<"pay_on_fulfillment">()
      .notNull()
      .default("pay_on_fulfillment"),
    paymentStatus: varchar("payment_status", { length: 30 })
      .$type<"awaiting_payment" | "paid">()
      .notNull()
      .default("awaiting_payment"),
    address: jsonb("address").$type<Record<string, unknown>>(),
    addressValidationStatus: varchar("address_validation_status", { length: 20 })
      .$type<"covered" | "unchecked" | "unavailable">()
      .notNull()
      .default("unchecked"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    promisedAt: timestamp("promised_at", { withTimezone: true }),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("growth_delivery_order_org_id_unique").on(table.organizationId, table.id),
    uniqueIndex("growth_delivery_order_ref_unique").on(table.organizationId, table.orderRef),
    uniqueIndex("growth_delivery_public_protocol_unique").on(table.publicProtocol),
    uniqueIndex("growth_delivery_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("growth_delivery_unit_status_idx").on(table.unitId, table.status),
    index("growth_delivery_unit_promised_idx").on(table.unitId, table.promisedAt),
    check(
      "growth_delivery_order_address_validation_check",
      sql`${table.addressValidationStatus} in ('covered', 'unchecked', 'unavailable')`,
    ),
    foreignKey({
      name: "growth_delivery_order_org_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "growth_delivery_order_customer_tenant_fk",
      columns: [table.organizationId, table.customerId],
      foreignColumns: [growthCustomers.organizationId, growthCustomers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "growth_delivery_order_zone_tenant_fk",
      columns: [table.organizationId, table.zoneId],
      foreignColumns: [deliveryZones.organizationId, deliveryZones.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "growth_delivery_order_courier_tenant_fk",
      columns: [table.organizationId, table.courierId],
      foreignColumns: [deliveryCouriers.organizationId, deliveryCouriers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "growth_delivery_order_tab_fk",
      columns: [table.organizationId, table.unitId, table.orderRef],
      foreignColumns: [posTabs.organizationId, posTabs.unitId, posTabs.id],
    }).onDelete("restrict"),
  ],
);

export const deliveryOrderStatusHistory = pgTable(
  "growth_delivery_order_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    deliveryOrderId: uuid("delivery_order_id").notNull(),
    fromStatus: deliveryStatus("from_status"),
    toStatus: deliveryStatus("to_status").notNull(),
    actorIdentityId: uuid("actor_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("growth_delivery_history_order_time_idx").on(table.deliveryOrderId, table.occurredAt),
    foreignKey({
      name: "growth_delivery_history_order_tenant_fk",
      columns: [table.organizationId, table.deliveryOrderId],
      foreignColumns: [deliveryOrders.organizationId, deliveryOrders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "growth_delivery_history_unit_tenant_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const deliveryCourierAssignments = pgTable(
  "growth_delivery_courier_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    deliveryOrderId: uuid("delivery_order_id").notNull(),
    courierId: uuid("courier_id").notNull(),
    assignedByIdentityId: uuid("assigned_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("growth_delivery_assignment_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("growth_delivery_assignment_order_time_idx").on(table.deliveryOrderId, table.assignedAt),
    foreignKey({
      name: "growth_delivery_assignment_order_tenant_fk",
      columns: [table.organizationId, table.deliveryOrderId],
      foreignColumns: [deliveryOrders.organizationId, deliveryOrders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "growth_delivery_assignment_courier_tenant_fk",
      columns: [table.organizationId, table.courierId],
      foreignColumns: [deliveryCouriers.organizationId, deliveryCouriers.id],
    }).onDelete("restrict"),
  ],
);

export const deliveryCourierEvents = pgTable(
  "growth_delivery_courier_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    courierId: uuid("courier_id").notNull(),
    eventType: varchar("event_type", { length: 20 }).$type<"status" | "position">().notNull(),
    status: varchar("status", { length: 20 }).$type<
      "available" | "assigned" | "delivering" | "offline"
    >(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    actorIdentityId: uuid("actor_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("growth_delivery_courier_event_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("growth_delivery_courier_event_time_idx").on(table.courierId, table.occurredAt),
    check(
      "growth_delivery_courier_event_shape_check",
      sql`(${table.eventType} = 'status' and ${table.status} is not null and ${table.latitude} is null and ${table.longitude} is null) or (${table.eventType} = 'position' and ${table.status} is null and ${table.latitude} between -90 and 90 and ${table.longitude} between -180 and 180)`,
    ),
    foreignKey({
      name: "growth_delivery_courier_event_courier_tenant_fk",
      columns: [table.organizationId, table.courierId],
      foreignColumns: [deliveryCouriers.organizationId, deliveryCouriers.id],
    }).onDelete("cascade"),
  ],
);

export const deliveryNotifications = pgTable(
  "growth_delivery_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    deliveryOrderId: uuid("delivery_order_id").notNull(),
    audience: varchar("audience", { length: 20 }).$type<"operations" | "customer">().notNull(),
    type: varchar("type", { length: 40 })
      .$type<"status_update" | "courier_assigned" | "courier_arriving">()
      .notNull(),
    status: varchar("status", { length: 30 })
      .$type<"pending_provider">()
      .notNull()
      .default("pending_provider"),
    requestedByIdentityId: uuid("requested_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("growth_delivery_notification_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("growth_delivery_notification_order_time_idx").on(table.deliveryOrderId, table.createdAt),
    check("growth_delivery_notification_status_check", sql`${table.status} = 'pending_provider'`),
    foreignKey({
      name: "growth_delivery_notification_order_tenant_fk",
      columns: [table.organizationId, table.deliveryOrderId],
      foreignColumns: [deliveryOrders.organizationId, deliveryOrders.id],
    }).onDelete("cascade"),
  ],
);

export const deliveryDispatches = pgTable(
  "growth_delivery_dispatches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    deliveryOrderId: uuid("delivery_order_id")
      .notNull()
      .references(() => deliveryOrders.id, { onDelete: "cascade" }),
    courierReference: varchar("courier_reference", { length: 160 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("assigned"),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("growth_dispatch_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "growth_dispatch_unit_tenant_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "growth_dispatch_order_tenant_fk",
      columns: [table.organizationId, table.deliveryOrderId],
      foreignColumns: [deliveryOrders.organizationId, deliveryOrders.id],
    }).onDelete("cascade"),
  ],
);

export const unitPriceOverrides = pgTable(
  "growth_unit_price_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    productRef: varchar("product_ref", { length: 180 }).notNull(),
    priceCents: integer("price_cents").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("growth_price_override_unit_product_unique").on(table.unitId, table.productRef),
    foreignKey({
      name: "growth_price_override_org_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const inventoryTransfers = pgTable(
  "growth_inventory_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    originUnitId: uuid("origin_unit_id")
      .notNull()
      .references(() => units.id),
    destinationUnitId: uuid("destination_unit_id")
      .notNull()
      .references(() => units.id),
    status: transferStatus("status").notNull().default("draft"),
    notes: varchar("notes", { length: 500 }),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("growth_transfer_org_id_unique").on(table.organizationId, table.id),
    uniqueIndex("growth_transfer_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    check(
      "growth_transfer_distinct_units_check",
      sql`${table.originUnitId} <> ${table.destinationUnitId}`,
    ),
    foreignKey({
      name: "growth_transfer_origin_tenant_fk",
      columns: [table.organizationId, table.originUnitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "growth_transfer_destination_tenant_fk",
      columns: [table.organizationId, table.destinationUnitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
  ],
);

export const inventoryTransferLines = pgTable(
  "growth_inventory_transfer_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => inventoryTransfers.id, { onDelete: "cascade" }),
    inventoryItemRef: varchar("inventory_item_ref", { length: 180 }).notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex("growth_transfer_line_item_unique").on(table.transferId, table.inventoryItemRef),
    check("growth_transfer_line_quantity_check", sql`${table.quantity} > 0`),
    foreignKey({
      name: "growth_transfer_line_tenant_fk",
      columns: [table.organizationId, table.transferId],
      foreignColumns: [inventoryTransfers.organizationId, inventoryTransfers.id],
    }).onDelete("cascade"),
  ],
);

export const publicApiKeys = pgTable(
  "growth_public_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    keyLastFour: varchar("key_last_four", { length: 4 }).notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    createdByIdentityId: uuid("created_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("growth_public_api_key_hash_unique").on(table.keyHash),
    index("growth_public_api_keys_org_idx").on(table.organizationId),
  ],
);

export const webhookEndpoints = pgTable(
  "growth_webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    eventTypes: jsonb("event_types").$type<string[]>().notNull(),
    signingKeyVersion: integer("signing_key_version").notNull().default(1),
    active: boolean("active").notNull().default(true),
    createdByIdentityId: uuid("created_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [index("growth_webhook_endpoints_org_idx").on(table.organizationId)],
);

export const webhookPublications = pgTable(
  "growth_webhook_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: varchar("aggregate_id", { length: 160 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("growth_webhook_publication_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
  ],
);

export const growthIntegrations = pgTable(
  "growth_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 60 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("disabled"),
    credentialReference: varchar("credential_reference", { length: 180 }),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("growth_integrations_org_unit_provider_unique").on(
      table.organizationId,
      table.unitId,
      table.provider,
    ),
    foreignKey({
      name: "growth_integration_unit_tenant_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("restrict"),
  ],
);
