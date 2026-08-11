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
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "management_returnable_serials_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "management_returnable_serials_number_unique" UNIQUE("organization_id", "unit_id", "asset_id", "serial_number"),
  CONSTRAINT "management_returnable_serials_state_check" CHECK ("state" IN ('available','in_custody','with_supplier','broken','lost'))
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
GRANT SELECT, INSERT, UPDATE ON "management_unit_conversions", "management_returnable_assets", "management_returnable_serials", "management_incidents" TO giromesa_app;
GRANT SELECT, INSERT ON "management_returnable_movements", "management_incident_events" TO giromesa_app;
--> statement-breakpoint
CREATE POLICY "giromesa_tenant_scope" ON "management_unit_conversions" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "management_returnable_assets" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "management_returnable_serials" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "management_returnable_movements" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "management_incidents" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "management_incident_events" FOR ALL TO giromesa_app USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
