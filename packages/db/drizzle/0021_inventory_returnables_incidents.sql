ALTER TABLE "management_inventory_items" ADD COLUMN "dimension" varchar(16) DEFAULT 'count' NOT NULL;
ALTER TABLE "management_inventory_items" ADD COLUMN "quantity_scale" smallint DEFAULT 6 NOT NULL;
UPDATE "management_inventory_items"
SET "dimension" = CASE
  WHEN lower("unit") IN ('mg', 'g', 'kg') THEN 'mass'
  WHEN lower("unit") IN ('ml', 'l') THEN 'volume'
  ELSE 'count'
END;
ALTER TABLE "management_inventory_items" ADD CONSTRAINT "management_inventory_items_dimension_check" CHECK ("dimension" IN ('mass','volume','count'));
ALTER TABLE "management_inventory_items" ADD CONSTRAINT "management_inventory_items_scale_check" CHECK ("quantity_scale" = 6);
ALTER TABLE "management_inventory_items" ALTER COLUMN "minimum_quantity" TYPE numeric(20,6) USING "minimum_quantity"::numeric(20,6);
ALTER TABLE "management_stock_balances" ALTER COLUMN "quantity" TYPE numeric(20,6) USING "quantity"::numeric(20,6);
ALTER TABLE "management_inventory_event_lines" ALTER COLUMN "previous_quantity" TYPE numeric(20,6) USING "previous_quantity"::numeric(20,6);
ALTER TABLE "management_inventory_event_lines" ALTER COLUMN "quantity_delta" TYPE numeric(20,6) USING "quantity_delta"::numeric(20,6);
ALTER TABLE "management_inventory_event_lines" ALTER COLUMN "resulting_quantity" TYPE numeric(20,6) USING "resulting_quantity"::numeric(20,6);
ALTER TABLE "management_inventory_movements" ALTER COLUMN "quantity_delta" TYPE numeric(20,6) USING "quantity_delta"::numeric(20,6);
ALTER TABLE "management_purchase_order_items" ALTER COLUMN "quantity" TYPE numeric(20,6) USING "quantity"::numeric(20,6);
ALTER TABLE "management_purchase_order_items" ALTER COLUMN "received_quantity" TYPE numeric(20,6) USING "received_quantity"::numeric(20,6);
ALTER TABLE "management_purchase_receipt_lines" ALTER COLUMN "quantity" TYPE numeric(20,6) USING "quantity"::numeric(20,6);
--> statement-breakpoint
ALTER TABLE "management_recipe_versions" ADD COLUMN "yield_quantity" numeric(20,6) DEFAULT '1' NOT NULL;
ALTER TABLE "management_recipe_versions" ADD COLUMN "yield_unit" varchar(20) DEFAULT 'unit' NOT NULL;
ALTER TABLE "management_recipe_versions" ADD CONSTRAINT "management_recipe_version_yield_check" CHECK ("yield_quantity" > 0);
ALTER TABLE "management_recipe_versions" ADD CONSTRAINT "management_recipe_version_yield_unit_check" CHECK ("yield_unit" IN ('unit','dozen'));
ALTER TABLE "management_recipe_components" ADD COLUMN "quantity_micros" bigint;
ALTER TABLE "management_recipe_components" ADD COLUMN "unit" varchar(20);
UPDATE "management_recipe_components" AS component
SET "quantity_micros" = component."quantity_milli"::bigint * 1000,
    "unit" = item."unit"
FROM "management_inventory_items" AS item
WHERE item."organization_id" = component."organization_id"
  AND item."unit_id" = component."unit_id"
  AND item."id" = component."inventory_item_id";
