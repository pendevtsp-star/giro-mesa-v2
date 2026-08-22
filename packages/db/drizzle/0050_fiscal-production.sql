CREATE TYPE "public"."fiscal_number_invalidation_status" AS ENUM('processing', 'invalidated', 'rejected');--> statement-breakpoint
CREATE TABLE "fiscal_document_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"bytes" integer NOT NULL,
	"content_type" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_document_artifacts_kind_check" CHECK ("fiscal_document_artifacts"."kind" IN ('authorization_xml', 'cancellation_xml', 'danfe_pdf')),
	CONSTRAINT "fiscal_document_artifacts_bytes_check" CHECK ("fiscal_document_artifacts"."bytes" > 0),
	CONSTRAINT "fiscal_document_artifacts_sha_check" CHECK ("fiscal_document_artifacts"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "fiscal_number_invalidations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"environment" "fiscal_environment" NOT NULL,
	"series" varchar(20) NOT NULL,
	"initial_number" integer NOT NULL,
	"final_number" integer NOT NULL,
	"justification" text NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"status" "fiscal_number_invalidation_status" DEFAULT 'processing' NOT NULL,
	"provider_reference" varchar(160),
	"xml_storage_key" text,
	"xml_sha256" varchar(64),
	"error_code" varchar(80),
	"error_message" text,
	"requested_by_identity_id" uuid NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_number_invalidations_range_check" CHECK ("fiscal_number_invalidations"."initial_number" > 0 AND "fiscal_number_invalidations"."final_number" >= "fiscal_number_invalidations"."initial_number")
);
--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD COLUMN "tab_id" uuid;--> statement-breakpoint
ALTER TABLE "fiscal_document_artifacts" ADD CONSTRAINT "fiscal_document_artifacts_document_fk" FOREIGN KEY ("organization_id","unit_id","document_id") REFERENCES "public"."fiscal_documents"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_number_invalidations" ADD CONSTRAINT "fiscal_number_invalidations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_number_invalidations" ADD CONSTRAINT "fiscal_number_invalidations_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_number_invalidations" ADD CONSTRAINT "fiscal_number_invalidations_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_document_artifacts_kind_unique" ON "fiscal_document_artifacts" USING btree ("document_id","kind");--> statement-breakpoint
CREATE INDEX "fiscal_document_artifacts_scope_idx" ON "fiscal_document_artifacts" USING btree ("organization_id","unit_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_number_invalidations_idempotency_unique" ON "fiscal_number_invalidations" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "fiscal_number_invalidations_scope_time_idx" ON "fiscal_number_invalidations" USING btree ("organization_id","unit_id","created_at");--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_tab_fk" FOREIGN KEY ("organization_id","unit_id","tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fiscal_documents_tab_idx" ON "fiscal_documents" USING btree ("organization_id","unit_id","tab_id");