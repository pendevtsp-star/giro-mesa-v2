ALTER TYPE "catalog_status" ADD VALUE IF NOT EXISTS 'approved' BEFORE 'published';--> statement-breakpoint
ALTER TYPE "catalog_status" ADD VALUE IF NOT EXISTS 'scheduled' BEFORE 'published';--> statement-breakpoint
ALTER TABLE "commercial_catalog_versions" ADD COLUMN "source_version_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_catalog_versions" ADD COLUMN "created_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_catalog_versions" ADD COLUMN "landing" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_catalog_versions" ADD COLUMN "seo" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_catalog_versions" ADD COLUMN "approved_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_catalog_versions" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commercial_catalog_versions" ADD COLUMN "scheduled_publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commercial_catalog_versions" ADD COLUMN "published_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "commercial_catalog_versions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_plans" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_plans" ADD COLUMN "features" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_plans" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_plans" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_plans" ADD COLUMN "cta_label" varchar(80) DEFAULT 'Começar agora' NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_plans" ADD COLUMN "cta_href" varchar(240) DEFAULT '/teste-gratis' NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_plans" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE TABLE "commercial_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_version_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" varchar(20) NOT NULL,
	"value" integer NOT NULL,
	"plan_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cycles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"new_customers_only" boolean DEFAULT true NOT NULL,
	"code" varchar(40),
	"redemption_limit" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_promotions_value_check" CHECK ("value" > 0 and ("type" <> 'percentage' or "value" <= 10000)),
	CONSTRAINT "commercial_promotions_window_check" CHECK ("ends_at" is null or "ends_at" > "starts_at"),
	CONSTRAINT "commercial_promotions_limit_check" CHECK ("redemption_limit" is null or "redemption_limit" > 0)
);--> statement-breakpoint
CREATE TABLE "commercial_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_campaigns_status_check" CHECK ("status" in ('draft', 'active', 'paused', 'ended')),
	CONSTRAINT "commercial_campaigns_window_check" CHECK ("starts_at" is null or "ends_at" is null or "ends_at" > "starts_at")
);--> statement-breakpoint
CREATE TABLE "commercial_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_version_id" uuid NOT NULL,
	"slug" varchar(80) NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"variants" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_experiments_status_check" CHECK ("status" in ('draft', 'active', 'paused', 'ended')),
	CONSTRAINT "commercial_experiments_window_check" CHECK ("starts_at" is null or "ends_at" is null or "ends_at" > "starts_at")
);--> statement-breakpoint
CREATE TABLE "commercial_experiment_impressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_version_id" uuid NOT NULL,
	"experiment_slug" varchar(80) NOT NULL,
	"variant_key" varchar(40) NOT NULL,
	"visitor_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "commercial_media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(40) NOT NULL,
	"url" text NOT NULL,
	"file_name" varchar(180) NOT NULL,
	"mime_type" varchar(32) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"alt" varchar(180) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_identity_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_media_assets_size_check" CHECK ("size_bytes" > 0 and "size_bytes" <= 2000000)
);--> statement-breakpoint
CREATE TABLE "commercial_lead_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" varchar(16) NOT NULL,
	"source_id" uuid NOT NULL,
	"stage" varchar(24) DEFAULT 'new' NOT NULL,
	"assigned_to_identity_id" uuid,
	"organization_id" uuid,
	"notes" text,
	"last_contact_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_lead_states_source_type_check" CHECK ("source_type" in ('trial', 'contact')),
	CONSTRAINT "commercial_lead_states_stage_check" CHECK ("stage" in ('new', 'qualified', 'contacted', 'converted', 'lost')),
	CONSTRAINT "commercial_lead_states_conversion_check" CHECK ("stage" <> 'converted' or "organization_id" is not null)
);--> statement-breakpoint
ALTER TABLE "trial_applications" ADD COLUMN "campaign_slug" varchar(80);--> statement-breakpoint
ALTER TABLE "trial_applications" ADD COLUMN "landing_version" integer;--> statement-breakpoint
ALTER TABLE "trial_applications" ADD COLUMN "utm_source" varchar(120);--> statement-breakpoint
ALTER TABLE "trial_applications" ADD COLUMN "utm_medium" varchar(120);--> statement-breakpoint
ALTER TABLE "trial_applications" ADD COLUMN "utm_campaign" varchar(160);--> statement-breakpoint
ALTER TABLE "trial_applications" ADD COLUMN "utm_term" varchar(160);--> statement-breakpoint
ALTER TABLE "trial_applications" ADD COLUMN "utm_content" varchar(160);--> statement-breakpoint
ALTER TABLE "trial_applications" ADD COLUMN "terms_version" varchar(40);--> statement-breakpoint
ALTER TABLE "trial_applications" ADD COLUMN "privacy_version" varchar(40);--> statement-breakpoint
ALTER TABLE "trial_applications" ADD COLUMN "experiment_slug" varchar(80);--> statement-breakpoint
ALTER TABLE "trial_applications" ADD COLUMN "experiment_variant_key" varchar(40);--> statement-breakpoint
ALTER TABLE "trial_applications" ADD COLUMN "experiment_visitor_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "campaign_slug" varchar(80);--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "landing_version" integer;--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "utm_source" varchar(120);--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "utm_medium" varchar(120);--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "utm_campaign" varchar(160);--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "utm_term" varchar(160);--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "utm_content" varchar(160);--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "terms_version" varchar(40);--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "privacy_version" varchar(40);--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "experiment_slug" varchar(80);--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "experiment_variant_key" varchar(40);--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "experiment_visitor_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "promotion_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "promotion_code" varchar(40);--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "promotion_discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "promotion_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "commercial_catalog_versions" ADD CONSTRAINT "commercial_catalog_versions_source_version_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."commercial_catalog_versions"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "commercial_catalog_versions" ADD CONSTRAINT "commercial_catalog_versions_created_by_identity_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "commercial_catalog_versions" ADD CONSTRAINT "commercial_catalog_versions_approved_by_identity_id_fk" FOREIGN KEY ("approved_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "commercial_catalog_versions" ADD CONSTRAINT "commercial_catalog_versions_published_by_identity_id_fk" FOREIGN KEY ("published_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "commercial_promotions" ADD CONSTRAINT "commercial_promotions_catalog_version_id_fk" FOREIGN KEY ("catalog_version_id") REFERENCES "public"."commercial_catalog_versions"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "commercial_experiments" ADD CONSTRAINT "commercial_experiments_catalog_version_id_fk" FOREIGN KEY ("catalog_version_id") REFERENCES "public"."commercial_catalog_versions"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "commercial_experiment_impressions" ADD CONSTRAINT "commercial_experiment_impressions_catalog_version_id_fk" FOREIGN KEY ("catalog_version_id") REFERENCES "public"."commercial_catalog_versions"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "commercial_media_assets" ADD CONSTRAINT "commercial_media_assets_created_by_identity_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "commercial_lead_states" ADD CONSTRAINT "commercial_lead_states_assigned_to_identity_id_fk" FOREIGN KEY ("assigned_to_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "commercial_lead_states" ADD CONSTRAINT "commercial_lead_states_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_promotion_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."commercial_promotions"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_promotion_discount_check" CHECK ("promotion_discount_cents" >= 0);--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_catalog_single_published_unique" ON "commercial_catalog_versions" ((status)) WHERE status::text = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_catalog_single_scheduled_unique" ON "commercial_catalog_versions" ((true)) WHERE "scheduled_publish_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_promotions_version_code_unique" ON "commercial_promotions" ("catalog_version_id", "code") WHERE "code" is not null;--> statement-breakpoint
CREATE INDEX "commercial_promotions_window_idx" ON "commercial_promotions" ("catalog_version_id", "active", "starts_at", "ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_campaigns_slug_unique" ON "commercial_campaigns" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_experiments_version_slug_unique" ON "commercial_experiments" ("catalog_version_id", "slug");--> statement-breakpoint
CREATE INDEX "commercial_experiments_active_idx" ON "commercial_experiments" ("catalog_version_id", "status", "starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_experiment_impressions_visitor_unique" ON "commercial_experiment_impressions" ("catalog_version_id", "experiment_slug", "visitor_hash");--> statement-breakpoint
CREATE INDEX "commercial_experiment_impressions_variant_idx" ON "commercial_experiment_impressions" ("catalog_version_id", "experiment_slug", "variant_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_media_assets_key_unique" ON "commercial_media_assets" ("key");
--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_lead_states_source_unique" ON "commercial_lead_states" ("source_type", "source_id");--> statement-breakpoint
CREATE INDEX "commercial_lead_states_stage_idx" ON "commercial_lead_states" ("stage", "updated_at");--> statement-breakpoint
CREATE INDEX "commercial_lead_states_assignee_idx" ON "commercial_lead_states" ("assigned_to_identity_id", "updated_at");
