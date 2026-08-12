DO $$ BEGIN CREATE TYPE public.layout_version_state AS ENUM ('draft', 'published');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE public.service_shift_state AS ENUM ('scheduled', 'open', 'handoff', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE public.table_occupancy_state AS ENUM ('reserved', 'open', 'paying', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE public.salon_exception_state AS ENUM ('open', 'acknowledged', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE public.table_service_call_kind AS ENUM ('waiter', 'bill');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE public.table_service_call_state AS ENUM ('received', 'routed', 'attended', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE TABLE public.service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  room_id uuid NOT NULL, name varchar(120) NOT NULL, code varchar(60) NOT NULL,
  resource_version integer NOT NULL DEFAULT 0 CHECK (resource_version >= 0), active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_areas_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT service_areas_room_code_unique UNIQUE (room_id, code),
  CONSTRAINT service_areas_room_scope_fk FOREIGN KEY (organization_id, unit_id, room_id)
    REFERENCES public.pos_dining_rooms(organization_id, unit_id, id) ON DELETE CASCADE
);--> statement-breakpoint

CREATE TABLE public.table_layout_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  room_id uuid NOT NULL, version integer NOT NULL CHECK (version > 0),
  state public.layout_version_state NOT NULL DEFAULT 'draft',
  resource_version integer NOT NULL DEFAULT 0 CHECK (resource_version >= 0),
  created_by_identity_id uuid NOT NULL REFERENCES public.identities(id), published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_layout_versions_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT table_layout_versions_room_version_unique UNIQUE (room_id, version),
  CONSTRAINT table_layout_versions_room_scope_fk FOREIGN KEY (organization_id, unit_id, room_id)
    REFERENCES public.pos_dining_rooms(organization_id, unit_id, id) ON DELETE RESTRICT
);--> statement-breakpoint

CREATE TABLE public.table_layout_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  layout_version_id uuid NOT NULL, table_id uuid NOT NULL, area_id uuid,
  x integer NOT NULL, y integer NOT NULL, width integer NOT NULL, height integer NOT NULL,
  rotation integer NOT NULL DEFAULT 0 CHECK (rotation BETWEEN -180 AND 180), z_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_layout_nodes_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT table_layout_nodes_layout_table_unique UNIQUE (layout_version_id, table_id),
  CONSTRAINT table_layout_nodes_geometry_check CHECK (
    x >= 0 AND y >= 0 AND width BETWEEN 1 AND 10000 AND height BETWEEN 1 AND 10000
    AND x + width <= 10000 AND y + height <= 10000
  ),
  CONSTRAINT table_layout_nodes_version_scope_fk FOREIGN KEY (organization_id, unit_id, layout_version_id)
    REFERENCES public.table_layout_versions(organization_id, unit_id, id) ON DELETE CASCADE,
  CONSTRAINT table_layout_nodes_table_scope_fk FOREIGN KEY (organization_id, unit_id, table_id)
    REFERENCES public.pos_dining_tables(organization_id, unit_id, id) ON DELETE RESTRICT,
  CONSTRAINT table_layout_nodes_area_scope_fk FOREIGN KEY (organization_id, unit_id, area_id)
    REFERENCES public.service_areas(organization_id, unit_id, id) ON DELETE RESTRICT
);--> statement-breakpoint

CREATE TABLE public.service_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  state public.service_shift_state NOT NULL DEFAULT 'scheduled',
  resource_version integer NOT NULL DEFAULT 0 CHECK (resource_version >= 0),
  starts_at timestamptz NOT NULL, ends_at timestamptz,
  opened_by_identity_id uuid REFERENCES public.identities(id), closed_by_identity_id uuid REFERENCES public.identities(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_shifts_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT service_shifts_time_check CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT service_shifts_unit_scope_fk FOREIGN KEY (organization_id, unit_id)
    REFERENCES public.units(organization_id, id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX service_shifts_one_live_unit_unique ON public.service_shifts(unit_id)
  WHERE state IN ('open', 'handoff');--> statement-breakpoint

CREATE TABLE public.area_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  shift_id uuid NOT NULL, area_id uuid NOT NULL,
  primary_identity_id uuid NOT NULL REFERENCES public.identities(id), support_identity_id uuid REFERENCES public.identities(id),
  fallback_role varchar(30) NOT NULL DEFAULT 'manager', resource_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT area_assignments_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT area_assignments_shift_area_unique UNIQUE (shift_id, area_id),
  CONSTRAINT area_assignments_shift_scope_fk FOREIGN KEY (organization_id, unit_id, shift_id)
    REFERENCES public.service_shifts(organization_id, unit_id, id) ON DELETE CASCADE,
  CONSTRAINT area_assignments_area_scope_fk FOREIGN KEY (organization_id, unit_id, area_id)
    REFERENCES public.service_areas(organization_id, unit_id, id) ON DELETE RESTRICT
);--> statement-breakpoint

CREATE TABLE public.table_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  occupancy_epoch uuid NOT NULL DEFAULT gen_random_uuid(), resource_version integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true, created_by_identity_id uuid NOT NULL REFERENCES public.identities(id),
  closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_groups_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT table_groups_epoch_unique UNIQUE (occupancy_epoch),
  CONSTRAINT table_groups_unit_scope_fk FOREIGN KEY (organization_id, unit_id)
    REFERENCES public.units(organization_id, id) ON DELETE RESTRICT
);--> statement-breakpoint

CREATE TABLE public.table_occupancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  table_id uuid NOT NULL, group_id uuid, tab_id uuid, reservation_id uuid,
  assigned_identity_id uuid REFERENCES public.identities(id), state public.table_occupancy_state NOT NULL,
  occupancy_epoch uuid NOT NULL DEFAULT gen_random_uuid(), resource_version integer NOT NULL DEFAULT 0 CHECK (resource_version >= 0),
  guest_count integer NOT NULL DEFAULT 1 CHECK (guest_count > 0), opened_at timestamptz, closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_occupancies_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT table_occupancies_scope_epoch_unique UNIQUE (organization_id, unit_id, occupancy_epoch),
  CONSTRAINT table_occupancies_closed_at_check CHECK ((state = 'closed') = (closed_at IS NOT NULL)),
  CONSTRAINT table_occupancies_table_scope_fk FOREIGN KEY (organization_id, unit_id, table_id)
    REFERENCES public.pos_dining_tables(organization_id, unit_id, id) ON DELETE RESTRICT,
  CONSTRAINT table_occupancies_group_scope_fk FOREIGN KEY (organization_id, unit_id, group_id)
    REFERENCES public.table_groups(organization_id, unit_id, id) ON DELETE RESTRICT,
  CONSTRAINT table_occupancies_tab_scope_fk FOREIGN KEY (organization_id, unit_id, tab_id)
    REFERENCES public.pos_tabs(organization_id, unit_id, id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX table_occupancies_one_live_table_unique
  ON public.table_occupancies(organization_id, unit_id, table_id)
  WHERE state IN ('reserved', 'open', 'paying');--> statement-breakpoint

CREATE TABLE public.table_group_members (
  organization_id uuid NOT NULL, unit_id uuid NOT NULL, group_id uuid NOT NULL, occupancy_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz,
  PRIMARY KEY (organization_id, unit_id, group_id, occupancy_id),
  CONSTRAINT table_group_members_group_scope_fk FOREIGN KEY (organization_id, unit_id, group_id)
    REFERENCES public.table_groups(organization_id, unit_id, id) ON DELETE CASCADE,
  CONSTRAINT table_group_members_occupancy_scope_fk FOREIGN KEY (organization_id, unit_id, occupancy_id)
    REFERENCES public.table_occupancies(organization_id, unit_id, id) ON DELETE RESTRICT
);--> statement-breakpoint

CREATE TABLE public.table_occupancy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  occupancy_id uuid NOT NULL, occupancy_epoch uuid NOT NULL, sequence integer NOT NULL CHECK (sequence > 0),
  type varchar(60) NOT NULL, actor_identity_id uuid NOT NULL REFERENCES public.identities(id),
  idempotency_key varchar(160) NOT NULL, request_hash varchar(64) NOT NULL, before jsonb NOT NULL, after jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_occupancy_events_sequence_unique UNIQUE (occupancy_id, sequence),
  CONSTRAINT table_occupancy_events_idempotency_unique UNIQUE (organization_id, unit_id, idempotency_key),
  CONSTRAINT table_occupancy_events_occupancy_scope_fk FOREIGN KEY (organization_id, unit_id, occupancy_id)
    REFERENCES public.table_occupancies(organization_id, unit_id, id) ON DELETE RESTRICT
);--> statement-breakpoint

CREATE TABLE public.service_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  occupancy_id uuid, table_id uuid, type varchar(60) NOT NULL, summary varchar(300) NOT NULL,
  state varchar(20) NOT NULL DEFAULT 'open', reported_by_identity_id uuid NOT NULL REFERENCES public.identities(id),
  resolved_by_identity_id uuid REFERENCES public.identities(id), resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_incidents_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT service_incidents_unit_scope_fk FOREIGN KEY (organization_id, unit_id)
    REFERENCES public.units(organization_id, id) ON DELETE RESTRICT
);--> statement-breakpoint

