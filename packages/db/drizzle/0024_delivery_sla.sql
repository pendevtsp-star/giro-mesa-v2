ALTER TABLE "growth_delivery_zones" ADD COLUMN "estimated_delivery_minutes" integer DEFAULT 45 NOT NULL;--> statement-breakpoint
ALTER TABLE "growth_delivery_zones" ADD CONSTRAINT "growth_delivery_zone_estimated_minutes_check" CHECK ("estimated_delivery_minutes" between 5 and 240);--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD COLUMN "promised_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "growth_delivery_unit_promised_idx" ON "growth_delivery_orders" ("unit_id", "promised_at");
