import {
  boolean,
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

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const membershipStatus = pgEnum("membership_status", ["invited", "active", "disabled"]);
export const roleName = pgEnum("role_name", [
  "owner",
  "manager",
  "waiter",
  "cashier",
  "kds",
  "inventory",
  "finance",
]);
export const catalogStatus = pgEnum("catalog_status", ["draft", "published", "discontinued"]);
export const billingState = pgEnum("billing_state", [
  "draft",
  "onboarding",
  "trial_active",
  "active",
  "grace",
  "restricted",
  "suspended",
  "canceled",
]);
export const billingCycle = pgEnum("billing_cycle", ["monthly", "annual"]);
export const integrationStatus = pgEnum("integration_status", [
  "disabled",
  "pending",
  "active",
  "failed",
]);
export const commandStatus = pgEnum("command_status", ["accepted", "processed", "rejected"]);

export const identities = pgTable(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 254 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    kind: varchar("kind", { length: 20 }).$type<"human" | "service">().notNull().default("human"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("identities_email_unique").on(table.email)],
);

export const passwordCredentials = pgTable("password_credentials", {
  identityId: uuid("identity_id")
    .primaryKey()
    .references(() => identities.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 30 }).notNull(),
    providerSubject: varchar("provider_subject", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("oauth_provider_subject_unique").on(table.provider, table.providerSubject),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    trustedDevice: boolean("trusted_device").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
    index("auth_sessions_identity_idx").on(table.identityId),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("password_reset_token_hash_unique").on(table.tokenHash)],
);

export const mfaFactors = pgTable("mfa_factors", {
  identityId: uuid("identity_id")
    .primaryKey()
    .references(() => identities.id, { onDelete: "cascade" }),
  encryptedSecret: text("encrypted_secret").notNull(),
  iv: varchar("iv", { length: 24 }).notNull(),
  authTag: varchar("auth_tag", { length: 32 }).notNull(),
  recoveryCodeHashes: jsonb("recovery_code_hashes").$type<string[]>().notNull().default([]),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  ...timestamps,
});

export const mfaChallenges = pgTable(
  "mfa_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    trustedDevice: boolean("trusted_device").notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mfa_challenges_token_hash_unique").on(table.tokenHash),
    index("mfa_challenges_identity_idx").on(table.identityId),
  ],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legalName: varchar("legal_name", { length: 160 }).notNull(),
    tradeName: varchar("trade_name", { length: 120 }).notNull(),
    document: varchar("document", { length: 14 }).notNull(),
    billingState: billingState("billing_state").notNull().default("draft"),
    billingStateChangedAt: timestamp("billing_state_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    operationalClosureUntil: timestamp("operational_closure_until", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("organizations_document_unique").on(table.document)],
);

export const legalEntities = pgTable(
  "legal_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    legalName: varchar("legal_name", { length: 160 }).notNull(),
    document: varchar("document", { length: 14 }).notNull(),
    stateRegistration: varchar("state_registration", { length: 30 }),
    fiscalProvider: varchar("fiscal_provider", { length: 30 }),
    fiscalStatus: integrationStatus("fiscal_status").notNull().default("disabled"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("legal_entities_org_document_unique").on(table.organizationId, table.document),
  ],
);

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 120 }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull().default("America/Sao_Paulo"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("units_organization_idx").on(table.organizationId),
    uniqueIndex("units_organization_id_unique").on(table.organizationId, table.id),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: membershipStatus("status").notNull().default("invited"),
    invitedByIdentityId: uuid("invited_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("memberships_identity_org_unique").on(table.identityId, table.organizationId),
    index("memberships_org_idx").on(table.organizationId),
  ],
);

export const roleBindings = pgTable(
  "role_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    role: roleName("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("role_binding_scope_unique").on(table.membershipId, table.unitId, table.role),
  ],
);

export const membershipInvitations = pgTable(
  "membership_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 254 }).notNull(),
    role: roleName("role").notNull(),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    invitedByIdentityId: uuid("invited_by_identity_id")
      .notNull()
      .references(() => identities.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("membership_invitation_token_unique").on(table.tokenHash),
    index("membership_invitation_email_idx").on(table.email),
  ],
);