CREATE TABLE public.staff_presence_leases (
  organization_id uuid NOT NULL, unit_id uuid NOT NULL, identity_id uuid NOT NULL REFERENCES public.identities(id),
  device_id uuid NOT NULL, lease_epoch uuid NOT NULL DEFAULT gen_random_uuid(), acknowledged_at timestamptz,
  expires_at timestamptz NOT NULL, resource_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, unit_id, identity_id, device_id),
  CONSTRAINT staff_presence_device_scope_fk FOREIGN KEY (organization_id, unit_id, device_id)
    REFERENCES public.device_enrollments(organization_id, unit_id, id) ON DELETE CASCADE
);--> statement-breakpoint

CREATE TABLE public.salon_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  occupancy_id uuid, table_id uuid, code varchar(80) NOT NULL, severity varchar(20) NOT NULL,
  state public.salon_exception_state NOT NULL DEFAULT 'open', details jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by_identity_id uuid REFERENCES public.identities(id), acknowledged_at timestamptz, resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salon_exceptions_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT salon_exceptions_unit_scope_fk FOREIGN KEY (organization_id, unit_id)
    REFERENCES public.units(organization_id, id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX salon_exceptions_open_idx ON public.salon_exceptions(organization_id, unit_id, state);--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_guard_published_layout()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.table_layout_versions AS v WHERE v.id = COALESCE(OLD.layout_version_id, NEW.layout_version_id) AND v.state = 'published') THEN
    RAISE EXCEPTION 'published layouts are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;--> statement-breakpoint
