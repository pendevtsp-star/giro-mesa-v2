CREATE TABLE "fiscal_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "sale_reference" varchar(160) NOT NULL,
  "document_type" varchar(24) NOT NULL,
  "total_cents" integer NOT NULL,
  "document_payload" jsonb NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "adapter" varchar(48) NOT NULL,
  "adapter_homologated" boolean DEFAULT false NOT NULL,
  "document_reference" varchar(160),
  "last_error_code" varchar(80),
  "idempotency_key" varchar(160) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "actor_identity_id" uuid NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "authorized_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fiscal_documents_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "fiscal_documents_total_check" CHECK ("total_cents" > 0),
  CONSTRAINT "fiscal_documents_attempt_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "fiscal_documents_version_check" CHECK ("version" > 0),
  CONSTRAINT "fiscal_documents_status_check" CHECK ("status" IN ('pending','submitted','authorized','rejected','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "fiscal_document_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "from_status" varchar(24),
  "to_status" varchar(24) NOT NULL,
  "event" varchar(24) NOT NULL,
  "error_code" varchar(80),
  "actor_identity_id" uuid,
  "safe_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_unit_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "public"."units"("organization_id", "id") ON DELETE restrict;
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_actor_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
ALTER TABLE "fiscal_document_events" ADD CONSTRAINT "fiscal_document_events_document_fk" FOREIGN KEY ("organization_id", "unit_id", "document_id") REFERENCES "public"."fiscal_documents"("organization_id", "unit_id", "id") ON DELETE restrict;
ALTER TABLE "fiscal_document_events" ADD CONSTRAINT "fiscal_document_events_actor_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_documents_idempotency_unique" ON "fiscal_documents" ("organization_id", "unit_id", "idempotency_key");
CREATE INDEX "fiscal_documents_sale_idx" ON "fiscal_documents" ("organization_id", "unit_id", "sale_reference");
CREATE INDEX "fiscal_document_events_document_idx" ON "fiscal_document_events" ("document_id", "created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.giromesa_protect_fiscal_document()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending'
       OR NEW.document_reference IS NOT NULL
       OR NEW.last_error_code IS NOT NULL
       OR NEW.attempt_count <> 0
       OR NEW.version <> 1
       OR NEW.authorized_at IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'fiscal documents must start pending and unsubmitted at version one'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fiscal documents cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(
    OLD.id, OLD.organization_id, OLD.unit_id, OLD.sale_reference, OLD.document_type,
    OLD.total_cents, OLD.document_payload, OLD.adapter, OLD.adapter_homologated,
    OLD.idempotency_key, OLD.request_hash, OLD.actor_identity_id, OLD.created_at
  ) IS DISTINCT FROM ROW(
    NEW.id, NEW.organization_id, NEW.unit_id, NEW.sale_reference, NEW.document_type,
    NEW.total_cents, NEW.document_payload, NEW.adapter, NEW.adapter_homologated,
    NEW.idempotency_key, NEW.request_hash, NEW.actor_identity_id, NEW.created_at
  ) THEN
    RAISE EXCEPTION 'fiscal scope, value, provider payload and idempotency are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.document_reference IS NOT NULL
     AND NEW.document_reference IS DISTINCT FROM OLD.document_reference THEN
    RAISE EXCEPTION 'fiscal provider reference cannot be replaced' USING ERRCODE = '55000';
  END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'fiscal document updates require the next version'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'pending' AND NEW.status = 'submitted')
    OR (OLD.status = 'submitted' AND NEW.status IN ('submitted', 'pending', 'authorized', 'rejected'))
    OR (OLD.status = 'rejected' AND NEW.status = 'pending')
    OR (OLD.status = 'authorized' AND NEW.status = 'cancelled')
  ) THEN
    RAISE EXCEPTION 'invalid fiscal document transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'pending' AND NEW.status = 'submitted' THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1 THEN
      RAISE EXCEPTION 'fiscal submission must increment attempt count once'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.attempt_count <> OLD.attempt_count THEN
    RAISE EXCEPTION 'fiscal attempt count can change only on submission'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'authorized' AND NEW.authorized_at IS NULL THEN
    RAISE EXCEPTION 'authorized fiscal documents require authorization time'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'cancelled'
     AND (NEW.authorized_at IS NULL OR NEW.cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'cancelled fiscal documents require authorization and cancellation times'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "fiscal_documents_state_machine"
BEFORE INSERT OR UPDATE OR DELETE ON "fiscal_documents"
FOR EACH ROW EXECUTE FUNCTION public.giromesa_protect_fiscal_document();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.giromesa_reject_fiscal_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'fiscal document events are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "fiscal_document_events_immutable" BEFORE UPDATE OR DELETE ON "fiscal_document_events" FOR EACH ROW EXECUTE FUNCTION public.giromesa_reject_fiscal_event_mutation();
--> statement-breakpoint
ALTER TABLE "fiscal_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_document_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_document_events" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "fiscal_documents", "fiscal_document_events" FROM PUBLIC, giromesa_app, giromesa_worker, giromesa_identity, giromesa_public, giromesa_internal, giromesa_legacy_transition;
GRANT SELECT, INSERT ON "fiscal_documents" TO giromesa_app;
GRANT UPDATE (
  "status", "document_reference", "last_error_code", "attempt_count", "version",
  "authorized_at", "cancelled_at", "updated_at"
) ON "fiscal_documents" TO giromesa_app;
GRANT SELECT, INSERT ON "fiscal_document_events" TO giromesa_app;
--> statement-breakpoint
CREATE POLICY "giromesa_tenant_scope" ON "fiscal_documents" FOR ALL TO giromesa_app
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id))
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "fiscal_document_events" FOR ALL TO giromesa_app
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id))
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
