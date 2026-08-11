DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'giromesa_platform') THEN
    CREATE ROLE giromesa_platform NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint
ALTER ROLE giromesa_platform NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO giromesa_platform;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_platform_actor_authorized()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    current_setting('app.current_context_source', true) = 'platform'
    AND nullif(current_setting('app.current_actor_identity_id', true), '')::uuid IS NOT NULL
    AND nullif(current_setting('app.current_session_id', true), '')::uuid IS NOT NULL
    AND pg_has_role(session_user, 'giromesa_platform', 'member')
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_platform_actor_authorized() OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_platform_actor_authorized() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giromesa_platform_actor_authorized() TO giromesa_platform;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_platform_context_authorized(expected_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    public.giromesa_platform_actor_authorized()
    AND expected_organization_id IS NOT NULL
    AND nullif(current_setting('app.current_organization_id', true), '')::uuid = expected_organization_id
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_platform_context_authorized(uuid) OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_platform_context_authorized(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giromesa_platform_context_authorized(uuid) TO giromesa_platform;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_platform_overview()
RETURNS TABLE (organizations integer, active integer, attention integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.giromesa_platform_actor_authorized()
    OR nullif(current_setting('app.current_organization_id', true), '')::uuid IS NOT NULL
  THEN
    RAISE EXCEPTION 'platform aggregate context is invalid' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE organization.billing_state IN ('trial_active', 'active'))::integer,
    count(*) FILTER (WHERE organization.billing_state IN ('grace', 'restricted', 'suspended'))::integer
  FROM public.organizations AS organization;
END
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_platform_overview() OWNER TO giromesa_migrator;--> statement-breakpoint
GRANT SELECT (id, billing_state) ON public.organizations TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_platform_overview() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giromesa_platform_overview() TO giromesa_platform;--> statement-breakpoint

GRANT SELECT (id, trade_name, billing_state, updated_at) ON public.organizations TO giromesa_platform;--> statement-breakpoint
GRANT UPDATE (billing_state, billing_state_changed_at, updated_at) ON public.organizations TO giromesa_platform;--> statement-breakpoint
GRANT SELECT (id, organization_id, name, active, timezone) ON public.units TO giromesa_platform;--> statement-breakpoint
GRANT SELECT (id, organization_id, identity_id, status) ON public.memberships TO giromesa_platform;--> statement-breakpoint
GRANT UPDATE (status, updated_at) ON public.memberships TO giromesa_platform;--> statement-breakpoint
GRANT SELECT (id, membership_id, unit_id, role) ON public.role_bindings TO giromesa_platform;--> statement-breakpoint
GRANT SELECT (id, email, display_name) ON public.identities TO giromesa_platform;--> statement-breakpoint
GRANT SELECT (id, slug, name) ON public.commercial_plans TO giromesa_platform;--> statement-breakpoint
GRANT SELECT (organization_id, selected_plan_id, selection_revision, selected_at) ON public.onboarding_records TO giromesa_platform;--> statement-breakpoint
GRANT SELECT (organization_id, entitlement, state, activated_at, revoked_at) ON public.subscription_entitlements TO giromesa_platform;--> statement-breakpoint
GRANT SELECT (organization_id, item, status, source, verified_at) ON public.onboarding_checklist_items TO giromesa_platform;--> statement-breakpoint
GRANT SELECT (id, organization_id, state, checkpoint, last_error_code, updated_at) ON public.provisioning_runs TO giromesa_platform;--> statement-breakpoint
GRANT SELECT (id, organization_id, commercial_plan_id, cycle, state, current_period_ends_at, updated_at) ON public.subscriptions TO giromesa_platform;--> statement-breakpoint
GRANT SELECT (id, organization_id, unit_id, provider, status, updated_at) ON public.growth_integrations TO giromesa_platform;--> statement-breakpoint
GRANT SELECT (id, organization_id, unit_id, actor_identity_id, action, entity_type, entity_id, metadata, occurred_at) ON public.audit_events TO giromesa_platform;--> statement-breakpoint
GRANT INSERT ON public.audit_events TO giromesa_platform;--> statement-breakpoint

CREATE POLICY giromesa_platform_select ON public.organizations
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (public.giromesa_platform_context_authorized(id));--> statement-breakpoint
CREATE POLICY giromesa_platform_update ON public.organizations
  AS PERMISSIVE FOR UPDATE TO giromesa_platform
  USING (public.giromesa_platform_context_authorized(id))
  WITH CHECK (public.giromesa_platform_context_authorized(id));--> statement-breakpoint

CREATE POLICY giromesa_platform_select ON public.units
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (public.giromesa_platform_context_authorized(organization_id));--> statement-breakpoint
CREATE POLICY giromesa_platform_select ON public.memberships
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (public.giromesa_platform_context_authorized(organization_id));--> statement-breakpoint
CREATE POLICY giromesa_platform_update ON public.memberships
  AS PERMISSIVE FOR UPDATE TO giromesa_platform
  USING (public.giromesa_platform_context_authorized(organization_id))
  WITH CHECK (public.giromesa_platform_context_authorized(organization_id));--> statement-breakpoint
CREATE POLICY giromesa_platform_select ON public.role_bindings
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships AS membership
      WHERE membership.id = membership_id
        AND public.giromesa_platform_context_authorized(membership.organization_id)
    )
  );--> statement-breakpoint
CREATE POLICY giromesa_platform_select ON public.onboarding_records
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (public.giromesa_platform_context_authorized(organization_id));--> statement-breakpoint
CREATE POLICY giromesa_platform_select ON public.subscription_entitlements
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (public.giromesa_platform_context_authorized(organization_id));--> statement-breakpoint
CREATE POLICY giromesa_platform_select ON public.onboarding_checklist_items
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (public.giromesa_platform_context_authorized(organization_id));--> statement-breakpoint
CREATE POLICY giromesa_platform_select ON public.provisioning_runs
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (public.giromesa_platform_context_authorized(organization_id));--> statement-breakpoint
CREATE POLICY giromesa_platform_select ON public.subscriptions
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (public.giromesa_platform_context_authorized(organization_id));--> statement-breakpoint
CREATE POLICY giromesa_platform_select ON public.growth_integrations
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (public.giromesa_platform_context_authorized(organization_id));--> statement-breakpoint
CREATE POLICY giromesa_platform_select ON public.audit_events
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (
    (organization_id IS NOT NULL AND public.giromesa_platform_context_authorized(organization_id))
    OR (
      organization_id IS NULL
      AND public.giromesa_platform_actor_authorized()
      AND actor_identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
      AND action = 'auth.mfa_verified'
      AND entity_type = 'session'
      AND entity_id = nullif(current_setting('app.current_session_id', true), '')
    )
  );--> statement-breakpoint
CREATE POLICY giromesa_platform_insert ON public.audit_events
  AS PERMISSIVE FOR INSERT TO giromesa_platform
  WITH CHECK (
    organization_id IS NOT NULL
    AND public.giromesa_platform_context_authorized(organization_id)
    AND actor_identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
  );
