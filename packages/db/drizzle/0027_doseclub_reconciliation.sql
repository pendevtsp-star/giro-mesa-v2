CREATE TABLE "doseclub_reconciliation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "run_date" date NOT NULL,
  "trigger" varchar(16) NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "idempotency_key" varchar(180),
  "request_fingerprint" varchar(64),
  "requested_by_identity_id" uuid,
  "lease_owner" varchar(120),
  "lease_until" timestamp with time zone,
  "finding_count" integer DEFAULT 0 NOT NULL,
  "failure_code" varchar(80),
  "version" integer DEFAULT 1 NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "doseclub_reconciliation_runs_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
  CONSTRAINT "doseclub_reconciliation_runs_trigger_check" CHECK ("trigger" in ('scheduled','manual','retry')),
  CONSTRAINT "doseclub_reconciliation_runs_status_check" CHECK ("status" in ('pending','running','completed','failed')),
  CONSTRAINT "doseclub_reconciliation_runs_version_check" CHECK ("version" > 0),
  CONSTRAINT "doseclub_reconciliation_runs_idempotency_check" CHECK (("idempotency_key" is null and "request_fingerprint" is null) or ("idempotency_key" is not null and "request_fingerprint" is not null))
);--> statement-breakpoint

CREATE TABLE "doseclub_reconciliation_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "last_run_id" uuid NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "kind" varchar(48) NOT NULL,
  "status" varchar(16) DEFAULT 'open' NOT NULL,
  "severity" varchar(16) NOT NULL,
  "entity_type" varchar(32) NOT NULL,
  "entity_id" varchar(180) NOT NULL,
  "summary" varchar(300) NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "doseclub_reconciliation_findings_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
  CONSTRAINT "doseclub_reconciliation_findings_kind_check" CHECK ("kind" in ('missing_mapping','inactive_mapping','invalid_inventory_dimension','invalid_inventory_unit','state_version_gap','missing_reconcile_heartbeat')),
  CONSTRAINT "doseclub_reconciliation_findings_status_check" CHECK ("status" in ('open','resolved','superseded')),
  CONSTRAINT "doseclub_reconciliation_findings_severity_check" CHECK ("severity" in ('warning','critical')),
  CONSTRAINT "doseclub_reconciliation_findings_version_check" CHECK ("version" > 0)
);--> statement-breakpoint

ALTER TABLE "doseclub_reconciliation_runs" ADD CONSTRAINT "doseclub_reconciliation_runs_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_runs" ADD CONSTRAINT "doseclub_reconciliation_runs_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_runs" ADD CONSTRAINT "doseclub_reconciliation_runs_requested_by_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_findings" ADD CONSTRAINT "doseclub_reconciliation_findings_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_findings" ADD CONSTRAINT "doseclub_reconciliation_findings_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_findings" ADD CONSTRAINT "doseclub_reconciliation_findings_run_fk" FOREIGN KEY ("organization_id","unit_id","last_run_id") REFERENCES "public"."doseclub_reconciliation_runs"("organization_id","unit_id","id") ON DELETE restrict;--> statement-breakpoint

CREATE UNIQUE INDEX "doseclub_reconciliation_runs_scheduled_day_unique" ON "doseclub_reconciliation_runs" ("organization_id","unit_id","run_date") WHERE "trigger" = 'scheduled';--> statement-breakpoint
CREATE UNIQUE INDEX "doseclub_reconciliation_runs_idempotency_unique" ON "doseclub_reconciliation_runs" ("organization_id","unit_id","idempotency_key") WHERE "idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "doseclub_reconciliation_runs_claim_idx" ON "doseclub_reconciliation_runs" ("status","lease_until","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "doseclub_reconciliation_findings_fingerprint_unique" ON "doseclub_reconciliation_findings" ("organization_id","unit_id","fingerprint");--> statement-breakpoint
CREATE INDEX "doseclub_reconciliation_findings_status_idx" ON "doseclub_reconciliation_findings" ("organization_id","unit_id","status","last_detected_at");--> statement-breakpoint

ALTER TABLE "doseclub_reconciliation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_findings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON "doseclub_reconciliation_runs", "doseclub_reconciliation_findings"
  FROM PUBLIC, giromesa_app, giromesa_worker, giromesa_identity, giromesa_public, giromesa_internal, giromesa_legacy_transition;--> statement-breakpoint
GRANT SELECT, INSERT ON "doseclub_reconciliation_runs" TO giromesa_app;--> statement-breakpoint
GRANT UPDATE (status, lease_owner, lease_until, failure_code, version, started_at, completed_at, updated_at)
  ON "doseclub_reconciliation_runs" TO giromesa_app;--> statement-breakpoint
