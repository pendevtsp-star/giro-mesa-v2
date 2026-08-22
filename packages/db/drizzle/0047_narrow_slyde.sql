CREATE TYPE "public"."pos_payment_certification_status" AS ENUM('approved', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."pos_payment_reconciliation_status" AS ENUM('pending', 'matched', 'divergent', 'settled', 'reversed');--> statement-breakpoint
CREATE TABLE "pos_payment_device_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"public_key_spki" varchar(512) NOT NULL,
	"rotation_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"rotate_after" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_payment_device_credentials_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "pos_payment_device_diagnostics" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"manufacturer" varchar(120) NOT NULL,
	"model" varchar(120) NOT NULL,
	"android_version" varchar(64) NOT NULL,
	"firmware_version" varchar(120) NOT NULL,
	"app_version" varchar(64) NOT NULL,
	"package_name" varchar(180) NOT NULL,
	"signing_certificate_sha256" varchar(64) NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_payment_device_diagnostics_organization_id_unit_id_installation_id_pk" PRIMARY KEY("organization_id","unit_id","installation_id")
);
--> statement-breakpoint
CREATE TABLE "pos_payment_device_pairing_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_installation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_payment_device_request_nonces" (
	"credential_id" uuid NOT NULL,
	"nonce" varchar(96) NOT NULL,
	"request_timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_payment_device_request_nonces_credential_id_nonce_pk" PRIMARY KEY("credential_id","nonce")
);
--> statement-breakpoint
CREATE TABLE "pos_payment_homologation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"certification_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"terminal_serial_hash" varchar(64) NOT NULL,
	"environment" varchar(24) NOT NULL,
	"checklist" jsonb NOT NULL,
	"evidence_reference" varchar(500) NOT NULL,
	"notes" text,
	"passed" boolean NOT NULL,
	"recorded_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_payment_homologation_runs_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_payment_homologation_runs_environment_check" CHECK ("pos_payment_homologation_runs"."environment" IN ('sandbox', 'homologation', 'production'))
);
--> statement-breakpoint
CREATE TABLE "pos_payment_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider" varchar(24) NOT NULL,
	"provider_settlement_id" varchar(160) NOT NULL,
	"provider_reference" varchar(120) NOT NULL,
	"gross_cents" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"net_cents" integer NOT NULL,
	"expected_settlement_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"status" "pos_payment_reconciliation_status" DEFAULT 'pending' NOT NULL,
	"source" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_payment_reconciliations_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_payment_reconciliations_provider_item_unique" UNIQUE("organization_id","unit_id","provider","provider_settlement_id","provider_reference"),
	CONSTRAINT "pos_payment_reconciliations_amounts_check" CHECK ("pos_payment_reconciliations"."gross_cents" > 0 AND "pos_payment_reconciliations"."fee_cents" >= 0 AND "pos_payment_reconciliations"."net_cents" = "pos_payment_reconciliations"."gross_cents" - "pos_payment_reconciliations"."fee_cents"),
	CONSTRAINT "pos_payment_reconciliations_source_check" CHECK ("pos_payment_reconciliations"."source" IN ('api', 'webhook', 'import')),
	CONSTRAINT "pos_payment_reconciliations_settled_at_check" CHECK ("pos_payment_reconciliations"."status" <> 'settled' OR "pos_payment_reconciliations"."settled_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "pos_payment_reversal_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"reversal_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"device_result_id" varchar(160) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"status" varchar(24) NOT NULL,
	"provider_reference" varchar(120),
	"failure_code" varchar(80),
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_payment_reversal_results_status_check" CHECK ("pos_payment_reversal_results"."status" IN ('processing', 'approved', 'declined', 'canceled', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "pos_payment_terminal_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"provider" varchar(24) NOT NULL,
	"status" "pos_payment_certification_status" DEFAULT 'suspended' NOT NULL,
	"manufacturer" varchar(120) NOT NULL,
	"model" varchar(120) NOT NULL,
	"android_version" varchar(64) NOT NULL,
	"firmware_version" varchar(120) NOT NULL,
	"app_version" varchar(64) NOT NULL,
	"package_name" varchar(180) NOT NULL,
	"signing_certificate_sha256" varchar(64) NOT NULL,
	"methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_installments" integer DEFAULT 1 NOT NULL,
	"supports_cancel" boolean DEFAULT false NOT NULL,
	"supports_recover" boolean DEFAULT false NOT NULL,
	"supports_reversal" boolean DEFAULT false NOT NULL,
	"kill_switch_enabled" boolean DEFAULT false NOT NULL,
	"kill_switch_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_payment_terminal_certifications_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_payment_terminal_certifications_provider_check" CHECK ("pos_payment_terminal_certifications"."provider" IN ('rede', 'paygo', 'stone', 'getnet', 'cielo', 'pagbank')),
	CONSTRAINT "pos_payment_terminal_certifications_installments_check" CHECK ("pos_payment_terminal_certifications"."max_installments" BETWEEN 1 AND 24),
	CONSTRAINT "pos_payment_terminal_certifications_kill_switch_reason_check" CHECK (NOT "pos_payment_terminal_certifications"."kill_switch_enabled" OR "pos_payment_terminal_certifications"."kill_switch_reason" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "pos_payment_attempt_results" DROP CONSTRAINT "pos_payment_attempt_results_attempt_fk";
--> statement-breakpoint
ALTER TABLE "pos_tab_payments" DROP CONSTRAINT "pos_tab_payments_attempt_fk";
--> statement-breakpoint
ALTER TABLE "pos_payment_reversals" ADD COLUMN "payment_attempt_id" uuid;--> statement-breakpoint
UPDATE "pos_payment_reversals" AS reversal
SET "payment_attempt_id" = payment."payment_attempt_id"
FROM "pos_tab_payments" AS payment
WHERE payment."organization_id" = reversal."organization_id"
	AND payment."unit_id" = reversal."unit_id"
	AND payment."id" = reversal."payment_id";--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "pos_payment_reversals" WHERE "payment_attempt_id" IS NULL) THEN
		RAISE EXCEPTION 'Cannot backfill payment_attempt_id for existing POS payment reversals';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "pos_payment_reversals" ALTER COLUMN "payment_attempt_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD COLUMN "payment_certification_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_payment_attempts" ADD CONSTRAINT "pos_payment_attempts_device_scope_unique" UNIQUE("organization_id","unit_id","id","installation_id");--> statement-breakpoint
ALTER TABLE "pos_payment_attempts" ADD CONSTRAINT "pos_payment_attempts_tab_scope_unique" UNIQUE("organization_id","unit_id","id","tab_id");--> statement-breakpoint
ALTER TABLE "pos_payment_reversals" ADD CONSTRAINT "pos_payment_reversals_device_scope_unique" UNIQUE("organization_id","unit_id","id","installation_id");--> statement-breakpoint
ALTER TABLE "pos_tab_payments" ADD CONSTRAINT "pos_tab_payments_attempt_scope_unique" UNIQUE("organization_id","unit_id","id","payment_attempt_id");--> statement-breakpoint
ALTER TABLE "pos_payment_device_credentials" ADD CONSTRAINT "pos_payment_device_credentials_device_fk" FOREIGN KEY ("organization_id","unit_id","installation_id") REFERENCES "public"."device_enrollments"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_device_diagnostics" ADD CONSTRAINT "pos_payment_device_diagnostics_device_fk" FOREIGN KEY ("organization_id","unit_id","installation_id") REFERENCES "public"."device_enrollments"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_device_pairing_codes" ADD CONSTRAINT "pos_payment_device_pairing_codes_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_device_pairing_codes" ADD CONSTRAINT "pos_payment_device_pairing_codes_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_device_pairing_codes" ADD CONSTRAINT "pos_payment_device_pairing_codes_consumed_device_fk" FOREIGN KEY ("organization_id","unit_id","consumed_by_installation_id") REFERENCES "public"."device_enrollments"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_device_request_nonces" ADD CONSTRAINT "pos_payment_device_request_nonces_credential_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."pos_payment_device_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_homologation_runs" ADD CONSTRAINT "pos_payment_homologation_runs_recorded_by_identity_id_identities_id_fk" FOREIGN KEY ("recorded_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_homologation_runs" ADD CONSTRAINT "pos_payment_homologation_runs_certification_fk" FOREIGN KEY ("organization_id","unit_id","certification_id") REFERENCES "public"."pos_payment_terminal_certifications"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_homologation_runs" ADD CONSTRAINT "pos_payment_homologation_runs_device_fk" FOREIGN KEY ("organization_id","unit_id","installation_id") REFERENCES "public"."device_enrollments"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_reconciliations" ADD CONSTRAINT "pos_payment_reconciliations_payment_fk" FOREIGN KEY ("organization_id","unit_id","payment_id") REFERENCES "public"."pos_tab_payments"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_reversal_results" ADD CONSTRAINT "pos_payment_reversal_results_reversal_fk" FOREIGN KEY ("organization_id","unit_id","reversal_id","installation_id") REFERENCES "public"."pos_payment_reversals"("organization_id","unit_id","id","installation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_terminal_certifications" ADD CONSTRAINT "pos_payment_terminal_certifications_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_payment_device_credentials_rotation_unique" ON "pos_payment_device_credentials" USING btree ("organization_id","unit_id","installation_id","rotation_id") WHERE "pos_payment_device_credentials"."rotation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pos_payment_device_credentials_active_idx" ON "pos_payment_device_credentials" USING btree ("organization_id","unit_id","installation_id","expires_at");--> statement-breakpoint
CREATE INDEX "pos_payment_device_diagnostics_last_seen_idx" ON "pos_payment_device_diagnostics" USING btree ("organization_id","unit_id","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_payment_device_pairing_codes_hash_unique" ON "pos_payment_device_pairing_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "pos_payment_device_pairing_codes_scope_idx" ON "pos_payment_device_pairing_codes" USING btree ("organization_id","unit_id","expires_at");--> statement-breakpoint
CREATE INDEX "pos_payment_device_request_nonces_created_idx" ON "pos_payment_device_request_nonces" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pos_payment_homologation_runs_certification_idx" ON "pos_payment_homologation_runs" USING btree ("organization_id","unit_id","certification_id","created_at");--> statement-breakpoint
CREATE INDEX "pos_payment_reconciliations_status_idx" ON "pos_payment_reconciliations" USING btree ("organization_id","unit_id","status","expected_settlement_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_payment_reversal_results_device_result_unique" ON "pos_payment_reversal_results" USING btree ("organization_id","unit_id","installation_id","device_result_id");--> statement-breakpoint
ALTER TABLE "pos_payment_attempt_results" ADD CONSTRAINT "pos_payment_attempt_results_attempt_fk" FOREIGN KEY ("organization_id","unit_id","attempt_id","installation_id") REFERENCES "public"."pos_payment_attempts"("organization_id","unit_id","id","installation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_reversals" ADD CONSTRAINT "pos_payment_reversals_payment_attempt_fk" FOREIGN KEY ("organization_id","unit_id","payment_id","payment_attempt_id") REFERENCES "public"."pos_tab_payments"("organization_id","unit_id","id","payment_attempt_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_reversals" ADD CONSTRAINT "pos_payment_reversals_attempt_device_fk" FOREIGN KEY ("organization_id","unit_id","payment_attempt_id","installation_id") REFERENCES "public"."pos_payment_attempts"("organization_id","unit_id","id","installation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tab_payments" ADD CONSTRAINT "pos_tab_payments_attempt_fk" FOREIGN KEY ("organization_id","unit_id","payment_attempt_id","tab_id") REFERENCES "public"."pos_payment_attempts"("organization_id","unit_id","id","tab_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD CONSTRAINT "pos_terminal_profiles_payment_certification_fk" FOREIGN KEY ("organization_id","unit_id","payment_certification_id") REFERENCES "public"."pos_payment_terminal_certifications"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