CREATE TRIGGER table_layout_nodes_published_immutable
BEFORE UPDATE OR DELETE ON public.table_layout_nodes FOR EACH ROW
EXECUTE FUNCTION public.giromesa_guard_published_layout();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_guard_layout_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.state = 'published' THEN
    RAISE EXCEPTION 'published layouts are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = 'published' THEN
    RAISE EXCEPTION 'published layouts are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.state = 'published'
     AND (to_jsonb(NEW) - ARRAY['state','resource_version','published_at','updated_at'])
       <> (to_jsonb(OLD) - ARRAY['state','resource_version','published_at','updated_at']) THEN
    RAISE EXCEPTION 'layout publication may only freeze the draft' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;--> statement-breakpoint
CREATE TRIGGER table_layout_versions_immutable
BEFORE UPDATE OR DELETE ON public.table_layout_versions FOR EACH ROW
EXECUTE FUNCTION public.giromesa_guard_layout_version();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_append_only_occupancy_event()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'occupancy events are append-only' USING ERRCODE = '55000';
END $$;--> statement-breakpoint
CREATE TRIGGER table_occupancy_events_append_only
BEFORE UPDATE OR DELETE ON public.table_occupancy_events FOR EACH ROW
EXECUTE FUNCTION public.giromesa_append_only_occupancy_event();--> statement-breakpoint

CREATE TABLE public.public_table_service_settings (
  organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  call_waiter_enabled boolean NOT NULL DEFAULT false,
  request_bill_enabled boolean NOT NULL DEFAULT false,
  view_partial_enabled boolean NOT NULL DEFAULT false,
  resource_version integer NOT NULL DEFAULT 0 CHECK (resource_version >= 0),
  updated_by_identity_id uuid NOT NULL REFERENCES public.identities(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, unit_id),
  CONSTRAINT public_table_service_settings_unit_scope_fk FOREIGN KEY (organization_id, unit_id)
    REFERENCES public.units(organization_id, id) ON DELETE CASCADE
);--> statement-breakpoint

