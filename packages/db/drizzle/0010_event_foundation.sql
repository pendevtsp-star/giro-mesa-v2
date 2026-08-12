CREATE TYPE "public"."command_inbox_status" AS ENUM('applied', 'quarantined', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."command_quarantine_status" AS ENUM('pending', 'recovered');--> statement-breakpoint
CREATE TABLE "aggregate_sequence_states" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"occupancy_epoch" uuid NOT NULL,
	"last_sequence" integer NOT NULL,
	"resource_version" integer NOT NULL,
	"last_command_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aggregate_sequence_states_organization_id_unit_id_aggregate_type_aggregate_id_occupancy_epoch_pk" PRIMARY KEY("organization_id","unit_id","aggregate_type","aggregate_id","occupancy_epoch"),
	CONSTRAINT "aggregate_sequence_states_last_sequence_check" CHECK ("aggregate_sequence_states"."last_sequence" > 0),
	CONSTRAINT "aggregate_sequence_states_resource_version_check" CHECK ("aggregate_sequence_states"."resource_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "aggregate_sequence_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "command_inbox" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"fingerprint_key_version" varchar(32) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"command_type" varchar(100) NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"occupancy_epoch" uuid NOT NULL,
	"resource_version" integer NOT NULL,
	"aggregate_sequence" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "command_inbox_status" NOT NULL,
	"precondition_code" varchar(100),
	"result" jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "command_inbox_organization_id_unit_id_command_id_pk" PRIMARY KEY("organization_id","unit_id","command_id"),
	CONSTRAINT "command_inbox_resource_version_check" CHECK ("command_inbox"."resource_version" >= 0),
	CONSTRAINT "command_inbox_aggregate_sequence_check" CHECK ("command_inbox"."aggregate_sequence" > 0),
	CONSTRAINT "command_inbox_fingerprint_check" CHECK ("command_inbox"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "command_inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "command_quarantine" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"reason" varchar(100) NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" "command_quarantine_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recovered_at" timestamp with time zone,
	CONSTRAINT "command_quarantine_organization_id_unit_id_command_id_pk" PRIMARY KEY("organization_id","unit_id","command_id")
);
--> statement-breakpoint
ALTER TABLE "command_quarantine" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "operational_command_idempotency_unique";--> statement-breakpoint
ALTER TABLE "operational_commands" DROP CONSTRAINT "operational_commands_pkey";--> statement-breakpoint
ALTER TABLE "operational_commands" ADD CONSTRAINT "operational_commands_organization_id_unit_id_id_pk" PRIMARY KEY("organization_id","unit_id","id");--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "occupancy_epoch" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "resource_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "source_command_id" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "aggregate_sequence" integer;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "occupancy_epoch" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "resource_version" integer;--> statement-breakpoint
ALTER TABLE "aggregate_sequence_states" ADD CONSTRAINT "aggregate_sequence_states_organization_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_inbox" ADD CONSTRAINT "command_inbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_inbox" ADD CONSTRAINT "command_inbox_organization_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_quarantine" ADD CONSTRAINT "command_quarantine_inbox_fk" FOREIGN KEY ("organization_id","unit_id","command_id") REFERENCES "public"."command_inbox"("organization_id","unit_id","command_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "command_inbox_scope_idempotency_unique" ON "command_inbox" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "command_inbox_aggregate_sequence_idx" ON "command_inbox" USING btree ("organization_id","unit_id","aggregate_type","aggregate_id","occupancy_epoch","aggregate_sequence");--> statement-breakpoint
CREATE INDEX "command_inbox_received_idx" ON "command_inbox" USING btree ("organization_id","unit_id","received_at");--> statement-breakpoint
CREATE INDEX "command_quarantine_pending_idx" ON "command_quarantine" USING btree ("organization_id","unit_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_command_effect_unique" ON "outbox_events" USING btree ("organization_id","unit_id","topic","source_command_id") WHERE "outbox_events"."source_command_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "operational_command_idempotency_unique" ON "operational_commands" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_resource_version_check" CHECK ("pos_tabs"."resource_version" >= 0);--> statement-breakpoint

GRANT SELECT (id, organization_id, unit_id, sync_key_hash, revoked_at), UPDATE (revoked_at)
  ON public.device_enrollments TO giromesa_migrator;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.giromesa_resolve_sync_hub(requested_sync_key_hash text)
RETURNS TABLE (hub_id uuid, organization_id uuid, unit_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT device.id, device.organization_id, device.unit_id
  FROM public.device_enrollments AS device
  WHERE device.sync_key_hash = requested_sync_key_hash
    AND device.revoked_at IS NULL
  LIMIT 1
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_resolve_sync_hub(text) OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_resolve_sync_hub(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giromesa_resolve_sync_hub(text) TO giromesa_internal;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.giromesa_lock_command_device(requested_device_id uuid)
RETURNS TABLE (device_id uuid, organization_id uuid, unit_id uuid, revoked_at timestamptz)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT device.id, device.organization_id, device.unit_id, device.revoked_at
  FROM public.device_enrollments AS device
  WHERE device.id = requested_device_id
  FOR UPDATE
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_lock_command_device(uuid) OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_lock_command_device(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giromesa_lock_command_device(uuid) TO giromesa_internal;--> statement-breakpoint
GRANT UPDATE (status) ON public.memberships TO giromesa_migrator;--> statement-breakpoint
GRANT UPDATE (role) ON public.role_bindings TO giromesa_migrator;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.giromesa_lock_command_actor(
  expected_organization_id uuid,
  expected_unit_id uuid,
  expected_actor_identity_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  locked_membership_id uuid;
  locked_binding_id uuid;
BEGIN
  SELECT membership.id INTO locked_membership_id
  FROM public.memberships AS membership
  WHERE membership.organization_id = expected_organization_id
    AND membership.identity_id = expected_actor_identity_id
    AND membership.status = 'active'
  FOR UPDATE;

  IF locked_membership_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT binding.id INTO locked_binding_id
  FROM public.role_bindings AS binding
  WHERE binding.membership_id = locked_membership_id
    AND (binding.unit_id IS NULL OR binding.unit_id = expected_unit_id)
  LIMIT 1
  FOR UPDATE;

  RETURN locked_binding_id IS NOT NULL;
END
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_lock_command_actor(uuid, uuid, uuid) OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_lock_command_actor(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giromesa_lock_command_actor(uuid, uuid, uuid) TO giromesa_internal;--> statement-breakpoint

ALTER TABLE public.aggregate_sequence_states FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.command_inbox FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.command_quarantine FORCE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON public.aggregate_sequence_states, public.command_inbox, public.command_quarantine
  FROM PUBLIC, giromesa_worker, giromesa_identity, giromesa_public, giromesa_internal;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  public.aggregate_sequence_states, public.command_inbox, public.command_quarantine
  TO giromesa_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.aggregate_sequence_states, public.command_inbox, public.command_quarantine
  TO giromesa_legacy_transition;--> statement-breakpoint

CREATE POLICY giromesa_tenant_scope ON public.aggregate_sequence_states
  AS PERMISSIVE FOR ALL TO giromesa_app
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
CREATE POLICY giromesa_tenant_scope ON public.command_inbox
  AS PERMISSIVE FOR ALL TO giromesa_app
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
CREATE POLICY giromesa_tenant_scope ON public.command_quarantine
  AS PERMISSIVE FOR ALL TO giromesa_app
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

CREATE POLICY giromesa_legacy_transition ON public.aggregate_sequence_states
  AS PERMISSIVE FOR ALL TO giromesa_legacy_transition USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY giromesa_legacy_transition ON public.command_inbox
  AS PERMISSIVE FOR ALL TO giromesa_legacy_transition USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY giromesa_legacy_transition ON public.command_quarantine
  AS PERMISSIVE FOR ALL TO giromesa_legacy_transition USING (true) WITH CHECK (true);
