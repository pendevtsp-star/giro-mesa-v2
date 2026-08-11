ALTER TABLE "onboarding_records" ADD COLUMN "selected_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_records" ADD COLUMN "selected_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_records" ADD COLUMN "selected_catalog_version" integer;--> statement-breakpoint
ALTER TABLE "onboarding_records" ADD COLUMN "selected_plan_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "onboarding_records" ADD COLUMN "selected_plan_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "onboarding_records" ADD COLUMN "selected_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_records" ADD COLUMN "selected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding_records" ADD COLUMN "selection_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provisioning_runs" ADD COLUMN "selected_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_records" ADD CONSTRAINT "onboarding_records_selected_plan_id_commercial_plans_id_fk" FOREIGN KEY ("selected_plan_id") REFERENCES "public"."commercial_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_records" ADD CONSTRAINT "onboarding_records_selected_by_identity_id_identities_id_fk" FOREIGN KEY ("selected_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_records" ADD CONSTRAINT "onboarding_records_selected_unit_scope_fk" FOREIGN KEY ("organization_id","selected_unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_runs" ADD CONSTRAINT "provisioning_runs_selected_unit_scope_fk" FOREIGN KEY ("organization_id","selected_unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_records" ADD CONSTRAINT "onboarding_selection_revision_check" CHECK ("onboarding_records"."selection_revision" >= 0);--> statement-breakpoint
ALTER TABLE "onboarding_records" ADD CONSTRAINT "onboarding_selection_complete_check" CHECK (("onboarding_records"."selected_unit_id" is null and "onboarding_records"."selected_plan_id" is null and "onboarding_records"."selected_catalog_version" is null and "onboarding_records"."selected_plan_fingerprint" is null and "onboarding_records"."selected_plan_snapshot" is null and "onboarding_records"."selected_by_identity_id" is null and "onboarding_records"."selected_at" is null) or ("onboarding_records"."selected_unit_id" is not null and "onboarding_records"."selected_plan_id" is not null and "onboarding_records"."selected_catalog_version" is not null and "onboarding_records"."selected_plan_fingerprint" is not null and "onboarding_records"."selected_plan_snapshot" is not null and "onboarding_records"."selected_by_identity_id" is not null and "onboarding_records"."selected_at" is not null and "onboarding_records"."selection_revision" > 0));
--> statement-breakpoint

-- Audit history is append-only for every runtime role. Only inserts remain
-- available through the policies/grants established by the tenant foundation.
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_events FROM
  PUBLIC, giromesa_app, giromesa_worker, giromesa_identity, giromesa_public,
  giromesa_internal, giromesa_legacy_transition;
