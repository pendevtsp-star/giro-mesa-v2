ALTER TYPE "public"."pos_table_status" ADD VALUE 'needs_cleaning';--> statement-breakpoint
ALTER TYPE "public"."pos_table_status" ADD VALUE 'cleaning';--> statement-breakpoint
ALTER TYPE "public"."role_name" ADD VALUE 'receptionist' BEFORE 'kds';--> statement-breakpoint
ALTER TYPE "public"."role_name" ADD VALUE 'busser' BEFORE 'kds';--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "service_notes" text;