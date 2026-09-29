ALTER TYPE "pos_print_document_type" ADD VALUE IF NOT EXISTS 'delivery_slip';
--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "delivery_fee_cents" integer NOT NULL DEFAULT 0;
ALTER TABLE "pos_tabs" ADD COLUMN "delivery_address_details" jsonb;
ALTER TABLE "pos_tabs" ADD COLUMN "delivery_zone_id" uuid;
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_delivery_fee_check" CHECK ("delivery_fee_cents" >= 0);
--> statement-breakpoint
ALTER TABLE "pos_bill_printing_policies" ADD COLUMN "delivery_auto_print" boolean NOT NULL DEFAULT false;
ALTER TABLE "pos_bill_printing_policies" ADD COLUMN "delivery_printer_id" uuid;
ALTER TABLE "pos_bill_printing_policies" ADD CONSTRAINT "pos_bill_printing_policies_delivery_printer_fk" FOREIGN KEY ("organization_id", "unit_id", "delivery_printer_id") REFERENCES "pos_production_printers" ("organization_id", "unit_id", "id");
ALTER TABLE "pos_bill_printing_policies" ADD CONSTRAINT "pos_bill_printing_policies_delivery_check" CHECK (NOT "delivery_auto_print" OR "delivery_printer_id" IS NOT NULL);
--> statement-breakpoint
-- Preserve closed financial history. Open delivery tabs acquire their persisted delivery fee once.
UPDATE "pos_tabs" AS tabs
SET "delivery_fee_cents" = delivery.delivery_fee_cents,
    "total_cents" = tabs.total_cents + delivery.delivery_fee_cents,
    "delivery_address_details" = delivery.address,
    "delivery_zone_id" = delivery.zone_id,
    "updated_at" = now()
FROM "growth_delivery_orders" AS delivery
WHERE delivery.organization_id = tabs.organization_id AND delivery.unit_id = tabs.unit_id
  AND delivery.order_ref = tabs.id AND tabs.status = 'open' AND tabs.fulfillment_type = 'delivery';
