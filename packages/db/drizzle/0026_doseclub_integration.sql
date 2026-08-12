CREATE TABLE "doseclub_product_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "external_product_id" varchar(180) NOT NULL,
  "product_id" uuid NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "stock_location_id" uuid NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "doseclub_product_mappings_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
  CONSTRAINT "doseclub_product_mappings_version_check" CHECK ("version" > 0)
);--> statement-breakpoint
CREATE TABLE "doseclub_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "external_club_id" varchar(180) NOT NULL,
  "external_offer_id" varchar(180),
  "external_customer_id" varchar(180),
  "sale_type" varchar(24) NOT NULL,
  "eligible_product_ids" jsonb NOT NULL,
  "purchase_snapshot" jsonb NOT NULL,
  "contract_version" varchar(8) NOT NULL,
  "version" integer NOT NULL,
  "remaining_doses" integer NOT NULL,
  "reserved_doses" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "doseclub_states_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
  CONSTRAINT "doseclub_states_external_scope_unique" UNIQUE("organization_id","unit_id","external_club_id"),
  CONSTRAINT "doseclub_states_sale_type_check" CHECK ("sale_type" in ('individual','combo_pool')),
  CONSTRAINT "doseclub_states_contract_check" CHECK ("contract_version" in ('v1','v2')),
  CONSTRAINT "doseclub_states_version_check" CHECK ("version" >= 0),
  CONSTRAINT "doseclub_states_doses_check" CHECK ("remaining_doses" >= 0 and "reserved_doses" >= 0 and "reserved_doses" <= "remaining_doses")
);--> statement-breakpoint
CREATE TABLE "doseclub_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "state_id" uuid,
  "external_club_id" varchar(180) NOT NULL,
  "operation_id" varchar(180) NOT NULL,
  "original_operation_id" varchar(180),
  "idempotency_key" varchar(180) NOT NULL,
  "request_fingerprint" varchar(64) NOT NULL,
  "contract_version" varchar(8) NOT NULL,
  "operation" varchar(24) NOT NULL,
  "version" integer NOT NULL,
  "outcome" varchar(24) NOT NULL,
  "payload" jsonb NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "doseclub_operations_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
  CONSTRAINT "doseclub_operations_contract_check" CHECK ("contract_version" in ('v1','v2')),
  CONSTRAINT "doseclub_operations_operation_check" CHECK ("operation" in ('sale','reservation','consumption','reversal','reconcile')),
  CONSTRAINT "doseclub_operations_version_check" CHECK ("version" >= 0),
  CONSTRAINT "doseclub_operations_outcome_check" CHECK ("outcome" in ('accepted','duplicate','reconciled'))
);--> statement-breakpoint

