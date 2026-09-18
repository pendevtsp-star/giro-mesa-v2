ALTER TABLE "management_inventory_items" DROP CONSTRAINT "management_inventory_items_kind_product_check";--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD CONSTRAINT "management_inventory_items_optional_resale_product_check" CHECK ("management_inventory_items"."kind" = 'resale' or "management_inventory_items"."product_id" is null);
