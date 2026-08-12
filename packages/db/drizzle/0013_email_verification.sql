CREATE TABLE "email_verification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" varchar(64) NOT NULL,
	"identity_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_verification_requests" ADD CONSTRAINT "email_verification_requests_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_verification_requests_email_time_idx" ON "email_verification_requests" USING btree ("email_hash","requested_at");--> statement-breakpoint
CREATE INDEX "email_verification_requests_identity_time_idx" ON "email_verification_requests" USING btree ("identity_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_verification_token_hash_unique" ON "email_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_identity_created_idx" ON "email_verification_tokens" USING btree ("identity_id","created_at");--> statement-breakpoint

REVOKE ALL ON public.email_verification_requests, public.email_verification_tokens
  FROM PUBLIC, giromesa_app, giromesa_worker, giromesa_public, giromesa_internal,
    giromesa_legacy_transition;--> statement-breakpoint
GRANT SELECT, INSERT ON public.email_verification_requests TO giromesa_identity;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.email_verification_tokens TO giromesa_identity;--> statement-breakpoint

DROP POLICY IF EXISTS giromesa_identity_outbox_insert ON public.outbox_events;--> statement-breakpoint
CREATE POLICY giromesa_identity_outbox_insert ON public.outbox_events FOR INSERT TO giromesa_identity
  WITH CHECK (
    (
      organization_id IS NULL AND unit_id IS NULL
      AND topic IN (
        'identity.registered',
        'auth.password_reset_requested',
        'auth.email_verification_requested'
      )
    )
    OR (
      organization_id = nullif(current_setting('app.bootstrap_organization_id', true), '')::uuid
      AND topic = 'organization.created'
    )
  );
