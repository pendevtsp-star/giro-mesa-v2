CREATE TYPE "public"."management_inventory_asset_condition" AS ENUM('good', 'fair', 'poor', 'unusable');--> statement-breakpoint
CREATE TYPE "public"."management_inventory_asset_status" AS ENUM('in_use', 'maintenance', 'damaged', 'retired');--> statement-breakpoint
CREATE TYPE "public"."management_inventory_review_status" AS ENUM('pending', 'approved', 'rejected', 'posted');--> statement-breakpoint
CREATE TYPE "public"."management_inventory_transfer_status" AS ENUM('in_transit', 'received', 'canceled');--> statement-breakpoint
CREATE TABLE "management_inventory_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"asset_tag" varchar(80) NOT NULL,
	"status" "management_inventory_asset_status" DEFAULT 'in_use' NOT NULL,
	"condition" "management_inventory_asset_condition" DEFAULT 'good' NOT NULL,
	"responsible_identity_id" uuid,
	"acquired_at" timestamp with time zone,
	"last_maintenance_at" timestamp with time zone,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_assets_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_assets_version_check" CHECK ("management_inventory_assets"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "management_inventory_review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"type" varchar(24) NOT NULL,
	"reason" text NOT NULL,
	"payload" jsonb NOT NULL,
	"risk_summary" jsonb NOT NULL,
	"status" "management_inventory_review_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"requested_by_identity_id" uuid NOT NULL,
	"reviewed_by_identity_id" uuid,
	"review_reason" text,
	"reviewed_at" timestamp with time zone,
	"posted_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_review_requests_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_review_requests_type_check" CHECK ("management_inventory_review_requests"."type" in ('loss','count','adjustment')),
	CONSTRAINT "management_inventory_review_requests_review_check" CHECK (("management_inventory_review_requests"."status" = 'pending' and "management_inventory_review_requests"."reviewed_by_identity_id" is null and "management_inventory_review_requests"."reviewed_at" is null) or ("management_inventory_review_requests"."status" in ('approved','rejected','posted') and "management_inventory_review_requests"."reviewed_by_identity_id" is not null and "management_inventory_review_requests"."reviewed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "management_inventory_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"source_location_id" uuid NOT NULL,
	"destination_location_id" uuid NOT NULL,
	"source_lot_id" uuid,
	"destination_lot_id" uuid,
	"event_id" uuid NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"reason" text NOT NULL,
	"status" "management_inventory_transfer_status" DEFAULT 'in_transit' NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"sent_by_identity_id" uuid NOT NULL,
	"received_by_identity_id" uuid,
	"canceled_by_identity_id" uuid,
	"received_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_transfers_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_transfers_quantity_check" CHECK ("management_inventory_transfers"."quantity" > 0),
	CONSTRAINT "management_inventory_transfers_locations_check" CHECK ("management_inventory_transfers"."source_location_id" <> "management_inventory_transfers"."destination_location_id"),
	CONSTRAINT "management_inventory_transfers_resolution_check" CHECK (("management_inventory_transfers"."status" = 'in_transit' and "management_inventory_transfers"."received_at" is null and "management_inventory_transfers"."canceled_at" is null) or ("management_inventory_transfers"."status" = 'received' and "management_inventory_transfers"."received_at" is not null and "management_inventory_transfers"."received_by_identity_id" is not null and "management_inventory_transfers"."canceled_at" is null) or ("management_inventory_transfers"."status" = 'canceled' and "management_inventory_transfers"."canceled_at" is not null and "management_inventory_transfers"."canceled_by_identity_id" is not null and "management_inventory_transfers"."received_at" is null))
);
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" DROP CONSTRAINT "management_supplier_invoices_reversal_check";--> statement-breakpoint
DROP INDEX "management_supplier_invoices_access_key_unique";--> statement-breakpoint
ALTER TABLE "management_product_returnables" ADD COLUMN "deposit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_inventory_assets" ADD CONSTRAINT "management_inventory_assets_responsible_identity_id_identities_id_fk" FOREIGN KEY ("responsible_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_assets" ADD CONSTRAINT "management_inventory_assets_item_fk" FOREIGN KEY ("organization_id","unit_id","inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_assets" ADD CONSTRAINT "management_inventory_assets_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_review_requests" ADD CONSTRAINT "management_inventory_review_requests_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_review_requests" ADD CONSTRAINT "management_inventory_review_requests_reviewed_by_identity_id_identities_id_fk" FOREIGN KEY ("reviewed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_review_requests" ADD CONSTRAINT "management_inventory_review_requests_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_review_requests" ADD CONSTRAINT "management_inventory_review_requests_event_fk" FOREIGN KEY ("organization_id","unit_id","posted_event_id") REFERENCES "public"."management_inventory_events"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD CONSTRAINT "management_inventory_transfers_sent_by_identity_id_identities_id_fk" FOREIGN KEY ("sent_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD CONSTRAINT "management_inventory_transfers_received_by_identity_id_identities_id_fk" FOREIGN KEY ("received_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD CONSTRAINT "management_inventory_transfers_canceled_by_identity_id_identities_id_fk" FOREIGN KEY ("canceled_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD CONSTRAINT "management_inventory_transfers_item_fk" FOREIGN KEY ("organization_id","unit_id","inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD CONSTRAINT "management_inventory_transfers_source_fk" FOREIGN KEY ("organization_id","unit_id","source_location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD CONSTRAINT "management_inventory_transfers_destination_fk" FOREIGN KEY ("organization_id","unit_id","destination_location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD CONSTRAINT "management_inventory_transfers_source_lot_fk" FOREIGN KEY ("organization_id","unit_id","source_lot_id") REFERENCES "public"."management_inventory_lots"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD CONSTRAINT "management_inventory_transfers_destination_lot_fk" FOREIGN KEY ("organization_id","unit_id","destination_lot_id") REFERENCES "public"."management_inventory_lots"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD CONSTRAINT "management_inventory_transfers_event_fk" FOREIGN KEY ("organization_id","unit_id","event_id") REFERENCES "public"."management_inventory_events"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_assets_tag_unique" ON "management_inventory_assets" USING btree ("organization_id","unit_id","asset_tag");--> statement-breakpoint
CREATE INDEX "management_inventory_assets_item_status_idx" ON "management_inventory_assets" USING btree ("organization_id","unit_id","inventory_item_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_review_requests_idempotency_unique" ON "management_inventory_review_requests" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_inventory_review_requests_status_idx" ON "management_inventory_review_requests" USING btree ("organization_id","unit_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_transfers_idempotency_unique" ON "management_inventory_transfers" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_inventory_transfers_status_idx" ON "management_inventory_transfers" USING btree ("organization_id","unit_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_supplier_invoices_access_key_unique" ON "management_supplier_invoices" USING btree ("access_key") WHERE "management_supplier_invoices"."access_key" is not null;--> statement-breakpoint
ALTER TABLE "management_product_returnables" ADD CONSTRAINT "management_product_returnables_deposit_check" CHECK ("management_product_returnables"."deposit_cents" >= 0);--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD CONSTRAINT "management_supplier_invoices_reversal_check" CHECK (("management_supplier_invoices"."status"::text = 'reversed' and "management_supplier_invoices"."reversal_reason" is not null and length(trim("management_supplier_invoices"."reversal_reason")) > 0 and "management_supplier_invoices"."reversed_at" is not null and "management_supplier_invoices"."reversed_by_identity_id" is not null and "management_supplier_invoices"."reversed_at" >= "management_supplier_invoices"."created_at") or ("management_supplier_invoices"."status"::text <> 'reversed' and "management_supplier_invoices"."reversal_reason" is null and "management_supplier_invoices"."reversed_at" is null and "management_supplier_invoices"."reversed_by_identity_id" is null));