ALTER TABLE "subscriptions" ADD COLUMN "contracted_price_cents" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "payment_method" varchar(24);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "current_period_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "reconciliation_status" varchar(24) DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "reconciliation_error" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_contracted_price_check" CHECK ("subscriptions"."contracted_price_cents" IS NULL OR "subscriptions"."contracted_price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_current_period_check" CHECK ("subscriptions"."current_period_starts_at" IS NULL OR "subscriptions"."current_period_ends_at" IS NULL OR "subscriptions"."current_period_ends_at" > "subscriptions"."current_period_starts_at");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payment_method_check" CHECK ("subscriptions"."payment_method" IS NULL OR "subscriptions"."payment_method" IN ('credit_card', 'pix'));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_reconciliation_status_check" CHECK ("subscriptions"."reconciliation_status" IN ('not_required', 'pending', 'succeeded', 'failed'));--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_organization_current_unique" ON "subscriptions" USING btree ("organization_id") WHERE "state" <> 'canceled';--> statement-breakpoint

CREATE TABLE "billing_upgrade_quotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "subscription_id" uuid NOT NULL,
  "target_commercial_plan_id" uuid NOT NULL,
  "cycle" "billing_cycle" NOT NULL,
  "amount_cents" integer NOT NULL,
  "period_starts_at" timestamp with time zone NOT NULL,
  "period_ends_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "status" varchar(24) DEFAULT 'quoted' NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "billing_upgrade_quotes_amount_check" CHECK ("billing_upgrade_quotes"."amount_cents" > 0),
  CONSTRAINT "billing_upgrade_quotes_period_check" CHECK ("billing_upgrade_quotes"."period_ends_at" > "billing_upgrade_quotes"."period_starts_at"),
  CONSTRAINT "billing_upgrade_quotes_expiry_check" CHECK ("billing_upgrade_quotes"."expires_at" > "billing_upgrade_quotes"."created_at"),
  CONSTRAINT "billing_upgrade_quotes_status_check" CHECK ("billing_upgrade_quotes"."status" IN ('quoted', 'consumed', 'expired', 'canceled'))
);--> statement-breakpoint
ALTER TABLE "billing_upgrade_quotes" ADD CONSTRAINT "billing_upgrade_quotes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_upgrade_quotes" ADD CONSTRAINT "billing_upgrade_quotes_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_upgrade_quotes" ADD CONSTRAINT "billing_upgrade_quotes_target_commercial_plan_id_commercial_plans_id_fk" FOREIGN KEY ("target_commercial_plan_id") REFERENCES "public"."commercial_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_upgrade_quotes_org_idempotency_unique" ON "billing_upgrade_quotes" USING btree ("organization_id", "idempotency_key");--> statement-breakpoint
CREATE INDEX "billing_upgrade_quotes_subscription_idx" ON "billing_upgrade_quotes" USING btree ("subscription_id", "created_at");--> statement-breakpoint

ALTER TABLE "billing_checkouts" ALTER COLUMN "provider_checkout_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "target_commercial_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "upgrade_quote_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "intent" varchar(24) DEFAULT 'subscribe';--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "idempotency_key" varchar(160);--> statement-breakpoint
UPDATE "billing_checkouts" SET "idempotency_key" = 'legacy:' || "id"::text WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ALTER COLUMN "intent" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ALTER COLUMN "intent" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "amount_cents" integer;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "cycle" "billing_cycle";--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "payment_methods" jsonb DEFAULT '["credit_card", "pix"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "provider_checkout_url" text;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "reconciliation_status" varchar(24) DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "reconciliation_error" text;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_target_commercial_plan_id_commercial_plans_id_fk" FOREIGN KEY ("target_commercial_plan_id") REFERENCES "public"."commercial_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_upgrade_quote_id_billing_upgrade_quotes_id_fk" FOREIGN KEY ("upgrade_quote_id") REFERENCES "public"."billing_upgrade_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_intent_check" CHECK ("billing_checkouts"."intent" IN ('subscribe', 'regularize', 'upgrade'));--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_amount_check" CHECK ("billing_checkouts"."amount_cents" IS NULL OR "billing_checkouts"."amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_reconciliation_status_check" CHECK ("billing_checkouts"."reconciliation_status" IN ('not_required', 'pending', 'succeeded', 'failed'));--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkouts_org_idempotency_unique" ON "billing_checkouts" USING btree ("organization_id", "idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkouts_upgrade_quote_unique" ON "billing_checkouts" USING btree ("upgrade_quote_id");--> statement-breakpoint

ALTER TABLE "charges" ADD COLUMN "billing_checkout_id" uuid;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "payment_method" varchar(24);--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "payment_url" text;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_billing_checkout_id_billing_checkouts_id_fk" FOREIGN KEY ("billing_checkout_id") REFERENCES "public"."billing_checkouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_payment_method_check" CHECK ("charges"."payment_method" IS NULL OR "charges"."payment_method" IN ('credit_card', 'pix'));--> statement-breakpoint

ALTER TABLE "payment_events" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_events" ADD COLUMN "last_processing_error" text;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_processing_attempts_check" CHECK ("payment_events"."processing_attempts" >= 0);
