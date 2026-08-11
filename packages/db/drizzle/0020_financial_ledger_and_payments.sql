CREATE TABLE "financial_ledger_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "kind" varchar(24) NOT NULL,
  "currency" varchar(3) DEFAULT 'BRL' NOT NULL,
  "reference_type" varchar(48) NOT NULL,
  "reference_id" varchar(160) NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "reversal_of" uuid,
  "debit_cents" integer NOT NULL,
  "credit_cents" integer NOT NULL,
  "actor_identity_id" uuid NOT NULL,
  "posted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "financial_ledger_transactions_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "financial_ledger_transactions_balanced_check" CHECK ("debit_cents" > 0 AND "debit_cents" = "credit_cents"),
  CONSTRAINT "financial_ledger_transactions_currency_check" CHECK ("currency" = 'BRL'),
  CONSTRAINT "financial_ledger_transactions_kind_check" CHECK ("kind" IN ('sale','payment','refund','chargeback','adjustment','reversal')),
  CONSTRAINT "financial_ledger_transactions_reversal_check" CHECK (("kind" = 'reversal') = ("reversal_of" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "financial_ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "transaction_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "account" varchar(80) NOT NULL,
  "component" varchar(24),
  "debit_cents" integer DEFAULT 0 NOT NULL,
  "credit_cents" integer DEFAULT 0 NOT NULL,
  "memo" varchar(240),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "financial_ledger_entries_sequence_unique" UNIQUE("transaction_id", "sequence"),
  CONSTRAINT "financial_ledger_entries_sequence_check" CHECK ("sequence" >= 0),
  CONSTRAINT "financial_ledger_entries_one_side_check" CHECK (("debit_cents" > 0 AND "credit_cents" = 0) OR ("credit_cents" > 0 AND "debit_cents" = 0))
);
--> statement-breakpoint
CREATE TABLE "payment_terminals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "label" varchar(120) NOT NULL,
  "adapter" varchar(48) NOT NULL,
  "external_reference" varchar(160),
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "paired_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_terminals_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "payment_terminals_status_check" CHECK ("status" IN ('active','offline','revoked'))
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "source_type" varchar(48) NOT NULL,
  "source_id" varchar(160) NOT NULL,
  "amount_cents" integer NOT NULL,
  "captured_cents" integer DEFAULT 0 NOT NULL,
  "currency" varchar(3) DEFAULT 'BRL' NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_intents_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "payment_intents_amount_check" CHECK ("amount_cents" > 0 AND "captured_cents" >= 0 AND "captured_cents" <= "amount_cents"),
  CONSTRAINT "payment_intents_currency_check" CHECK ("currency" = 'BRL'),
  CONSTRAINT "payment_intents_status_check" CHECK ("status" IN ('pending','partially_paid','paid','cancelled')),
  CONSTRAINT "payment_intents_version_check" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "intent_id" uuid NOT NULL,
  "terminal_id" uuid,
  "adapter" varchar(48) NOT NULL,
  "amount_cents" integer NOT NULL,
  "status" varchar(24) DEFAULT 'created' NOT NULL,
  "provider_reference" varchar(160),
  "idempotency_key" varchar(160) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "review_required" boolean DEFAULT false NOT NULL,
  "review_reason" varchar(240),
  "last_lookup_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_attempts_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "payment_attempts_amount_check" CHECK ("amount_cents" > 0),
  CONSTRAINT "payment_attempts_status_check" CHECK ("status" IN ('created','processing','authorized','declined','unknown','reconciled','cancelled')),
  CONSTRAINT "payment_attempts_version_check" CHECK ("version" > 0),
  CONSTRAINT "payment_attempts_review_check" CHECK ("status" <> 'unknown' OR ("review_required" AND "review_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "payment_provider_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "attempt_id" uuid NOT NULL,
  "adapter" varchar(48) NOT NULL,
  "provider_event_id" varchar(160) NOT NULL,
  "outcome" varchar(24) NOT NULL,
  "safe_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_ledger_transactions" ADD CONSTRAINT "financial_ledger_transactions_unit_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "public"."units"("organization_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "financial_ledger_transactions" ADD CONSTRAINT "financial_ledger_transactions_actor_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "financial_ledger_transactions" ADD CONSTRAINT "financial_ledger_transactions_reversal_fk" FOREIGN KEY ("organization_id", "unit_id", "reversal_of") REFERENCES "public"."financial_ledger_transactions"("organization_id", "unit_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "financial_ledger_entries" ADD CONSTRAINT "financial_ledger_entries_transaction_fk" FOREIGN KEY ("organization_id", "unit_id", "transaction_id") REFERENCES "public"."financial_ledger_transactions"("organization_id", "unit_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "payment_terminals" ADD CONSTRAINT "payment_terminals_unit_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "public"."units"("organization_id", "id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_unit_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "public"."units"("organization_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_intent_fk" FOREIGN KEY ("organization_id", "unit_id", "intent_id") REFERENCES "public"."payment_intents"("organization_id", "unit_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_terminal_fk" FOREIGN KEY ("organization_id", "unit_id", "terminal_id") REFERENCES "public"."payment_terminals"("organization_id", "unit_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "payment_provider_events" ADD CONSTRAINT "payment_provider_events_attempt_fk" FOREIGN KEY ("organization_id", "unit_id", "attempt_id") REFERENCES "public"."payment_attempts"("organization_id", "unit_id", "id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "financial_ledger_transactions_idempotency_unique" ON "financial_ledger_transactions" ("organization_id", "unit_id", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "financial_ledger_transactions_reversal_unique" ON "financial_ledger_transactions" ("organization_id", "unit_id", "reversal_of") WHERE "reversal_of" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "financial_ledger_transactions_reference_idx" ON "financial_ledger_transactions" ("organization_id", "unit_id", "reference_type", "reference_id", "posted_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_terminals_external_unique" ON "payment_terminals" ("organization_id", "unit_id", "adapter", "external_reference") WHERE "external_reference" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_idempotency_unique" ON "payment_intents" ("organization_id", "unit_id", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_idempotency_unique" ON "payment_attempts" ("organization_id", "unit_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "payment_attempts_review_idx" ON "payment_attempts" ("organization_id", "unit_id", "review_required", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_events_provider_unique" ON "payment_provider_events" ("organization_id", "unit_id", "adapter", "provider_event_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.giromesa_assert_balanced_ledger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_id uuid;
  expected_debit integer;
  expected_credit integer;
  actual_debit bigint;
  actual_credit bigint;
  entry_count integer;
BEGIN
  IF TG_TABLE_NAME = 'financial_ledger_entries' THEN
    target_id := NEW.transaction_id;
  ELSE
    target_id := NEW.id;
  END IF;
  SELECT debit_cents, credit_cents INTO expected_debit, expected_credit
  FROM public.financial_ledger_transactions WHERE id = target_id;
  SELECT COALESCE(sum(debit_cents), 0), COALESCE(sum(credit_cents), 0), count(*)
    INTO actual_debit, actual_credit, entry_count
  FROM public.financial_ledger_entries WHERE transaction_id = target_id;
  IF entry_count < 2 OR actual_debit <> actual_credit OR actual_debit <> expected_debit OR actual_credit <> expected_credit THEN
    RAISE EXCEPTION 'financial ledger transaction % is not balanced', target_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "financial_ledger_transaction_balanced"
AFTER INSERT ON "financial_ledger_transactions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.giromesa_assert_balanced_ledger();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "financial_ledger_entry_balanced"
AFTER INSERT ON "financial_ledger_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.giromesa_assert_balanced_ledger();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.giromesa_reject_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'financial ledger is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "financial_ledger_transactions_immutable" BEFORE UPDATE OR DELETE ON "financial_ledger_transactions" FOR EACH ROW EXECUTE FUNCTION public.giromesa_reject_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER "financial_ledger_entries_immutable" BEFORE UPDATE OR DELETE ON "financial_ledger_entries" FOR EACH ROW EXECUTE FUNCTION public.giromesa_reject_ledger_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.giromesa_protect_payment_terminal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'payment terminals must start active and unrevoked'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment terminals cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(
    OLD.id, OLD.organization_id, OLD.unit_id, OLD.label, OLD.adapter,
    OLD.external_reference, OLD.capabilities, OLD.paired_at, OLD.created_at
  ) IS DISTINCT FROM ROW(
    NEW.id, NEW.organization_id, NEW.unit_id, NEW.label, NEW.adapter,
    NEW.external_reference, NEW.capabilities, NEW.paired_at, NEW.created_at
  ) THEN
    RAISE EXCEPTION 'payment terminal identity, provider binding and scope are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'revoked'
     OR NOT (
       OLD.status = NEW.status
       OR (OLD.status = 'active' AND NEW.status IN ('offline', 'revoked'))
       OR (OLD.status = 'offline' AND NEW.status IN ('active', 'revoked'))
     ) THEN
    RAISE EXCEPTION 'invalid payment terminal transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '55000';
  END IF;
  IF (NEW.status = 'revoked') <> (NEW.revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'revoked payment terminals require a revocation timestamp'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "payment_terminals_state_machine"
BEFORE INSERT OR UPDATE OR DELETE ON "payment_terminals"
FOR EACH ROW EXECUTE FUNCTION public.giromesa_protect_payment_terminal();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.giromesa_protect_payment_intent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.captured_cents <> 0 OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'payment intents must start pending, uncaptured and at version one'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment intents cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(
    OLD.id, OLD.organization_id, OLD.unit_id, OLD.source_type, OLD.source_id,
    OLD.amount_cents, OLD.currency, OLD.idempotency_key, OLD.request_hash, OLD.created_at
  ) IS DISTINCT FROM ROW(
    NEW.id, NEW.organization_id, NEW.unit_id, NEW.source_type, NEW.source_id,
    NEW.amount_cents, NEW.currency, NEW.idempotency_key, NEW.request_hash, NEW.created_at
  ) THEN
    RAISE EXCEPTION 'payment intent value, idempotency and scope are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'payment intent updates require the next version'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.captured_cents < OLD.captured_cents THEN
    RAISE EXCEPTION 'captured payment value cannot decrease' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status IN ('pending', 'partially_paid') AND NEW.status IN ('partially_paid', 'paid'))
    OR (
      OLD.status IN ('pending', 'partially_paid')
      AND NEW.status = 'cancelled'
      AND NEW.captured_cents = OLD.captured_cents
    )
  ) THEN
    RAISE EXCEPTION 'invalid payment intent transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '55000';
  END IF;
  IF (NEW.status = 'paid' AND NEW.captured_cents <> NEW.amount_cents)
     OR (NEW.status = 'partially_paid' AND NOT (
       NEW.captured_cents > 0 AND NEW.captured_cents < NEW.amount_cents
     )) THEN
    RAISE EXCEPTION 'payment intent status does not match captured value'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "payment_intents_state_machine"
BEFORE INSERT OR UPDATE OR DELETE ON "payment_intents"
FOR EACH ROW EXECUTE FUNCTION public.giromesa_protect_payment_intent();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.giromesa_protect_payment_attempt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('created', 'processing')
       OR NEW.provider_reference IS NOT NULL
       OR NEW.review_required
       OR NEW.review_reason IS NOT NULL
       OR NEW.last_lookup_at IS NOT NULL
       OR NEW.resolved_at IS NOT NULL
       OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'payment attempts must start unresolved and at version one'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment attempts cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(
    OLD.id, OLD.organization_id, OLD.unit_id, OLD.intent_id, OLD.terminal_id,
    OLD.adapter, OLD.amount_cents, OLD.idempotency_key, OLD.request_hash, OLD.created_at
  ) IS DISTINCT FROM ROW(
    NEW.id, NEW.organization_id, NEW.unit_id, NEW.intent_id, NEW.terminal_id,
    NEW.adapter, NEW.amount_cents, NEW.idempotency_key, NEW.request_hash, NEW.created_at
  ) THEN
    RAISE EXCEPTION 'payment attempt value, idempotency, provider and scope are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.provider_reference IS NOT NULL
     AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference THEN
    RAISE EXCEPTION 'payment provider reference cannot be replaced' USING ERRCODE = '55000';
  END IF;
  IF NEW.version <> OLD.version + 1 OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'payment attempt updates require the next version'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'created' AND NEW.status IN ('processing', 'cancelled'))
    OR (OLD.status = 'processing' AND NEW.status IN ('authorized', 'declined', 'unknown', 'cancelled'))
    OR (OLD.status = 'unknown' AND NEW.status IN ('authorized', 'declined', 'unknown', 'reconciled', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid payment attempt transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'unknown' THEN
    IF NOT NEW.review_required OR NEW.review_reason IS NULL OR NEW.resolved_at IS NOT NULL THEN
      RAISE EXCEPTION 'unknown payment attempts require unresolved manual review'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.status IN ('authorized', 'declined', 'reconciled', 'cancelled') THEN
    IF NEW.review_required OR NEW.review_reason IS NOT NULL OR NEW.resolved_at IS NULL THEN
      RAISE EXCEPTION 'resolved payment attempts cannot retain manual review state'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "payment_attempts_state_machine"
BEFORE INSERT OR UPDATE OR DELETE ON "payment_attempts"
FOR EACH ROW EXECUTE FUNCTION public.giromesa_protect_payment_attempt();
--> statement-breakpoint
ALTER TABLE "financial_ledger_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_ledger_transactions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "financial_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_ledger_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_terminals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_terminals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_intents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_attempts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_provider_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_provider_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "financial_ledger_transactions", "financial_ledger_entries", "payment_terminals", "payment_intents", "payment_attempts", "payment_provider_events" FROM PUBLIC, giromesa_app, giromesa_worker, giromesa_identity, giromesa_public, giromesa_internal, giromesa_legacy_transition;
--> statement-breakpoint
GRANT SELECT, INSERT ON "financial_ledger_transactions", "financial_ledger_entries" TO giromesa_app;
GRANT SELECT, INSERT ON "payment_terminals", "payment_intents", "payment_attempts" TO giromesa_app;
GRANT UPDATE ("captured_cents", "status", "version", "updated_at") ON "payment_intents" TO giromesa_app;
GRANT UPDATE (
  "status", "provider_reference", "review_required", "review_reason",
  "last_lookup_at", "resolved_at", "version", "updated_at"
) ON "payment_attempts" TO giromesa_app;
GRANT SELECT, INSERT ON "payment_provider_events" TO giromesa_app;
--> statement-breakpoint
CREATE POLICY "giromesa_tenant_scope" ON "financial_ledger_transactions" FOR ALL TO giromesa_app
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id))
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "financial_ledger_entries" FOR ALL TO giromesa_app
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id))
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "payment_terminals" FOR ALL TO giromesa_app
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id))
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "payment_intents" FOR ALL TO giromesa_app
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id))
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "payment_attempts" FOR ALL TO giromesa_app
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id))
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
CREATE POLICY "giromesa_tenant_scope" ON "payment_provider_events" FOR ALL TO giromesa_app
  USING (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id))
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid AND public.giromesa_tenant_context_authorized(organization_id, unit_id));
