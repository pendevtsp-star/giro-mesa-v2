CREATE TYPE "public"."pos_payment_attempt_status" AS ENUM('created', 'processing', 'approved', 'declined', 'canceled', 'unknown', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."pos_payment_reversal_status" AS ENUM('pending', 'processing', 'approved', 'declined', 'canceled', 'unknown');--> statement-breakpoint
CREATE TABLE "pos_payment_attempt_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"device_result_id" varchar(160) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"status" varchar(24) NOT NULL,
	"provider_reference" varchar(120),
	"authorization_code" varchar(64),
	"failure_code" varchar(80),
	"failure_message" varchar(500),
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_payment_attempt_results_status_check" CHECK ("pos_payment_attempt_results"."status" IN ('processing', 'approved', 'declined', 'canceled', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "pos_payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"tab_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"requested_by_identity_id" uuid NOT NULL,
	"provider" varchar(24) NOT NULL,
	"method" "pos_payment_method" NOT NULL,
	"amount_cents" integer NOT NULL,
	"installments" integer DEFAULT 1 NOT NULL,
	"status" "pos_payment_attempt_status" DEFAULT 'created' NOT NULL,
	"provider_reference" varchar(120),
	"authorization_code" varchar(64),
	"failure_code" varchar(80),
	"failure_message" varchar(500),
	"expires_at" timestamp with time zone NOT NULL,
	"processing_at" timestamp with time zone,
	"recovery_requested_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_payment_attempts_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_payment_attempts_amount_check" CHECK ("pos_payment_attempts"."amount_cents" > 0),
	CONSTRAINT "pos_payment_attempts_method_check" CHECK ("pos_payment_attempts"."method" IN ('credit_card', 'debit_card', 'pix')),
	CONSTRAINT "pos_payment_attempts_installments_check" CHECK ("pos_payment_attempts"."installments" BETWEEN 1 AND 24),
	CONSTRAINT "pos_payment_attempts_non_credit_installments_check" CHECK ("pos_payment_attempts"."method" = 'credit_card' OR "pos_payment_attempts"."installments" = 1)
);
--> statement-breakpoint
CREATE TABLE "pos_payment_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"requested_by_identity_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" varchar(500) NOT NULL,
	"status" "pos_payment_reversal_status" DEFAULT 'pending' NOT NULL,
	"provider_reference" varchar(120),
	"failure_code" varchar(80),
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_payment_reversals_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_payment_reversals_amount_check" CHECK ("pos_payment_reversals"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "pos_tab_payments" ADD COLUMN "payment_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_tab_payments" ADD COLUMN "source" varchar(24) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_tab_payments" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD COLUMN "payment_provider" varchar(24);--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD COLUMN "payment_status" varchar(24) DEFAULT 'disabled' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD COLUMN "payment_methods" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD COLUMN "max_payment_installments" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD COLUMN "payment_supports_cancel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD COLUMN "payment_supports_recover" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD COLUMN "payment_supports_reversal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_payment_attempt_results" ADD CONSTRAINT "pos_payment_attempt_results_attempt_fk" FOREIGN KEY ("organization_id","unit_id","attempt_id") REFERENCES "public"."pos_payment_attempts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_attempt_results" ADD CONSTRAINT "pos_payment_attempt_results_device_fk" FOREIGN KEY ("organization_id","unit_id","installation_id") REFERENCES "public"."device_enrollments"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_attempts" ADD CONSTRAINT "pos_payment_attempts_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_attempts" ADD CONSTRAINT "pos_payment_attempts_tab_fk" FOREIGN KEY ("organization_id","unit_id","tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_attempts" ADD CONSTRAINT "pos_payment_attempts_device_fk" FOREIGN KEY ("organization_id","unit_id","installation_id") REFERENCES "public"."device_enrollments"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_reversals" ADD CONSTRAINT "pos_payment_reversals_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_reversals" ADD CONSTRAINT "pos_payment_reversals_payment_fk" FOREIGN KEY ("organization_id","unit_id","payment_id") REFERENCES "public"."pos_tab_payments"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_reversals" ADD CONSTRAINT "pos_payment_reversals_device_fk" FOREIGN KEY ("organization_id","unit_id","installation_id") REFERENCES "public"."device_enrollments"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_payment_attempt_results_device_result_unique" ON "pos_payment_attempt_results" USING btree ("organization_id","unit_id","installation_id","device_result_id");--> statement-breakpoint
CREATE INDEX "pos_payment_attempt_results_attempt_idx" ON "pos_payment_attempt_results" USING btree ("organization_id","unit_id","attempt_id","received_at");--> statement-breakpoint
CREATE INDEX "pos_payment_attempts_tab_status_idx" ON "pos_payment_attempts" USING btree ("organization_id","unit_id","tab_id","status");--> statement-breakpoint
CREATE INDEX "pos_payment_attempts_installation_idx" ON "pos_payment_attempts" USING btree ("organization_id","unit_id","installation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_payment_attempts_provider_reference_unique" ON "pos_payment_attempts" USING btree ("organization_id","unit_id","provider","provider_reference") WHERE "pos_payment_attempts"."provider_reference" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pos_payment_reversals_payment_idx" ON "pos_payment_reversals" USING btree ("organization_id","unit_id","payment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_payment_reversals_one_active_unique" ON "pos_payment_reversals" USING btree ("organization_id","unit_id","payment_id") WHERE "pos_payment_reversals"."status" IN ('pending', 'processing', 'approved', 'unknown');--> statement-breakpoint
ALTER TABLE "pos_tab_payments" ADD CONSTRAINT "pos_tab_payments_attempt_fk" FOREIGN KEY ("organization_id","unit_id","payment_attempt_id") REFERENCES "public"."pos_payment_attempts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_tab_payments_attempt_unique" ON "pos_tab_payments" USING btree ("organization_id","unit_id","payment_attempt_id") WHERE "pos_tab_payments"."payment_attempt_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_tab_payments" ADD CONSTRAINT "pos_tab_payments_source_check" CHECK ("pos_tab_payments"."source" IN ('manual', 'terminal'));--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD CONSTRAINT "pos_terminal_profiles_payment_provider_check" CHECK ("pos_terminal_profiles"."payment_provider" IS NULL OR "pos_terminal_profiles"."payment_provider" IN ('rede', 'paygo', 'stone', 'getnet', 'cielo', 'pagbank'));--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD CONSTRAINT "pos_terminal_profiles_payment_status_check" CHECK ("pos_terminal_profiles"."payment_status" IN ('disabled', 'pending', 'homologated', 'suspended'));--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD CONSTRAINT "pos_terminal_profiles_payment_installments_check" CHECK ("pos_terminal_profiles"."max_payment_installments" BETWEEN 1 AND 24);