ALTER TABLE "pos_products" ALTER COLUMN "image_url" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "pos_combos" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "pos_products" ADD COLUMN "estimated_prep_time_minutes" integer;