CREATE TABLE public.public_table_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  menu_id uuid NOT NULL, table_id uuid NOT NULL, occupancy_id uuid NOT NULL, occupancy_epoch uuid NOT NULL,
  nonce_hash varchar(64) NOT NULL, capabilities jsonb NOT NULL DEFAULT '["call_waiter","request_bill","view_partial"]'::jsonb,
  expires_at timestamptz NOT NULL, revoked_at timestamptz, revoke_reason varchar(80),
  resource_version integer NOT NULL DEFAULT 0 CHECK (resource_version >= 0), created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_table_sessions_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT public_table_sessions_nonce_unique UNIQUE (nonce_hash),
  CONSTRAINT public_table_sessions_menu_scope_fk FOREIGN KEY (organization_id, unit_id, menu_id)
    REFERENCES public.public_menus(organization_id, unit_id, id) ON DELETE CASCADE,
  CONSTRAINT public_table_sessions_table_scope_fk FOREIGN KEY (organization_id, unit_id, table_id)
    REFERENCES public.pos_dining_tables(organization_id, unit_id, id) ON DELETE RESTRICT,
  CONSTRAINT public_table_sessions_occupancy_scope_fk FOREIGN KEY (organization_id, unit_id, occupancy_id)
    REFERENCES public.table_occupancies(organization_id, unit_id, id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX public_table_sessions_occupancy_idx
  ON public.public_table_sessions(organization_id, unit_id, occupancy_id, expires_at);--> statement-breakpoint

CREATE TABLE public.public_table_session_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  session_id uuid NOT NULL, nonce_hash varchar(64) NOT NULL, purpose varchar(60) NOT NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_table_session_nonces_unique UNIQUE (session_id, nonce_hash),
  CONSTRAINT public_table_session_nonces_session_scope_fk FOREIGN KEY (organization_id, unit_id, session_id)
    REFERENCES public.public_table_sessions(organization_id, unit_id, id) ON DELETE CASCADE
);--> statement-breakpoint

CREATE TABLE public.public_table_session_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  menu_id uuid NOT NULL, bucket_hash varchar(64) NOT NULL, window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0), expires_at timestamptz NOT NULL,
  CONSTRAINT public_table_session_rate_bucket_unique UNIQUE (menu_id, bucket_hash, window_started_at),
  CONSTRAINT public_table_session_rate_menu_scope_fk FOREIGN KEY (organization_id, unit_id, menu_id)
    REFERENCES public.public_menus(organization_id, unit_id, id) ON DELETE CASCADE
);--> statement-breakpoint