ALTER TABLE "doseclub_product_mappings" ADD CONSTRAINT "doseclub_product_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "doseclub_product_mappings" ADD CONSTRAINT "doseclub_product_mappings_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "doseclub_product_mappings" ADD CONSTRAINT "doseclub_product_mappings_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "doseclub_product_mappings" ADD CONSTRAINT "doseclub_product_mappings_inventory_item_fk" FOREIGN KEY ("organization_id","unit_id","inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "doseclub_product_mappings" ADD CONSTRAINT "doseclub_product_mappings_stock_location_fk" FOREIGN KEY ("organization_id","unit_id","stock_location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "doseclub_states" ADD CONSTRAINT "doseclub_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "doseclub_states" ADD CONSTRAINT "doseclub_states_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "doseclub_operations" ADD CONSTRAINT "doseclub_operations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "doseclub_operations" ADD CONSTRAINT "doseclub_operations_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "doseclub_operations" ADD CONSTRAINT "doseclub_operations_state_fk" FOREIGN KEY ("organization_id","unit_id","state_id") REFERENCES "public"."doseclub_states"("organization_id","unit_id","id") ON DELETE restrict;--> statement-breakpoint

CREATE UNIQUE INDEX "doseclub_product_mappings_external_unique" ON "doseclub_product_mappings" ("organization_id","unit_id","external_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doseclub_operations_idempotency_unique" ON "doseclub_operations" ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "doseclub_operations_operation_unique" ON "doseclub_operations" ("organization_id","unit_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doseclub_operations_v2_sequence_unique" ON "doseclub_operations" ("organization_id","unit_id","external_club_id","version") WHERE "contract_version" = 'v2';--> statement-breakpoint
CREATE UNIQUE INDEX "doseclub_operations_reversal_unique" ON "doseclub_operations" ("organization_id","unit_id","original_operation_id") WHERE "operation" = 'reversal' and "original_operation_id" is not null;--> statement-breakpoint
CREATE INDEX "doseclub_operations_reconcile_idx" ON "doseclub_operations" ("organization_id","unit_id","external_club_id","created_at");--> statement-breakpoint
CREATE INDEX "doseclub_states_updated_idx" ON "doseclub_states" ("organization_id","unit_id","updated_at");--> statement-breakpoint

ALTER TABLE "doseclub_product_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doseclub_product_mappings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doseclub_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doseclub_states" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doseclub_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "doseclub_operations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

GRANT SELECT (id, organization_id, key_hash, scopes, expires_at, revoked_at)
  ON "growth_public_api_keys" TO giromesa_migrator;--> statement-breakpoint
GRANT UPDATE (last_used_at) ON "growth_public_api_keys" TO giromesa_migrator;--> statement-breakpoint
GRANT SELECT (organization_id, unit_id, provider, status, config)
  ON "growth_integrations" TO giromesa_migrator;--> statement-breakpoint
GRANT SELECT (id, organization_id, name, active) ON "units" TO giromesa_migrator;--> statement-breakpoint

REVOKE ALL ON "doseclub_product_mappings", "doseclub_states", "doseclub_operations"
  FROM PUBLIC, giromesa_app, giromesa_worker, giromesa_identity, giromesa_public, giromesa_internal, giromesa_legacy_transition;--> statement-breakpoint
GRANT SELECT, INSERT ON "doseclub_product_mappings" TO giromesa_app;--> statement-breakpoint
GRANT UPDATE (product_id, inventory_item_id, stock_location_id, active, version, updated_at) ON "doseclub_product_mappings" TO giromesa_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "doseclub_states" TO giromesa_app;--> statement-breakpoint
GRANT UPDATE (version, remaining_doses, reserved_doses, updated_at) ON "doseclub_states" TO giromesa_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "doseclub_operations" TO giromesa_app;--> statement-breakpoint

CREATE POLICY giromesa_tenant_scope ON "doseclub_product_mappings" FOR ALL TO giromesa_app
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
CREATE POLICY giromesa_tenant_scope ON "doseclub_states" FOR ALL TO giromesa_app
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
CREATE POLICY giromesa_tenant_scope ON "doseclub_operations" FOR ALL TO giromesa_app
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

CREATE OR REPLACE FUNCTION public.giromesa_doseclub_scope(
  requested_key_hash text,
  requested_scope text,
  requested_branch_id text
)
RETURNS TABLE (organization_id uuid, unit_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  matched_key_id uuid;
  matched_organization_id uuid;
  matched_unit_id uuid;
BEGIN
  IF requested_key_hash !~ '^[0-9a-f]{64}$'
    OR requested_scope NOT IN ('doseclub:read', 'doseclub:write')
    OR requested_branch_id IS NOT NULL AND (length(requested_branch_id) < 1 OR length(requested_branch_id) > 180)
  THEN
    RETURN;
  END IF;

  SELECT key.id, key.organization_id
  INTO matched_key_id, matched_organization_id
  FROM public.growth_public_api_keys AS key
  WHERE key.key_hash = requested_key_hash
    AND key.revoked_at IS NULL
    AND (key.expires_at IS NULL OR key.expires_at > clock_timestamp())
    AND key.scopes @> jsonb_build_array(requested_scope)
  LIMIT 1;

  IF matched_key_id IS NULL THEN
    RETURN;
  END IF;

  IF requested_branch_id IS NOT NULL THEN
    SELECT integration.unit_id
    INTO matched_unit_id
    FROM public.growth_integrations AS integration
    WHERE integration.organization_id = matched_organization_id
      AND integration.provider = 'doseclub'
      AND integration.status = 'active'
      AND integration.unit_id IS NOT NULL
      AND integration.config ->> 'branchId' = requested_branch_id
    LIMIT 1;
    IF matched_unit_id IS NULL THEN
      RETURN;
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.growth_integrations AS integration
    WHERE integration.organization_id = matched_organization_id
      AND integration.provider = 'doseclub'
      AND integration.status = 'active'
      AND integration.unit_id IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  UPDATE public.growth_public_api_keys
  SET last_used_at = clock_timestamp()
  WHERE id = matched_key_id;

  organization_id := matched_organization_id;
  unit_id := matched_unit_id;
  RETURN NEXT;
END
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_doseclub_scope(text, text, text) OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_doseclub_scope(text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giromesa_doseclub_scope(text, text, text) TO giromesa_internal;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_doseclub_visible_branches()
RETURNS TABLE (branch_id text, unit_id uuid, branch_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    integration.config ->> 'branchId' AS branch_id,
    unit.id AS unit_id,
    unit.name AS branch_name
  FROM public.growth_integrations AS integration
  INNER JOIN public.units AS unit
    ON unit.organization_id = integration.organization_id
   AND unit.id = integration.unit_id
  WHERE integration.organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND current_setting('app.current_context_source', true) = 'internal'
    AND integration.provider = 'doseclub'
    AND integration.status = 'active'
    AND integration.unit_id IS NOT NULL
    AND jsonb_typeof(integration.config -> 'branchId') = 'string'
    AND length(integration.config ->> 'branchId') BETWEEN 1 AND 180
    AND unit.active = true
  ORDER BY unit.name, unit.id
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_doseclub_visible_branches() OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_doseclub_visible_branches() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giromesa_doseclub_visible_branches() TO giromesa_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_doseclub_immutable_operation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'DOSECLUB_OPERATION_IMMUTABLE';
END
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_doseclub_immutable_operation() OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_doseclub_immutable_operation() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER doseclub_operations_immutable
  BEFORE UPDATE OR DELETE ON public.doseclub_operations
  FOR EACH ROW EXECUTE FUNCTION public.giromesa_doseclub_immutable_operation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_doseclub_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id
    OR NEW.unit_id <> OLD.unit_id
    OR NEW.external_club_id <> OLD.external_club_id
    OR NEW.external_offer_id IS DISTINCT FROM OLD.external_offer_id
    OR NEW.external_customer_id IS DISTINCT FROM OLD.external_customer_id
    OR NEW.sale_type <> OLD.sale_type
    OR NEW.eligible_product_ids <> OLD.eligible_product_ids
    OR NEW.purchase_snapshot <> OLD.purchase_snapshot
    OR NEW.contract_version <> OLD.contract_version
  THEN
    RAISE EXCEPTION 'DOSECLUB_STATE_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'DOSECLUB_STATE_VERSION_INVALID';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_doseclub_state_transition() OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_doseclub_state_transition() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER doseclub_states_transition
  BEFORE UPDATE ON public.doseclub_states
  FOR EACH ROW EXECUTE FUNCTION public.giromesa_doseclub_state_transition();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_doseclub_mapping_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id
    OR NEW.unit_id <> OLD.unit_id
    OR NEW.external_product_id <> OLD.external_product_id
  THEN
    RAISE EXCEPTION 'DOSECLUB_MAPPING_SCOPE_IMMUTABLE';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'DOSECLUB_MAPPING_VERSION_INVALID';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_doseclub_mapping_transition() OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_doseclub_mapping_transition() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER doseclub_product_mappings_transition
  BEFORE UPDATE ON public.doseclub_product_mappings
  FOR EACH ROW EXECUTE FUNCTION public.giromesa_doseclub_mapping_transition();
