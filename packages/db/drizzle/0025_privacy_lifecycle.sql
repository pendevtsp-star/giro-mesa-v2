ALTER TABLE public.auth_sessions ADD COLUMN mfa_verified_at timestamp with time zone;
--> statement-breakpoint

CREATE TYPE public.privacy_request_type AS ENUM (
  'access_export', 'correction', 'anonymization', 'deletion'
);
--> statement-breakpoint
CREATE TYPE public.privacy_request_state AS ENUM (
  'verification_pending', 'approval_pending', 'processing', 'partial',
  'completed', 'rejected', 'failed'
);
--> statement-breakpoint
CREATE TYPE public.privacy_step_status AS ENUM (
  'pending', 'processing', 'completed', 'blocked', 'failed'
);
--> statement-breakpoint

CREATE TABLE public.privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject_identity_id uuid NOT NULL REFERENCES public.identities(id),
  requester_identity_id uuid NOT NULL REFERENCES public.identities(id),
  type public.privacy_request_type NOT NULL,
  state public.privacy_request_state NOT NULL DEFAULT 'verification_pending',
  idempotency_key varchar(160) NOT NULL,
  request_fingerprint varchar(64) NOT NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_domains jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code varchar(80),
  verified_at timestamp with time zone,
  approved_at timestamp with time zone,
  rejected_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT privacy_requests_scope_id_unique UNIQUE (organization_id, id),
  CONSTRAINT privacy_requests_org_key_unique UNIQUE (organization_id, idempotency_key),
  CONSTRAINT privacy_requests_attempts_check CHECK (attempts >= 0),
  CONSTRAINT privacy_requests_subject_check CHECK (subject_identity_id = requester_identity_id),
  CONSTRAINT privacy_requests_domains_check CHECK (
    jsonb_typeof(required_domains) = 'array' AND jsonb_array_length(required_domains) > 0
  )
);
--> statement-breakpoint
CREATE INDEX privacy_requests_subject_time_idx
  ON public.privacy_requests (organization_id, subject_identity_id, created_at);
--> statement-breakpoint
CREATE INDEX privacy_requests_state_time_idx
  ON public.privacy_requests (state, updated_at);
--> statement-breakpoint

CREATE TABLE public.privacy_request_steps (
  organization_id uuid NOT NULL,
  request_id uuid NOT NULL,
  domain varchar(80) NOT NULL,
  mandatory boolean NOT NULL DEFAULT true,
  status public.privacy_step_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  reason_code varchar(80),
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, request_id, domain),
  CONSTRAINT privacy_request_steps_scope_fk
    FOREIGN KEY (organization_id, request_id)
    REFERENCES public.privacy_requests (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT privacy_request_steps_attempts_check CHECK (attempts >= 0)
);
--> statement-breakpoint

CREATE TABLE public.privacy_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  request_id uuid NOT NULL,
  subject_identity_id uuid NOT NULL REFERENCES public.identities(id),
  encrypted_payload text NOT NULL,
  iv varchar(24) NOT NULL,
  auth_tag varchar(32) NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  downloaded_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT privacy_exports_request_unique UNIQUE (organization_id, request_id),
  CONSTRAINT privacy_exports_request_scope_fk
    FOREIGN KEY (organization_id, request_id)
    REFERENCES public.privacy_requests (organization_id, id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE UNIQUE INDEX outbox_privacy_request_processing_unique
  ON public.outbox_events (organization_id, topic, aggregate_id)
  WHERE topic = 'privacy.request.processing';
--> statement-breakpoint

CREATE FUNCTION public.giromesa_privacy_request_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id <> OLD.organization_id
    OR NEW.subject_identity_id <> OLD.subject_identity_id
    OR NEW.requester_identity_id <> OLD.requester_identity_id
    OR NEW.type <> OLD.type
    OR NEW.idempotency_key <> OLD.idempotency_key
    OR NEW.request_fingerprint <> OLD.request_fingerprint
    OR NEW.request_payload <> OLD.request_payload
    OR NEW.required_domains <> OLD.required_domains
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'PRIVACY_REQUEST_IMMUTABLE_FIELDS' USING ERRCODE = '23514';
  END IF;

  IF NEW.state <> OLD.state AND NOT (
    (OLD.state = 'verification_pending' AND NEW.state IN ('approval_pending', 'rejected'))
    OR (OLD.state = 'approval_pending' AND NEW.state IN ('processing', 'rejected'))
    OR (OLD.state = 'processing' AND NEW.state IN ('partial', 'completed', 'failed'))
    OR (OLD.state IN ('partial', 'failed') AND NEW.state IN ('processing', 'rejected'))
  ) THEN
    RAISE EXCEPTION 'PRIVACY_STATE_TRANSITION_INVALID' USING ERRCODE = '23514';
  END IF;

  IF NEW.state = 'completed' AND (
    EXISTS (
      SELECT 1 FROM public.privacy_request_steps step
      WHERE step.organization_id = NEW.organization_id AND step.request_id = NEW.id
        AND step.mandatory AND step.status <> 'completed'
    )
    OR (
      SELECT count(*) FROM public.privacy_request_steps step
      WHERE step.organization_id = NEW.organization_id AND step.request_id = NEW.id
        AND step.mandatory
    ) <> jsonb_array_length(NEW.required_domains)
  ) THEN
    RAISE EXCEPTION 'PRIVACY_MANDATORY_PROCESSORS_INCOMPLETE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER privacy_request_guard
  BEFORE UPDATE ON public.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION public.giromesa_privacy_request_guard();
--> statement-breakpoint

ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_request_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_request_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_exports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

REVOKE ALL ON public.privacy_requests, public.privacy_request_steps, public.privacy_exports
FROM PUBLIC, giromesa_app, giromesa_worker, giromesa_identity, giromesa_public,
  giromesa_internal, giromesa_legacy_transition;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.privacy_requests, public.privacy_request_steps TO giromesa_app;
GRANT UPDATE (
  state, attempts, last_error_code, verified_at, approved_at, rejected_at,
  completed_at, updated_at
) ON public.privacy_requests TO giromesa_app;
--> statement-breakpoint
GRANT SELECT ON public.privacy_exports TO giromesa_app;
GRANT UPDATE (downloaded_at) ON public.privacy_exports TO giromesa_app;
--> statement-breakpoint
GRANT SELECT ON public.privacy_requests, public.privacy_request_steps TO giromesa_worker;
GRANT UPDATE (state, attempts, last_error_code, completed_at, updated_at)
  ON public.privacy_requests TO giromesa_worker;
GRANT UPDATE (status, attempts, reason_code, completed_at, updated_at)
  ON public.privacy_request_steps TO giromesa_worker;
GRANT SELECT, INSERT, UPDATE ON public.privacy_exports TO giromesa_worker;
--> statement-breakpoint

CREATE POLICY giromesa_privacy_request_app ON public.privacy_requests
  AS PERMISSIVE FOR ALL TO giromesa_app
  USING (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, NULL)
    AND (
      requester_identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
      OR EXISTS (
        SELECT 1 FROM public.memberships membership
        JOIN public.role_bindings binding ON binding.membership_id = membership.id
        WHERE membership.organization_id = privacy_requests.organization_id
          AND membership.identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
          AND membership.status = 'active' AND binding.role = 'owner'
      )
    )
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, NULL)
    AND (
      requester_identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
      OR EXISTS (
        SELECT 1 FROM public.memberships membership
        JOIN public.role_bindings binding ON binding.membership_id = membership.id
        WHERE membership.organization_id = privacy_requests.organization_id
          AND membership.identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
          AND membership.status = 'active' AND binding.role = 'owner'
      )
    )
  );
