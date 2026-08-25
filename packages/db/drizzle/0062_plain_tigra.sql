CREATE TYPE "public"."management_inventory_count_session_status" AS ENUM('open', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."management_inventory_lot_hold_status" AS ENUM('active', 'released');--> statement-breakpoint
CREATE TYPE "public"."management_inventory_temperature_status" AS ENUM('normal', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."management_returnable_deposit_charge_status" AS ENUM('charged', 'canceled');--> statement-breakpoint
CREATE TABLE "management_inventory_count_session_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"lot_id" uuid,
	"expected_quantity" numeric(16, 3) NOT NULL,
	"counted_quantity" numeric(16, 3),
	"difference_quantity" numeric(16, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_count_session_lines_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_count_session_lines_values_check" CHECK ("management_inventory_count_session_lines"."expected_quantity" >= 0 and ("management_inventory_count_session_lines"."counted_quantity" is null or "management_inventory_count_session_lines"."counted_quantity" >= 0) and (("management_inventory_count_session_lines"."counted_quantity" is null and "management_inventory_count_session_lines"."difference_quantity" is null) or ("management_inventory_count_session_lines"."counted_quantity" is not null and "management_inventory_count_session_lines"."difference_quantity" = "management_inventory_count_session_lines"."counted_quantity" - "management_inventory_count_session_lines"."expected_quantity")))
);
--> statement-breakpoint
CREATE TABLE "management_inventory_count_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" "management_inventory_count_session_status" DEFAULT 'open' NOT NULL,
	"shift_reference" varchar(80),
	"reason" text NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"started_by_identity_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_by_identity_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_count_sessions_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_count_sessions_state_check" CHECK (("management_inventory_count_sessions"."status" = 'open' and "management_inventory_count_sessions"."submitted_at" is null and "management_inventory_count_sessions"."reviewed_at" is null) or ("management_inventory_count_sessions"."status" = 'submitted' and "management_inventory_count_sessions"."submitted_at" is not null and "management_inventory_count_sessions"."reviewed_at" is null) or ("management_inventory_count_sessions"."status" in ('approved','rejected') and "management_inventory_count_sessions"."submitted_at" is not null and "management_inventory_count_sessions"."reviewed_at" is not null and "management_inventory_count_sessions"."reviewed_by_identity_id" is not null and nullif(btrim("management_inventory_count_sessions"."review_note"), '') is not null))
);
--> statement-breakpoint
CREATE TABLE "management_inventory_lot_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"status" "management_inventory_lot_hold_status" DEFAULT 'active' NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"released_by_identity_id" uuid,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_lot_holds_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_lot_holds_resolution_check" CHECK (("management_inventory_lot_holds"."status" = 'active' and "management_inventory_lot_holds"."released_by_identity_id" is null and "management_inventory_lot_holds"."released_at" is null and "management_inventory_lot_holds"."release_reason" is null) or ("management_inventory_lot_holds"."status" = 'released' and "management_inventory_lot_holds"."released_by_identity_id" is not null and "management_inventory_lot_holds"."released_at" is not null and nullif(btrim("management_inventory_lot_holds"."release_reason"), '') is not null))
);
--> statement-breakpoint
CREATE TABLE "management_inventory_sector_policies" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"blind_count_required" boolean DEFAULT true NOT NULL,
	"require_distinct_count_reviewer" boolean DEFAULT true NOT NULL,
	"scan_required" boolean DEFAULT true NOT NULL,
	"offline_allowed" boolean DEFAULT true NOT NULL,
	"temperature_min_milli" integer,
	"temperature_max_milli" integer,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_sector_policies_organization_id_unit_id_location_id_pk" PRIMARY KEY("organization_id","unit_id","location_id"),
	CONSTRAINT "management_inventory_sector_policies_temperature_check" CHECK (("management_inventory_sector_policies"."temperature_min_milli" is null and "management_inventory_sector_policies"."temperature_max_milli" is null) or ("management_inventory_sector_policies"."temperature_min_milli" is not null and "management_inventory_sector_policies"."temperature_max_milli" is not null and "management_inventory_sector_policies"."temperature_min_milli" < "management_inventory_sector_policies"."temperature_max_milli"))
);
--> statement-breakpoint
CREATE TABLE "management_inventory_temperature_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"celsius_milli" integer NOT NULL,
	"minimum_milli_at_capture" integer NOT NULL,
	"maximum_milli_at_capture" integer NOT NULL,
	"status" "management_inventory_temperature_status" NOT NULL,
	"source" varchar(16) NOT NULL,
	"note" text,
	"idempotency_key" varchar(160) NOT NULL,
	"recorded_by_identity_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_temperature_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_temperature_values_check" CHECK ("management_inventory_temperature_readings"."celsius_milli" between -100000 and 100000 and "management_inventory_temperature_readings"."minimum_milli_at_capture" < "management_inventory_temperature_readings"."maximum_milli_at_capture"),
	CONSTRAINT "management_inventory_temperature_source_check" CHECK ("management_inventory_temperature_readings"."source" in ('manual','sensor','import'))
);
--> statement-breakpoint
CREATE TABLE "management_returnable_deposit_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"receivable_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "management_returnable_deposit_charge_status" DEFAULT 'charged' NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"charged_by_identity_id" uuid NOT NULL,
	"canceled_by_identity_id" uuid,
	"canceled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_returnable_deposit_charges_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_returnable_deposit_charges_amount_check" CHECK ("management_returnable_deposit_charges"."amount_cents" > 0),
	CONSTRAINT "management_returnable_deposit_charges_state_check" CHECK (("management_returnable_deposit_charges"."status" = 'charged' and "management_returnable_deposit_charges"."canceled_by_identity_id" is null and "management_returnable_deposit_charges"."canceled_at" is null and "management_returnable_deposit_charges"."cancellation_reason" is null) or ("management_returnable_deposit_charges"."status" = 'canceled' and "management_returnable_deposit_charges"."canceled_by_identity_id" is not null and "management_returnable_deposit_charges"."canceled_at" is not null and nullif(btrim("management_returnable_deposit_charges"."cancellation_reason"), '') is not null))
);
--> statement-breakpoint
ALTER TABLE "management_inventory_count_session_lines" ADD CONSTRAINT "management_inventory_count_session_lines_session_fk" FOREIGN KEY ("organization_id","unit_id","session_id") REFERENCES "public"."management_inventory_count_sessions"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_count_session_lines" ADD CONSTRAINT "management_inventory_count_session_lines_item_fk" FOREIGN KEY ("organization_id","unit_id","inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_count_session_lines" ADD CONSTRAINT "management_inventory_count_session_lines_lot_fk" FOREIGN KEY ("organization_id","unit_id","lot_id") REFERENCES "public"."management_inventory_lots"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_count_sessions" ADD CONSTRAINT "management_inventory_count_sessions_started_by_identity_id_identities_id_fk" FOREIGN KEY ("started_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_count_sessions" ADD CONSTRAINT "management_inventory_count_sessions_reviewed_by_identity_id_identities_id_fk" FOREIGN KEY ("reviewed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_count_sessions" ADD CONSTRAINT "management_inventory_count_sessions_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_lot_holds" ADD CONSTRAINT "management_inventory_lot_holds_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_lot_holds" ADD CONSTRAINT "management_inventory_lot_holds_released_by_identity_id_identities_id_fk" FOREIGN KEY ("released_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_lot_holds" ADD CONSTRAINT "management_inventory_lot_holds_lot_fk" FOREIGN KEY ("organization_id","unit_id","lot_id") REFERENCES "public"."management_inventory_lots"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_sector_policies" ADD CONSTRAINT "management_inventory_sector_policies_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_sector_policies" ADD CONSTRAINT "management_inventory_sector_policies_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_temperature_readings" ADD CONSTRAINT "management_inventory_temperature_readings_recorded_by_identity_id_identities_id_fk" FOREIGN KEY ("recorded_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_temperature_readings" ADD CONSTRAINT "management_inventory_temperature_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_returnable_deposit_charges" ADD CONSTRAINT "management_returnable_deposit_charges_charged_by_identity_id_identities_id_fk" FOREIGN KEY ("charged_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_returnable_deposit_charges" ADD CONSTRAINT "management_returnable_deposit_charges_canceled_by_identity_id_identities_id_fk" FOREIGN KEY ("canceled_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_returnable_deposit_charges" ADD CONSTRAINT "management_returnable_deposit_charges_order_fk" FOREIGN KEY ("organization_id","unit_id","order_id") REFERENCES "public"."pos_orders"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_returnable_deposit_charges" ADD CONSTRAINT "management_returnable_deposit_charges_receivable_fk" FOREIGN KEY ("organization_id","unit_id","receivable_id") REFERENCES "public"."management_accounts_receivable"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_count_session_lines_item_unique" ON "management_inventory_count_session_lines" USING btree ("organization_id","unit_id","session_id","inventory_item_id",coalesce("lot_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_count_sessions_idempotency_unique" ON "management_inventory_count_sessions" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_inventory_count_sessions_status_idx" ON "management_inventory_count_sessions" USING btree ("organization_id","unit_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_lot_holds_idempotency_unique" ON "management_inventory_lot_holds" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_lot_holds_active_unique" ON "management_inventory_lot_holds" USING btree ("organization_id","unit_id","lot_id") WHERE "management_inventory_lot_holds"."status" = 'active';--> statement-breakpoint
CREATE INDEX "management_inventory_lot_holds_status_idx" ON "management_inventory_lot_holds" USING btree ("organization_id","unit_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_temperature_idempotency_unique" ON "management_inventory_temperature_readings" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_inventory_temperature_timeline_idx" ON "management_inventory_temperature_readings" USING btree ("organization_id","unit_id","location_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_returnable_deposit_charges_idempotency_unique" ON "management_returnable_deposit_charges" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_returnable_deposit_charges_active_order_unique" ON "management_returnable_deposit_charges" USING btree ("organization_id","unit_id","order_id") WHERE "management_returnable_deposit_charges"."status" = 'charged';