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
  "receptionist",
  "busser",
  "kds",
  "delivery",
  "inventory",
  "finance",
  "accountant",
]);
export const catalogStatus = pgEnum("catalog_status", [
  "draft",
  "approved",
  "scheduled",
  "published",
  "discontinued",
]);
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

export const terminalOperatorPins = pgTable("terminal_operator_pins", {
  membershipId: uuid("membership_id")
    .primaryKey()
    .references(() => memberships.id, { onDelete: "cascade" }),
  pinHash: text("pin_hash").notNull(),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const terminalSessions = pgTable(
  "terminal_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").notNull(),
    openedByIdentityId: uuid("opened_by_identity_id")
      .notNull()
      .references(() => identities.id),
    deviceId: varchar("device_id", { length: 160 }),
    activeActorMembershipId: uuid("active_actor_membership_id").references(() => memberships.id, {
      onDelete: "set null",
    }),
    actorEpoch: integer("actor_epoch").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    failureWindowStartedAt: timestamp("failure_window_started_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("terminal_sessions_token_hash_unique").on(table.tokenHash),
    index("terminal_sessions_scope_idx").on(table.organizationId, table.unitId),
    index("terminal_sessions_actor_idx").on(table.activeActorMembershipId),
    foreignKey({
      name: "terminal_sessions_organization_unit_fk",
      columns: [table.organizationId, table.unitId],
      foreignColumns: [units.organizationId, units.id],
    }).onDelete("cascade"),
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
    sourceVersionId: uuid("source_version_id"),
    createdByIdentityId: uuid("created_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    landing: jsonb("landing")
      .$type<
        Record<
          | "hero"
          | "socialProof"
          | "benefits"
          | "howItWorks"
          | "testimonials"
          | "faq"
          | "finalCta"
          | "legal",
          Record<string, unknown>
        >
      >()
      .notNull()
      .default(
        {} as Record<
          | "hero"
          | "socialProof"
          | "benefits"
          | "howItWorks"
          | "testimonials"
          | "faq"
          | "finalCta"
          | "legal",
          Record<string, unknown>
        >,
      ),
    seo: jsonb("seo").$type<Record<string, unknown>>().notNull().default({}),
    approvedByIdentityId: uuid("approved_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    scheduledPublishAt: timestamp("scheduled_publish_at", { withTimezone: true }),
    publishedByIdentityId: uuid("published_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("commercial_catalog_version_unique").on(table.version),
    uniqueIndex("commercial_catalog_single_published_unique")
      .on(table.status)
      .where(sql`${table.status} = 'published'::catalog_status`),
    uniqueIndex("commercial_catalog_single_scheduled_unique")
      .on(sql`(true)`)
      .where(sql`${table.scheduledPublishAt} is not null`),
    foreignKey({
      name: "commercial_catalog_versions_source_version_id_fk",
      columns: [table.sourceVersionId],
      foreignColumns: [table.id],
    }).onDelete("set null"),
  ],
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
    description: text("description").notNull().default(""),
    features: jsonb("features").$type<string[]>().notNull().default([]),
    featured: boolean("featured").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),
    ctaLabel: varchar("cta_label", { length: 80 }).notNull().default("Começar agora"),
    ctaHref: varchar("cta_href", { length: 240 }).notNull().default("/teste-gratis"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("commercial_plan_catalog_slug_unique").on(table.catalogVersionId, table.slug),
  ],
);

export const commercialPromotions = pgTable(
  "commercial_promotions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    catalogVersionId: uuid("catalog_version_id")
      .notNull()
      .references(() => commercialCatalogVersions.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    type: varchar("type", { length: 20 }).$type<"percentage" | "fixed" | "price">().notNull(),
    value: integer("value").notNull(),
    planSlugs: jsonb("plan_slugs").$type<string[]>().notNull().default([]),
    cycles: jsonb("cycles").$type<Array<"monthly" | "annual">>().notNull().default([]),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    newCustomersOnly: boolean("new_customers_only").notNull().default(true),
    code: varchar("code", { length: 40 }),
    redemptionLimit: integer("redemption_limit"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("commercial_promotions_version_code_unique")
      .on(table.catalogVersionId, table.code)
      .where(sql`${table.code} is not null`),
    index("commercial_promotions_window_idx").on(
      table.catalogVersionId,
      table.active,
      table.startsAt,
      table.endsAt,
    ),
    check(
      "commercial_promotions_value_check",
      sql`${table.value} > 0 and (${table.type} <> 'percentage' or ${table.value} <= 10000)`,
    ),
    check(
      "commercial_promotions_window_check",
      sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      "commercial_promotions_limit_check",
      sql`${table.redemptionLimit} is null or ${table.redemptionLimit} > 0`,
    ),
  ],
);

export const commercialCampaigns = pgTable(
  "commercial_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    status: varchar("status", { length: 16 })
      .$type<"draft" | "active" | "paused" | "ended">()
      .notNull()
      .default("draft"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("commercial_campaigns_slug_unique").on(table.slug),
    check(
      "commercial_campaigns_status_check",
      sql`${table.status} in ('draft', 'active', 'paused', 'ended')`,
    ),
    check(
      "commercial_campaigns_window_check",
      sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

export type CommercialExperimentVariant = {
  key: string;
  weight: number;
  headline: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
};

export const commercialExperiments = pgTable(
  "commercial_experiments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    catalogVersionId: uuid("catalog_version_id")
      .notNull()
      .references(() => commercialCatalogVersions.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 80 }).notNull(),
    status: varchar("status", { length: 16 })
      .$type<"draft" | "active" | "paused" | "ended">()
      .notNull()
      .default("draft"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    variants: jsonb("variants").$type<CommercialExperimentVariant[]>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("commercial_experiments_version_slug_unique").on(
      table.catalogVersionId,
      table.slug,
    ),
    index("commercial_experiments_active_idx").on(
      table.catalogVersionId,
      table.status,
      table.startsAt,
    ),
    check(
      "commercial_experiments_status_check",
      sql`${table.status} in ('draft', 'active', 'paused', 'ended')`,
    ),
    check(
      "commercial_experiments_window_check",
      sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);

export const commercialExperimentImpressions = pgTable(
  "commercial_experiment_impressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    catalogVersionId: uuid("catalog_version_id")
      .notNull()
      .references(() => commercialCatalogVersions.id, { onDelete: "cascade" }),
    experimentSlug: varchar("experiment_slug", { length: 80 }).notNull(),
    variantKey: varchar("variant_key", { length: 40 }).notNull(),
    visitorHash: varchar("visitor_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("commercial_experiment_impressions_visitor_unique").on(
      table.catalogVersionId,
      table.experimentSlug,
      table.visitorHash,
    ),
    index("commercial_experiment_impressions_variant_idx").on(
      table.catalogVersionId,
      table.experimentSlug,
      table.variantKey,
    ),
  ],
);

export const commercialMediaAssets = pgTable(
  "commercial_media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: varchar("key", { length: 40 }).notNull(),
    url: text("url").notNull(),
    fileName: varchar("file_name", { length: 180 }).notNull(),
    mimeType: varchar("mime_type", { length: 32 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    alt: varchar("alt", { length: 180 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdByIdentityId: uuid("created_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("commercial_media_assets_key_unique").on(table.key),
    check(
      "commercial_media_assets_size_check",
      sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 2000000`,
    ),
  ],
);

export const commercialLeadStates = pgTable(
  "commercial_lead_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceType: varchar("source_type", { length: 16 }).$type<"trial" | "contact">().notNull(),
    sourceId: uuid("source_id").notNull(),
    stage: varchar("stage", { length: 24 })
      .$type<"new" | "qualified" | "contacted" | "converted" | "lost">()
      .notNull()
      .default("new"),
    assignedToIdentityId: uuid("assigned_to_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("commercial_lead_states_source_unique").on(table.sourceType, table.sourceId),
    index("commercial_lead_states_stage_idx").on(table.stage, table.updatedAt),
    index("commercial_lead_states_assignee_idx").on(table.assignedToIdentityId, table.updatedAt),
    check(
      "commercial_lead_states_source_type_check",
      sql`${table.sourceType} in ('trial', 'contact')`,
    ),
    check(
      "commercial_lead_states_stage_check",
      sql`${table.stage} in ('new', 'qualified', 'contacted', 'converted', 'lost')`,
    ),
    check(
      "commercial_lead_states_conversion_check",
      sql`${table.stage} <> 'converted' or ${table.organizationId} is not null`,
    ),
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
  campaignSlug: varchar("campaign_slug", { length: 80 }),
  landingVersion: integer("landing_version"),
  utmSource: varchar("utm_source", { length: 120 }),
  utmMedium: varchar("utm_medium", { length: 120 }),
  utmCampaign: varchar("utm_campaign", { length: 160 }),
  utmTerm: varchar("utm_term", { length: 160 }),
  utmContent: varchar("utm_content", { length: 160 }),
  termsVersion: varchar("terms_version", { length: 40 }),
  privacyVersion: varchar("privacy_version", { length: 40 }),
  experimentSlug: varchar("experiment_slug", { length: 80 }),
  experimentVariantKey: varchar("experiment_variant_key", { length: 40 }),
  experimentVisitorHash: varchar("experiment_visitor_hash", { length: 64 }),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contactRequests = pgTable("contact_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 254 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  message: text("message").notNull(),
  campaignSlug: varchar("campaign_slug", { length: 80 }),
  landingVersion: integer("landing_version"),
  utmSource: varchar("utm_source", { length: 120 }),
  utmMedium: varchar("utm_medium", { length: 120 }),
  utmCampaign: varchar("utm_campaign", { length: 160 }),
  utmTerm: varchar("utm_term", { length: 160 }),
  utmContent: varchar("utm_content", { length: 160 }),
  termsVersion: varchar("terms_version", { length: 40 }),
  privacyVersion: varchar("privacy_version", { length: 40 }),
  experimentSlug: varchar("experiment_slug", { length: 80 }),
  experimentVariantKey: varchar("experiment_variant_key", { length: 40 }),
  experimentVisitorHash: varchar("experiment_visitor_hash", { length: 64 }),
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
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    version: integer("version").notNull().default(1),
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
    contractedPriceCents: integer("contracted_price_cents"),
    paymentMethod: varchar("payment_method", { length: 24 }).$type<"credit_card" | "pix">(),
    currentPeriodStartsAt: timestamp("current_period_starts_at", { withTimezone: true }),
    currentPeriodEndsAt: timestamp("current_period_ends_at", { withTimezone: true }),
    reconciliationStatus: varchar("reconciliation_status", { length: 24 })
      .$type<"not_required" | "pending" | "succeeded" | "failed">()
      .notNull()
      .default("not_required"),
    reconciliationError: text("reconciliation_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("subscriptions_provider_unique").on(table.provider, table.providerSubscriptionId),
    uniqueIndex("subscriptions_organization_current_unique")
      .on(table.organizationId)
      .where(sql`${table.state} <> 'canceled'`),
    check(
      "subscriptions_contracted_price_check",
      sql`${table.contractedPriceCents} IS NULL OR ${table.contractedPriceCents} >= 0`,
    ),
    check(
      "subscriptions_current_period_check",
      sql`${table.currentPeriodStartsAt} IS NULL OR ${table.currentPeriodEndsAt} IS NULL OR ${table.currentPeriodEndsAt} > ${table.currentPeriodStartsAt}`,
    ),
  ],
);

export const billingUpgradeQuotes = pgTable(
  "billing_upgrade_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    targetCommercialPlanId: uuid("target_commercial_plan_id")
      .notNull()
      .references(() => commercialPlans.id),
    cycle: billingCycle("cycle").notNull(),
    amountCents: integer("amount_cents").notNull(),
    periodStartsAt: timestamp("period_starts_at", { withTimezone: true }).notNull(),
    periodEndsAt: timestamp("period_ends_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 24 })
      .$type<"quoted" | "consumed" | "expired" | "canceled">()
      .notNull()
      .default("quoted"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_upgrade_quotes_org_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    index("billing_upgrade_quotes_subscription_idx").on(table.subscriptionId, table.createdAt),
    check("billing_upgrade_quotes_amount_check", sql`${table.amountCents} > 0`),
    check(
      "billing_upgrade_quotes_period_check",
      sql`${table.periodEndsAt} > ${table.periodStartsAt}`,
    ),
    check("billing_upgrade_quotes_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const billingCheckouts = pgTable(
  "billing_checkouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    targetCommercialPlanId: uuid("target_commercial_plan_id").references(() => commercialPlans.id),
    upgradeQuoteId: uuid("upgrade_quote_id").references(() => billingUpgradeQuotes.id),
    promotionId: uuid("promotion_id").references(() => commercialPromotions.id, {
      onDelete: "set null",
    }),
    promotionCode: varchar("promotion_code", { length: 40 }),
    promotionDiscountCents: integer("promotion_discount_cents").notNull().default(0),
    promotionFingerprint: varchar("promotion_fingerprint", { length: 64 }),
    provider: varchar("provider", { length: 30 }).notNull(),
    providerCheckoutId: varchar("provider_checkout_id", { length: 160 }),
    intent: varchar("intent", { length: 24 })
      .$type<"subscribe" | "regularize" | "upgrade">()
      .notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    amountCents: integer("amount_cents"),
    cycle: billingCycle("cycle"),
    paymentMethods: jsonb("payment_methods")
      .$type<Array<"credit_card" | "pix">>()
      .notNull()
      .default(["credit_card", "pix"]),
    providerCheckoutUrl: text("provider_checkout_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: varchar("status", { length: 40 }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    reconciliationStatus: varchar("reconciliation_status", { length: 24 })
      .$type<"not_required" | "pending" | "succeeded" | "failed">()
      .notNull()
      .default("not_required"),
    reconciliationError: text("reconciliation_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("billing_checkout_provider_unique").on(table.provider, table.providerCheckoutId),
    uniqueIndex("billing_checkouts_org_idempotency_unique").on(
      table.organizationId,
      table.idempotencyKey,
    ),
    uniqueIndex("billing_checkouts_upgrade_quote_unique").on(table.upgradeQuoteId),
    check(
      "billing_checkouts_amount_check",
      sql`${table.amountCents} IS NULL OR ${table.amountCents} > 0`,
    ),
    check("billing_checkouts_promotion_discount_check", sql`${table.promotionDiscountCents} >= 0`),
  ],
);

export const charges = pgTable(
  "charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    billingCheckoutId: uuid("billing_checkout_id").references(() => billingCheckouts.id, {
      onDelete: "set null",
    }),
    providerChargeId: varchar("provider_charge_id", { length: 160 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    paymentMethod: varchar("payment_method", { length: 24 }).$type<"credit_card" | "pix">(),
    paymentUrl: text("payment_url"),
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
    processingAttempts: integer("processing_attempts").notNull().default(0),
    lastProcessingError: text("last_processing_error"),
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
    unitId: uuid("unit_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hubId: uuid("hub_id").notNull(),
    version: varchar("version", { length: 40 }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    primaryKey({
      name: "hub_heartbeats_pkey",
      columns: [table.unitId, table.hubId],
    }),
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
    unique("hub_commands_scope_id_unique").on(table.organizationId, table.unitId, table.id),
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
