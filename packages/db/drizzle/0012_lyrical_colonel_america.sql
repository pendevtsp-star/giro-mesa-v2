CREATE TYPE "public"."pos_fulfillment_type" AS ENUM('dine_in', 'pickup', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."pos_order_course" AS ENUM('anytime', 'starter', 'main', 'dessert');--> statement-breakpoint
CREATE TYPE "public"."pos_payment_method" AS ENUM('cash', 'credit_card', 'debit_card', 'pix', 'other');--> statement-breakpoint
CREATE TYPE "public"."pos_service_call_kind" AS ENUM('assistance', 'bill', 'water', 'other');--> statement-breakpoint
CREATE TYPE "public"."pos_service_call_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TABLE "pos_service_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"tab_id" uuid,
	"kind" "pos_service_call_kind" DEFAULT 'assistance' NOT NULL,
	"status" "pos_service_call_status" DEFAULT 'open' NOT NULL,
	"sla_minutes" integer DEFAULT 3 NOT NULL,
	"acknowledged_by_identity_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"resolved_by_identity_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_service_calls_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_service_calls_sla_check" CHECK ("pos_service_calls"."sla_minutes" BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE TABLE "pos_tab_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"tab_id" uuid NOT NULL,
	"method" "pos_payment_method" NOT NULL,
	"amount_cents" integer NOT NULL,
	"reference" varchar(120),
	"created_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_tab_payments_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_tab_payments_amount_check" CHECK ("pos_tab_payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "pos_tab_presence" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"tab_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_tab_presence_organization_id_unit_id_tab_id_identity_id_pk" PRIMARY KEY("organization_id","unit_id","tab_id","identity_id")
);
--> statement-breakpoint
ALTER TABLE "pos_dining_tables" DROP CONSTRAINT "pos_tables_layout_check";--> statement-breakpoint
ALTER TABLE "pos_dining_rooms" ADD COLUMN "responsible_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_order_items" ADD COLUMN "seat_number" integer;--> statement-breakpoint
ALTER TABLE "pos_order_items" ADD COLUMN "course" "pos_order_course" DEFAULT 'anytime' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_order_items" ADD COLUMN "allergy_note" text;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "responsible_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "display_number" integer;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "fulfillment_type" "pos_fulfillment_type" DEFAULT 'dine_in' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "customer_name" varchar(120);--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "customer_phone" varchar(30);--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "delivery_address" text;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "promised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "ready_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_service_calls" ADD CONSTRAINT "pos_service_calls_acknowledged_by_identity_id_identities_id_fk" FOREIGN KEY ("acknowledged_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_service_calls" ADD CONSTRAINT "pos_service_calls_resolved_by_identity_id_identities_id_fk" FOREIGN KEY ("resolved_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_service_calls" ADD CONSTRAINT "pos_service_calls_table_fk" FOREIGN KEY ("organization_id","unit_id","table_id") REFERENCES "public"."pos_dining_tables"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_service_calls" ADD CONSTRAINT "pos_service_calls_tab_fk" FOREIGN KEY ("organization_id","unit_id","tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tab_payments" ADD CONSTRAINT "pos_tab_payments_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tab_payments" ADD CONSTRAINT "pos_tab_payments_tab_fk" FOREIGN KEY ("organization_id","unit_id","tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tab_presence" ADD CONSTRAINT "pos_tab_presence_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tab_presence" ADD CONSTRAINT "pos_tab_presence_tab_fk" FOREIGN KEY ("organization_id","unit_id","tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_service_calls_active_idx" ON "pos_service_calls" USING btree ("organization_id","unit_id","status","created_at");--> statement-breakpoint
CREATE INDEX "pos_tab_payments_tab_idx" ON "pos_tab_payments" USING btree ("organization_id","unit_id","tab_id");--> statement-breakpoint
CREATE INDEX "pos_tab_presence_expiry_idx" ON "pos_tab_presence" USING btree ("organization_id","unit_id","expires_at");--> statement-breakpoint
ALTER TABLE "pos_dining_rooms" ADD CONSTRAINT "pos_dining_rooms_responsible_identity_id_identities_id_fk" FOREIGN KEY ("responsible_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_responsible_identity_id_identities_id_fk" FOREIGN KEY ("responsible_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_dining_tables" ADD CONSTRAINT "pos_tables_layout_check" CHECK (("pos_dining_tables"."layout_x" IS NULL AND "pos_dining_tables"."layout_y" IS NULL) OR ("pos_dining_tables"."layout_x" BETWEEN -1000000 AND 1000000 AND "pos_dining_tables"."layout_y" BETWEEN -1000000 AND 1000000));--> statement-breakpoint
ALTER TABLE "pos_order_items" ADD CONSTRAINT "pos_order_items_seat_check" CHECK ("pos_order_items"."seat_number" IS NULL OR "pos_order_items"."seat_number" > 0);--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_display_number_check" CHECK ("pos_tabs"."display_number" IS NULL OR "pos_tabs"."display_number" > 0);--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_version_check" CHECK ("pos_tabs"."version" > 0);