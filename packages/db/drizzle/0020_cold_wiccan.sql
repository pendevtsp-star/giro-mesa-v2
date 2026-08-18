CREATE TABLE "management_inventory_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"batch_code" varchar(80) NOT NULL,
	"expires_at" timestamp with time zone,
	"quantity" numeric(16, 3) DEFAULT '0' NOT NULL,
	"unit_cost_cents" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_lots_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_lots_quantity_check" CHECK ("management_inventory_lots"."quantity" >= 0),
	CONSTRAINT "management_inventory_lots_cost_check" CHECK ("management_inventory_lots"."unit_cost_cents" is null or "management_inventory_lots"."unit_cost_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "management_inventory_events" DROP CONSTRAINT "management_inventory_events_type_check";--> statement-breakpoint
ALTER TABLE "management_inventory_event_lines" ADD COLUMN "lot_id" uuid;--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD COLUMN "preferred_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD COLUMN "barcode" varchar(80);--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD COLUMN "purchase_unit" varchar(20);--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD COLUMN "purchase_to_stock_factor" numeric(16, 3) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD COLUMN "reorder_quantity" numeric(16, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD COLUMN "lead_time_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_inventory_movements" ADD COLUMN "lot_id" uuid;--> statement-breakpoint
ALTER TABLE "management_inventory_lots" ADD CONSTRAINT "management_inventory_lots_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_lots" ADD CONSTRAINT "management_inventory_lots_item_fk" FOREIGN KEY ("organization_id","unit_id","inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_lots_batch_unique" ON "management_inventory_lots" USING btree ("organization_id","unit_id","location_id","inventory_item_id","batch_code");--> statement-breakpoint
CREATE INDEX "management_inventory_lots_expiry_idx" ON "management_inventory_lots" USING btree ("organization_id","unit_id","expires_at");--> statement-breakpoint
ALTER TABLE "management_inventory_event_lines" ADD CONSTRAINT "management_inventory_event_lines_lot_fk" FOREIGN KEY ("organization_id","unit_id","lot_id") REFERENCES "public"."management_inventory_lots"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD CONSTRAINT "management_inventory_items_supplier_fk" FOREIGN KEY ("organization_id","unit_id","preferred_supplier_id") REFERENCES "public"."management_suppliers"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_movements" ADD CONSTRAINT "management_inventory_movements_lot_fk" FOREIGN KEY ("organization_id","unit_id","lot_id") REFERENCES "public"."management_inventory_lots"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_items_barcode_unique" ON "management_inventory_items" USING btree ("organization_id","unit_id","barcode");--> statement-breakpoint
ALTER TABLE "management_inventory_events" ADD CONSTRAINT "management_inventory_events_type_check" CHECK ("management_inventory_events"."type" in ('loss','count','adjustment','transfer'));--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD CONSTRAINT "management_inventory_items_purchase_factor_check" CHECK ("management_inventory_items"."purchase_to_stock_factor" > 0);--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD CONSTRAINT "management_inventory_items_reorder_check" CHECK ("management_inventory_items"."reorder_quantity" >= 0);--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD CONSTRAINT "management_inventory_items_lead_time_check" CHECK ("management_inventory_items"."lead_time_days" >= 0);