--> statement-breakpoint

CREATE POLICY giromesa_privacy_step_app ON public.privacy_request_steps
  AS PERMISSIVE FOR ALL TO giromesa_app
  USING (EXISTS (
    SELECT 1 FROM public.privacy_requests request
    WHERE request.organization_id = privacy_request_steps.organization_id
      AND request.id = privacy_request_steps.request_id
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.privacy_requests request
    WHERE request.organization_id = privacy_request_steps.organization_id
      AND request.id = privacy_request_steps.request_id
  ));
--> statement-breakpoint

CREATE POLICY giromesa_privacy_export_app ON public.privacy_exports
  AS PERMISSIVE FOR SELECT TO giromesa_app
  USING (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND subject_identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, NULL)
  );
--> statement-breakpoint
CREATE POLICY giromesa_privacy_export_download_app ON public.privacy_exports
  AS PERMISSIVE FOR UPDATE TO giromesa_app
  USING (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND subject_identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(organization_id, NULL)
    AND downloaded_at IS NULL AND expires_at > now()
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND subject_identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
    AND downloaded_at IS NOT NULL
  );
--> statement-breakpoint

CREATE POLICY giromesa_privacy_worker ON public.privacy_requests
  AS PERMISSIVE FOR ALL TO giromesa_worker USING (true) WITH CHECK (true);
CREATE POLICY giromesa_privacy_worker ON public.privacy_request_steps
  AS PERMISSIVE FOR ALL TO giromesa_worker USING (true) WITH CHECK (true);
CREATE POLICY giromesa_privacy_worker ON public.privacy_exports
  AS PERMISSIVE FOR ALL TO giromesa_worker USING (true) WITH CHECK (true);
--> statement-breakpoint

GRANT SELECT (id, email, display_name, email_verified_at, disabled_at, created_at, updated_at)
  ON public.identities TO giromesa_worker;
GRANT SELECT (id, identity_id, organization_id, status, created_at, updated_at)
  ON public.memberships TO giromesa_worker;
GRANT SELECT (membership_id, role, unit_id) ON public.role_bindings TO giromesa_worker;
--> statement-breakpoint
GRANT INSERT ON public.audit_events TO giromesa_worker;
--> statement-breakpoint
CREATE POLICY giromesa_privacy_worker_audit ON public.audit_events
  AS PERMISSIVE FOR INSERT TO giromesa_worker
  WITH CHECK (
    organization_id IS NOT NULL
    AND action LIKE 'privacy.%'
    AND metadata - ARRAY['attempt', 'state', 'domain', 'reasonCode', 'requestType'] = '{}'::jsonb
  );
--> statement-breakpoint
CREATE POLICY giromesa_privacy_worker_read ON public.memberships
  AS PERMISSIVE FOR SELECT TO giromesa_worker USING (true);
CREATE POLICY giromesa_privacy_worker_read ON public.role_bindings
  AS PERMISSIVE FOR SELECT TO giromesa_worker USING (true);
