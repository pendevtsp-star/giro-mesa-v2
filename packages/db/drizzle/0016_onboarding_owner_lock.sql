CREATE OR REPLACE FUNCTION public.giromesa_lock_onboarding_owner(
  p_organization_id uuid,
  p_identity_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  context_organization_id text := current_setting('app.current_organization_id', true);
  context_identity_id text := current_setting('app.current_actor_identity_id', true);
BEGIN
  -- Validate before casting so malformed or missing transaction context fails closed.
  -- PostgreSQL UUID comparison then accepts canonical case differences safely.
  IF context_organization_id IS NULL
     OR context_identity_id IS NULL
     OR context_organization_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR context_identity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR context_organization_id::uuid IS DISTINCT FROM p_organization_id
     OR context_identity_id::uuid IS DISTINCT FROM p_identity_id THEN
    RETURN false;
  END IF;

  -- Global authorization lock order: memberships, then role_bindings.
  PERFORM membership.id
  FROM public.memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.identity_id = p_identity_id
  ORDER BY membership.id
  FOR UPDATE OF membership;

  PERFORM binding.id
  FROM public.role_bindings AS binding
  INNER JOIN public.memberships AS membership
    ON membership.id = binding.membership_id
  WHERE membership.organization_id = p_organization_id
    AND membership.identity_id = p_identity_id
  ORDER BY binding.id
  FOR UPDATE OF binding;

  RETURN EXISTS (
    SELECT 1
    FROM public.memberships AS membership
    INNER JOIN public.role_bindings AS binding
      ON binding.membership_id = membership.id
    WHERE membership.organization_id = p_organization_id
      AND membership.identity_id = p_identity_id
      AND membership.status = 'active'
      AND binding.role = 'owner'
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_lock_onboarding_owner(uuid, uuid)
  FROM PUBLIC, giromesa_app, giromesa_worker, giromesa_identity, giromesa_public,
    giromesa_internal, giromesa_legacy_transition;
--> statement-breakpoint
ALTER FUNCTION public.giromesa_lock_onboarding_owner(uuid, uuid) OWNER TO giromesa_migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_lock_onboarding_owner(uuid, uuid)
  FROM PUBLIC, giromesa_worker, giromesa_identity, giromesa_public,
    giromesa_internal, giromesa_legacy_transition;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giromesa_lock_onboarding_owner(uuid, uuid) TO giromesa_app;
