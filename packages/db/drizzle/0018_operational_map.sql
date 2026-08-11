DO $$ BEGIN CREATE TYPE public.layout_version_state AS ENUM ('draft', 'published');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE public.service_shift_state AS ENUM ('scheduled', 'open', 'handoff', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE public.table_occupancy_state AS ENUM ('reserved', 'open', 'paying', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE public.salon_exception_state AS ENUM ('open', 'acknowledged', 'resolved');
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

DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'service_areas','table_layout_versions','table_layout_nodes','service_shifts','area_assignments',
    'table_groups','table_occupancies','table_group_members','table_occupancy_events','service_incidents',
    'staff_presence_leases','salon_exceptions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO giromesa_app', tenant_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO giromesa_legacy_transition', tenant_table);
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
