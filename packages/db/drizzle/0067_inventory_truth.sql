ALTER TABLE "management_inventory_closings" ADD COLUMN "total_in_transit_value_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_inventory_closing_lines" ADD COLUMN "in_transit_quantity" numeric(16, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_inventory_closing_lines" ADD COLUMN "in_transit_value_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_returnable_custody_movements" ADD COLUMN "parent_movement_id" uuid;--> statement-breakpoint
ALTER TABLE "management_returnable_custody_movements" ADD COLUMN "responsible_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_returnable_custody_movements" ADD COLUMN "counterparty_name" varchar(160);--> statement-breakpoint
ALTER TABLE "management_returnable_custody_movements" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_returnable_custody_movements" ADD CONSTRAINT "management_returnable_custody_parent_fk" FOREIGN KEY ("organization_id", "unit_id", "parent_movement_id") REFERENCES "public"."management_returnable_custody_movements"("organization_id", "unit_id", "id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "management_returnable_custody_movements" ADD CONSTRAINT "management_returnable_custody_responsible_identity_id_identities_id_fk" FOREIGN KEY ("responsible_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "management_returnable_custody_parent_idx" ON "management_returnable_custody_movements" USING btree ("organization_id", "unit_id", "parent_movement_id");--> statement-breakpoint
CREATE INDEX "management_returnable_custody_due_idx" ON "management_returnable_custody_movements" USING btree ("organization_id", "unit_id", "type", "due_at");--> statement-breakpoint
ALTER TABLE "management_inventory_closings" DROP CONSTRAINT "management_inventory_closings_values_check";--> statement-breakpoint
ALTER TABLE "management_inventory_closings" ADD CONSTRAINT "management_inventory_closings_values_check" CHECK ("management_inventory_closings"."total_reserved_value_cents" >= 0 and "management_inventory_closings"."total_in_transit_value_cents" >= 0 and "management_inventory_closings"."line_count" >= 0);--> statement-breakpoint
ALTER TABLE "management_inventory_closing_lines" DROP CONSTRAINT "management_inventory_closing_lines_values_check";--> statement-breakpoint
ALTER TABLE "management_inventory_closing_lines" ADD CONSTRAINT "management_inventory_closing_lines_values_check" CHECK ("management_inventory_closing_lines"."reserved_quantity" >= 0 and "management_inventory_closing_lines"."in_transit_quantity" >= 0 and "management_inventory_closing_lines"."in_transit_value_cents" >= 0 and ("management_inventory_closing_lines"."average_cost_cents" is null or "management_inventory_closing_lines"."average_cost_cents" >= 0));