CREATE TABLE public.table_service_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  session_id uuid NOT NULL, occupancy_id uuid NOT NULL, occupancy_epoch uuid NOT NULL, table_id uuid NOT NULL,
  kind public.table_service_call_kind NOT NULL, state public.table_service_call_state NOT NULL DEFAULT 'received',
  routed_identity_id uuid REFERENCES public.identities(id), route_source varchar(20) NOT NULL,
  attended_by_identity_id uuid REFERENCES public.identities(id), idempotency_key varchar(160) NOT NULL,
  request_hash varchar(64) NOT NULL, resource_version integer NOT NULL DEFAULT 0 CHECK (resource_version >= 0),
  routed_at timestamptz, attended_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_service_calls_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT table_service_calls_idempotency_unique UNIQUE (session_id, idempotency_key),
  CONSTRAINT table_service_calls_session_scope_fk FOREIGN KEY (organization_id, unit_id, session_id)
    REFERENCES public.public_table_sessions(organization_id, unit_id, id) ON DELETE RESTRICT,
  CONSTRAINT table_service_calls_occupancy_scope_fk FOREIGN KEY (organization_id, unit_id, occupancy_id)
    REFERENCES public.table_occupancies(organization_id, unit_id, id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX table_service_calls_open_idx ON public.table_service_calls(organization_id, unit_id, state, created_at);--> statement-breakpoint

CREATE TABLE public.table_service_call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  call_id uuid NOT NULL, sequence integer NOT NULL, state public.table_service_call_state NOT NULL,
  actor_identity_id uuid REFERENCES public.identities(id), metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_service_call_events_sequence_unique UNIQUE (call_id, sequence),
  CONSTRAINT table_service_call_events_call_scope_fk FOREIGN KEY (organization_id, unit_id, call_id)
    REFERENCES public.table_service_calls(organization_id, unit_id, id) ON DELETE RESTRICT
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_append_only_service_call_event()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'table service call events are append-only' USING ERRCODE = '55000';
END $$;--> statement-breakpoint
CREATE TRIGGER table_service_call_events_append_only
BEFORE UPDATE OR DELETE ON public.table_service_call_events FOR EACH ROW
EXECUTE FUNCTION public.giromesa_append_only_service_call_event();--> statement-breakpoint

CREATE TABLE public.table_service_call_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  session_id uuid NOT NULL, call_id uuid NOT NULL, idempotency_key varchar(160) NOT NULL,
  request_hash varchar(64) NOT NULL, cooldown_deduplicated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_service_call_receipts_idempotency_unique UNIQUE (session_id, idempotency_key),
  CONSTRAINT table_service_call_receipts_session_scope_fk FOREIGN KEY (organization_id, unit_id, session_id)
    REFERENCES public.public_table_sessions(organization_id, unit_id, id) ON DELETE RESTRICT,
  CONSTRAINT table_service_call_receipts_call_scope_fk FOREIGN KEY (organization_id, unit_id, call_id)
    REFERENCES public.table_service_calls(organization_id, unit_id, id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX table_service_call_receipts_call_idx
  ON public.table_service_call_receipts(organization_id, unit_id, call_id);--> statement-breakpoint
CREATE INDEX table_service_calls_cooldown_idx
  ON public.table_service_calls(organization_id, unit_id, occupancy_id, occupancy_epoch, kind, created_at DESC)
  WHERE state IN ('received','routed');--> statement-breakpoint
CREATE INDEX table_layout_versions_published_idx
  ON public.table_layout_versions(organization_id, unit_id, room_id, state, version DESC);--> statement-breakpoint
CREATE INDEX area_assignments_routing_idx
  ON public.area_assignments(organization_id, unit_id, shift_id, area_id);--> statement-breakpoint
CREATE INDEX staff_presence_leases_routing_idx
  ON public.staff_presence_leases(organization_id, unit_id, identity_id, expires_at DESC);--> statement-breakpoint
CREATE TRIGGER table_service_call_receipts_append_only
BEFORE UPDATE OR DELETE ON public.table_service_call_receipts FOR EACH ROW
EXECUTE FUNCTION public.giromesa_append_only_service_call_event();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_guard_table_occupancy_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['state','occupancy_epoch','resource_version','table_id','group_id','opened_at','closed_at','updated_at'])
     <> (to_jsonb(OLD) - ARRAY['state','occupancy_epoch','resource_version','table_id','group_id','opened_at','closed_at','updated_at']) THEN
    RAISE EXCEPTION 'table occupancy immutable fields changed' USING ERRCODE = '55000';
  END IF;
  IF NEW.resource_version <> OLD.resource_version + 1 THEN
    RAISE EXCEPTION 'table occupancy resource version must advance by one' USING ERRCODE = '40001';
  END IF;
  IF NOT (
    (OLD.state = 'reserved' AND NEW.state IN ('open','closed')) OR
    (OLD.state = 'open' AND NEW.state IN ('open','paying','closed')) OR
    (OLD.state = 'paying' AND NEW.state IN ('open','closed')) OR
    (OLD.state = 'closed' AND NEW.state = 'open')
  ) THEN
    RAISE EXCEPTION 'invalid table occupancy transition' USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'closed' AND NEW.state = 'open' THEN
    IF NEW.occupancy_epoch = OLD.occupancy_epoch THEN
      RAISE EXCEPTION 'reopened occupancy requires a new epoch' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.occupancy_epoch <> OLD.occupancy_epoch THEN
    RAISE EXCEPTION 'occupancy epoch may only change on reopen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER table_occupancies_state_machine
BEFORE UPDATE ON public.table_occupancies FOR EACH ROW
EXECUTE FUNCTION public.giromesa_guard_table_occupancy_update();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_guard_public_table_session_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['revoked_at','revoke_reason','resource_version'])
     <> (to_jsonb(OLD) - ARRAY['revoked_at','revoke_reason','resource_version']) THEN
    RAISE EXCEPTION 'public table session immutable fields changed' USING ERRCODE = '55000';
  END IF;
  IF NEW.resource_version <> OLD.resource_version + 1 THEN
    RAISE EXCEPTION 'public table session resource version must advance by one' USING ERRCODE = '40001';
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoke_reason IS NULL THEN
    RAISE EXCEPTION 'public table session revocation is terminal' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER public_table_sessions_state_machine
