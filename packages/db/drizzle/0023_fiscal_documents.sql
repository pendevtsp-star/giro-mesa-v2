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
  "authorized_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fiscal_documents_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "fiscal_documents_total_check" CHECK ("total_cents" > 0),
  CONSTRAINT "fiscal_documents_attempt_check" CHECK ("attempt_count" >= 0),
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
GRANT SELECT, INSERT, UPDATE ON "fiscal_documents" TO giromesa_app;
GRANT SELECT, INSERT ON "fiscal_document_events" TO giromesa_app;
--> statement-breakpoint
CREATE POLICY "giromesa_tenant_scope" ON "fiscal_documents" FOR ALL TO giromesa_app
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id))
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "fiscal_document_events" FOR ALL TO giromesa_app
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id))
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
