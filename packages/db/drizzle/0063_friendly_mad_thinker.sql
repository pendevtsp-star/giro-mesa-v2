CREATE TYPE "public"."management_finance_approval_status" AS ENUM('pending', 'approved', 'rejected', 'executed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."management_financial_payment_status" AS ENUM('posted', 'reversed');--> statement-breakpoint
CREATE TABLE "growth_pos_tab_customer_links" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"tab_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"linked_by_identity_id" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_pos_tab_customer_link_tab_unique" UNIQUE("organization_id","unit_id","tab_id")
);
--> statement-breakpoint
CREATE TABLE "management_finance_approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"direction" varchar(16) NOT NULL,
	"payable_id" uuid,
	"receivable_id" uuid,
	"amount_cents" integer NOT NULL,
	"method" varchar(32) NOT NULL,
	"reference" varchar(160),
	"cash_register_id" uuid,
	"occurred_at" timestamp with time zone,
	"status" "management_finance_approval_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"requested_by_identity_id" uuid NOT NULL,
	"decided_by_identity_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"executed_payment_id" uuid,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_finance_approvals_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_finance_approvals_amount_check" CHECK ("management_finance_approval_requests"."amount_cents" > 0),
	CONSTRAINT "management_finance_approvals_target_check" CHECK (("management_finance_approval_requests"."direction" = 'payable' and "management_finance_approval_requests"."payable_id" is not null and "management_finance_approval_requests"."receivable_id" is null) or ("management_finance_approval_requests"."direction" = 'receivable' and "management_finance_approval_requests"."receivable_id" is not null and "management_finance_approval_requests"."payable_id" is null)),
	CONSTRAINT "management_finance_approvals_state_check" CHECK (("management_finance_approval_requests"."status" = 'pending' and "management_finance_approval_requests"."decided_by_identity_id" is null and "management_finance_approval_requests"."decided_at" is null and "management_finance_approval_requests"."executed_payment_id" is null and "management_finance_approval_requests"."executed_at" is null) or ("management_finance_approval_requests"."status" in ('approved','rejected') and "management_finance_approval_requests"."decided_by_identity_id" is not null and "management_finance_approval_requests"."decided_at" is not null and "management_finance_approval_requests"."executed_payment_id" is null and "management_finance_approval_requests"."executed_at" is null) or ("management_finance_approval_requests"."status" = 'executed' and "management_finance_approval_requests"."decided_by_identity_id" is not null and "management_finance_approval_requests"."decided_at" is not null and "management_finance_approval_requests"."executed_payment_id" is not null and "management_finance_approval_requests"."executed_at" is not null) or ("management_finance_approval_requests"."status" = 'canceled' and "management_finance_approval_requests"."executed_payment_id" is null and "management_finance_approval_requests"."executed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "management_finance_settings" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"payment_approval_threshold_cents" integer,
	"require_distinct_approver" boolean DEFAULT true NOT NULL,
	"due_soon_days" integer DEFAULT 7 NOT NULL,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_finance_settings_organization_id_unit_id_pk" PRIMARY KEY("organization_id","unit_id"),
	CONSTRAINT "management_finance_settings_threshold_check" CHECK ("management_finance_settings"."payment_approval_threshold_cents" is null or "management_finance_settings"."payment_approval_threshold_cents" > 0),
	CONSTRAINT "management_finance_settings_due_soon_check" CHECK ("management_finance_settings"."due_soon_days" between 1 and 90)
);
--> statement-breakpoint
ALTER TABLE "growth_customers" ADD COLUMN "notes" varchar(1000);--> statement-breakpoint
ALTER TABLE "growth_customers" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "growth_customers" ADD COLUMN "email_marketing_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "growth_customers" ADD COLUMN "whatsapp_marketing_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "growth_customers" ADD COLUMN "merged_into_customer_id" uuid;--> statement-breakpoint
UPDATE "growth_customers" customer
SET "email_marketing_opt_in" = coalesce((
	SELECT consent."decision" = 'granted'
	FROM "growth_customer_consents" consent
	WHERE consent."organization_id" = customer."organization_id"
		AND consent."customer_id" = customer."id"
		AND consent."purpose" = 'marketing'
		AND consent."channel" IN ('email', 'all')
	ORDER BY consent."occurred_at" DESC, consent."id" DESC
	LIMIT 1
), false);--> statement-breakpoint
UPDATE "growth_customers" customer
SET "whatsapp_marketing_opt_in" = coalesce((
	SELECT consent."decision" = 'granted'
	FROM "growth_customer_consents" consent
	WHERE consent."organization_id" = customer."organization_id"
		AND consent."customer_id" = customer."id"
		AND consent."purpose" = 'marketing'
		AND consent."channel" IN ('whatsapp', 'all')
	ORDER BY consent."occurred_at" DESC, consent."id" DESC
	LIMIT 1
), false);--> statement-breakpoint
UPDATE "growth_customers"
SET "marketing_opt_in" = "email_marketing_opt_in" OR "whatsapp_marketing_opt_in";--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD COLUMN "category" varchar(80);--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD COLUMN "cost_center" varchar(80);--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD COLUMN "document_number" varchar(80);--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD COLUMN "recurrence_group_id" uuid;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD COLUMN "installment_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD COLUMN "installment_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD COLUMN "created_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD COLUMN "canceled_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD COLUMN "category" varchar(80);--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD COLUMN "cost_center" varchar(80);--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD COLUMN "document_number" varchar(80);--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD COLUMN "recurrence_group_id" uuid;--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD COLUMN "installment_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD COLUMN "installment_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD COLUMN "created_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD COLUMN "canceled_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "management_payable_payments" ADD COLUMN "status" "management_financial_payment_status" DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_payable_payments" ADD COLUMN "reversed_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_payable_payments" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_payable_payments" ADD COLUMN "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "management_receivable_payments" ADD COLUMN "status" "management_financial_payment_status" DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_receivable_payments" ADD COLUMN "reversed_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_receivable_payments" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_receivable_payments" ADD COLUMN "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "management_reconciliation_entries" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "growth_pos_tab_customer_links" ADD CONSTRAINT "growth_pos_tab_customer_links_linked_by_identity_id_identities_id_fk" FOREIGN KEY ("linked_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_pos_tab_customer_links" ADD CONSTRAINT "growth_pos_tab_customer_link_tab_fk" FOREIGN KEY ("organization_id","unit_id","tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_pos_tab_customer_links" ADD CONSTRAINT "growth_pos_tab_customer_link_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."growth_customers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_finance_approval_requests" ADD CONSTRAINT "management_finance_approval_requests_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_finance_approval_requests" ADD CONSTRAINT "management_finance_approval_requests_decided_by_identity_id_identities_id_fk" FOREIGN KEY ("decided_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_finance_approval_requests" ADD CONSTRAINT "management_finance_approvals_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_finance_approval_requests" ADD CONSTRAINT "management_finance_approvals_payable_fk" FOREIGN KEY ("organization_id","unit_id","payable_id") REFERENCES "public"."management_accounts_payable"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_finance_approval_requests" ADD CONSTRAINT "management_finance_approvals_receivable_fk" FOREIGN KEY ("organization_id","unit_id","receivable_id") REFERENCES "public"."management_accounts_receivable"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_finance_approval_requests" ADD CONSTRAINT "management_finance_approvals_cash_register_fk" FOREIGN KEY ("organization_id","unit_id","cash_register_id") REFERENCES "public"."management_cash_registers"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_finance_settings" ADD CONSTRAINT "management_finance_settings_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_finance_settings" ADD CONSTRAINT "management_finance_settings_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "growth_pos_tab_customer_link_customer_idx" ON "growth_pos_tab_customer_links" USING btree ("organization_id","customer_id","linked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_finance_approvals_idempotency_unique" ON "management_finance_approval_requests" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_finance_approvals_status_idx" ON "management_finance_approval_requests" USING btree ("organization_id","unit_id","status","created_at");--> statement-breakpoint
ALTER TABLE "growth_customers" ADD CONSTRAINT "growth_customer_merge_tenant_fk" FOREIGN KEY ("organization_id","merged_into_customer_id") REFERENCES "public"."growth_customers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD CONSTRAINT "management_accounts_payable_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD CONSTRAINT "management_accounts_payable_canceled_by_identity_id_identities_id_fk" FOREIGN KEY ("canceled_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD CONSTRAINT "management_accounts_receivable_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD CONSTRAINT "management_accounts_receivable_canceled_by_identity_id_identities_id_fk" FOREIGN KEY ("canceled_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_payable_payments" ADD CONSTRAINT "management_payable_payments_reversed_by_identity_id_identities_id_fk" FOREIGN KEY ("reversed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_receivable_payments" ADD CONSTRAINT "management_receivable_payments_reversed_by_identity_id_identities_id_fk" FOREIGN KEY ("reversed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "growth_customers_org_phone_idx" ON "growth_customers" USING btree ("organization_id","phone");--> statement-breakpoint
ALTER TABLE "growth_customers" ADD CONSTRAINT "growth_customer_merge_archive_check" CHECK ("growth_customers"."merged_into_customer_id" is null or "growth_customers"."archived_at" is not null);--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD CONSTRAINT "management_payables_installment_check" CHECK ("management_accounts_payable"."installment_number" > 0 and "management_accounts_payable"."installment_count" > 0 and "management_accounts_payable"."installment_number" <= "management_accounts_payable"."installment_count");--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD CONSTRAINT "management_payables_cancellation_check" CHECK (("management_accounts_payable"."status" <> 'canceled' and "management_accounts_payable"."canceled_at" is null and "management_accounts_payable"."canceled_by_identity_id" is null and "management_accounts_payable"."cancellation_reason" is null) or ("management_accounts_payable"."status" = 'canceled' and "management_accounts_payable"."canceled_at" is not null and "management_accounts_payable"."canceled_by_identity_id" is not null and nullif(btrim("management_accounts_payable"."cancellation_reason"), '') is not null));--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD CONSTRAINT "management_receivables_installment_check" CHECK ("management_accounts_receivable"."installment_number" > 0 and "management_accounts_receivable"."installment_count" > 0 and "management_accounts_receivable"."installment_number" <= "management_accounts_receivable"."installment_count");--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD CONSTRAINT "management_receivables_cancellation_check" CHECK (("management_accounts_receivable"."status" <> 'canceled' and "management_accounts_receivable"."canceled_at" is null and "management_accounts_receivable"."canceled_by_identity_id" is null and "management_accounts_receivable"."cancellation_reason" is null) or ("management_accounts_receivable"."status" = 'canceled' and "management_accounts_receivable"."canceled_at" is not null and "management_accounts_receivable"."canceled_by_identity_id" is not null and nullif(btrim("management_accounts_receivable"."cancellation_reason"), '') is not null));--> statement-breakpoint
ALTER TABLE "management_payable_payments" ADD CONSTRAINT "management_payable_payments_reversal_check" CHECK (("management_payable_payments"."status" = 'posted' and "management_payable_payments"."reversed_by_identity_id" is null and "management_payable_payments"."reversed_at" is null and "management_payable_payments"."reversal_reason" is null) or ("management_payable_payments"."status" = 'reversed' and "management_payable_payments"."reversed_by_identity_id" is not null and "management_payable_payments"."reversed_at" is not null and nullif(btrim("management_payable_payments"."reversal_reason"), '') is not null));--> statement-breakpoint
ALTER TABLE "management_receivable_payments" ADD CONSTRAINT "management_receivable_payments_reversal_check" CHECK (("management_receivable_payments"."status" = 'posted' and "management_receivable_payments"."reversed_by_identity_id" is null and "management_receivable_payments"."reversed_at" is null and "management_receivable_payments"."reversal_reason" is null) or ("management_receivable_payments"."status" = 'reversed' and "management_receivable_payments"."reversed_by_identity_id" is not null and "management_receivable_payments"."reversed_at" is not null and nullif(btrim("management_receivable_payments"."reversal_reason"), '') is not null));
