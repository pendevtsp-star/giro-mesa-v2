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
export const onboardingChecklistStatus = pgEnum("onboarding_checklist_status", [
  "pending",
  "in_progress",
  "verified",
  "blocked",
  "not_applicable",
]);
export const onboardingChecklistSource = pgEnum("onboarding_checklist_source", [
  "system",
  "actor_attestation",
  "authorized_waiver",
  "legacy_import",
]);
export const provisioningState = pgEnum("provisioning_state", [
  "requested",
  "validating",
  "provisioning",
  "activating",
  "publishing",
  "retryable_failed",
  "compensating",
  "compensated",
  "terminal_failed",
  "completed",
]);
export const provisioningStepStatus = pgEnum("provisioning_step_status", [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "compensated",
]);
export const subscriptionEntitlementState = pgEnum("subscription_entitlement_state", [
  "provisional",
  "active",
  "revoked",
]);

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

export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("email_verification_token_hash_unique").on(table.tokenHash),
    index("email_verification_tokens_identity_created_idx").on(table.identityId, table.createdAt),
  ],
);

export const emailVerificationRequests = pgTable(
  "email_verification_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailHash: varchar("email_hash", { length: 64 }).notNull(),
    identityId: uuid("identity_id").references(() => identities.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("email_verification_requests_email_time_idx").on(table.emailHash, table.requestedAt),
    index("email_verification_requests_identity_time_idx").on(table.identityId, table.requestedAt),
  ],
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

export const onboardingRecords = pgTable(
  "onboarding_records",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    checklist: jsonb("checklist").$type<Record<string, unknown>>().notNull().default({}),
    selectedUnitId: uuid("selected_unit_id"),
    selectedPlanId: uuid("selected_plan_id").references(() => commercialPlans.id),
    selectedCatalogVersion: integer("selected_catalog_version"),
    selectedPlanFingerprint: varchar("selected_plan_fingerprint", { length: 64 }),
    selectedPlanSnapshot: jsonb("selected_plan_snapshot").$type<Record<string, unknown>>(),
    selectedByIdentityId: uuid("selected_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    selectedAt: timestamp("selected_at", { withTimezone: true }),
    selectionRevision: integer("selection_revision").notNull().default(0),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    activatedByIdentityId: uuid("activated_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "onboarding_records_selected_unit_scope_fk",
      columns: [table.organizationId, table.selectedUnitId],
      foreignColumns: [units.organizationId, units.id],
    }),
    check("onboarding_selection_revision_check", sql`${table.selectionRevision} >= 0`),
    check(
      "onboarding_selection_complete_check",
      sql`(${table.selectedUnitId} is null and ${table.selectedPlanId} is null and ${table.selectedCatalogVersion} is null and ${table.selectedPlanFingerprint} is null and ${table.selectedPlanSnapshot} is null and ${table.selectedByIdentityId} is null and ${table.selectedAt} is null) or (${table.selectedUnitId} is not null and ${table.selectedPlanId} is not null and ${table.selectedCatalogVersion} is not null and ${table.selectedPlanFingerprint} is not null and ${table.selectedPlanSnapshot} is not null and ${table.selectedByIdentityId} is not null and ${table.selectedAt} is not null and ${table.selectionRevision} > 0)`,
    ),
  ],
);

export const onboardingChecklistItems = pgTable(
  "onboarding_checklist_items",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    item: varchar("item", { length: 40 }).notNull(),
    status: onboardingChecklistStatus("status").notNull().default("pending"),
    source: onboardingChecklistSource("source").notNull().default("system"),
    evidenceReference: varchar("evidence_reference", { length: 240 }),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    actorIdentityId: uuid("actor_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    waiverReason: text("waiver_reason"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.item] }),
    check(
      "onboarding_checklist_item_check",
      sql`${table.item} in ('business','unit','plan','fiscalChoice','catalog','tables','team','qr','production','cashier','training','rehearsal')`,
    ),
    check(
      "onboarding_checklist_verified_evidence_check",
      sql`${table.status} <> 'verified' or (${table.source} in ('system','actor_attestation') and ${table.evidenceReference} is not null and ${table.verifiedAt} is not null and (${table.source} <> 'actor_attestation' or ${table.actorIdentityId} is not null))`,
    ),
    check(
      "onboarding_checklist_waiver_check",
      sql`${table.status} <> 'not_applicable' or (${table.item} in ('fiscalChoice','qr') and ${table.source} = 'authorized_waiver' and length(${table.waiverReason}) >= 10 and ${table.evidenceReference} is not null and ${table.actorIdentityId} is not null and ${table.verifiedAt} is not null)`,
    ),
  ],
);

