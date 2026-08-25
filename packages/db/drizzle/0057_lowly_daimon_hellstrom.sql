ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "source" varchar(32) DEFAULT 'ops' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_orders" DROP CONSTRAINT IF EXISTS "pos_orders_source_check";--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_source_check" CHECK ("pos_orders"."source" IN ('ops', 'qr_table'));