GRANT SELECT ON "doseclub_reconciliation_findings" TO giromesa_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "doseclub_reconciliation_runs", "doseclub_reconciliation_findings" TO giromesa_worker;--> statement-breakpoint
GRANT SELECT ON "doseclub_product_mappings", "doseclub_states", "doseclub_operations", "management_inventory_items" TO giromesa_worker;--> statement-breakpoint
GRANT SELECT (organization_id, unit_id, provider, status, config) ON "growth_integrations" TO giromesa_worker;--> statement-breakpoint

CREATE POLICY giromesa_tenant_scope ON "doseclub_reconciliation_runs" FOR ALL TO giromesa_app
  USING (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, unit_id)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, unit_id)
    AND (
      current_user <> 'giromesa_app'
      OR (
        trigger = 'manual'
        AND status = 'pending'
        AND idempotency_key is not null
        AND request_fingerprint is not null
        AND lease_owner is null
        AND lease_until is null
        AND finding_count = 0
        AND failure_code is null
        AND started_at is null
        AND completed_at is null
      )
    )
  );--> statement-breakpoint
CREATE POLICY giromesa_tenant_scope ON "doseclub_reconciliation_findings" FOR ALL TO giromesa_app
  USING (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, unit_id)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, unit_id)
  );--> statement-breakpoint
CREATE POLICY giromesa_doseclub_reconciliation_worker ON "doseclub_reconciliation_runs"
  FOR ALL TO giromesa_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY giromesa_doseclub_reconciliation_worker ON "doseclub_reconciliation_findings"
  FOR ALL TO giromesa_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY giromesa_doseclub_worker_read ON "doseclub_product_mappings"
  FOR SELECT TO giromesa_worker USING (true);--> statement-breakpoint
CREATE POLICY giromesa_doseclub_worker_read ON "doseclub_states"
  FOR SELECT TO giromesa_worker USING (true);--> statement-breakpoint
CREATE POLICY giromesa_doseclub_worker_read ON "doseclub_operations"
  FOR SELECT TO giromesa_worker USING (true);--> statement-breakpoint
CREATE POLICY giromesa_doseclub_worker_inventory_read ON "management_inventory_items"
  FOR SELECT TO giromesa_worker USING (true);--> statement-breakpoint
CREATE POLICY giromesa_doseclub_worker_integrations_read ON "growth_integrations"
  FOR SELECT TO giromesa_worker USING (provider = 'doseclub');--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_doseclub_reconciliation_run_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id
    OR NEW.unit_id <> OLD.unit_id
    OR NEW.run_date <> OLD.run_date
    OR NEW.trigger <> OLD.trigger
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
    OR NEW.requested_by_identity_id IS DISTINCT FROM OLD.requested_by_identity_id
  THEN
    RAISE EXCEPTION 'DOSECLUB_RECONCILIATION_RUN_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'DOSECLUB_RECONCILIATION_RUN_VERSION_INVALID';
  END IF;
  IF current_user = 'giromesa_app'
    AND NOT (OLD.status = 'failed' AND NEW.status = 'pending')
  THEN
    RAISE EXCEPTION 'DOSECLUB_RECONCILIATION_RUN_APP_TRANSITION_INVALID';
  END IF;
  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('pending','running','failed'))
    OR (OLD.status = 'running' AND NEW.status IN ('running','completed','failed'))
    OR (OLD.status = 'failed' AND NEW.status = 'pending')
    OR (OLD.status = 'completed' AND NEW.status = 'completed')
  ) THEN
    RAISE EXCEPTION 'DOSECLUB_RECONCILIATION_RUN_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_doseclub_reconciliation_run_transition() OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_doseclub_reconciliation_run_transition() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER doseclub_reconciliation_runs_transition
  BEFORE UPDATE ON public.doseclub_reconciliation_runs
  FOR EACH ROW EXECUTE FUNCTION public.giromesa_doseclub_reconciliation_run_transition();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_doseclub_reconciliation_finding_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id
    OR NEW.unit_id <> OLD.unit_id
    OR NEW.fingerprint <> OLD.fingerprint
    OR NEW.kind <> OLD.kind
    OR NEW.entity_type <> OLD.entity_type
    OR NEW.entity_id <> OLD.entity_id
    OR NEW.first_detected_at <> OLD.first_detected_at
  THEN
    RAISE EXCEPTION 'DOSECLUB_RECONCILIATION_FINDING_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'DOSECLUB_RECONCILIATION_FINDING_VERSION_INVALID';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_doseclub_reconciliation_finding_transition() OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_doseclub_reconciliation_finding_transition() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER doseclub_reconciliation_findings_transition
  BEFORE UPDATE ON public.doseclub_reconciliation_findings
  FOR EACH ROW EXECUTE FUNCTION public.giromesa_doseclub_reconciliation_finding_transition();
