CREATE TYPE "public"."management_report_delivery" AS ENUM('in_app', 'email');--> statement-breakpoint
CREATE TYPE "public"."management_report_export_format" AS ENUM('csv');--> statement-breakpoint
CREATE TYPE "public"."management_report_export_status" AS ENUM('ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."management_report_frequency" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."management_report_range" AS ENUM('previous_week', 'previous_month');--> statement-breakpoint
CREATE TYPE "public"."management_time_tracking_closure_status" AS ENUM('closed');--> statement-breakpoint
CREATE TABLE "management_report_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"month" date NOT NULL,
	"metric" varchar(80) NOT NULL,
	"target_cents" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_report_budgets_month_check" CHECK ("management_report_budgets"."month" = date_trunc('month', "management_report_budgets"."month")::date),
	CONSTRAINT "management_report_budgets_target_check" CHECK ("management_report_budgets"."target_cents" >= 0),
	CONSTRAINT "management_report_budgets_version_check" CHECK ("management_report_budgets"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "management_report_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"schedule_id" uuid,
	"idempotency_key" varchar(160) NOT NULL,
	"query" jsonb NOT NULL,
	"content" text,
	"status" "management_report_export_status" NOT NULL,
	"format" "management_report_export_format" DEFAULT 'csv' NOT NULL,
	"sha256" varchar(64),
	"row_count" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(120),
	"requested_by_identity_id" uuid,
	"scheduled_for" timestamp with time zone,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "management_report_exports_row_count_check" CHECK ("management_report_exports"."row_count" >= 0),
	CONSTRAINT "management_report_exports_completion_check" CHECK (("management_report_exports"."status" = 'ready' and "management_report_exports"."content" is not null and "management_report_exports"."sha256" is not null and "management_report_exports"."completed_at" is not null and "management_report_exports"."error_code" is null) or ("management_report_exports"."status" = 'failed' and "management_report_exports"."content" is null and "management_report_exports"."sha256" is null and "management_report_exports"."completed_at" is not null and "management_report_exports"."error_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "management_report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"frequency" "management_report_frequency" NOT NULL,
	"weekday" integer,
	"day_of_month" integer,
	"local_time" time NOT NULL,
	"range" "management_report_range" NOT NULL,
	"comparison_mode" varchar(32) DEFAULT 'previous_period' NOT NULL,
	"delivery" "management_report_delivery" NOT NULL,
	"recipient_identity_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_report_schedules_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_report_schedules_recurrence_check" CHECK (("management_report_schedules"."frequency" = 'weekly' and "management_report_schedules"."weekday" between 0 and 6 and "management_report_schedules"."day_of_month" is null) or ("management_report_schedules"."frequency" = 'monthly' and "management_report_schedules"."day_of_month" between 1 and 31 and "management_report_schedules"."weekday" is null)),
	CONSTRAINT "management_report_schedules_delivery_check" CHECK ("management_report_schedules"."delivery" <> 'email' or "management_report_schedules"."recipient_identity_id" is not null),
	CONSTRAINT "management_report_schedules_version_check" CHECK ("management_report_schedules"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "management_time_tracking_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "management_time_tracking_closure_status" DEFAULT 'closed' NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by_identity_id" uuid NOT NULL,
	"reason" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_time_tracking_closure_window_check" CHECK ("management_time_tracking_closures"."period_end" >= "management_time_tracking_closures"."period_start")
);
--> statement-breakpoint
DROP INDEX IF EXISTS "management_returnable_incidents_movement_unique";--> statement-breakpoint
ALTER TABLE "growth_delivery_couriers" ADD COLUMN IF NOT EXISTS "request_fingerprint" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_corrections" ADD COLUMN "requires_special_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_in_server_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_in_device_id" varchar(160);--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_in_ip_address" varchar(64);--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_in_user_agent" varchar(512);--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_in_flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_out_server_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_out_device_id" varchar(160);--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_out_ip_address" varchar(64);--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_out_user_agent" varchar(512);--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_out_flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "start_server_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "start_device_id" varchar(160);--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "start_ip_address" varchar(64);--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "start_user_agent" varchar(512);--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "start_flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "end_server_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "end_device_id" varchar(160);--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "end_ip_address" varchar(64);--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "end_user_agent" varchar(512);--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "end_flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "anti_fraud_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "offline_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "manager_alert_on_anomaly" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "late_tolerance_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "minimum_break_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "max_overtime_minutes" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "long_shift_alert_minutes" integer DEFAULT 720 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "reminder_before_shift_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD COLUMN "reminder_after_shift_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_report_budgets" ADD CONSTRAINT "management_report_budgets_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_budgets" ADD CONSTRAINT "management_report_budgets_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_budgets" ADD CONSTRAINT "management_report_budgets_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_exports" ADD CONSTRAINT "management_report_exports_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_exports" ADD CONSTRAINT "management_report_exports_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_exports" ADD CONSTRAINT "management_report_exports_schedule_fk" FOREIGN KEY ("organization_id","unit_id","schedule_id") REFERENCES "public"."management_report_schedules"("organization_id","unit_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_schedules" ADD CONSTRAINT "management_report_schedules_recipient_identity_id_identities_id_fk" FOREIGN KEY ("recipient_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_schedules" ADD CONSTRAINT "management_report_schedules_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_schedules" ADD CONSTRAINT "management_report_schedules_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_schedules" ADD CONSTRAINT "management_report_schedules_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_time_tracking_closures" ADD CONSTRAINT "management_time_tracking_closures_closed_by_identity_id_identities_id_fk" FOREIGN KEY ("closed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_time_tracking_closures" ADD CONSTRAINT "management_time_tracking_closure_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_report_budgets_scope_month_metric_unique" ON "management_report_budgets" USING btree ("organization_id","unit_id","month","metric");--> statement-breakpoint
CREATE UNIQUE INDEX "management_report_exports_idempotency_unique" ON "management_report_exports" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_report_exports_expiry_idx" ON "management_report_exports" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "management_report_schedules_due_idx" ON "management_report_schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_time_tracking_closure_period_unique" ON "management_time_tracking_closures" USING btree ("organization_id","unit_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "management_time_tracking_closure_scope_idx" ON "management_time_tracking_closures" USING btree ("organization_id","unit_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "management_returnable_incidents_movement_idx" ON "management_returnable_incidents" USING btree ("organization_id","unit_id","custody_movement_id");--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD CONSTRAINT "management_inventory_items_kind_product_check" CHECK (("management_inventory_items"."kind" = 'resale' and "management_inventory_items"."product_id" is not null) or ("management_inventory_items"."kind" <> 'resale' and "management_inventory_items"."product_id" is null));--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD CONSTRAINT "management_time_tracking_settings_rules_check" CHECK ("management_time_tracking_settings"."late_tolerance_minutes" between 0 and 120 and "management_time_tracking_settings"."minimum_break_minutes" between 0 and 1440 and "management_time_tracking_settings"."max_overtime_minutes" between 0 and 720 and "management_time_tracking_settings"."long_shift_alert_minutes" between 60 and 1440 and "management_time_tracking_settings"."reminder_before_shift_minutes" between 0 and 240 and "management_time_tracking_settings"."reminder_after_shift_minutes" between 0 and 240);
