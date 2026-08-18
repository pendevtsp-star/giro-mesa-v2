ALTER TABLE "management_time_tracking_settings" DROP CONSTRAINT IF EXISTS "management_time_tracking_settings_updated_by_fk";
--> statement-breakpoint
ALTER TABLE "management_time_tracking_assignments" DROP CONSTRAINT IF EXISTS "management_time_tracking_assignment_updated_by_fk";
--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" DROP CONSTRAINT IF EXISTS "management_time_entry_break_recorded_by_fk";
--> statement-breakpoint
ALTER TABLE "growth_delivery_courier_assignments" DROP CONSTRAINT IF EXISTS "growth_delivery_assignment_actor_fk";
--> statement-breakpoint
ALTER TABLE "growth_delivery_courier_events" DROP CONSTRAINT IF EXISTS "growth_delivery_courier_event_actor_fk";
--> statement-breakpoint
ALTER TABLE "growth_delivery_notifications" DROP CONSTRAINT IF EXISTS "growth_delivery_notification_actor_fk";
--> statement-breakpoint
ALTER TABLE "growth_delivery_order_status_history" DROP CONSTRAINT IF EXISTS "growth_delivery_history_actor_fk";
--> statement-breakpoint
CREATE TYPE "public"."accountant_request_status" AS ENUM('open', 'resolved');
--> statement-breakpoint
CREATE TYPE "public"."accounting_export_status" AS ENUM('pending', 'ready', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."fiscal_document_model" AS ENUM('nfce', 'nfe', 'nfse');
--> statement-breakpoint
CREATE TYPE "public"."fiscal_document_status" AS ENUM('pending', 'processing', 'authorized', 'rejected', 'contingency', 'canceled');
--> statement-breakpoint
CREATE TYPE "public"."fiscal_environment" AS ENUM('homologation', 'production');
--> statement-breakpoint
CREATE TYPE "public"."fiscal_period_status" AS ENUM('open', 'reviewing', 'closed');
--> statement-breakpoint
CREATE TYPE "public"."fiscal_revision_status" AS ENUM('draft', 'active', 'revoked');
--> statement-breakpoint
CREATE TYPE "public"."management_inventory_item_kind" AS ENUM('ingredient', 'resale', 'reusable', 'returnable_container');
--> statement-breakpoint
CREATE TYPE "public"."management_nfe_import_line_status" AS ENUM('pending', 'matched', 'suggested', 'new', 'conflict', 'ignored');
--> statement-breakpoint
CREATE TYPE "public"."management_nfe_import_status" AS ENUM('staged', 'reviewing', 'ready', 'confirmed', 'canceled', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."management_overview_priority_status" AS ENUM('claimed', 'snoozed', 'resolved');
--> statement-breakpoint
CREATE TYPE "public"."management_purchase_receipt_status" AS ENUM('posted', 'reversed');
--> statement-breakpoint
CREATE TYPE "public"."management_returnable_custody_movement_type" AS ENUM('issue', 'return', 'incident', 'correction', 'supplier_exchange');
--> statement-breakpoint
CREATE TYPE "public"."management_returnable_incident_status" AS ENUM('pending', 'approved', 'rejected');
--> statement-breakpoint
CREATE TYPE "public"."management_returnable_incident_type" AS ENUM('breakage', 'loss', 'suspected_theft', 'recording_error', 'other');
--> statement-breakpoint
CREATE TYPE "public"."management_time_correction_status" AS ENUM('pending', 'approved', 'rejected');
--> statement-breakpoint
ALTER TYPE "public"."role_name" ADD VALUE 'accountant';
--> statement-breakpoint
CREATE TYPE "public"."management_supplier_invoice_status_v2" AS ENUM('pending', 'matched', 'divergent', 'confirmed', 'canceled', 'reversed');
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ALTER COLUMN "status" TYPE "public"."management_supplier_invoice_status_v2" USING "status"::text::"public"."management_supplier_invoice_status_v2";
--> statement-breakpoint
DROP TYPE "public"."management_supplier_invoice_status";
--> statement-breakpoint
ALTER TYPE "public"."management_supplier_invoice_status_v2" RENAME TO "management_supplier_invoice_status";
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ALTER COLUMN "status" SET DEFAULT 'pending';
--> statement-breakpoint
CREATE TABLE "accountant_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"competence" date NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"status" "accountant_request_status" DEFAULT 'open' NOT NULL,
	"due_date" date,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved_by_identity_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"format" varchar(40) NOT NULL,
	"status" "accounting_export_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb,
	"storage_key" text,
	"sha256" varchar(64),
	"requested_by_identity_id" uuid,
	"generated_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_document_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"provider_event_id" varchar(160),
	"type" varchar(80) NOT NULL,
	"status" "fiscal_document_status",
	"code" varchar(40),
	"message" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_document_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"product_id" uuid,
	"tax_revision_id" uuid,
	"line_number" integer NOT NULL,
	"description" varchar(240) NOT NULL,
	"quantity_milli" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"tax_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"order_id" uuid,
	"model" "fiscal_document_model" NOT NULL,
	"environment" "fiscal_environment" NOT NULL,
	"status" "fiscal_document_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"provider_reference" varchar(160),
	"access_key" varchar(64),
	"series" varchar(20),
	"number" integer,
	"total_cents" integer NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"customer_document" varchar(32),
	"snapshot" jsonb NOT NULL,
	"xml_storage_key" text,
	"xml_sha256" varchar(64),
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"authorized_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_documents_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "fiscal_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"competence" date NOT NULL,
	"status" "fiscal_period_status" DEFAULT 'open' NOT NULL,
	"snapshot_sha256" varchar(64),
	"closed_by_identity_id" uuid,
	"closed_at" timestamp with time zone,
	"reopened_by_identity_id" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_periods_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "fiscal_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"tax_regime" varchar(40) NOT NULL,
	"crt" varchar(2) NOT NULL,
	"municipal_registration" varchar(30),
	"cnae" varchar(10),
	"state_code" varchar(2) NOT NULL,
	"city_code" varchar(7) NOT NULL,
	"environment" "fiscal_environment" DEFAULT 'homologation' NOT NULL,
	"provider" varchar(40),
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_by_identity_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_webhook_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_event_id" varchar(160) NOT NULL,
	"body_sha256" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "product_tax_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "fiscal_revision_status" DEFAULT 'draft' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"classification" jsonb NOT NULL,
	"created_by_identity_id" uuid,
	"approved_by_identity_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_tax_revisions_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "management_inventory_supplier_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"supplier_product_code" varchar(120) NOT NULL,
	"supplier_barcode" varchar(80),
	"supplier_description" varchar(240),
	"purchase_unit" varchar(20),
	"purchase_to_stock_factor" numeric(16, 3) DEFAULT '1' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_supplier_aliases_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_supplier_aliases_factor_check" CHECK ("management_inventory_supplier_aliases"."purchase_to_stock_factor" > 0)
);
--> statement-breakpoint
CREATE TABLE "management_nfe_import_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"nfe_import_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"status" "management_nfe_import_line_status" DEFAULT 'pending' NOT NULL,
	"inventory_item_id" uuid,
	"supplier_product_code" varchar(120),
	"gtin" varchar(80),
	"description" varchar(240) NOT NULL,
	"ncm" varchar(10),
	"cfop" varchar(4),
	"purchase_unit" varchar(20) NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"purchase_to_stock_factor" numeric(16, 3) DEFAULT '1' NOT NULL,
	"match_score" numeric(5, 4),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_nfe_import_lines_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_nfe_import_lines_number_check" CHECK ("management_nfe_import_lines"."line_number" > 0),
	CONSTRAINT "management_nfe_import_lines_quantity_check" CHECK ("management_nfe_import_lines"."quantity" > 0),
	CONSTRAINT "management_nfe_import_lines_cost_check" CHECK ("management_nfe_import_lines"."unit_cost_cents" >= 0),
	CONSTRAINT "management_nfe_import_lines_total_check" CHECK ("management_nfe_import_lines"."total_cents" >= 0),
	CONSTRAINT "management_nfe_import_lines_factor_check" CHECK ("management_nfe_import_lines"."purchase_to_stock_factor" > 0),
	CONSTRAINT "management_nfe_import_lines_match_score_check" CHECK ("management_nfe_import_lines"."match_score" is null or ("management_nfe_import_lines"."match_score" >= 0 and "management_nfe_import_lines"."match_score" <= 1))
);
--> statement-breakpoint
CREATE TABLE "management_nfe_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"access_key" varchar(44) NOT NULL,
	"xml_sha256" varchar(64) NOT NULL,
	"xml_content" text NOT NULL,
	"status" "management_nfe_import_status" DEFAULT 'staged' NOT NULL,
	"document_number" varchar(80),
	"issued_at" timestamp with time zone,
	"total_cents" integer,
	"idempotency_key" varchar(160) NOT NULL,
	"imported_by_identity_id" uuid NOT NULL,
	"confirmed_by_identity_id" uuid,
	"confirmed_at" timestamp with time zone,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_nfe_imports_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_nfe_imports_access_key_check" CHECK (length("management_nfe_imports"."access_key") = 44),
	CONSTRAINT "management_nfe_imports_hash_check" CHECK (length("management_nfe_imports"."xml_sha256") = 64),
	CONSTRAINT "management_nfe_imports_total_check" CHECK ("management_nfe_imports"."total_cents" is null or "management_nfe_imports"."total_cents" >= 0),
	CONSTRAINT "management_nfe_imports_confirmation_check" CHECK (("management_nfe_imports"."status" = 'confirmed' and "management_nfe_imports"."confirmed_by_identity_id" is not null and "management_nfe_imports"."confirmed_at" is not null) or "management_nfe_imports"."status" <> 'confirmed')
);
--> statement-breakpoint
CREATE TABLE "management_overview_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"minimum_tone" varchar(10) DEFAULT 'warning' NOT NULL,
	"digest_minutes" integer DEFAULT 15 NOT NULL,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_visited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_overview_preferences_tone_check" CHECK ("management_overview_preferences"."minimum_tone" in ('info', 'warning', 'danger')),
	CONSTRAINT "management_overview_preferences_digest_check" CHECK ("management_overview_preferences"."digest_minutes" between 5 and 1440)
);
--> statement-breakpoint
CREATE TABLE "management_overview_priority_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"priority_id" varchar(80) NOT NULL,
	"occurrence_key" varchar(64) NOT NULL,
	"status" "management_overview_priority_status" NOT NULL,
	"assigned_to_identity_id" uuid,
	"snoozed_until" timestamp with time zone,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_overview_priority_snooze_check" CHECK (("management_overview_priority_states"."status" = 'snoozed' and "management_overview_priority_states"."snoozed_until" is not null) or ("management_overview_priority_states"."status" <> 'snoozed' and "management_overview_priority_states"."snoozed_until" is null))
);
--> statement-breakpoint
CREATE TABLE "management_product_returnables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"container_inventory_item_id" uuid NOT NULL,
	"quantity_per_unit" numeric(16, 3) DEFAULT '1' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_product_returnables_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_product_returnables_quantity_check" CHECK ("management_product_returnables"."quantity_per_unit" > 0)
);
--> statement-breakpoint
CREATE TABLE "management_returnable_custody_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"container_inventory_item_id" uuid NOT NULL,
	"location_id" uuid,
	"type" "management_returnable_custody_movement_type" NOT NULL,
	"quantity_delta" numeric(16, 3) NOT NULL,
	"order_id" uuid,
	"order_item_id" uuid,
	"source_type" varchar(48) NOT NULL,
	"source_id" uuid NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_returnable_custody_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_returnable_custody_delta_check" CHECK ("management_returnable_custody_movements"."quantity_delta" <> 0),
	CONSTRAINT "management_returnable_custody_direction_check" CHECK (("management_returnable_custody_movements"."type" = 'issue' and "management_returnable_custody_movements"."quantity_delta" > 0) or ("management_returnable_custody_movements"."type" in ('return', 'incident', 'supplier_exchange') and "management_returnable_custody_movements"."quantity_delta" < 0) or ("management_returnable_custody_movements"."type" = 'correction' and "management_returnable_custody_movements"."quantity_delta" <> 0))
);
--> statement-breakpoint
CREATE TABLE "management_returnable_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"container_inventory_item_id" uuid NOT NULL,
	"location_id" uuid,
	"custody_movement_id" uuid,
	"type" "management_returnable_incident_type" NOT NULL,
	"status" "management_returnable_incident_status" DEFAULT 'pending' NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"estimated_cost_cents" integer,
	"notes" text NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"approver_identity_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_returnable_incidents_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_returnable_incidents_quantity_check" CHECK ("management_returnable_incidents"."quantity" > 0),
	CONSTRAINT "management_returnable_incidents_cost_check" CHECK ("management_returnable_incidents"."estimated_cost_cents" is null or "management_returnable_incidents"."estimated_cost_cents" >= 0),
	CONSTRAINT "management_returnable_incidents_review_check" CHECK (("management_returnable_incidents"."status" = 'pending' and "management_returnable_incidents"."approver_identity_id" is null and "management_returnable_incidents"."reviewed_at" is null) or ("management_returnable_incidents"."status" in ('approved', 'rejected') and "management_returnable_incidents"."approver_identity_id" is not null and "management_returnable_incidents"."reviewed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "management_time_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"requested_clocked_in_at" timestamp with time zone NOT NULL,
	"requested_clocked_out_at" timestamp with time zone,
	"reason" varchar(1000) NOT NULL,
	"status" "management_time_correction_status" DEFAULT 'pending' NOT NULL,
	"requested_by_identity_id" uuid NOT NULL,
	"reviewed_by_identity_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_time_corrections_window_check" CHECK ("management_time_corrections"."requested_clocked_out_at" is null or "management_time_corrections"."requested_clocked_out_at" > "management_time_corrections"."requested_clocked_in_at")
);
--> statement-breakpoint
DROP INDEX IF EXISTS "management_purchase_orders_status_idx";
--> statement-breakpoint
ALTER TABLE "growth_customers" ADD COLUMN "idempotency_key" varchar(180) NOT NULL;
--> statement-breakpoint
ALTER TABLE "growth_customers" ADD COLUMN "request_fingerprint" varchar(64) NOT NULL;
--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD COLUMN "kind" "management_inventory_item_kind" DEFAULT 'ingredient' NOT NULL;
--> statement-breakpoint
UPDATE "management_inventory_items" SET "kind" = 'resale' WHERE "product_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "management_purchase_receipts" ADD COLUMN "status" "management_purchase_receipt_status" DEFAULT 'posted' NOT NULL;
--> statement-breakpoint
ALTER TABLE "management_purchase_receipts" ADD COLUMN "reversal_reason" text;
--> statement-breakpoint
ALTER TABLE "management_purchase_receipts" ADD COLUMN "reversed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "management_purchase_receipts" ADD COLUMN "reversed_by_identity_id" uuid;
--> statement-breakpoint
ALTER TABLE "management_purchase_receipts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD COLUMN "access_key" varchar(44);
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD COLUMN "xml_content" text;
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD COLUMN "series" varchar(3);
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD COLUMN "model" varchar(2);
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD COLUMN "tax_total_cents" integer;
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD COLUMN "reversal_reason" text;
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD COLUMN "reversed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD COLUMN "reversed_by_identity_id" uuid;
--> statement-breakpoint
ALTER TABLE "accountant_requests" ADD CONSTRAINT "accountant_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accountant_requests" ADD CONSTRAINT "accountant_requests_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accountant_requests" ADD CONSTRAINT "accountant_requests_resolved_by_identity_id_identities_id_fk" FOREIGN KEY ("resolved_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accountant_requests" ADD CONSTRAINT "accountant_requests_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_exports" ADD CONSTRAINT "accounting_exports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_exports" ADD CONSTRAINT "accounting_exports_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_exports" ADD CONSTRAINT "accounting_exports_period_fk" FOREIGN KEY ("organization_id","unit_id","period_id") REFERENCES "public"."fiscal_periods"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_document_events" ADD CONSTRAINT "fiscal_document_events_document_fk" FOREIGN KEY ("organization_id","unit_id","document_id") REFERENCES "public"."fiscal_documents"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_document_items" ADD CONSTRAINT "fiscal_document_items_document_fk" FOREIGN KEY ("organization_id","unit_id","document_id") REFERENCES "public"."fiscal_documents"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_document_items" ADD CONSTRAINT "fiscal_document_items_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_document_items" ADD CONSTRAINT "fiscal_document_items_revision_fk" FOREIGN KEY ("organization_id","unit_id","tax_revision_id") REFERENCES "public"."product_tax_revisions"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_order_fk" FOREIGN KEY ("organization_id","unit_id","order_id") REFERENCES "public"."pos_orders"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_closed_by_identity_id_identities_id_fk" FOREIGN KEY ("closed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_reopened_by_identity_id_identities_id_fk" FOREIGN KEY ("reopened_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_profiles" ADD CONSTRAINT "fiscal_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_profiles" ADD CONSTRAINT "fiscal_profiles_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_profiles" ADD CONSTRAINT "fiscal_profiles_approved_by_identity_id_identities_id_fk" FOREIGN KEY ("approved_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_profiles" ADD CONSTRAINT "fiscal_profiles_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fiscal_webhook_receipts" ADD CONSTRAINT "fiscal_webhook_receipts_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_tax_revisions" ADD CONSTRAINT "product_tax_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_tax_revisions" ADD CONSTRAINT "product_tax_revisions_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_tax_revisions" ADD CONSTRAINT "product_tax_revisions_approved_by_identity_id_identities_id_fk" FOREIGN KEY ("approved_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_tax_revisions" ADD CONSTRAINT "product_tax_revisions_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_tax_revisions" ADD CONSTRAINT "product_tax_revisions_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_delivery_courier_assignments" ADD CONSTRAINT "growth_delivery_courier_assignments_assigned_by_identity_id_identities_id_fk" FOREIGN KEY ("assigned_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_delivery_courier_events" ADD CONSTRAINT "growth_delivery_courier_events_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_delivery_notifications" ADD CONSTRAINT "growth_delivery_notifications_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_delivery_order_status_history" ADD CONSTRAINT "growth_delivery_order_status_history_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_inventory_supplier_aliases" ADD CONSTRAINT "management_inventory_supplier_aliases_supplier_fk" FOREIGN KEY ("organization_id","unit_id","supplier_id") REFERENCES "public"."management_suppliers"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_inventory_supplier_aliases" ADD CONSTRAINT "management_inventory_supplier_aliases_item_fk" FOREIGN KEY ("organization_id","unit_id","inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_nfe_import_lines" ADD CONSTRAINT "management_nfe_import_lines_import_fk" FOREIGN KEY ("organization_id","unit_id","nfe_import_id") REFERENCES "public"."management_nfe_imports"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_nfe_import_lines" ADD CONSTRAINT "management_nfe_import_lines_item_fk" FOREIGN KEY ("organization_id","unit_id","inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_nfe_imports" ADD CONSTRAINT "management_nfe_imports_imported_by_identity_id_identities_id_fk" FOREIGN KEY ("imported_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_nfe_imports" ADD CONSTRAINT "management_nfe_imports_confirmed_by_identity_id_identities_id_fk" FOREIGN KEY ("confirmed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_nfe_imports" ADD CONSTRAINT "management_nfe_imports_supplier_fk" FOREIGN KEY ("organization_id","unit_id","supplier_id") REFERENCES "public"."management_suppliers"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_nfe_imports" ADD CONSTRAINT "management_nfe_imports_order_fk" FOREIGN KEY ("organization_id","unit_id","purchase_order_id") REFERENCES "public"."management_purchase_orders"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_overview_preferences" ADD CONSTRAINT "management_overview_preferences_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_overview_preferences" ADD CONSTRAINT "management_overview_preferences_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_overview_priority_states" ADD CONSTRAINT "management_overview_priority_states_assigned_to_identity_id_identities_id_fk" FOREIGN KEY ("assigned_to_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_overview_priority_states" ADD CONSTRAINT "management_overview_priority_states_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_overview_priority_states" ADD CONSTRAINT "management_overview_priority_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_product_returnables" ADD CONSTRAINT "management_product_returnables_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_product_returnables" ADD CONSTRAINT "management_product_returnables_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_product_returnables" ADD CONSTRAINT "management_product_returnables_container_fk" FOREIGN KEY ("organization_id","unit_id","container_inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_custody_movements" ADD CONSTRAINT "management_returnable_custody_movements_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_custody_movements" ADD CONSTRAINT "management_returnable_custody_container_fk" FOREIGN KEY ("organization_id","unit_id","container_inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_custody_movements" ADD CONSTRAINT "management_returnable_custody_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_custody_movements" ADD CONSTRAINT "management_returnable_custody_order_fk" FOREIGN KEY ("organization_id","unit_id","order_id") REFERENCES "public"."pos_orders"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_custody_movements" ADD CONSTRAINT "management_returnable_custody_order_item_fk" FOREIGN KEY ("organization_id","unit_id","order_item_id") REFERENCES "public"."pos_order_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_incidents" ADD CONSTRAINT "management_returnable_incidents_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_incidents" ADD CONSTRAINT "management_returnable_incidents_approver_identity_id_identities_id_fk" FOREIGN KEY ("approver_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_incidents" ADD CONSTRAINT "management_returnable_incidents_container_fk" FOREIGN KEY ("organization_id","unit_id","container_inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_incidents" ADD CONSTRAINT "management_returnable_incidents_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_incidents" ADD CONSTRAINT "management_returnable_incidents_movement_fk" FOREIGN KEY ("organization_id","unit_id","custody_movement_id") REFERENCES "public"."management_returnable_custody_movements"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_time_corrections" ADD CONSTRAINT "management_time_corrections_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_time_corrections" ADD CONSTRAINT "management_time_corrections_reviewed_by_identity_id_identities_id_fk" FOREIGN KEY ("reviewed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_time_corrections" ADD CONSTRAINT "management_time_corrections_person_fk" FOREIGN KEY ("organization_id","unit_id","person_id") REFERENCES "public"."management_people"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_time_corrections" ADD CONSTRAINT "management_time_corrections_entry_fk" FOREIGN KEY ("organization_id","unit_id","time_entry_id") REFERENCES "public"."management_time_entries"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD CONSTRAINT "management_time_entry_breaks_recorded_by_identity_id_identities_id_fk" FOREIGN KEY ("recorded_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_time_tracking_assignments" ADD CONSTRAINT "management_time_tracking_assignments_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_time_tracking_settings" ADD CONSTRAINT "management_time_tracking_settings_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "accountant_requests_idempotency_unique" ON "accountant_requests" USING btree ("organization_id","unit_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "accountant_requests_unit_status_idx" ON "accountant_requests" USING btree ("organization_id","unit_id","status");
--> statement-breakpoint
CREATE INDEX "accountant_requests_competence_idx" ON "accountant_requests" USING btree ("organization_id","unit_id","competence");
--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_exports_period_format_unique" ON "accounting_exports" USING btree ("period_id","format");
--> statement-breakpoint
CREATE INDEX "accounting_exports_unit_time_idx" ON "accounting_exports" USING btree ("organization_id","unit_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_document_events_provider_unique" ON "fiscal_document_events" USING btree ("organization_id","provider_event_id");
--> statement-breakpoint
CREATE INDEX "fiscal_document_events_document_time_idx" ON "fiscal_document_events" USING btree ("document_id","occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_document_items_line_unique" ON "fiscal_document_items" USING btree ("document_id","line_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_documents_idempotency_unique" ON "fiscal_documents" USING btree ("organization_id","unit_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_documents_provider_reference_unique" ON "fiscal_documents" USING btree ("organization_id","provider_reference");
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_documents_access_key_unique" ON "fiscal_documents" USING btree ("access_key");
--> statement-breakpoint
CREATE INDEX "fiscal_documents_unit_status_time_idx" ON "fiscal_documents" USING btree ("organization_id","unit_id","status","issued_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_periods_competence_unique" ON "fiscal_periods" USING btree ("organization_id","unit_id","competence");
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_profiles_unit_unique" ON "fiscal_profiles" USING btree ("organization_id","unit_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_webhook_receipts_provider_event_unique" ON "fiscal_webhook_receipts" USING btree ("organization_id","provider","provider_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_tax_revisions_version_unique" ON "product_tax_revisions" USING btree ("organization_id","unit_id","product_id","version");
--> statement-breakpoint
CREATE INDEX "product_tax_revisions_active_idx" ON "product_tax_revisions" USING btree ("organization_id","unit_id","status","effective_from");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_supplier_aliases_code_unique" ON "management_inventory_supplier_aliases" USING btree ("organization_id","unit_id","supplier_id","supplier_product_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_supplier_aliases_barcode_unique" ON "management_inventory_supplier_aliases" USING btree ("organization_id","unit_id","supplier_id","supplier_barcode") WHERE "management_inventory_supplier_aliases"."supplier_barcode" is not null;
--> statement-breakpoint
CREATE INDEX "management_inventory_supplier_aliases_item_idx" ON "management_inventory_supplier_aliases" USING btree ("organization_id","unit_id","inventory_item_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_nfe_import_lines_number_unique" ON "management_nfe_import_lines" USING btree ("organization_id","unit_id","nfe_import_id","line_number");
--> statement-breakpoint
CREATE INDEX "management_nfe_import_lines_status_idx" ON "management_nfe_import_lines" USING btree ("organization_id","unit_id","nfe_import_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_nfe_imports_access_key_unique" ON "management_nfe_imports" USING btree ("access_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_nfe_imports_idempotency_unique" ON "management_nfe_imports" USING btree ("organization_id","unit_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "management_nfe_imports_hash_idx" ON "management_nfe_imports" USING btree ("organization_id","unit_id","xml_sha256");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_overview_preferences_identity_unique" ON "management_overview_preferences" USING btree ("organization_id","unit_id","identity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_overview_priority_occurrence_unique" ON "management_overview_priority_states" USING btree ("organization_id","unit_id","priority_id","occurrence_key");
--> statement-breakpoint
CREATE INDEX "management_overview_priority_active_idx" ON "management_overview_priority_states" USING btree ("organization_id","unit_id","status","snoozed_until");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_product_returnables_product_container_unique" ON "management_product_returnables" USING btree ("organization_id","unit_id","product_id","container_inventory_item_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_returnable_custody_idempotency_unique" ON "management_returnable_custody_movements" USING btree ("organization_id","unit_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_returnable_custody_source_unique" ON "management_returnable_custody_movements" USING btree ("organization_id","unit_id","source_type","source_id","container_inventory_item_id");
--> statement-breakpoint
CREATE INDEX "management_returnable_custody_ledger_idx" ON "management_returnable_custody_movements" USING btree ("organization_id","unit_id","container_inventory_item_id","occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_returnable_incidents_movement_unique" ON "management_returnable_incidents" USING btree ("organization_id","unit_id","custody_movement_id") WHERE "management_returnable_incidents"."custody_movement_id" is not null;
--> statement-breakpoint
CREATE INDEX "management_returnable_incidents_status_idx" ON "management_returnable_incidents" USING btree ("organization_id","unit_id","status","occurred_at");
--> statement-breakpoint
CREATE INDEX "management_time_corrections_scope_status_idx" ON "management_time_corrections" USING btree ("organization_id","unit_id","status","created_at");
--> statement-breakpoint
ALTER TABLE "management_purchase_receipts" ADD CONSTRAINT "management_purchase_receipts_reversed_by_identity_id_identities_id_fk" FOREIGN KEY ("reversed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD CONSTRAINT "management_supplier_invoices_reversed_by_identity_id_identities_id_fk" FOREIGN KEY ("reversed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "management_purchase_orders_created_idx" ON "management_purchase_orders" USING btree ("organization_id","unit_id","created_at");
--> statement-breakpoint
CREATE INDEX "management_purchase_orders_supplier_created_idx" ON "management_purchase_orders" USING btree ("organization_id","unit_id","supplier_id","created_at");
--> statement-breakpoint
CREATE INDEX "management_purchase_receipt_lines_order_item_idx" ON "management_purchase_receipt_lines" USING btree ("organization_id","unit_id","purchase_order_item_id");
--> statement-breakpoint
CREATE INDEX "management_purchase_receipts_order_idx" ON "management_purchase_receipts" USING btree ("organization_id","unit_id","purchase_order_id","received_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_supplier_invoices_access_key_unique" ON "management_supplier_invoices" USING btree ("access_key") WHERE "management_supplier_invoices"."access_key" is not null;
--> statement-breakpoint
CREATE INDEX "management_supplier_invoice_lines_order_item_idx" ON "management_supplier_invoice_lines" USING btree ("organization_id","unit_id","purchase_order_item_id");
--> statement-breakpoint
CREATE INDEX "management_purchase_orders_status_idx" ON "management_purchase_orders" USING btree ("organization_id","unit_id","status","created_at");
--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" ADD CONSTRAINT "management_purchase_receipt_lines_total_check" CHECK ("management_purchase_receipt_lines"."total_cents" > 0);
--> statement-breakpoint
ALTER TABLE "management_purchase_receipts" ADD CONSTRAINT "management_purchase_receipts_version_check" CHECK ("management_purchase_receipts"."version" > 0);
--> statement-breakpoint
ALTER TABLE "management_purchase_receipts" ADD CONSTRAINT "management_purchase_receipts_reversal_check" CHECK (("management_purchase_receipts"."status" = 'posted' and "management_purchase_receipts"."reversal_reason" is null and "management_purchase_receipts"."reversed_at" is null and "management_purchase_receipts"."reversed_by_identity_id" is null) or ("management_purchase_receipts"."status" = 'reversed' and "management_purchase_receipts"."reversal_reason" is not null and length(trim("management_purchase_receipts"."reversal_reason")) > 0 and "management_purchase_receipts"."reversed_at" is not null and "management_purchase_receipts"."reversed_by_identity_id" is not null and "management_purchase_receipts"."reversed_at" >= "management_purchase_receipts"."received_at"));
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD CONSTRAINT "management_supplier_invoices_access_key_check" CHECK ("management_supplier_invoices"."access_key" is null or "management_supplier_invoices"."access_key" ~ '^[0-9]{44}$');
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD CONSTRAINT "management_supplier_invoices_xml_check" CHECK ("management_supplier_invoices"."xml_content" is null or (octet_length("management_supplier_invoices"."xml_content") > 0 and octet_length("management_supplier_invoices"."xml_content") <= 2097152));
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD CONSTRAINT "management_supplier_invoices_nfe_fields_check" CHECK (("management_supplier_invoices"."access_key" is null and "management_supplier_invoices"."xml_content" is null and "management_supplier_invoices"."series" is null and "management_supplier_invoices"."model" is null and "management_supplier_invoices"."tax_total_cents" is null) or ("management_supplier_invoices"."access_key" is not null and "management_supplier_invoices"."xml_content" is not null and "management_supplier_invoices"."series" is not null and "management_supplier_invoices"."series" ~ '^[0-9]{1,3}$' and "management_supplier_invoices"."model" is not null and "management_supplier_invoices"."model" ~ '^[0-9]{2}$' and "management_supplier_invoices"."tax_total_cents" is not null and "management_supplier_invoices"."tax_total_cents" >= 0));
--> statement-breakpoint
ALTER TABLE "management_supplier_invoices" ADD CONSTRAINT "management_supplier_invoices_reversal_check" CHECK (("management_supplier_invoices"."status"::text = 'reversed' and "management_supplier_invoices"."reversal_reason" is not null and length(trim("management_supplier_invoices"."reversal_reason")) > 0 and "management_supplier_invoices"."reversed_at" is not null and "management_supplier_invoices"."reversed_by_identity_id" is not null and "management_supplier_invoices"."reversed_at" >= "management_supplier_invoices"."created_at") or ("management_supplier_invoices"."status"::text <> 'reversed' and "management_supplier_invoices"."reversal_reason" is null and "management_supplier_invoices"."reversed_at" is null and "management_supplier_invoices"."reversed_by_identity_id" is null));
