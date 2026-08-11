CREATE TYPE "public"."onboarding_checklist_source" AS ENUM('system', 'actor_attestation', 'authorized_waiver', 'legacy_import');--> statement-breakpoint
CREATE TYPE "public"."onboarding_checklist_status" AS ENUM('pending', 'in_progress', 'verified', 'blocked', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."provisioning_state" AS ENUM('requested', 'validating', 'provisioning', 'activating', 'publishing', 'retryable_failed', 'compensating', 'compensated', 'terminal_failed', 'completed');--> statement-breakpoint
CREATE TYPE "public"."provisioning_step_status" AS ENUM('pending', 'in_progress', 'completed', 'failed', 'compensated');--> statement-breakpoint
CREATE TYPE "public"."subscription_entitlement_state" AS ENUM('provisional', 'active', 'revoked');--> statement-breakpoint
CREATE TABLE "onboarding_checklist_items" (
	"organization_id" uuid NOT NULL,
	"item" varchar(40) NOT NULL,
	"status" "onboarding_checklist_status" DEFAULT 'pending' NOT NULL,
	"source" "onboarding_checklist_source" DEFAULT 'system' NOT NULL,
	"evidence_reference" varchar(240),
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_identity_id" uuid,
	"waiver_reason" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_checklist_items_organization_id_item_pk" PRIMARY KEY("organization_id","item"),
	CONSTRAINT "onboarding_checklist_item_check" CHECK ("onboarding_checklist_items"."item" in ('business','unit','plan','fiscalChoice','catalog','tables','team','qr','production','cashier','training','rehearsal')),
	CONSTRAINT "onboarding_checklist_verified_evidence_check" CHECK ("onboarding_checklist_items"."status" <> 'verified' or ("onboarding_checklist_items"."source" in ('system','actor_attestation') and "onboarding_checklist_items"."evidence_reference" is not null and "onboarding_checklist_items"."verified_at" is not null and ("onboarding_checklist_items"."source" <> 'actor_attestation' or "onboarding_checklist_items"."actor_identity_id" is not null))),
	CONSTRAINT "onboarding_checklist_waiver_check" CHECK ("onboarding_checklist_items"."status" <> 'not_applicable' or ("onboarding_checklist_items"."item" in ('fiscalChoice','qr') and "onboarding_checklist_items"."source" = 'authorized_waiver' and length("onboarding_checklist_items"."waiver_reason") >= 10 and "onboarding_checklist_items"."evidence_reference" is not null and "onboarding_checklist_items"."actor_identity_id" is not null and "onboarding_checklist_items"."verified_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "onboarding_checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provisioning_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"plan_slug" varchar(60) NOT NULL,
	"pinned_plan_id" uuid,
	"pinned_catalog_version" integer,
	"plan_fingerprint" varchar(64),
	"plan_snapshot" jsonb,
	"state" "provisioning_state" DEFAULT 'requested' NOT NULL,
	"checkpoint" varchar(40) DEFAULT 'requested' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_owner" varchar(120),
	"lease_expires_at" timestamp with time zone,
	"lease_version" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(80),
	"last_error_message" varchar(240),
	"next_retry_at" timestamp with time zone,
	"response" jsonb,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provisioning_runs_scope_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "provisioning_runs_attempts_check" CHECK ("provisioning_runs"."attempts" >= 0),
	CONSTRAINT "provisioning_runs_lease_version_check" CHECK ("provisioning_runs"."lease_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "provisioning_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provisioning_steps" (
	"organization_id" uuid NOT NULL,
	"provisioning_run_id" uuid NOT NULL,
	"step" varchar(40) NOT NULL,
	"status" "provisioning_step_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"resource_id" uuid,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error_code" varchar(80),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"compensated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provisioning_steps_organization_id_provisioning_run_id_step_pk" PRIMARY KEY("organization_id","provisioning_run_id","step"),
	CONSTRAINT "provisioning_steps_run_step_unique" UNIQUE("provisioning_run_id","step"),
	CONSTRAINT "provisioning_steps_attempts_check" CHECK ("provisioning_steps"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "provisioning_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_entitlements" (
	"organization_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"entitlement" varchar(100) NOT NULL,
	"state" "subscription_entitlement_state" DEFAULT 'provisional' NOT NULL,
	"provisioning_run_id" uuid NOT NULL,
	"source_plan_snapshot" jsonb NOT NULL,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_entitlements_organization_id_subscription_id_entitlement_pk" PRIMARY KEY("organization_id","subscription_id","entitlement")
);
--> statement-breakpoint
ALTER TABLE "subscription_entitlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "provisioning_run_id" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "provisioning_run_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provisioning_run_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "plan_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "provisioning_run_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "onboarding_checklist_items" ADD CONSTRAINT "onboarding_checklist_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_checklist_items" ADD CONSTRAINT "onboarding_checklist_items_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_runs" ADD CONSTRAINT "provisioning_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_runs" ADD CONSTRAINT "provisioning_runs_pinned_plan_id_commercial_plans_id_fk" FOREIGN KEY ("pinned_plan_id") REFERENCES "public"."commercial_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_steps" ADD CONSTRAINT "provisioning_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_steps" ADD CONSTRAINT "provisioning_steps_run_scope_fk" FOREIGN KEY ("organization_id","provisioning_run_id") REFERENCES "public"."provisioning_runs"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_entitlements" ADD CONSTRAINT "subscription_entitlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_entitlements" ADD CONSTRAINT "subscription_entitlements_subscription_scope_fk" FOREIGN KEY ("organization_id","subscription_id") REFERENCES "public"."subscriptions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_entitlements" ADD CONSTRAINT "subscription_entitlements_run_scope_fk" FOREIGN KEY ("organization_id","provisioning_run_id") REFERENCES "public"."provisioning_runs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provisioning_runs_org_key_unique" ON "provisioning_runs" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "provisioning_runs_one_live_org_unique" ON "provisioning_runs" USING btree ("organization_id") WHERE "provisioning_runs"."state" not in ('compensated', 'terminal_failed');--> statement-breakpoint
CREATE INDEX "provisioning_runs_lease_idx" ON "provisioning_runs" USING btree ("state","lease_expires_at");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_provisioning_run_scope_fk" FOREIGN KEY ("organization_id","provisioning_run_id") REFERENCES "public"."provisioning_runs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_provisioning_run_scope_fk" FOREIGN KEY ("organization_id","provisioning_run_id") REFERENCES "public"."provisioning_runs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_provisioning_run_scope_fk" FOREIGN KEY ("organization_id","provisioning_run_id") REFERENCES "public"."provisioning_runs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_provisioning_run_scope_fk" FOREIGN KEY ("organization_id","provisioning_run_id") REFERENCES "public"."provisioning_runs"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_provisioning_action_unique" ON "audit_events" USING btree ("provisioning_run_id","action");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_provisioning_topic_unique" ON "outbox_events" USING btree ("provisioning_run_id","topic") WHERE "outbox_events"."provisioning_run_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provisioning_run_unique" ON "subscriptions" USING btree ("provisioning_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trials_provisioning_run_unique" ON "trials" USING btree ("provisioning_run_id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_provisioning_scope_check" CHECK ("audit_events"."provisioning_run_id" is null or "audit_events"."organization_id" is not null);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_provisioning_scope_check" CHECK ("outbox_events"."provisioning_run_id" is null or "outbox_events"."organization_id" is not null);
--> statement-breakpoint

-- Legacy boolean values are preserved as resumable progress, never promoted to
-- verified evidence.  The API revalidates system-owned items before activation.
INSERT INTO public.onboarding_checklist_items (
  organization_id, item, status, source, evidence, created_at, updated_at
)
SELECT
  record.organization_id,
  item.name,
  CASE
    WHEN record.checklist ->> item.name = 'true' THEN 'in_progress'::onboarding_checklist_status
    ELSE 'pending'::onboarding_checklist_status
  END,
  'legacy_import'::onboarding_checklist_source,
  jsonb_build_object('legacyValue', record.checklist -> item.name),
  record.created_at,
  record.updated_at
FROM public.onboarding_records AS record
CROSS JOIN (
  VALUES
    ('business'), ('unit'), ('plan'), ('fiscalChoice'), ('catalog'), ('tables'),
    ('team'), ('qr'), ('production'), ('cashier'), ('training'), ('rehearsal')
) AS item(name)
ON CONFLICT (organization_id, item) DO NOTHING;
--> statement-breakpoint

ALTER TABLE public.onboarding_checklist_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.provisioning_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.provisioning_steps FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.subscription_entitlements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

REVOKE ALL ON
  public.onboarding_checklist_items,
  public.provisioning_runs,
  public.provisioning_steps,
  public.subscription_entitlements
FROM PUBLIC, giromesa_worker, giromesa_identity, giromesa_public, giromesa_internal,
  giromesa_legacy_transition;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON
  public.onboarding_checklist_items,
  public.provisioning_runs,
  public.provisioning_steps,
  public.subscription_entitlements
TO giromesa_app;
--> statement-breakpoint

GRANT SELECT ON public.commercial_catalog_versions, public.commercial_plans TO giromesa_app;
--> statement-breakpoint

-- Provisioning can only touch the subscription columns owned by this saga.
-- Existing billing provider identifiers remain inaccessible to the app role.
GRANT SELECT (
  id, organization_id, commercial_plan_id, provisioning_run_id, plan_snapshot,
  cycle, state, current_period_ends_at, created_at, updated_at
) ON public.subscriptions TO giromesa_app;
--> statement-breakpoint
GRANT INSERT (
  id, organization_id, commercial_plan_id, provisioning_run_id, plan_snapshot,
  cycle, state, current_period_ends_at, created_at, updated_at
) ON public.subscriptions TO giromesa_app;
--> statement-breakpoint
GRANT UPDATE (state, current_period_ends_at, updated_at) ON public.subscriptions TO giromesa_app;
--> statement-breakpoint

CREATE POLICY giromesa_tenant_scope ON public.onboarding_checklist_items
  AS PERMISSIVE FOR ALL TO giromesa_app
  USING (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, NULL)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, NULL)
  );
--> statement-breakpoint
CREATE POLICY giromesa_tenant_scope ON public.provisioning_runs
  AS PERMISSIVE FOR ALL TO giromesa_app
  USING (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, NULL)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, NULL)
  );
--> statement-breakpoint
CREATE POLICY giromesa_tenant_scope ON public.provisioning_steps
  AS PERMISSIVE FOR ALL TO giromesa_app
  USING (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, NULL)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, NULL)
  );
--> statement-breakpoint
CREATE POLICY giromesa_tenant_scope ON public.subscription_entitlements
  AS PERMISSIVE FOR ALL TO giromesa_app
  USING (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, NULL)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, NULL)
  );