ALTER TABLE "management_recipe_components" ALTER COLUMN "quantity_micros" SET NOT NULL;
ALTER TABLE "management_recipe_components" ALTER COLUMN "unit" SET NOT NULL;
ALTER TABLE "management_recipe_components" ADD CONSTRAINT "management_recipe_component_micros_check" CHECK ("quantity_micros" > 0);
--> statement-breakpoint
CREATE TABLE "management_unit_conversions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "from_unit" varchar(20) NOT NULL,
  "to_unit" varchar(20) NOT NULL,
  "dimension" varchar(16) NOT NULL,
  "numerator" bigint NOT NULL,
  "denominator" bigint NOT NULL,
  "rounding" varchar(16) DEFAULT 'exact' NOT NULL,
  "valid_from" timestamp with time zone NOT NULL,
  "valid_until" timestamp with time zone,
  "created_by_identity_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "management_unit_conversions_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "management_unit_conversions_dimension_check" CHECK ("dimension" IN ('mass','volume','count')),
  CONSTRAINT "management_unit_conversions_rounding_check" CHECK ("rounding" IN ('exact','up','down','half_up')),
  CONSTRAINT "management_unit_conversions_ratio_check" CHECK ("numerator" > 0 AND "denominator" > 0),
  CONSTRAINT "management_unit_conversions_window_check" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from")
);
ALTER TABLE "management_unit_conversions" ADD CONSTRAINT "management_unit_conversions_unit_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "public"."units"("organization_id", "id") ON DELETE cascade;
ALTER TABLE "management_unit_conversions" ADD CONSTRAINT "management_unit_conversions_actor_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
CREATE UNIQUE INDEX "management_unit_conversions_active_unique" ON "management_unit_conversions" ("organization_id", "unit_id", "from_unit", "to_unit") WHERE "valid_until" IS NULL;
--> statement-breakpoint
CREATE TABLE "management_returnable_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "sku" varchar(80) NOT NULL,
  "name" varchar(160) NOT NULL,
  "tracking_mode" varchar(16) NOT NULL,
  "deposit_cents" integer,
  "idempotency_key" varchar(160) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "management_returnable_assets_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "management_returnable_assets_sku_unique" UNIQUE("organization_id", "unit_id", "sku"),
  CONSTRAINT "management_returnable_assets_idempotency_unique" UNIQUE("organization_id", "unit_id", "idempotency_key"),
  CONSTRAINT "management_returnable_assets_mode_check" CHECK ("tracking_mode" IN ('aggregate','serialized')),
  CONSTRAINT "management_returnable_assets_deposit_check" CHECK ("deposit_cents" IS NULL OR "deposit_cents" >= 0)
);
CREATE TABLE "management_returnable_serials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "serial_number" varchar(120) NOT NULL,
  "state" varchar(24) DEFAULT 'available' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "management_returnable_serials_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "management_returnable_serials_number_unique" UNIQUE("organization_id", "unit_id", "asset_id", "serial_number"),
  CONSTRAINT "management_returnable_serials_state_check" CHECK ("state" IN ('available','in_custody','with_supplier','broken','lost'))
  ,CONSTRAINT "management_returnable_serials_version_check" CHECK ("version" > 0)
);
CREATE TABLE "management_returnable_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "serial_id" uuid,
  "movement_type" varchar(32) NOT NULL,
  "quantity" integer NOT NULL,
  "from_custody_type" varchar(24),
  "from_custody_id" varchar(160),
  "to_custody_type" varchar(24),
  "to_custody_id" varchar(160),
  "supplier_reference" varchar(160),
  "lot_reference" varchar(160),
  "reason" varchar(240),
  "idempotency_key" varchar(160) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "actor_identity_id" uuid NOT NULL,
  "approver_identity_id" uuid,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "management_returnable_movements_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "management_returnable_movements_idempotency_unique" UNIQUE("organization_id", "unit_id", "idempotency_key"),
  CONSTRAINT "management_returnable_movements_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "management_returnable_movements_type_check" CHECK ("movement_type" IN ('receive','circulate','return_empty','send_supplier','receive_supplier','broken','lost','reconcile_adjustment')),
  CONSTRAINT "management_returnable_movements_custody_check" CHECK (("from_custody_type" IS NOT NULL AND "from_custody_id" IS NOT NULL) OR ("to_custody_type" IS NOT NULL AND "to_custody_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "management_incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "incident_type" varchar(48) NOT NULL,
  "status" varchar(24) DEFAULT 'reported' NOT NULL,
  "neutral_summary" text NOT NULL,
  "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "amount_cents" integer,
  "payroll_action" boolean DEFAULT false NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "reporter_identity_id" uuid NOT NULL,
  "approver_identity_id" uuid,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "management_incidents_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "management_incidents_idempotency_unique" UNIQUE("organization_id", "unit_id", "idempotency_key"),
  CONSTRAINT "management_incidents_status_check" CHECK ("status" IN ('reported','under_review','approved','rejected','closed')),
  CONSTRAINT "management_incidents_amount_check" CHECK ("amount_cents" IS NULL OR "amount_cents" >= 0),
  CONSTRAINT "management_incidents_no_payroll_check" CHECK ("payroll_action" = false)
);
CREATE TABLE "management_incident_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "incident_id" uuid NOT NULL,
  "event" varchar(32) NOT NULL,
  "from_status" varchar(24),
  "to_status" varchar(24) NOT NULL,
  "neutral_note" text,
  "idempotency_key" varchar(160) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "actor_identity_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
  ,CONSTRAINT "management_incident_events_idempotency_unique" UNIQUE("organization_id", "unit_id", "idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "management_returnable_assets" ADD CONSTRAINT "management_returnable_assets_unit_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "public"."units"("organization_id", "id") ON DELETE restrict;
ALTER TABLE "management_returnable_serials" ADD CONSTRAINT "management_returnable_serials_asset_fk" FOREIGN KEY ("organization_id", "unit_id", "asset_id") REFERENCES "public"."management_returnable_assets"("organization_id", "unit_id", "id") ON DELETE restrict;
ALTER TABLE "management_returnable_movements" ADD CONSTRAINT "management_returnable_movements_asset_fk" FOREIGN KEY ("organization_id", "unit_id", "asset_id") REFERENCES "public"."management_returnable_assets"("organization_id", "unit_id", "id") ON DELETE restrict;
ALTER TABLE "management_returnable_movements" ADD CONSTRAINT "management_returnable_movements_serial_fk" FOREIGN KEY ("organization_id", "unit_id", "serial_id") REFERENCES "public"."management_returnable_serials"("organization_id", "unit_id", "id") ON DELETE restrict;
ALTER TABLE "management_returnable_movements" ADD CONSTRAINT "management_returnable_movements_actor_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
ALTER TABLE "management_returnable_movements" ADD CONSTRAINT "management_returnable_movements_approver_fk" FOREIGN KEY ("approver_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
ALTER TABLE "management_incidents" ADD CONSTRAINT "management_incidents_unit_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "public"."units"("organization_id", "id") ON DELETE restrict;
ALTER TABLE "management_incidents" ADD CONSTRAINT "management_incidents_reporter_fk" FOREIGN KEY ("reporter_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
ALTER TABLE "management_incidents" ADD CONSTRAINT "management_incidents_approver_fk" FOREIGN KEY ("approver_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
ALTER TABLE "management_incident_events" ADD CONSTRAINT "management_incident_events_incident_fk" FOREIGN KEY ("organization_id", "unit_id", "incident_id") REFERENCES "public"."management_incidents"("organization_id", "unit_id", "id") ON DELETE restrict;
ALTER TABLE "management_incident_events" ADD CONSTRAINT "management_incident_events_actor_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.giromesa_reject_management_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'management ledger rows are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "management_returnable_movements_immutable" BEFORE UPDATE OR DELETE ON "management_returnable_movements" FOR EACH ROW EXECUTE FUNCTION public.giromesa_reject_management_ledger_mutation();
CREATE TRIGGER "management_incident_events_immutable" BEFORE UPDATE OR DELETE ON "management_incident_events" FOR EACH ROW EXECUTE FUNCTION public.giromesa_reject_management_ledger_mutation();
CREATE OR REPLACE FUNCTION public.giromesa_guard_incident_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  transition_event public.management_incident_events%ROWTYPE;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
    OR NEW.incident_type IS DISTINCT FROM OLD.incident_type
    OR NEW.neutral_summary IS DISTINCT FROM OLD.neutral_summary
    OR NEW.evidence IS DISTINCT FROM OLD.evidence
    OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
    OR NEW.payroll_action IS DISTINCT FROM OLD.payroll_action
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.reporter_identity_id IS DISTINCT FROM OLD.reporter_identity_id
    OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'incident evidence and report facts are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.approver_identity_id IS DISTINCT FROM OLD.approver_identity_id THEN
    SELECT event.* INTO transition_event
      FROM public.management_incident_events AS event
      WHERE event.organization_id = OLD.organization_id
        AND event.unit_id = OLD.unit_id
        AND event.incident_id = OLD.id
        AND event.from_status = OLD.status
        AND event.to_status = NEW.status
      AND event.created_at >= transaction_timestamp()
      ORDER BY event.created_at DESC
      LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'incident transition requires an audit event in the same transaction' USING ERRCODE = '55000';
    END IF;
    IF NOT (
      (OLD.status = 'reported' AND NEW.status = 'under_review')
      OR (OLD.status = 'under_review' AND NEW.status IN ('approved', 'rejected'))
      OR (OLD.status IN ('approved', 'rejected') AND NEW.status = 'closed')
    ) THEN
      RAISE EXCEPTION 'incident transition is outside the allowed graph' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IN ('approved', 'rejected') THEN
      IF transition_event.actor_identity_id = OLD.reporter_identity_id
        OR NEW.approver_identity_id IS DISTINCT FROM transition_event.actor_identity_id
      THEN
        RAISE EXCEPTION 'incident decision requires an independent actor' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.approver_identity_id IS DISTINCT FROM OLD.approver_identity_id THEN
      RAISE EXCEPTION 'incident approver can only be set by an independent decision' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "management_incidents_guard_update" BEFORE UPDATE ON "management_incidents" FOR EACH ROW EXECUTE FUNCTION public.giromesa_guard_incident_update();
CREATE OR REPLACE FUNCTION public.giromesa_guard_incident_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  incident public.management_incidents%ROWTYPE;
BEGIN
  SELECT * INTO incident
  FROM public.management_incidents
  WHERE organization_id = NEW.organization_id
    AND unit_id = NEW.unit_id
    AND id = NEW.incident_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident event requires an incident in the same tenant' USING ERRCODE = '23503';
  END IF;
  IF NEW.event IS DISTINCT FROM NEW.to_status THEN
    RAISE EXCEPTION 'incident event must match its target status' USING ERRCODE = '23514';
  END IF;
  IF NEW.to_status = 'reported' THEN
    IF NEW.from_status IS NOT NULL
      OR incident.status <> 'reported'
      OR NEW.actor_identity_id <> incident.reporter_identity_id
      OR EXISTS (
        SELECT 1 FROM public.management_incident_events existing
        WHERE existing.organization_id = NEW.organization_id
          AND existing.unit_id = NEW.unit_id
          AND existing.incident_id = NEW.incident_id
      )
    THEN
      RAISE EXCEPTION 'reported event must be the first event from the reporter' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.from_status IS DISTINCT FROM incident.status
    OR NOT (
      (incident.status = 'reported' AND NEW.to_status = 'under_review')
      OR (incident.status = 'under_review' AND NEW.to_status IN ('approved', 'rejected'))
      OR (incident.status IN ('approved', 'rejected') AND NEW.to_status = 'closed')
    )
  THEN
    RAISE EXCEPTION 'incident event is outside the allowed graph' USING ERRCODE = '23514';
  END IF;
  IF NEW.to_status IN ('approved', 'rejected')
    AND NEW.actor_identity_id = incident.reporter_identity_id
  THEN
    RAISE EXCEPTION 'incident decision requires an independent actor' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "management_incident_events_guard_insert" BEFORE INSERT ON "management_incident_events" FOR EACH ROW EXECUTE FUNCTION public.giromesa_guard_incident_event_insert();
CREATE OR REPLACE FUNCTION public.giromesa_report_incident(
  p_organization_id uuid,
  p_unit_id uuid,
  p_incident_type varchar,
  p_neutral_summary text,
  p_evidence jsonb,
  p_amount_cents integer,
  p_idempotency_key varchar,
  p_request_hash varchar,
  p_reporter_identity_id uuid,
  p_occurred_at timestamptz
)
RETURNS SETOF public.management_incidents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing public.management_incidents%ROWTYPE;
  created public.management_incidents%ROWTYPE;
BEGIN
  IF current_setting('app.current_organization_id', true) IS DISTINCT FROM p_organization_id::text
    OR current_setting('app.current_unit_id', true) IS DISTINCT FROM p_unit_id::text
    OR current_setting('app.current_actor_identity_id', true) IS DISTINCT FROM p_reporter_identity_id::text
    OR current_setting('app.current_context_source', true) <> 'http'
    OR NOT public.giromesa_tenant_context_authorized(p_organization_id, p_unit_id)
  THEN
    RAISE EXCEPTION 'incident report context is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('incident-report:' || p_organization_id::text || ':' || p_unit_id::text || ':' || p_idempotency_key));
  SELECT * INTO existing
  FROM public.management_incidents
  WHERE organization_id = p_organization_id
    AND unit_id = p_unit_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'incident idempotency payload mismatch' USING ERRCODE = '23505';
    END IF;
    RETURN NEXT existing;
    RETURN;
  END IF;
  INSERT INTO public.management_incidents (
    organization_id, unit_id, incident_type, neutral_summary, evidence, amount_cents,
    payroll_action, idempotency_key, request_hash, reporter_identity_id, occurred_at
  ) VALUES (
    p_organization_id, p_unit_id, p_incident_type, p_neutral_summary, p_evidence, p_amount_cents,
    false, p_idempotency_key, p_request_hash, p_reporter_identity_id, p_occurred_at
  ) RETURNING * INTO created;
  INSERT INTO public.management_incident_events (
    organization_id, unit_id, incident_id, event, from_status, to_status, neutral_note,
    idempotency_key, request_hash, actor_identity_id
  ) VALUES (
    p_organization_id, p_unit_id, created.id, 'reported', NULL, 'reported', p_neutral_summary,
    p_idempotency_key, p_request_hash, p_reporter_identity_id
  );
  RETURN NEXT created;
END;
$$;
CREATE OR REPLACE FUNCTION public.giromesa_transition_incident(
  p_organization_id uuid,
  p_unit_id uuid,
  p_incident_id uuid,
  p_target varchar,
  p_neutral_note text,
  p_idempotency_key varchar,
  p_request_hash varchar,
  p_actor_identity_id uuid
)
RETURNS SETOF public.management_incidents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  incident public.management_incidents%ROWTYPE;
  existing_event public.management_incident_events%ROWTYPE;
BEGIN
  IF current_setting('app.current_organization_id', true) IS DISTINCT FROM p_organization_id::text
    OR current_setting('app.current_unit_id', true) IS DISTINCT FROM p_unit_id::text
    OR current_setting('app.current_actor_identity_id', true) IS DISTINCT FROM p_actor_identity_id::text
    OR current_setting('app.current_context_source', true) <> 'http'
    OR NOT public.giromesa_tenant_context_authorized(p_organization_id, p_unit_id)
  THEN
    RAISE EXCEPTION 'incident transition context is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('incident:' || p_incident_id::text));
  SELECT * INTO existing_event
  FROM public.management_incident_events
  WHERE organization_id = p_organization_id
    AND unit_id = p_unit_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF existing_event.incident_id IS DISTINCT FROM p_incident_id
      OR existing_event.to_status IS DISTINCT FROM p_target
      OR existing_event.request_hash IS DISTINCT FROM p_request_hash
    THEN
      RAISE EXCEPTION 'incident transition idempotency payload mismatch' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT * FROM public.management_incidents WHERE id = p_incident_id;
    RETURN;
  END IF;
  SELECT * INTO incident
  FROM public.management_incidents
  WHERE organization_id = p_organization_id
    AND unit_id = p_unit_id
    AND id = p_incident_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (
    (incident.status = 'reported' AND p_target = 'under_review')
    OR (incident.status = 'under_review' AND p_target IN ('approved', 'rejected'))
    OR (incident.status IN ('approved', 'rejected') AND p_target = 'closed')
  ) THEN
    RAISE EXCEPTION 'incident transition is outside the allowed graph' USING ERRCODE = '23514';
  END IF;
  IF p_target IN ('approved', 'rejected') AND p_actor_identity_id = incident.reporter_identity_id THEN
    RAISE EXCEPTION 'incident decision requires an independent actor' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.management_incident_events (
    organization_id, unit_id, incident_id, event, from_status, to_status, neutral_note,
    idempotency_key, request_hash, actor_identity_id
  ) VALUES (
    p_organization_id, p_unit_id, p_incident_id, p_target, incident.status, p_target,
    p_neutral_note, p_idempotency_key, p_request_hash, p_actor_identity_id
  );
  UPDATE public.management_incidents
  SET status = p_target,
      approver_identity_id = CASE
        WHEN p_target IN ('approved', 'rejected') THEN p_actor_identity_id
        ELSE approver_identity_id
      END,
      updated_at = now()
  WHERE id = incident.id
  RETURNING * INTO incident;
  RETURN NEXT incident;
END;
$$;
--> statement-breakpoint
ALTER TABLE "management_unit_conversions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "management_unit_conversions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "management_returnable_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "management_returnable_assets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "management_returnable_serials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "management_returnable_serials" FORCE ROW LEVEL SECURITY;
ALTER TABLE "management_returnable_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "management_returnable_movements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "management_incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "management_incidents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "management_incident_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "management_incident_events" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "management_unit_conversions", "management_returnable_assets", "management_returnable_serials", "management_returnable_movements", "management_incidents", "management_incident_events" FROM PUBLIC, giromesa_app, giromesa_worker, giromesa_identity, giromesa_public, giromesa_internal, giromesa_legacy_transition;
GRANT SELECT, INSERT, UPDATE ON "management_unit_conversions", "management_returnable_assets", "management_returnable_serials" TO giromesa_app;
GRANT SELECT ON "management_incidents", "management_incident_events" TO giromesa_app;
GRANT SELECT, INSERT ON "management_returnable_movements" TO giromesa_app;
REVOKE ALL ON FUNCTION public.giromesa_report_incident(uuid, uuid, varchar, text, jsonb, integer, varchar, varchar, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.giromesa_transition_incident(uuid, uuid, uuid, varchar, text, varchar, varchar, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.giromesa_report_incident(uuid, uuid, varchar, text, jsonb, integer, varchar, varchar, uuid, timestamptz) TO giromesa_app;
GRANT EXECUTE ON FUNCTION public.giromesa_transition_incident(uuid, uuid, uuid, varchar, text, varchar, varchar, uuid) TO giromesa_app;
--> statement-breakpoint
CREATE POLICY "giromesa_tenant_scope" ON "management_unit_conversions" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "management_returnable_assets" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "management_returnable_serials" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "management_returnable_movements" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "management_incidents" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "management_incident_events" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
