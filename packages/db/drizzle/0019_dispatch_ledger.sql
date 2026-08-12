DO $$ BEGIN CREATE TYPE public.production_dispatch_mode AS ENUM ('kds', 'print', 'both', 'kds_with_contingency_print', 'off');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE public.dispatch_destination AS ENUM ('kds', 'printer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE public.dispatch_effect_state AS ENUM ('pending', 'delivered', 'acked', 'canceled', 'dlq');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE public.dispatch_operation AS ENUM ('dispatch', 'reprint', 'cancel', 'contingency');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE TABLE public.production_station_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  station_id uuid NOT NULL, mode public.production_dispatch_mode NOT NULL DEFAULT 'kds',
  kds_target_ref varchar(160), printer_target_ref varchar(160), fallback_after_seconds integer NOT NULL DEFAULT 45,
  active boolean NOT NULL DEFAULT true, resource_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_station_routes_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT production_station_routes_station_scope_fk FOREIGN KEY (organization_id, unit_id, station_id)
    REFERENCES public.pos_production_stations(organization_id, unit_id, id) ON DELETE CASCADE,
  CONSTRAINT production_station_routes_fallback_check CHECK (fallback_after_seconds BETWEEN 5 AND 3600)
);--> statement-breakpoint
CREATE UNIQUE INDEX production_station_routes_station_unique
  ON public.production_station_routes(organization_id, unit_id, station_id);--> statement-breakpoint

CREATE TABLE public.dispatch_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  order_id uuid NOT NULL, station_id uuid NOT NULL, route_id uuid,
  destination public.dispatch_destination NOT NULL, target_ref varchar(160) NOT NULL,
  operation public.dispatch_operation NOT NULL DEFAULT 'dispatch', effect_key varchar(240) NOT NULL,
  state public.dispatch_effect_state NOT NULL DEFAULT 'pending', attempt_count integer NOT NULL DEFAULT 0,
  resource_version integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz, acknowledged_at timestamptz, canceled_at timestamptz, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_effects_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT dispatch_effects_order_scope_fk FOREIGN KEY (organization_id, unit_id, order_id)
    REFERENCES public.pos_orders(organization_id, unit_id, id) ON DELETE RESTRICT,
  CONSTRAINT dispatch_effects_station_scope_fk FOREIGN KEY (organization_id, unit_id, station_id)
    REFERENCES public.pos_production_stations(organization_id, unit_id, id) ON DELETE RESTRICT,
  CONSTRAINT dispatch_effects_route_scope_fk FOREIGN KEY (organization_id, unit_id, route_id)
    REFERENCES public.production_station_routes(organization_id, unit_id, id) ON DELETE RESTRICT,
  CONSTRAINT dispatch_effects_attempt_check CHECK (attempt_count >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX dispatch_effects_exactly_once_unique
  ON public.dispatch_effects(organization_id, unit_id, effect_key);--> statement-breakpoint
CREATE INDEX dispatch_effects_pending_idx
  ON public.dispatch_effects(organization_id, unit_id, state, next_attempt_at);--> statement-breakpoint

CREATE TABLE public.dispatch_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  effect_id uuid NOT NULL, attempt_number integer NOT NULL, delivery_key varchar(240) NOT NULL,
  state varchar(24) NOT NULL, error text, attempted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_attempts_effect_scope_fk FOREIGN KEY (organization_id, unit_id, effect_id)
    REFERENCES public.dispatch_effects(organization_id, unit_id, id) ON DELETE RESTRICT,
  CONSTRAINT dispatch_attempts_state_check CHECK (state IN ('scheduled', 'delivered', 'failed'))
);--> statement-breakpoint
CREATE UNIQUE INDEX dispatch_attempts_number_unique ON public.dispatch_attempts(effect_id, attempt_number);--> statement-breakpoint
CREATE UNIQUE INDEX dispatch_attempts_delivery_key_unique ON public.dispatch_attempts(delivery_key);--> statement-breakpoint

