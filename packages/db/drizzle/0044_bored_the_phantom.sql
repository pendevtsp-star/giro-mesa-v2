CREATE TYPE "public"."management_time_tracking_low_accuracy_policy" AS ENUM('block', 'flag');--> statement-breakpoint
CREATE TYPE "public"."management_operational_loss_status" AS ENUM('pending', 'approved', 'rejected', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."management_operational_loss_type" AS ENUM('unpaid_tab', 'refund', 'chargeback', 'other');--> statement-breakpoint
CREATE TYPE "public"."management_partnership_reward_type" AS ENUM('percentage', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."management_settlement_status" AS ENUM('closed', 'approved', 'paid', 'canceled');--> statement-breakpoint
CREATE TABLE "management_operational_losses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"tab_id" uuid NOT NULL,
	"operational_shift_id" uuid,
	"responsible_identity_id" uuid,
	"type" "management_operational_loss_type" NOT NULL,
	"reason" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"service_charge_cents" integer DEFAULT 0 NOT NULL,
	"status" "management_operational_loss_status" DEFAULT 'pending' NOT NULL,
	"requested_by_identity_id" uuid NOT NULL,
	"reviewed_by_identity_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"reversed_by_identity_id" uuid,
	"reversed_at" timestamp with time zone,
	"reversal_note" text,
	"idempotency_key" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_operational_losses_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_operational_losses_amount_check" CHECK ("management_operational_losses"."amount_cents" > 0 and "management_operational_losses"."service_charge_cents" >= 0 and "management_operational_losses"."service_charge_cents" <= "management_operational_losses"."amount_cents"),
	CONSTRAINT "management_operational_losses_lifecycle_check" CHECK (("management_operational_losses"."status" = 'pending' and "management_operational_losses"."reviewed_at" is null and "management_operational_losses"."reviewed_by_identity_id" is null and "management_operational_losses"."reversed_at" is null and "management_operational_losses"."reversed_by_identity_id" is null) or ("management_operational_losses"."status" in ('approved','rejected') and "management_operational_losses"."reviewed_at" is not null and "management_operational_losses"."reviewed_by_identity_id" is not null and nullif(btrim("management_operational_losses"."review_note"), '') is not null and "management_operational_losses"."reversed_at" is null and "management_operational_losses"."reversed_by_identity_id" is null) or ("management_operational_losses"."status" = 'reversed' and "management_operational_losses"."reviewed_at" is not null and "management_operational_losses"."reviewed_by_identity_id" is not null and "management_operational_losses"."reversed_at" is not null and "management_operational_losses"."reversed_by_identity_id" is not null and nullif(btrim("management_operational_losses"."reversal_note"), '') is not null))
);
--> statement-breakpoint
CREATE TABLE "management_partnership_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"effective_from" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_partnership_plans_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "management_partnership_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"minimum_cents" integer NOT NULL,
	"maximum_cents" integer,
	"reward_type" "management_partnership_reward_type" NOT NULL,
	"reward_value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_partnership_tiers_position_unique" UNIQUE("organization_id","unit_id","plan_id","position"),
	CONSTRAINT "management_partnership_tiers_position_check" CHECK ("management_partnership_tiers"."position" >= 0),
	CONSTRAINT "management_partnership_tiers_range_check" CHECK ("management_partnership_tiers"."minimum_cents" >= 0 and ("management_partnership_tiers"."maximum_cents" is null or "management_partnership_tiers"."maximum_cents" >= "management_partnership_tiers"."minimum_cents")),
	CONSTRAINT "management_partnership_tiers_reward_check" CHECK ("management_partnership_tiers"."reward_value" >= 0 and ("management_partnership_tiers"."reward_type" <> 'percentage' or "management_partnership_tiers"."reward_value" <= 10000))
);
--> statement-breakpoint
CREATE TABLE "management_settlement_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"configuration" jsonb NOT NULL,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_settlement_settings_unit_unique" UNIQUE("organization_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "management_waiter_settlement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"gross_sales_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"canceled_cents" integer NOT NULL,
	"received_cents" integer NOT NULL,
	"service_charge_cents" integer NOT NULL,
	"service_share_cents" integer NOT NULL,
	"partnership_base_cents" integer NOT NULL,
	"partnership_cents" integer NOT NULL,
	"operational_loss_cents" integer DEFAULT 0 NOT NULL,
	"payable_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_waiter_settlement_lines_person_unique" UNIQUE("organization_id","unit_id","settlement_id","person_id"),
	CONSTRAINT "management_waiter_settlement_lines_totals_check" CHECK ("management_waiter_settlement_lines"."gross_sales_cents" >= 0 and "management_waiter_settlement_lines"."discount_cents" >= 0 and "management_waiter_settlement_lines"."canceled_cents" >= 0 and "management_waiter_settlement_lines"."received_cents" >= 0 and "management_waiter_settlement_lines"."service_charge_cents" >= 0 and "management_waiter_settlement_lines"."service_share_cents" >= 0 and "management_waiter_settlement_lines"."partnership_base_cents" >= 0 and "management_waiter_settlement_lines"."partnership_cents" >= 0 and "management_waiter_settlement_lines"."operational_loss_cents" >= 0 and "management_waiter_settlement_lines"."payable_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_waiter_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"aggregation_key" varchar(80) NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"status" "management_settlement_status" DEFAULT 'closed' NOT NULL,
	"configuration_snapshot" jsonb NOT NULL,
	"partnership_plan_id" uuid,
	"unassigned_gross_cents" integer DEFAULT 0 NOT NULL,
	"operational_loss_cents" integer DEFAULT 0 NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_identity_id" uuid,
	"approval_note" text,
	"paid_at" timestamp with time zone,
	"paid_by_identity_id" uuid,
	"payment_note" text,
	"canceled_at" timestamp with time zone,
	"canceled_by_identity_id" uuid,
	"cancellation_note" text,
	"idempotency_key" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_waiter_settlements_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_waiter_settlements_period_check" CHECK ("management_waiter_settlements"."period_to" >= "management_waiter_settlements"."period_from"),
	CONSTRAINT "management_waiter_settlements_totals_check" CHECK ("management_waiter_settlements"."unassigned_gross_cents" >= 0 and "management_waiter_settlements"."operational_loss_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" DROP CONSTRAINT "management_time_tracking_settings_radius_check";--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" DROP CONSTRAINT "management_time_tracking_settings_rules_check";--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "location_address" varchar(300);--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "max_location_accuracy_meters" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "low_accuracy_policy" "management_time_tracking_low_accuracy_policy" DEFAULT 'block' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "additional_locations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "offline_max_delay_minutes" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "offline_requires_justification" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "email_alerts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "location_retention_days" integer DEFAULT 365 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_operational_losses" ADD CONSTRAINT "management_operational_losses_responsible_identity_id_identities_id_fk" FOREIGN KEY ("responsible_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_operational_losses" ADD CONSTRAINT "management_operational_losses_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_operational_losses" ADD CONSTRAINT "management_operational_losses_reviewed_by_identity_id_identities_id_fk" FOREIGN KEY ("reviewed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_operational_losses" ADD CONSTRAINT "management_operational_losses_reversed_by_identity_id_identities_id_fk" FOREIGN KEY ("reversed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_operational_losses" ADD CONSTRAINT "management_operational_losses_tab_fk" FOREIGN KEY ("organization_id","unit_id","tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_operational_losses" ADD CONSTRAINT "management_operational_losses_shift_fk" FOREIGN KEY ("organization_id","unit_id","operational_shift_id") REFERENCES "public"."pos_operational_shifts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_partnership_plans" ADD CONSTRAINT "management_partnership_plans_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_partnership_plans" ADD CONSTRAINT "management_partnership_plans_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_partnership_tiers" ADD CONSTRAINT "management_partnership_tiers_plan_fk" FOREIGN KEY ("organization_id","unit_id","plan_id") REFERENCES "public"."management_partnership_plans"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_settlement_settings" ADD CONSTRAINT "management_settlement_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_settlement_settings" ADD CONSTRAINT "management_settlement_settings_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_settlement_settings" ADD CONSTRAINT "management_settlement_settings_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD CONSTRAINT "management_waiter_settlement_lines_settlement_fk" FOREIGN KEY ("organization_id","unit_id","settlement_id") REFERENCES "public"."management_waiter_settlements"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD CONSTRAINT "management_waiter_settlement_lines_person_fk" FOREIGN KEY ("organization_id","unit_id","person_id") REFERENCES "public"."management_people"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlements" ADD CONSTRAINT "management_waiter_settlements_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlements" ADD CONSTRAINT "management_waiter_settlements_approved_by_identity_id_identities_id_fk" FOREIGN KEY ("approved_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlements" ADD CONSTRAINT "management_waiter_settlements_paid_by_identity_id_identities_id_fk" FOREIGN KEY ("paid_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlements" ADD CONSTRAINT "management_waiter_settlements_canceled_by_identity_id_identities_id_fk" FOREIGN KEY ("canceled_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlements" ADD CONSTRAINT "management_waiter_settlements_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlements" ADD CONSTRAINT "management_waiter_settlements_plan_fk" FOREIGN KEY ("organization_id","unit_id","partnership_plan_id") REFERENCES "public"."management_partnership_plans"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_operational_losses_idempotency_unique" ON "management_operational_losses" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_operational_losses_tab_idx" ON "management_operational_losses" USING btree ("organization_id","unit_id","tab_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "management_partnership_plans_effective_unique" ON "management_partnership_plans" USING btree ("organization_id","unit_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "management_waiter_settlements_period_unique" ON "management_waiter_settlements" USING btree ("organization_id","aggregation_key","period_from","period_to");--> statement-breakpoint
CREATE UNIQUE INDEX "management_waiter_settlements_idempotency_unique" ON "management_waiter_settlements" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD CONSTRAINT "management_time_tracking_settings_radius_check" CHECK ("management_time_tracking_settings"."radius_meters" between 25 and 5000 and "management_time_tracking_settings"."accuracy_tolerance_meters" between 0 and 500 and "management_time_tracking_settings"."max_location_accuracy_meters" between 5 and 2000);--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD CONSTRAINT "management_time_tracking_settings_rules_check" CHECK ("management_time_tracking_settings"."late_tolerance_minutes" between 0 and 120 and "management_time_tracking_settings"."minimum_break_minutes" between 0 and 1440 and "management_time_tracking_settings"."max_overtime_minutes" between 0 and 720 and "management_time_tracking_settings"."long_shift_alert_minutes" between 60 and 1440 and "management_time_tracking_settings"."reminder_before_shift_minutes" between 0 and 240 and "management_time_tracking_settings"."reminder_after_shift_minutes" between 0 and 240 and "management_time_tracking_settings"."offline_max_delay_minutes" between 5 and 2880 and "management_time_tracking_settings"."location_retention_days" between 30 and 1825);