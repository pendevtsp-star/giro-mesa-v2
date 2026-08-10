DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'giromesa_app') THEN
    CREATE ROLE giromesa_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'giromesa_migrator') THEN
    CREATE ROLE giromesa_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint

ALTER ROLE giromesa_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;--> statement-breakpoint
ALTER ROLE giromesa_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO giromesa_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO giromesa_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO giromesa_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO giromesa_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO giromesa_app;--> statement-breakpoint
GRANT SELECT ON public.memberships, public.role_bindings TO giromesa_migrator;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_tenant_context_authorized(
  expected_organization_id uuid,
  expected_unit_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    expected_organization_id IS NOT NULL
    AND nullif(current_setting('app.current_organization_id', true), '')::uuid = expected_organization_id
    AND nullif(current_setting('app.current_actor_identity_id', true), '')::uuid IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.memberships AS membership
      JOIN public.role_bindings AS binding ON binding.membership_id = membership.id
      WHERE membership.organization_id = expected_organization_id
        AND membership.identity_id = nullif(
          current_setting('app.current_actor_identity_id', true),
          ''
        )::uuid
        AND membership.status = 'active'
        AND (
          expected_unit_id IS NULL
          OR binding.unit_id IS NULL
          OR binding.unit_id = expected_unit_id
        )
    )
$$;--> statement-breakpoint

ALTER FUNCTION public.giromesa_tenant_context_authorized(uuid, uuid) OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_tenant_context_authorized(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giromesa_tenant_context_authorized(uuid, uuid) TO giromesa_app;--> statement-breakpoint

DO $$
DECLARE
  tenant_table record;
  row_scope text;
  tenant_scope text;
BEGIN
  FOR tenant_table IN
    SELECT
      columns.table_name,
      bool_or(columns.column_name = 'unit_id') AS has_unit_id
    FROM information_schema.columns AS columns
    JOIN information_schema.tables AS tables
      ON tables.table_schema = columns.table_schema
      AND tables.table_name = columns.table_name
      AND tables.table_type = 'BASE TABLE'
    WHERE columns.table_schema = 'public'
      AND columns.column_name IN ('organization_id', 'unit_id')
    GROUP BY columns.table_name
    HAVING bool_or(columns.column_name = 'organization_id')
  LOOP
    row_scope := format(
      'organization_id = nullif(current_setting(''app.current_organization_id'', true), '''')::uuid%s',
      CASE
        WHEN tenant_table.has_unit_id THEN
          ' AND (unit_id IS NULL OR unit_id = nullif(current_setting(''app.current_unit_id'', true), '''')::uuid)'
        ELSE ''
      END
    );
    tenant_scope := format(
      '(%s AND public.giromesa_tenant_context_authorized('
      || 'nullif(current_setting(''app.current_organization_id'', true), '''')::uuid, '
      || 'nullif(current_setting(''app.current_unit_id'', true), '''')::uuid))',
      row_scope
    );

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tenant_table.table_name);
    EXECUTE format(
      'CREATE POLICY giromesa_legacy_unscoped ON public.%I AS PERMISSIVE FOR ALL TO PUBLIC '
      || 'USING (NOT pg_has_role(session_user, ''giromesa_app'', ''member'')) '
      || 'WITH CHECK (NOT pg_has_role(session_user, ''giromesa_app'', ''member''))',
      tenant_table.table_name
    );
    EXECUTE format(
      'CREATE POLICY giromesa_tenant_scope ON public.%I AS PERMISSIVE FOR ALL TO giromesa_app '
      || 'USING %s WITH CHECK %s',
      tenant_table.table_name,
      tenant_scope,
      tenant_scope
    );
  END LOOP;
END
$$;--> statement-breakpoint

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY giromesa_legacy_unscoped ON public.organizations AS PERMISSIVE FOR ALL TO PUBLIC
  USING (NOT pg_has_role(session_user, 'giromesa_app', 'member'))
  WITH CHECK (NOT pg_has_role(session_user, 'giromesa_app', 'member'));--> statement-breakpoint
CREATE POLICY giromesa_tenant_scope ON public.organizations AS PERMISSIVE FOR ALL TO giromesa_app
  USING (
    id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(
      id,
      nullif(current_setting('app.current_unit_id', true), '')::uuid
    )
  )
  WITH CHECK (
    id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(
      id,
      nullif(current_setting('app.current_unit_id', true), '')::uuid
    )
  );--> statement-breakpoint

ALTER TABLE public.role_bindings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.role_bindings FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY giromesa_legacy_unscoped ON public.role_bindings AS PERMISSIVE FOR ALL TO PUBLIC
  USING (NOT pg_has_role(session_user, 'giromesa_app', 'member'))
  WITH CHECK (NOT pg_has_role(session_user, 'giromesa_app', 'member'));--> statement-breakpoint
CREATE POLICY giromesa_tenant_scope ON public.role_bindings AS PERMISSIVE FOR ALL TO giromesa_app
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships AS membership
      WHERE membership.id = membership_id
        AND membership.organization_id = nullif(
          current_setting('app.current_organization_id', true),
          ''
        )::uuid
    )
    AND public.giromesa_tenant_context_authorized(
      nullif(current_setting('app.current_organization_id', true), '')::uuid,
      nullif(current_setting('app.current_unit_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.memberships AS membership
      WHERE membership.id = membership_id
        AND membership.organization_id = nullif(
          current_setting('app.current_organization_id', true),
          ''
        )::uuid
    )
    AND public.giromesa_tenant_context_authorized(
      nullif(current_setting('app.current_organization_id', true), '')::uuid,
      nullif(current_setting('app.current_unit_id', true), '')::uuid
    )
  );--> statement-breakpoint

ALTER TABLE public.charges ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.charges FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY giromesa_legacy_unscoped ON public.charges AS PERMISSIVE FOR ALL TO PUBLIC
  USING (NOT pg_has_role(session_user, 'giromesa_app', 'member'))
  WITH CHECK (NOT pg_has_role(session_user, 'giromesa_app', 'member'));--> statement-breakpoint
CREATE POLICY giromesa_tenant_scope ON public.charges AS PERMISSIVE FOR ALL TO giromesa_app
  USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions AS subscription
      WHERE subscription.id = subscription_id
        AND subscription.organization_id = nullif(
          current_setting('app.current_organization_id', true),
          ''
        )::uuid
    )
    AND public.giromesa_tenant_context_authorized(
      nullif(current_setting('app.current_organization_id', true), '')::uuid,
      nullif(current_setting('app.current_unit_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.subscriptions AS subscription
      WHERE subscription.id = subscription_id
        AND subscription.organization_id = nullif(
          current_setting('app.current_organization_id', true),
          ''
        )::uuid
    )
    AND public.giromesa_tenant_context_authorized(
      nullif(current_setting('app.current_organization_id', true), '')::uuid,
      nullif(current_setting('app.current_unit_id', true), '')::uuid
    )
  );
