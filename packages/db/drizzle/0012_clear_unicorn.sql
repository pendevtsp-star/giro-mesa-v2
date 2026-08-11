ALTER TABLE "pos_dining_tables" ADD COLUMN "occupancy_epoch" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_dining_tables" ADD COLUMN "resource_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_dining_tables" ADD CONSTRAINT "pos_tables_resource_version_check" CHECK ("pos_dining_tables"."resource_version" >= 0);