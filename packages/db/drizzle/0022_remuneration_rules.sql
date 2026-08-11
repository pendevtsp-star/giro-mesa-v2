CREATE TABLE "remuneration_rule_sets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "kind" varchar(24) NOT NULL,
  "name" varchar(160) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "created_by_identity_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "remuneration_rule_sets_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "remuneration_rule_sets_name_unique" UNIQUE("organization_id", "unit_id", "kind", "name"),
  CONSTRAINT "remuneration_rule_sets_idempotency_unique" UNIQUE("organization_id", "unit_id", "idempotency_key"),
  CONSTRAINT "remuneration_rule_sets_kind_check" CHECK ("kind" IN ('service','commission','profit_sharing'))
);
CREATE TABLE "remuneration_rule_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "rule_set_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "expression" jsonb NOT NULL,
  "effective_from" timestamp with time zone NOT NULL,
  "effective_until" timestamp with time zone,
  "created_by_identity_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "remuneration_rule_versions_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "remuneration_rule_versions_number_unique" UNIQUE("rule_set_id", "version"),
  CONSTRAINT "remuneration_rule_versions_positive_check" CHECK ("version" > 0),
  CONSTRAINT "remuneration_rule_versions_window_check" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from")
);
CREATE UNIQUE INDEX "remuneration_rule_versions_active_unique" ON "remuneration_rule_versions" ("organization_id", "unit_id", "rule_set_id") WHERE "effective_until" IS NULL;
--> statement-breakpoint
CREATE TABLE "remuneration_calculation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "kind" varchar(24) NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "status" varchar(16) DEFAULT 'estimated' NOT NULL,
  "rule_version_id" uuid NOT NULL,
  "frozen_rule" jsonb NOT NULL,
  "frozen_metrics" jsonb NOT NULL,
  "source_references" jsonb NOT NULL,
  "evaluation_trace" jsonb NOT NULL,
  "output_cents" integer NOT NULL,
  "memory_hash" varchar(64) NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "adjustment_of" uuid,
  "created_by_identity_id" uuid NOT NULL,
  "approved_by_identity_id" uuid,
  "approved_at" timestamp with time zone,
  "closed_by_identity_id" uuid,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "remuneration_calculation_runs_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "remuneration_calculation_runs_idempotency_unique" UNIQUE("organization_id", "unit_id", "idempotency_key"),
  CONSTRAINT "remuneration_calculation_runs_kind_check" CHECK ("kind" IN ('service','commission','profit_sharing')),
  CONSTRAINT "remuneration_calculation_runs_status_check" CHECK ("status" IN ('estimated','approved','closed')),
  CONSTRAINT "remuneration_calculation_runs_output_check" CHECK ("output_cents" >= 0),
  CONSTRAINT "remuneration_calculation_runs_period_check" CHECK ("period_end" >= "period_start")
);
CREATE TABLE "remuneration_calculation_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "recipient_reference" varchar(160) NOT NULL,
  "recipient_label" varchar(160) NOT NULL,
  "amount_cents" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "remuneration_calculation_entries_recipient_unique" UNIQUE("run_id", "recipient_reference"),
  CONSTRAINT "remuneration_calculation_entries_amount_check" CHECK ("amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "remuneration_rule_sets" ADD CONSTRAINT "remuneration_rule_sets_unit_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "public"."units"("organization_id", "id") ON DELETE restrict;
ALTER TABLE "remuneration_rule_sets" ADD CONSTRAINT "remuneration_rule_sets_actor_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
ALTER TABLE "remuneration_rule_versions" ADD CONSTRAINT "remuneration_rule_versions_set_fk" FOREIGN KEY ("organization_id", "unit_id", "rule_set_id") REFERENCES "public"."remuneration_rule_sets"("organization_id", "unit_id", "id") ON DELETE restrict;
ALTER TABLE "remuneration_rule_versions" ADD CONSTRAINT "remuneration_rule_versions_actor_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
ALTER TABLE "remuneration_calculation_runs" ADD CONSTRAINT "remuneration_calculation_runs_rule_fk" FOREIGN KEY ("organization_id", "unit_id", "rule_version_id") REFERENCES "public"."remuneration_rule_versions"("organization_id", "unit_id", "id") ON DELETE restrict;
ALTER TABLE "remuneration_calculation_runs" ADD CONSTRAINT "remuneration_calculation_runs_adjustment_fk" FOREIGN KEY ("organization_id", "unit_id", "adjustment_of") REFERENCES "public"."remuneration_calculation_runs"("organization_id", "unit_id", "id") ON DELETE restrict;
ALTER TABLE "remuneration_calculation_runs" ADD CONSTRAINT "remuneration_calculation_runs_created_by_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
ALTER TABLE "remuneration_calculation_runs" ADD CONSTRAINT "remuneration_calculation_runs_approved_by_fk" FOREIGN KEY ("approved_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
ALTER TABLE "remuneration_calculation_runs" ADD CONSTRAINT "remuneration_calculation_runs_closed_by_fk" FOREIGN KEY ("closed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
ALTER TABLE "remuneration_calculation_entries" ADD CONSTRAINT "remuneration_calculation_entries_run_fk" FOREIGN KEY ("organization_id", "unit_id", "run_id") REFERENCES "public"."remuneration_calculation_runs"("organization_id", "unit_id", "id") ON DELETE restrict;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.giromesa_protect_remuneration_rule_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'remuneration rule versions are append-only' USING ERRCODE = '55000';
  END IF;
  IF OLD."effective_until" IS NULL AND NEW."effective_until" IS NOT NULL
     AND ROW(OLD."id", OLD."organization_id", OLD."unit_id", OLD."rule_set_id", OLD."version", OLD."expression", OLD."effective_from", OLD."created_by_identity_id", OLD."created_at")
         IS NOT DISTINCT FROM
         ROW(NEW."id", NEW."organization_id", NEW."unit_id", NEW."rule_set_id", NEW."version", NEW."expression", NEW."effective_from", NEW."created_by_identity_id", NEW."created_at") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'remuneration rule versions are immutable except for closing validity' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "remuneration_rule_versions_immutable" BEFORE UPDATE OR DELETE ON "remuneration_rule_versions" FOR EACH ROW EXECUTE FUNCTION public.giromesa_protect_remuneration_rule_version();
CREATE OR REPLACE FUNCTION public.giromesa_protect_remuneration_run()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'remuneration calculations cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF OLD."frozen_rule" IS DISTINCT FROM NEW."frozen_rule"
     OR OLD."frozen_metrics" IS DISTINCT FROM NEW."frozen_metrics"
     OR OLD."source_references" IS DISTINCT FROM NEW."source_references"
     OR OLD."evaluation_trace" IS DISTINCT FROM NEW."evaluation_trace"
     OR OLD."output_cents" IS DISTINCT FROM NEW."output_cents"
     OR OLD."memory_hash" IS DISTINCT FROM NEW."memory_hash"
     OR OLD."rule_version_id" IS DISTINCT FROM NEW."rule_version_id" THEN
    RAISE EXCEPTION 'frozen remuneration memory is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'closed' THEN
    RAISE EXCEPTION 'closed remuneration calculations are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "remuneration_calculation_runs_protected" BEFORE UPDATE OR DELETE ON "remuneration_calculation_runs" FOR EACH ROW EXECUTE FUNCTION public.giromesa_protect_remuneration_run();
CREATE TRIGGER "remuneration_calculation_entries_immutable" BEFORE UPDATE OR DELETE ON "remuneration_calculation_entries" FOR EACH ROW EXECUTE FUNCTION public.giromesa_reject_management_ledger_mutation();
--> statement-breakpoint
ALTER TABLE "remuneration_rule_sets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "remuneration_rule_sets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "remuneration_rule_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "remuneration_rule_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "remuneration_calculation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "remuneration_calculation_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "remuneration_calculation_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "remuneration_calculation_entries" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "remuneration_rule_sets", "remuneration_rule_versions", "remuneration_calculation_runs", "remuneration_calculation_entries" FROM PUBLIC, giromesa_app, giromesa_worker, giromesa_identity, giromesa_public, giromesa_internal, giromesa_legacy_transition;
GRANT SELECT, INSERT, UPDATE ON "remuneration_rule_sets", "remuneration_calculation_runs" TO giromesa_app;
GRANT SELECT, INSERT, UPDATE ON "remuneration_rule_versions" TO giromesa_app;
GRANT SELECT, INSERT ON "remuneration_calculation_entries" TO giromesa_app;
--> statement-breakpoint
CREATE POLICY "giromesa_tenant_scope" ON "remuneration_rule_sets" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "remuneration_rule_versions" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "remuneration_calculation_runs" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "remuneration_calculation_entries" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
