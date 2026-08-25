ALTER TYPE "public"."pos_print_document_type" ADD VALUE IF NOT EXISTS 'kds_ticket';--> statement-breakpoint
CREATE TYPE "public"."pos_production_delivery_mode" AS ENUM('kds_only', 'printer_only', 'both', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."pos_printer_apply_status" AS ENUM('pending', 'applied', 'error');--> statement-breakpoint
CREATE TYPE "public"."pos_printer_health_status" AS ENUM('unknown', 'pending', 'online', 'error', 'confirmation_required');--> statement-breakpoint
ALTER TABLE "hub_heartbeats" DROP CONSTRAINT "hub_heartbeats_pkey";--> statement-breakpoint
ALTER TABLE "hub_heartbeats" ADD CONSTRAINT "hub_heartbeats_pkey" PRIMARY KEY("unit_id", "hub_id");--> statement-breakpoint
CREATE TABLE "pos_production_printers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"hub_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"host" varchar(45) NOT NULL,
	"port" integer DEFAULT 9100 NOT NULL,
	"paper_width_mm" integer DEFAULT 80 NOT NULL,
	"characters_per_line" integer DEFAULT 48 NOT NULL,
	"code_table" integer DEFAULT 16 NOT NULL,
	"cut" boolean DEFAULT true NOT NULL,
	"supports_raster_graphics" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"document_types" jsonb DEFAULT '["kds_ticket"]'::jsonb NOT NULL,
	"fallback_printer_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"applied_revision" integer,
	"apply_status" "pos_printer_apply_status" DEFAULT 'pending' NOT NULL,
	"pending_command_id" uuid,
	"last_applied_at" timestamp with time zone,
	"last_test_command_id" uuid,
	"last_test_at" timestamp with time zone,
	"last_status" "pos_printer_health_status" DEFAULT 'unknown' NOT NULL,
	"last_error" varchar(500),
	"created_by_identity_id" uuid NOT NULL,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_production_printers_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
	CONSTRAINT "pos_production_printers_port_check" CHECK ("port" BETWEEN 1 AND 65535),
	CONSTRAINT "pos_production_printers_paper_width_check" CHECK ("paper_width_mm" IN (58, 80)),
	CONSTRAINT "pos_production_printers_characters_check" CHECK ("characters_per_line" BETWEEN 24 AND 64),
	CONSTRAINT "pos_production_printers_code_table_check" CHECK ("code_table" BETWEEN 0 AND 255),
	CONSTRAINT "pos_production_printers_revision_check" CHECK ("revision" > 0),
	CONSTRAINT "pos_production_printers_applied_revision_check" CHECK ("applied_revision" IS NULL OR ("applied_revision" > 0 AND "applied_revision" <= "revision")),
	CONSTRAINT "pos_production_printers_fallback_check" CHECK ("fallback_printer_id" IS NULL OR "fallback_printer_id" <> "id")
);--> statement-breakpoint
ALTER TABLE "pos_production_printers" ADD CONSTRAINT "pos_production_printers_unit_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "public"."units"("organization_id", "id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_production_printers" ADD CONSTRAINT "pos_production_printers_hub_fk" FOREIGN KEY ("organization_id", "unit_id", "hub_id") REFERENCES "public"."device_enrollments"("organization_id", "unit_id", "id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_production_printers" ADD CONSTRAINT "pos_production_printers_fallback_fk" FOREIGN KEY ("organization_id", "unit_id", "fallback_printer_id") REFERENCES "public"."pos_production_printers"("organization_id", "unit_id", "id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_production_printers" ADD CONSTRAINT "pos_production_printers_pending_command_fk" FOREIGN KEY ("pending_command_id") REFERENCES "public"."hub_commands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_production_printers" ADD CONSTRAINT "pos_production_printers_last_test_command_fk" FOREIGN KEY ("last_test_command_id") REFERENCES "public"."hub_commands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_production_printers" ADD CONSTRAINT "pos_production_printers_created_by_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_production_printers" ADD CONSTRAINT "pos_production_printers_updated_by_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_production_printers_default_unique" ON "pos_production_printers" USING btree ("organization_id", "unit_id", "hub_id") WHERE "is_default" = true AND "active" = true;--> statement-breakpoint
CREATE INDEX "pos_production_printers_unit_idx" ON "pos_production_printers" USING btree ("organization_id", "unit_id", "active");--> statement-breakpoint
ALTER TABLE "pos_production_stations" ADD COLUMN "delivery_mode" "pos_production_delivery_mode" DEFAULT 'kds_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_production_stations" ADD COLUMN "print_copies" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_production_stations" ADD COLUMN "print_printer_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_production_stations" ADD CONSTRAINT "pos_stations_print_printer_fk" FOREIGN KEY ("organization_id", "unit_id", "print_printer_id") REFERENCES "public"."pos_production_printers"("organization_id", "unit_id", "id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_production_stations" ADD CONSTRAINT "pos_stations_print_copies_check" CHECK ("print_copies" BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE "pos_production_stations" ADD CONSTRAINT "pos_stations_print_policy_check" CHECK ((("delivery_mode" IN ('printer_only', 'both') AND "print_printer_id" IS NOT NULL) OR ("delivery_mode" IN ('kds_only', 'disabled') AND "print_printer_id" IS NULL)));--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD COLUMN "station_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD COLUMN "kds_ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD COLUMN "hub_command_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD COLUMN "dispatch_key" varchar(200);--> statement-breakpoint
ALTER TABLE "hub_commands" ADD CONSTRAINT "hub_commands_scope_id_unique" UNIQUE("organization_id", "unit_id", "id");--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD CONSTRAINT "pos_print_jobs_station_fk" FOREIGN KEY ("organization_id", "unit_id", "station_id") REFERENCES "public"."pos_production_stations"("organization_id", "unit_id", "id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD CONSTRAINT "pos_print_jobs_kds_ticket_fk" FOREIGN KEY ("organization_id", "unit_id", "kds_ticket_id") REFERENCES "public"."pos_kds_tickets"("organization_id", "unit_id", "id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD CONSTRAINT "pos_print_jobs_hub_command_fk" FOREIGN KEY ("organization_id", "unit_id", "hub_command_id") REFERENCES "public"."hub_commands"("organization_id", "unit_id", "id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD CONSTRAINT "pos_print_jobs_production_scope_check" CHECK (("station_id" IS NULL AND "kds_ticket_id" IS NULL) OR ("station_id" IS NOT NULL AND "kds_ticket_id" IS NOT NULL));--> statement-breakpoint
CREATE INDEX "pos_print_jobs_station_idx" ON "pos_print_jobs" USING btree ("organization_id", "unit_id", "station_id", "status", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_print_jobs_dispatch_unique" ON "pos_print_jobs" USING btree ("organization_id", "unit_id", "dispatch_key") WHERE "dispatch_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_print_jobs_hub_command_unique" ON "pos_print_jobs" USING btree ("organization_id", "unit_id", "hub_command_id") WHERE "hub_command_id" IS NOT NULL;
