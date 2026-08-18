CREATE TYPE "public"."management_interunit_transfer_status" AS ENUM('in_transit', 'partially_received', 'received', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."management_inventory_reservation_status" AS ENUM('active', 'consumed', 'released', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."management_production_batch_status" AS ENUM('planned', 'completed', 'canceled');--> statement-breakpoint
ALTER TYPE "public"."management_inventory_item_kind" ADD VALUE 'prepared' BEFORE 'resale';--> statement-breakpoint
CREATE TABLE "management_interunit_transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_unit_id" uuid NOT NULL,
	"destination_unit_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"source_inventory_item_id" uuid NOT NULL,
	"destination_inventory_item_id" uuid NOT NULL,
	"source_location_id" uuid NOT NULL,
	"destination_location_id" uuid NOT NULL,
	"source_lot_id" uuid,
	"quantity_sent" numeric(16, 3) NOT NULL,
	"quantity_received" numeric(16, 3) DEFAULT '0' NOT NULL,
	"unit_cost_cents" integer,
	"batch_code" varchar(80),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_interunit_transfer_lines_scope_id_unique" UNIQUE("organization_id","source_unit_id","id"),
	CONSTRAINT "management_interunit_transfer_lines_quantities_check" CHECK ("management_interunit_transfer_lines"."quantity_sent" > 0 and "management_interunit_transfer_lines"."quantity_received" >= 0 and "management_interunit_transfer_lines"."quantity_received" <= "management_interunit_transfer_lines"."quantity_sent"),
	CONSTRAINT "management_interunit_transfer_lines_cost_check" CHECK ("management_interunit_transfer_lines"."unit_cost_cents" is null or "management_interunit_transfer_lines"."unit_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_interunit_transfer_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_unit_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"lines" jsonb NOT NULL,
	"note" text NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"received_by_identity_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "management_interunit_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_unit_id" uuid NOT NULL,
	"destination_unit_id" uuid NOT NULL,
	"status" "management_interunit_transfer_status" DEFAULT 'in_transit' NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"sent_by_identity_id" uuid NOT NULL,
	"last_received_by_identity_id" uuid,
	"canceled_by_identity_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_received_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_interunit_transfers_scope_id_unique" UNIQUE("organization_id","source_unit_id","id"),
	CONSTRAINT "management_interunit_transfers_units_check" CHECK ("management_interunit_transfers"."source_unit_id" <> "management_interunit_transfers"."destination_unit_id"),
	CONSTRAINT "management_interunit_transfers_resolution_check" CHECK (("management_interunit_transfers"."status" in ('in_transit','partially_received') and "management_interunit_transfers"."canceled_at" is null) or ("management_interunit_transfers"."status" = 'received' and "management_interunit_transfers"."last_received_at" is not null and "management_interunit_transfers"."last_received_by_identity_id" is not null and "management_interunit_transfers"."canceled_at" is null) or ("management_interunit_transfers"."status" = 'canceled' and "management_interunit_transfers"."canceled_at" is not null and "management_interunit_transfers"."canceled_by_identity_id" is not null and "management_interunit_transfers"."cancel_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "management_inventory_closing_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"closing_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"reserved_quantity" numeric(16, 3) DEFAULT '0' NOT NULL,
	"average_cost_cents" integer,
	"value_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_closing_lines_unique" UNIQUE("closing_id","inventory_item_id","location_id"),
	CONSTRAINT "management_inventory_closing_lines_values_check" CHECK ("management_inventory_closing_lines"."reserved_quantity" >= 0 and ("management_inventory_closing_lines"."average_cost_cents" is null or "management_inventory_closing_lines"."average_cost_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "management_inventory_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"period" date NOT NULL,
	"total_value_cents" integer NOT NULL,
	"total_reserved_value_cents" integer NOT NULL,
	"line_count" integer NOT NULL,
	"notes" text,
	"idempotency_key" varchar(160) NOT NULL,
	"closed_by_identity_id" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_closings_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_closings_values_check" CHECK ("management_inventory_closings"."total_reserved_value_cents" >= 0 and "management_inventory_closings"."line_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_inventory_count_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"classification" varchar(1) NOT NULL,
	"risk_score" integer NOT NULL,
	"frequency_days" integer NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"last_counted_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_count_schedules_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_count_schedules_classification_check" CHECK ("management_inventory_count_schedules"."classification" in ('A','B','C')),
	CONSTRAINT "management_inventory_count_schedules_values_check" CHECK ("management_inventory_count_schedules"."risk_score" between 0 and 100 and "management_inventory_count_schedules"."frequency_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "management_inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"status" "management_inventory_reservation_status" DEFAULT 'active' NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"source_id" varchar(160) NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"idempotency_key" varchar(160) NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"resolved_by_identity_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_reservations_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_reservations_quantity_check" CHECK ("management_inventory_reservations"."quantity" > 0),
	CONSTRAINT "management_inventory_reservations_resolution_check" CHECK (("management_inventory_reservations"."status" = 'active' and "management_inventory_reservations"."resolved_at" is null and "management_inventory_reservations"."resolved_by_identity_id" is null) or ("management_inventory_reservations"."status" <> 'active' and "management_inventory_reservations"."resolved_at" is not null and "management_inventory_reservations"."resolved_by_identity_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "management_production_batch_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"production_batch_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"lot_id" uuid,
	"planned_quantity" numeric(16, 3) NOT NULL,
	"actual_quantity" numeric(16, 3),
	"unit_cost_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_production_batch_inputs_planned_check" CHECK ("management_production_batch_inputs"."planned_quantity" > 0),
	CONSTRAINT "management_production_batch_inputs_actual_check" CHECK ("management_production_batch_inputs"."actual_quantity" is null or "management_production_batch_inputs"."actual_quantity" > 0),
	CONSTRAINT "management_production_batch_inputs_cost_check" CHECK ("management_production_batch_inputs"."unit_cost_cents" is null or "management_production_batch_inputs"."unit_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_production_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"output_inventory_item_id" uuid NOT NULL,
	"output_location_id" uuid NOT NULL,
	"output_lot_id" uuid,
	"batch_code" varchar(80) NOT NULL,
	"planned_quantity" numeric(16, 3) NOT NULL,
	"actual_quantity" numeric(16, 3),
	"status" "management_production_batch_status" DEFAULT 'planned' NOT NULL,
	"expires_at" timestamp with time zone,
	"notes" text,
	"idempotency_key" varchar(160) NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"completed_by_identity_id" uuid,
	"completed_at" timestamp with time zone,
	"canceled_by_identity_id" uuid,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_production_batches_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_production_batches_planned_check" CHECK ("management_production_batches"."planned_quantity" > 0),
	CONSTRAINT "management_production_batches_actual_check" CHECK ("management_production_batches"."actual_quantity" is null or "management_production_batches"."actual_quantity" > 0),
	CONSTRAINT "management_production_batches_resolution_check" CHECK (("management_production_batches"."status" = 'planned' and "management_production_batches"."actual_quantity" is null and "management_production_batches"."completed_at" is null and "management_production_batches"."canceled_at" is null) or ("management_production_batches"."status" = 'completed' and "management_production_batches"."actual_quantity" is not null and "management_production_batches"."completed_at" is not null and "management_production_batches"."completed_by_identity_id" is not null and "management_production_batches"."canceled_at" is null) or ("management_production_batches"."status" = 'canceled' and "management_production_batches"."canceled_at" is not null and "management_production_batches"."canceled_by_identity_id" is not null and "management_production_batches"."completed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "management_interunit_transfer_lines" ADD CONSTRAINT "management_interunit_transfer_lines_transfer_fk" FOREIGN KEY ("organization_id","source_unit_id","transfer_id") REFERENCES "public"."management_interunit_transfers"("organization_id","source_unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_interunit_transfer_lines" ADD CONSTRAINT "management_interunit_transfer_lines_source_balance_fk" FOREIGN KEY ("organization_id","source_unit_id","source_location_id","source_inventory_item_id") REFERENCES "public"."management_stock_balances"("organization_id","unit_id","location_id","inventory_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_interunit_transfer_lines" ADD CONSTRAINT "management_interunit_transfer_lines_destination_item_fk" FOREIGN KEY ("organization_id","destination_unit_id","destination_inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_interunit_transfer_lines" ADD CONSTRAINT "management_interunit_transfer_lines_destination_location_fk" FOREIGN KEY ("organization_id","destination_unit_id","destination_location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_interunit_transfer_lines" ADD CONSTRAINT "management_interunit_transfer_lines_source_lot_fk" FOREIGN KEY ("organization_id","source_unit_id","source_lot_id") REFERENCES "public"."management_inventory_lots"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_interunit_transfer_receipts" ADD CONSTRAINT "management_interunit_transfer_receipts_received_by_identity_id_identities_id_fk" FOREIGN KEY ("received_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_interunit_transfer_receipts" ADD CONSTRAINT "management_interunit_transfer_receipts_transfer_fk" FOREIGN KEY ("organization_id","source_unit_id","transfer_id") REFERENCES "public"."management_interunit_transfers"("organization_id","source_unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_interunit_transfers" ADD CONSTRAINT "management_interunit_transfers_sent_by_identity_id_identities_id_fk" FOREIGN KEY ("sent_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_interunit_transfers" ADD CONSTRAINT "management_interunit_transfers_last_received_by_identity_id_identities_id_fk" FOREIGN KEY ("last_received_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_interunit_transfers" ADD CONSTRAINT "management_interunit_transfers_canceled_by_identity_id_identities_id_fk" FOREIGN KEY ("canceled_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_interunit_transfers" ADD CONSTRAINT "management_interunit_transfers_source_unit_fk" FOREIGN KEY ("organization_id","source_unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_interunit_transfers" ADD CONSTRAINT "management_interunit_transfers_destination_unit_fk" FOREIGN KEY ("organization_id","destination_unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_closing_lines" ADD CONSTRAINT "management_inventory_closing_lines_closing_fk" FOREIGN KEY ("organization_id","unit_id","closing_id") REFERENCES "public"."management_inventory_closings"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_closings" ADD CONSTRAINT "management_inventory_closings_closed_by_identity_id_identities_id_fk" FOREIGN KEY ("closed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_closings" ADD CONSTRAINT "management_inventory_closings_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_count_schedules" ADD CONSTRAINT "management_inventory_count_schedules_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_count_schedules" ADD CONSTRAINT "management_inventory_count_schedules_balance_fk" FOREIGN KEY ("organization_id","unit_id","location_id","inventory_item_id") REFERENCES "public"."management_stock_balances"("organization_id","unit_id","location_id","inventory_item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_reservations" ADD CONSTRAINT "management_inventory_reservations_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_reservations" ADD CONSTRAINT "management_inventory_reservations_resolved_by_identity_id_identities_id_fk" FOREIGN KEY ("resolved_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_reservations" ADD CONSTRAINT "management_inventory_reservations_balance_fk" FOREIGN KEY ("organization_id","unit_id","location_id","inventory_item_id") REFERENCES "public"."management_stock_balances"("organization_id","unit_id","location_id","inventory_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_production_batch_inputs" ADD CONSTRAINT "management_production_batch_inputs_batch_fk" FOREIGN KEY ("organization_id","unit_id","production_batch_id") REFERENCES "public"."management_production_batches"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_production_batch_inputs" ADD CONSTRAINT "management_production_batch_inputs_balance_fk" FOREIGN KEY ("organization_id","unit_id","location_id","inventory_item_id") REFERENCES "public"."management_stock_balances"("organization_id","unit_id","location_id","inventory_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_production_batch_inputs" ADD CONSTRAINT "management_production_batch_inputs_lot_fk" FOREIGN KEY ("organization_id","unit_id","lot_id") REFERENCES "public"."management_inventory_lots"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_production_batches" ADD CONSTRAINT "management_production_batches_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_production_batches" ADD CONSTRAINT "management_production_batches_completed_by_identity_id_identities_id_fk" FOREIGN KEY ("completed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_production_batches" ADD CONSTRAINT "management_production_batches_canceled_by_identity_id_identities_id_fk" FOREIGN KEY ("canceled_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_production_batches" ADD CONSTRAINT "management_production_batches_output_item_fk" FOREIGN KEY ("organization_id","unit_id","output_inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_production_batches" ADD CONSTRAINT "management_production_batches_output_location_fk" FOREIGN KEY ("organization_id","unit_id","output_location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_production_batches" ADD CONSTRAINT "management_production_batches_output_lot_fk" FOREIGN KEY ("organization_id","unit_id","output_lot_id") REFERENCES "public"."management_inventory_lots"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_interunit_transfer_receipts_idempotency_unique" ON "management_interunit_transfer_receipts" USING btree ("organization_id","source_unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_interunit_transfers_idempotency_unique" ON "management_interunit_transfers" USING btree ("organization_id","source_unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_interunit_transfers_source_idx" ON "management_interunit_transfers" USING btree ("organization_id","source_unit_id","status","sent_at");--> statement-breakpoint
CREATE INDEX "management_interunit_transfers_destination_idx" ON "management_interunit_transfers" USING btree ("organization_id","destination_unit_id","status","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_closings_period_unique" ON "management_inventory_closings" USING btree ("organization_id","unit_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_closings_idempotency_unique" ON "management_inventory_closings" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_count_schedules_item_unique" ON "management_inventory_count_schedules" USING btree ("organization_id","unit_id","inventory_item_id","location_id");--> statement-breakpoint
CREATE INDEX "management_inventory_count_schedules_due_idx" ON "management_inventory_count_schedules" USING btree ("organization_id","unit_id","active","next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_reservations_idempotency_unique" ON "management_inventory_reservations" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_reservations_source_unique" ON "management_inventory_reservations" USING btree ("organization_id","unit_id","source_type","source_id","inventory_item_id","location_id");--> statement-breakpoint
CREATE INDEX "management_inventory_reservations_active_idx" ON "management_inventory_reservations" USING btree ("organization_id","unit_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_production_batches_idempotency_unique" ON "management_production_batches" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_production_batches_code_unique" ON "management_production_batches" USING btree ("organization_id","unit_id","batch_code");--> statement-breakpoint
CREATE INDEX "management_production_batches_status_idx" ON "management_production_batches" USING btree ("organization_id","unit_id","status","created_at");
--> statement-breakpoint
CREATE FUNCTION prevent_inventory_closing_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION USING
		ERRCODE = '55000',
		MESSAGE = 'inventory closings are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER management_inventory_closings_immutable
BEFORE UPDATE OR DELETE ON management_inventory_closings
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_closing_mutation();
--> statement-breakpoint
CREATE TRIGGER management_inventory_closing_lines_immutable
BEFORE UPDATE OR DELETE ON management_inventory_closing_lines
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_closing_mutation();
--> statement-breakpoint
CREATE TRIGGER management_inventory_closings_no_truncate
BEFORE TRUNCATE ON management_inventory_closings
FOR EACH STATEMENT EXECUTE FUNCTION prevent_inventory_closing_mutation();
--> statement-breakpoint
CREATE TRIGGER management_inventory_closing_lines_no_truncate
BEFORE TRUNCATE ON management_inventory_closing_lines
FOR EACH STATEMENT EXECUTE FUNCTION prevent_inventory_closing_mutation();
