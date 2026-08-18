CREATE TYPE "public"."pos_print_document_type" AS ENUM('partial_statement', 'payment_statement', 'final_receipt');--> statement-breakpoint
CREATE TYPE "public"."pos_print_job_status" AS ENUM('queued', 'printing', 'printed', 'failed');--> statement-breakpoint
CREATE TABLE "pos_print_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"tab_id" uuid NOT NULL,
	"document_type" "pos_print_document_type" NOT NULL,
	"status" "pos_print_job_status" DEFAULT 'queued' NOT NULL,
	"copies" integer DEFAULT 1 NOT NULL,
	"terminal_id" varchar(120),
	"printer_id" varchar(120),
	"payload" jsonb NOT NULL,
	"requested_by_identity_id" uuid NOT NULL,
	"reprint_of_job_id" uuid,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"printing_at" timestamp with time zone,
	"printed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_print_jobs_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_print_jobs_copies_check" CHECK ("pos_print_jobs"."copies" BETWEEN 1 AND 10),
	CONSTRAINT "pos_print_jobs_attempts_check" CHECK ("pos_print_jobs"."attempts" >= 0),
	CONSTRAINT "pos_print_jobs_state_timestamps_check" CHECK (("pos_print_jobs"."status" <> 'printing' OR "pos_print_jobs"."printing_at" IS NOT NULL)
        AND ("pos_print_jobs"."status" <> 'printed' OR "pos_print_jobs"."printed_at" IS NOT NULL)
        AND ("pos_print_jobs"."status" <> 'failed' OR ("pos_print_jobs"."failed_at" IS NOT NULL AND "pos_print_jobs"."last_error" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD CONSTRAINT "pos_print_jobs_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD CONSTRAINT "pos_print_jobs_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD CONSTRAINT "pos_print_jobs_tab_fk" FOREIGN KEY ("organization_id","unit_id","tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_print_jobs_queue_idx" ON "pos_print_jobs" USING btree ("organization_id","unit_id","status","created_at");--> statement-breakpoint
CREATE INDEX "pos_print_jobs_tab_idx" ON "pos_print_jobs" USING btree ("organization_id","unit_id","tab_id","created_at");