export const provisioningRuns = pgTable(
  "provisioning_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    planSlug: varchar("plan_slug", { length: 60 }).notNull(),
    selectedUnitId: uuid("selected_unit_id"),
    pinnedPlanId: uuid("pinned_plan_id").references(() => commercialPlans.id),
    pinnedCatalogVersion: integer("pinned_catalog_version"),
    planFingerprint: varchar("plan_fingerprint", { length: 64 }),
    planSnapshot: jsonb("plan_snapshot").$type<Record<string, unknown>>(),
    state: provisioningState("state").notNull().default("requested"),
    checkpoint: varchar("checkpoint", { length: 40 }).notNull().default("requested"),
    attempts: integer("attempts").notNull().default(0),
    leaseOwner: varchar("lease_owner", { length: 120 }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    leaseVersion: integer("lease_version").notNull().default(0),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
    lastErrorMessage: varchar("last_error_message", { length: 240 }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    response: jsonb("response").$type<Record<string, unknown>>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("provisioning_runs_org_key_unique").on(table.organizationId, table.idempotencyKey),
    unique("provisioning_runs_scope_id_unique").on(table.organizationId, table.id),
    uniqueIndex("provisioning_runs_one_live_org_unique")
      .on(table.organizationId)
      .where(sql`${table.state} not in ('compensated', 'terminal_failed')`),
    index("provisioning_runs_lease_idx").on(table.state, table.leaseExpiresAt),
    check("provisioning_runs_attempts_check", sql`${table.attempts} >= 0`),
    check("provisioning_runs_lease_version_check", sql`${table.leaseVersion} >= 0`),
    foreignKey({
      name: "provisioning_runs_selected_unit_scope_fk",
      columns: [table.organizationId, table.selectedUnitId],
      foreignColumns: [units.organizationId, units.id],
    }),
  ],
);

export const provisioningSteps = pgTable(
  "provisioning_steps",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provisioningRunId: uuid("provisioning_run_id").notNull(),
    step: varchar("step", { length: 40 }).notNull(),
    status: provisioningStepStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    resourceId: uuid("resource_id"),
    checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().notNull().default({}),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    compensatedAt: timestamp("compensated_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.provisioningRunId, table.step] }),
    unique("provisioning_steps_run_step_unique").on(table.provisioningRunId, table.step),
    foreignKey({
      name: "provisioning_steps_run_scope_fk",
      columns: [table.organizationId, table.provisioningRunId],
      foreignColumns: [provisioningRuns.organizationId, provisioningRuns.id],
    }).onDelete("cascade"),
    check("provisioning_steps_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

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
    provisioningRunId: uuid("provisioning_run_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    activatedByIdentityId: uuid("activated_by_identity_id")
      .notNull()
      .references(() => identities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trials_org_unique").on(table.organizationId),
    uniqueIndex("trials_provisioning_run_unique").on(table.provisioningRunId),
    foreignKey({
      name: "trials_provisioning_run_scope_fk",
      columns: [table.organizationId, table.provisioningRunId],
      foreignColumns: [provisioningRuns.organizationId, provisioningRuns.id],
    }),
  ],
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
    publishedVersionId: uuid("published_version_id"),
    publishEpoch: integer("publish_epoch").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("public_menus_scope_id_unique").on(table.organizationId, table.unitId, table.id),
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
    provisioningRunId: uuid("provisioning_run_id"),
    planSnapshot: jsonb("plan_snapshot").$type<Record<string, unknown>>(),
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
    uniqueIndex("subscriptions_provisioning_run_unique").on(table.provisioningRunId),
    unique("subscriptions_organization_id_unique").on(table.organizationId, table.id),
    foreignKey({
      name: "subscriptions_provisioning_run_scope_fk",
      columns: [table.organizationId, table.provisioningRunId],
      foreignColumns: [provisioningRuns.organizationId, provisioningRuns.id],
    }),
  ],
);

export const subscriptionEntitlements = pgTable(
  "subscription_entitlements",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").notNull(),
    entitlement: varchar("entitlement", { length: 100 }).notNull(),
    state: subscriptionEntitlementState("state").notNull().default("provisional"),
    provisioningRunId: uuid("provisioning_run_id").notNull(),
    sourcePlanSnapshot: jsonb("source_plan_snapshot").$type<Record<string, unknown>>().notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.subscriptionId, table.entitlement] }),
    foreignKey({
      name: "subscription_entitlements_subscription_scope_fk",
      columns: [table.organizationId, table.subscriptionId],
      foreignColumns: [subscriptions.organizationId, subscriptions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "subscription_entitlements_run_scope_fk",
      columns: [table.organizationId, table.provisioningRunId],
      foreignColumns: [provisioningRuns.organizationId, provisioningRuns.id],
    }),
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
    id: uuid("id").notNull(),
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
    primaryKey({ columns: [table.organizationId, table.unitId, table.id] }),
    uniqueIndex("operational_command_idempotency_unique").on(
      table.organizationId,
      table.unitId,
      table.idempotencyKey,
    ),
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
    provisioningRunId: uuid("provisioning_run_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_org_time_idx").on(table.organizationId, table.occurredAt),
    uniqueIndex("audit_events_provisioning_action_unique").on(
      table.provisioningRunId,
      table.action,
    ),
    foreignKey({
      name: "audit_events_provisioning_run_scope_fk",
      columns: [table.organizationId, table.provisioningRunId],
      foreignColumns: [provisioningRuns.organizationId, provisioningRuns.id],
    }),
    check(
      "audit_events_provisioning_scope_check",
      sql`${table.provisioningRunId} is null or ${table.organizationId} is not null`,
    ),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    topic: varchar("topic", { length: 120 }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: varchar("aggregate_id", { length: 160 }).notNull(),
    sourceCommandId: uuid("source_command_id"),
    aggregateSequence: integer("aggregate_sequence"),
    occupancyEpoch: uuid("occupancy_epoch"),
    resourceVersion: integer("resource_version"),
    provisioningRunId: uuid("provisioning_run_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outbox_pending_idx").on(table.processedAt, table.availableAt),
    index("outbox_organization_idx").on(table.organizationId, table.createdAt),
    uniqueIndex("outbox_command_effect_unique")
      .on(table.organizationId, table.unitId, table.topic, table.sourceCommandId)
      .where(sql`${table.sourceCommandId} IS NOT NULL`),
    uniqueIndex("outbox_provisioning_topic_unique")
      .on(table.provisioningRunId, table.topic)
      .where(sql`${table.provisioningRunId} IS NOT NULL`),
    foreignKey({
      name: "outbox_events_provisioning_run_scope_fk",
      columns: [table.organizationId, table.provisioningRunId],
      foreignColumns: [provisioningRuns.organizationId, provisioningRuns.id],
    }),
    check(
      "outbox_events_provisioning_scope_check",
      sql`${table.provisioningRunId} is null or ${table.organizationId} is not null`,
    ),
    foreignKey({
      name: "outbox_events_organization_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
  ],
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

// Keep Drizzle's schema snapshot aligned with the RLS migration. Indirectly scoped
// tables (role bindings and charges) are enforced through their tenant parent.
export const baseTenantTables = [
  organizations,
  legalEntities,
  units,
  memberships,
  roleBindings,
  membershipInvitations,
  deviceEnrollments,
  onboardingRecords,
  onboardingChecklistItems,
  provisioningRuns,
  provisioningSteps,
  trials,
  publicMenus,
  providerCustomers,
  billingCheckouts,
  subscriptions,
  subscriptionEntitlements,
  charges,
  operationalCommands,
  auditEvents,
  outboxEvents,
  hubHeartbeats,
  hubCommands,
] as const;

for (const table of baseTenantTables) table.enableRLS();
