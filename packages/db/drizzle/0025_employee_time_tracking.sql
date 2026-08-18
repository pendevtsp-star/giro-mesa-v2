CREATE TYPE "public"."management_time_tracking_mode" AS ENUM('off', 'all', 'selected');--> statement-breakpoint
CREATE TYPE "public"."management_break_type" AS ENUM('meal', 'temporary');--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_in_latitude" double precision;--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_in_longitude" double precision;--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_in_accuracy_meters" integer;--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_out_latitude" double precision;--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_out_longitude" double precision;--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_out_accuracy_meters" integer;--> statement-breakpoint
CREATE TABLE "management_time_tracking_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"mode" "management_time_tracking_mode" DEFAULT 'off' NOT NULL,
	"geofence_enabled" boolean DEFAULT true NOT NULL,
	"location_label" varchar(160),
	"latitude" double precision,
	"longitude" double precision,
	"radius_meters" integer DEFAULT 100 NOT NULL,
	"accuracy_tolerance_meters" integer DEFAULT 50 NOT NULL,
	"manager_can_view" boolean DEFAULT false NOT NULL,
	"finance_can_view" boolean DEFAULT false NOT NULL,
	"updated_by_identity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_time_tracking_settings_radius_check" CHECK ("management_time_tracking_settings"."radius_meters" between 25 and 5000 and "management_time_tracking_settings"."accuracy_tolerance_meters" between 0 and 500),
	CONSTRAINT "management_time_tracking_settings_coordinates_check" CHECK (("management_time_tracking_settings"."latitude" is null and "management_time_tracking_settings"."longitude" is null) or ("management_time_tracking_settings"."latitude" between -90 and 90 and "management_time_tracking_settings"."longitude" between -180 and 180))
);--> statement-breakpoint
CREATE UNIQUE INDEX "management_time_tracking_settings_unit_unique" ON "management_time_tracking_settings" USING btree ("organization_id", "unit_id");--> statement-breakpoint
CREATE TABLE "management_time_tracking_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by_identity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "management_time_tracking_assignment_person_unique" ON "management_time_tracking_assignments" USING btree ("organization_id", "unit_id", "person_id");--> statement-breakpoint
CREATE TABLE "management_time_entry_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"type" "management_break_type" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"start_latitude" double precision,
	"start_longitude" double precision,
	"start_accuracy_meters" integer,
	"end_latitude" double precision,
	"end_longitude" double precision,
	"end_accuracy_meters" integer,
	"idempotency_key" varchar(160) NOT NULL,
	"recorded_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_time_entry_break_window_check" CHECK ("management_time_entry_breaks"."ended_at" is null or "management_time_entry_breaks"."ended_at" > "management_time_entry_breaks"."started_at"),
	CONSTRAINT "management_time_entry_break_accuracy_check" CHECK (("management_time_entry_breaks"."start_accuracy_meters" is null or "management_time_entry_breaks"."start_accuracy_meters" >= 0) and ("management_time_entry_breaks"."end_accuracy_meters" is null or "management_time_entry_breaks"."end_accuracy_meters" >= 0))
);--> statement-breakpoint
CREATE UNIQUE INDEX "management_time_entry_break_idempotency_unique" ON "management_time_entry_breaks" USING btree ("organization_id", "unit_id", "idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_time_entry_break_one_open_unique" ON "management_time_entry_breaks" USING btree ("organization_id", "unit_id", "time_entry_id") WHERE "management_time_entry_breaks"."ended_at" is null;--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD CONSTRAINT "management_time_entries_scope_id_unique" UNIQUE("organization_id","unit_id","id");--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD CONSTRAINT "management_time_tracking_settings_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD CONSTRAINT "management_time_tracking_settings_updated_by_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_time_tracking_assignments" ADD CONSTRAINT "management_time_tracking_assignment_unit_fk" FOREIGN KEY ("organization_id","unit_id","person_id") REFERENCES "public"."management_people"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_time_tracking_assignments" ADD CONSTRAINT "management_time_tracking_assignment_updated_by_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD CONSTRAINT "management_time_entry_break_entry_fk" FOREIGN KEY ("organization_id","unit_id","time_entry_id") REFERENCES "public"."management_time_entries"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD CONSTRAINT "management_time_entry_break_recorded_by_fk" FOREIGN KEY ("recorded_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
