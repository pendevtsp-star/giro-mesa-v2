ALTER TABLE public.trial_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contact_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_requests FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS giromesa_public_insert ON public.trial_applications;
CREATE POLICY giromesa_public_insert ON public.trial_applications
  AS PERMISSIVE FOR INSERT TO giromesa_public
  WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS giromesa_public_insert ON public.contact_requests;
CREATE POLICY giromesa_public_insert ON public.contact_requests
  AS PERMISSIVE FOR INSERT TO giromesa_public
  WITH CHECK (true);--> statement-breakpoint

REVOKE ALL ON public.trial_applications, public.contact_requests FROM giromesa_platform;
GRANT SELECT (id, name, email, phone, business_name, segment, plan_slug, consented_at, created_at)
  ON public.trial_applications TO giromesa_platform;
GRANT SELECT (id, name, email, phone, consented_at, created_at)
  ON public.contact_requests TO giromesa_platform;--> statement-breakpoint

CREATE POLICY giromesa_platform_global_select ON public.trial_applications
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (
    public.giromesa_platform_actor_authorized()
    AND nullif(current_setting('app.current_organization_id', true), '')::uuid IS NULL
  );--> statement-breakpoint
CREATE POLICY giromesa_platform_global_select ON public.contact_requests
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (
    public.giromesa_platform_actor_authorized()
    AND nullif(current_setting('app.current_organization_id', true), '')::uuid IS NULL
  );--> statement-breakpoint

REVOKE ALL ON public.management_incidents, public.management_incident_events FROM giromesa_platform;
GRANT SELECT (
  id, organization_id, unit_id, incident_type, status, neutral_summary, amount_cents,
  reporter_identity_id, approver_identity_id, occurred_at, updated_at
) ON public.management_incidents TO giromesa_platform;--> statement-breakpoint
CREATE POLICY giromesa_platform_select ON public.management_incidents
  AS PERMISSIVE FOR SELECT TO giromesa_platform
  USING (public.giromesa_platform_context_authorized(organization_id));--> statement-breakpoint

GRANT SELECT ON public.management_incidents TO giromesa_migrator;
GRANT UPDATE (status, approver_identity_id, updated_at)
  ON public.management_incidents TO giromesa_migrator;
GRANT SELECT ON public.management_incident_events TO giromesa_migrator;
GRANT INSERT (
  organization_id, unit_id, incident_id, event, from_status, to_status, neutral_note,
  idempotency_key, request_hash, actor_identity_id
) ON public.management_incident_events TO giromesa_migrator;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_platform_transition_incident(
  p_organization_id uuid,
  p_unit_id uuid,
  p_incident_id uuid,
  p_target text,
  p_neutral_note text,
  p_idempotency_key text,
  p_request_hash text,
  p_actor_identity_id uuid
)
RETURNS TABLE (status text, approver_identity_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  incident public.management_incidents%ROWTYPE;
  existing_event public.management_incident_events%ROWTYPE;
BEGIN
  IF NOT public.giromesa_platform_context_authorized(p_organization_id)
    OR nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
      IS DISTINCT FROM p_actor_identity_id
  THEN
    RAISE EXCEPTION 'platform incident context is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_unit_id IS NULL OR p_incident_id IS NULL
    OR p_target NOT IN ('under_review', 'approved', 'rejected', 'closed')
    OR p_neutral_note IS NULL OR char_length(btrim(p_neutral_note)) NOT BETWEEN 20 AND 500
    OR p_idempotency_key IS NULL OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 160
    OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'
    OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'platform incident command is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('platform-incident:' || p_incident_id::text, 0));
  SELECT event.* INTO existing_event
  FROM public.management_incident_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.unit_id = p_unit_id
    AND event.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF existing_event.incident_id IS DISTINCT FROM p_incident_id
      OR existing_event.to_status IS DISTINCT FROM p_target
      OR existing_event.request_hash IS DISTINCT FROM p_request_hash
      OR existing_event.actor_identity_id IS DISTINCT FROM p_actor_identity_id
    THEN
      RAISE EXCEPTION 'platform incident idempotency payload mismatch' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY
      SELECT current_incident.status::text, current_incident.approver_identity_id
      FROM public.management_incidents AS current_incident
      WHERE current_incident.organization_id = p_organization_id
        AND current_incident.unit_id = p_unit_id
        AND current_incident.id = p_incident_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'platform incident not found' USING ERRCODE = 'P0002';
    END IF;
    RETURN;
  END IF;

  SELECT current_incident.* INTO incident
  FROM public.management_incidents AS current_incident
  WHERE current_incident.organization_id = p_organization_id
    AND current_incident.unit_id = p_unit_id
    AND current_incident.id = p_incident_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform incident not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (
    (incident.status = 'reported' AND p_target = 'under_review')
    OR (incident.status = 'under_review' AND p_target IN ('approved', 'rejected'))
    OR (incident.status IN ('approved', 'rejected') AND p_target = 'closed')
  ) THEN
    RAISE EXCEPTION 'incident transition is invalid' USING ERRCODE = '23514';
  END IF;
  IF p_target IN ('approved', 'rejected')
    AND p_actor_identity_id = incident.reporter_identity_id
  THEN
    RAISE EXCEPTION 'incident requires an independent actor' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.management_incident_events (
    organization_id, unit_id, incident_id, event, from_status, to_status, neutral_note,
    idempotency_key, request_hash, actor_identity_id
  ) VALUES (
    p_organization_id, p_unit_id, p_incident_id, p_target, incident.status, p_target,
    btrim(p_neutral_note), p_idempotency_key, p_request_hash, p_actor_identity_id
  );
  UPDATE public.management_incidents AS current_incident
  SET status = p_target,
      approver_identity_id = CASE
        WHEN p_target IN ('approved', 'rejected') THEN p_actor_identity_id
        ELSE current_incident.approver_identity_id
      END,
      updated_at = now()
  WHERE current_incident.organization_id = p_organization_id
    AND current_incident.unit_id = p_unit_id
    AND current_incident.id = p_incident_id
  RETURNING current_incident.status::text, current_incident.approver_identity_id
    INTO status, approver_identity_id;
  RETURN NEXT;
END;
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_platform_transition_incident(
  uuid, uuid, uuid, text, text, text, text, uuid
) OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_platform_transition_incident(
  uuid, uuid, uuid, text, text, text, text, uuid
) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giromesa_platform_transition_incident(
  uuid, uuid, uuid, text, text, text, text, uuid
) TO giromesa_platform;