CREATE TABLE public.dispatch_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  effect_id uuid NOT NULL, acknowledgement_key varchar(160) NOT NULL,
  acknowledged_by_identity_id uuid REFERENCES public.identities(id), acknowledged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_acknowledgements_effect_scope_fk FOREIGN KEY (organization_id, unit_id, effect_id)
    REFERENCES public.dispatch_effects(organization_id, unit_id, id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX dispatch_acknowledgements_key_unique
  ON public.dispatch_acknowledgements(effect_id, acknowledgement_key);--> statement-breakpoint

CREATE TABLE public.dispatch_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  effect_id uuid NOT NULL, reason text NOT NULL, resolved_by_identity_id uuid REFERENCES public.identities(id),
  resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_dead_letters_effect_scope_fk FOREIGN KEY (organization_id, unit_id, effect_id)
    REFERENCES public.dispatch_effects(organization_id, unit_id, id) ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX dispatch_dead_letters_open_unique
  ON public.dispatch_dead_letters(effect_id) WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX dispatch_dead_letters_scope_created_idx
  ON public.dispatch_dead_letters(organization_id, unit_id, created_at DESC)
  WHERE resolved_at IS NULL;--> statement-breakpoint

CREATE TABLE public.dispatch_outcomes (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, unit_id uuid NOT NULL,
  effect_id uuid NOT NULL, delivery_key varchar(240) NOT NULL, state varchar(24) NOT NULL,
  error text, occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_outcomes_effect_scope_fk FOREIGN KEY (organization_id, unit_id, effect_id)
    REFERENCES public.dispatch_effects(organization_id, unit_id, id) ON DELETE RESTRICT,
  CONSTRAINT dispatch_outcomes_state_check CHECK (state IN ('delivered','acked','failed','canceled','dlq'))
);--> statement-breakpoint
CREATE UNIQUE INDEX dispatch_outcomes_effect_delivery_state_unique
  ON public.dispatch_outcomes(effect_id, delivery_key, state);--> statement-breakpoint
CREATE INDEX dispatch_outcomes_effect_idx
  ON public.dispatch_outcomes(organization_id, unit_id, effect_id);--> statement-breakpoint
CREATE INDEX dispatch_attempts_effect_state_idx
  ON public.dispatch_attempts(organization_id, unit_id, effect_id, state, attempted_at DESC);--> statement-breakpoint
CREATE INDEX dispatch_acknowledgements_effect_idx
  ON public.dispatch_acknowledgements(organization_id, unit_id, effect_id, acknowledged_at DESC);--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_append_only_dispatch_record()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'dispatch delivery records are append-only' USING ERRCODE = '55000';
END $$;--> statement-breakpoint
CREATE TRIGGER dispatch_attempts_append_only BEFORE UPDATE OR DELETE ON public.dispatch_attempts
  FOR EACH ROW EXECUTE FUNCTION public.giromesa_append_only_dispatch_record();--> statement-breakpoint
CREATE TRIGGER dispatch_acknowledgements_append_only BEFORE UPDATE OR DELETE ON public.dispatch_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.giromesa_append_only_dispatch_record();--> statement-breakpoint
CREATE TRIGGER dispatch_outcomes_append_only BEFORE UPDATE OR DELETE ON public.dispatch_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.giromesa_append_only_dispatch_record();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_guard_dispatch_effect_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['state','attempt_count','resource_version','next_attempt_at','delivered_at','acknowledged_at','canceled_at','last_error','updated_at'])
     <> (to_jsonb(OLD) - ARRAY['state','attempt_count','resource_version','next_attempt_at','delivered_at','acknowledged_at','canceled_at','last_error','updated_at']) THEN
    RAISE EXCEPTION 'dispatch effect immutable fields changed' USING ERRCODE = '55000';
  END IF;
  IF NEW.resource_version <> OLD.resource_version + 1 THEN
    RAISE EXCEPTION 'dispatch effect resource version must advance by one' USING ERRCODE = '40001';
  END IF;
  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'dispatch attempt count is monotonic' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.state = 'pending' AND NEW.state IN ('pending','delivered','acked','canceled','dlq')) OR
    (OLD.state = 'delivered' AND NEW.state IN ('pending','acked','canceled','dlq')) OR
    (OLD.state = 'dlq' AND NEW.state IN ('pending','canceled'))
  ) THEN
    RAISE EXCEPTION 'invalid dispatch effect transition' USING ERRCODE = '55000';
  END IF;
  IF NEW.state = 'delivered' AND NEW.delivered_at IS NULL THEN
    RAISE EXCEPTION 'delivered dispatch requires timestamp' USING ERRCODE = '55000';
  END IF;
  IF NEW.state = 'acked' AND NEW.acknowledged_at IS NULL THEN
    RAISE EXCEPTION 'acknowledged dispatch requires timestamp' USING ERRCODE = '55000';
  END IF;
  IF NEW.state = 'canceled' AND NEW.canceled_at IS NULL THEN
    RAISE EXCEPTION 'canceled dispatch requires timestamp' USING ERRCODE = '55000';
  END IF;
  IF NEW.state = 'dlq' AND NEW.last_error IS NULL THEN
    RAISE EXCEPTION 'dead-letter dispatch requires an error' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER dispatch_effects_state_machine
BEFORE UPDATE ON public.dispatch_effects FOR EACH ROW
EXECUTE FUNCTION public.giromesa_guard_dispatch_effect_update();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_guard_dispatch_dead_letter_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['resolved_by_identity_id','resolved_at'])
     <> (to_jsonb(OLD) - ARRAY['resolved_by_identity_id','resolved_at']) THEN
    RAISE EXCEPTION 'dispatch dead letter immutable fields changed' USING ERRCODE = '55000';
  END IF;
  IF OLD.resolved_at IS NOT NULL OR NEW.resolved_at IS NULL OR NEW.resolved_by_identity_id IS NULL THEN
    RAISE EXCEPTION 'dispatch dead letter resolution is terminal' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER dispatch_dead_letters_state_machine
BEFORE UPDATE ON public.dispatch_dead_letters FOR EACH ROW
EXECUTE FUNCTION public.giromesa_guard_dispatch_dead_letter_update();--> statement-breakpoint

DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'production_station_routes','dispatch_effects','dispatch_attempts','dispatch_acknowledgements','dispatch_dead_letters',
    'dispatch_outcomes'
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
GRANT INSERT, UPDATE ON public.production_station_routes TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT ON public.dispatch_effects TO giromesa_app, giromesa_legacy_transition;
GRANT UPDATE (state, attempt_count, resource_version, next_attempt_at, delivered_at, acknowledged_at, canceled_at, last_error, updated_at)
  ON public.dispatch_effects TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT ON public.dispatch_attempts, public.dispatch_acknowledgements, public.dispatch_outcomes
  TO giromesa_app, giromesa_legacy_transition;
GRANT INSERT ON public.dispatch_dead_letters TO giromesa_app, giromesa_legacy_transition;
GRANT UPDATE (resolved_by_identity_id, resolved_at)
  ON public.dispatch_dead_letters TO giromesa_app, giromesa_legacy_transition;