export const deviceEnrollments = pgTable(
  "device_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    certificateFingerprint: varchar("certificate_fingerprint", { length: 128 }),
    syncKeyHash: varchar("sync_key_hash", { length: 64 }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("devices_unit_idx").on(table.unitId),
    uniqueIndex("devices_sync_key_hash_unique").on(table.syncKeyHash),
    unique("devices_scope_id_unique").on(table.organizationId, table.unitId, table.id),
    foreignKey({
      name: "devices_organization_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const commercialCatalogVersions = pgTable(
  "commercial_catalog_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: integer("version").notNull(),
    status: catalogStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("commercial_catalog_version_unique").on(table.version)],
);

export const commercialPlans = pgTable(
  "commercial_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    catalogVersionId: uuid("catalog_version_id")
      .notNull()
      .references(() => commercialCatalogVersions.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 60 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    monthlyPriceCents: integer("monthly_price_cents").notNull(),
    annualPriceCents: integer("annual_price_cents").notNull(),
    includedUnits: integer("included_units").notNull(),
    entitlements: jsonb("entitlements").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("commercial_plan_catalog_slug_unique").on(table.catalogVersionId, table.slug),
  ],
);

export const onboardingRecords = pgTable("onboarding_records", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  checklist: jsonb("checklist").$type<Record<string, boolean>>().notNull().default({}),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  activatedByIdentityId: uuid("activated_by_identity_id").references(() => identities.id, {
    onDelete: "set null",
  }),
  ...timestamps,
});

export const trials = pgTable(
  "trials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    commercialPlanId: uuid("commercial_plan_id")
      .notNull()
      .references(() => commercialPlans.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    activatedByIdentityId: uuid("activated_by_identity_id")
      .notNull()
      .references(() => identities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("trials_org_unique").on(table.organizationId)],
);

export const trialApplications = pgTable("trial_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 254 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  businessName: varchar("business_name", { length: 120 }).notNull(),
  segment: varchar("segment", { length: 80 }),
  planSlug: varchar("plan_slug", { length: 60 }).notNull(),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contactRequests = pgTable("contact_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 254 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  message: text("message").notNull(),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const publicMenus = pgTable(
  "public_menus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    items: jsonb("items").$type<Record<string, unknown>[]>().notNull().default([]),
    active: boolean("active").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("public_menus_slug_unique").on(table.slug),
    foreignKey({
      name: "public_menus_organization_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const providerCustomers = pgTable(
  "provider_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 30 }).notNull(),
    providerCustomerId: varchar("provider_customer_id", { length: 160 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("provider_customer_unique").on(table.provider, table.providerCustomerId)],
);

export const billingCheckouts = pgTable(
  "billing_checkouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 30 }).notNull(),
    providerCheckoutId: varchar("provider_checkout_id", { length: 160 }).notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_checkout_provider_unique").on(table.provider, table.providerCheckoutId),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    commercialPlanId: uuid("commercial_plan_id")
      .notNull()
      .references(() => commercialPlans.id),
    providerCustomerId: uuid("provider_customer_id").references(() => providerCustomers.id),
    provider: varchar("provider", { length: 30 }),
    providerSubscriptionId: varchar("provider_subscription_id", { length: 160 }),
    cycle: billingCycle("cycle").notNull(),
    state: billingState("state").notNull().default("draft"),
    currentPeriodEndsAt: timestamp("current_period_ends_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("subscriptions_provider_unique").on(table.provider, table.providerSubscriptionId),
  ],
);

export const charges = pgTable(
  "charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    providerChargeId: varchar("provider_charge_id", { length: 160 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("charges_provider_unique").on(table.providerChargeId)],
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 30 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 160 }).notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("payment_event_provider_unique").on(table.provider, table.providerEventId),
  ],
);

export const operationalCommands = pgTable(
  "operational_commands",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    actorIdentityId: uuid("actor_identity_id")
      .notNull()
      .references(() => identities.id),
    deviceId: uuid("device_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    type: varchar("type", { length: 100 }).notNull(),
    version: integer("version").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: commandStatus("status").notNull().default("accepted"),
    rejectionReason: text("rejection_reason"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("operational_command_idempotency_unique").on(table.unitId, table.idempotencyKey),
    index("operational_commands_unit_time_idx").on(table.unitId, table.occurredAt),
    foreignKey({
      name: "operational_commands_organization_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "set null" }),
    actorIdentityId: uuid("actor_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 120 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: varchar("entity_id", { length: 160 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_events_org_time_idx").on(table.organizationId, table.occurredAt)],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topic: varchar("topic", { length: 120 }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: varchar("aggregate_id", { length: 160 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("outbox_pending_idx").on(table.processedAt, table.availableAt)],
);

export const hubHeartbeats = pgTable(
  "hub_heartbeats",
  {
    unitId: uuid("unit_id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hubId: uuid("hub_id").notNull(),
    version: varchar("version", { length: 40 }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    foreignKey({
      name: "hub_heartbeats_organization_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "hub_heartbeats_device_scope_fk",
      columns: [table.organizationId, table.unitId, table.hubId],
      foreignColumns: [
        deviceEnrollments.organizationId,
        deviceEnrollments.unitId,
        deviceEnrollments.id,
      ],
    }).onDelete("cascade"),
  ],
);

export const hubCommands = pgTable(
  "hub_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    hubId: uuid("hub_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    type: varchar("type", { length: 100 }).notNull(),
    source: varchar("source", { length: 40 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("hub_commands_unit_idempotency_unique").on(table.unitId, table.idempotencyKey),
    index("hub_commands_pending_idx").on(table.hubId, table.acknowledgedAt, table.createdAt),
    foreignKey({
      name: "hub_commands_device_scope_fk",
      columns: [table.organizationId, table.unitId, table.hubId],
      foreignColumns: [
        deviceEnrollments.organizationId,
        deviceEnrollments.unitId,
        deviceEnrollments.id,
      ],
    }).onDelete("cascade"),
  ],
);