BEFORE UPDATE ON public.public_table_sessions FOR EACH ROW
EXECUTE FUNCTION public.giromesa_guard_public_table_session_update();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_guard_table_service_call_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['state','attended_by_identity_id','attended_at','resource_version','updated_at'])
     <> (to_jsonb(OLD) - ARRAY['state','attended_by_identity_id','attended_at','resource_version','updated_at']) THEN
    RAISE EXCEPTION 'table service call immutable fields changed' USING ERRCODE = '55000';
  END IF;
  IF NEW.resource_version <> OLD.resource_version + 1 THEN
    RAISE EXCEPTION 'table service call resource version must advance by one' USING ERRCODE = '40001';
  END IF;
  IF OLD.state NOT IN ('received','routed') OR NEW.state <> 'attended'
     OR NEW.attended_by_identity_id IS NULL OR NEW.attended_at IS NULL THEN
    RAISE EXCEPTION 'invalid table service call transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER table_service_calls_state_machine
BEFORE UPDATE ON public.table_service_calls FOR EACH ROW
EXECUTE FUNCTION public.giromesa_guard_table_service_call_update();--> statement-breakpoint

DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'service_areas','table_layout_versions','table_layout_nodes','service_shifts','area_assignments',
    'table_groups','table_occupancies','table_group_members','table_occupancy_events','service_incidents',
    'staff_presence_leases','salon_exceptions','public_table_service_settings','public_table_sessions',
    'public_table_session_nonces','public_table_session_rate_limits','table_service_calls',
    'table_service_call_events','table_service_call_receipts'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON public.%I FROM giromesa_app', tenant_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON public.%I FROM giromesa_legacy_transition', tenant_table);
    EXECUTE format('GRANT SELECT ON public.%I TO giromesa_app, giromesa_legacy_transition', tenant_table);
    EXECUTE format(
      'CREATE POLICY giromesa_tenant_scope ON public.%I FOR ALL TO giromesa_app '
      || 'USING (organization_id = nullif(current_setting(''app.current_organization_id'', true), '''')::uuid '
      || 'AND unit_id = nullif(current_setting(''app.current_unit_id'', true), '''')::uuid '
      || 'AND public.giromesa_tenant_context_authorized(organization_id, unit_id)) '
      || 'WITH CHECK (organization_id = nullif(current_setting(''app.current_organization_id'', true), '''')::uuid '
      || 'AND unit_id = nullif(current_setting(''app.current_unit_id'', true), '''')::uuid '
      || 'AND public.giromesa_tenant_context_authorized(organization_id, unit_id))', tenant_table
    );
    EXECUTE format(
      'CREATE POLICY giromesa_legacy_transition ON public.%I FOR ALL TO giromesa_legacy_transition USING (true) WITH CHECK (true)',
      tenant_table
    );
  END LOOP;
END $$;
--> statement-breakpoint
GRANT INSERT, UPDATE ON public.service_areas TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT, UPDATE ON public.table_layout_versions TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT, DELETE ON public.table_layout_nodes TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT ON public.service_shifts, public.area_assignments TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT ON public.table_occupancies TO giromesa_app, giromesa_legacy_transition;
GRANT UPDATE (state, occupancy_epoch, resource_version, table_id, group_id, opened_at, closed_at, updated_at)
  ON public.table_occupancies TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT ON public.table_occupancy_events TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT, UPDATE ON public.staff_presence_leases, public.salon_exceptions TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT, UPDATE ON public.public_table_service_settings TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT ON public.public_table_sessions TO giromesa_app, giromesa_legacy_transition;
GRANT UPDATE (revoked_at, revoke_reason, resource_version)
  ON public.public_table_sessions TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT ON public.public_table_session_nonces TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT, UPDATE ON public.public_table_session_rate_limits TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT ON public.table_service_calls TO giromesa_app, giromesa_legacy_transition;
GRANT UPDATE (state, attended_by_identity_id, attended_at, resource_version, updated_at)
  ON public.table_service_calls TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT ON public.table_service_call_events, public.table_service_call_receipts TO giromesa_app, giromesa_legacy_transition;
