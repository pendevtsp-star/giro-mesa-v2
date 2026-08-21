CREATE TYPE "public"."command_inbox_status" AS ENUM('applied', 'quarantined', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."command_quarantine_status" AS ENUM('pending', 'recovered');--> statement-breakpoint
CREATE TYPE "public"."management_returnable_supplier_exchange_status" AS ENUM('in_transit', 'received', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."management_stock_location_kind" AS ENUM('warehouse', 'cooler', 'freezer', 'bar', 'kitchen', 'returnables', 'other');--> statement-breakpoint
CREATE TYPE "public"."management_report_alert_status" AS ENUM('open', 'claimed', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."management_report_cost_confidence" AS ENUM('exact', 'estimated');--> statement-breakpoint
CREATE TYPE "public"."management_report_view_visibility" AS ENUM('private', 'unit', 'organization');--> statement-breakpoint
ALTER TYPE "public"."management_report_export_format" ADD VALUE 'pdf';--> statement-breakpoint
ALTER TYPE "public"."management_report_export_format" ADD VALUE 'xlsx';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doseclub_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"state_id" uuid,
	"external_club_id" varchar(180) NOT NULL,
	"operation_id" varchar(180) NOT NULL,
	"original_operation_id" varchar(180),
	"idempotency_key" varchar(180) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"contract_version" varchar(8) NOT NULL,
	"operation" varchar(24) NOT NULL,
	"version" integer NOT NULL,
	"outcome" varchar(24) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doseclub_operations_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "doseclub_operations_contract_check" CHECK ("doseclub_operations"."contract_version" in ('v1','v2')),
	CONSTRAINT "doseclub_operations_operation_check" CHECK ("doseclub_operations"."operation" in ('sale','reservation','consumption','reversal','reconcile')),
	CONSTRAINT "doseclub_operations_version_check" CHECK ("doseclub_operations"."version" >= 0),
	CONSTRAINT "doseclub_operations_outcome_check" CHECK ("doseclub_operations"."outcome" in ('accepted','duplicate','reconciled'))
);
--> statement-breakpoint
ALTER TABLE "doseclub_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doseclub_product_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"external_product_id" varchar(180) NOT NULL,
	"product_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"stock_location_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doseclub_product_mappings_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "doseclub_product_mappings_version_check" CHECK ("doseclub_product_mappings"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "doseclub_product_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doseclub_reconciliation_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"last_run_id" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"kind" varchar(48) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"severity" varchar(16) NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"entity_id" varchar(180) NOT NULL,
	"summary" varchar(300) NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doseclub_reconciliation_findings_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "doseclub_reconciliation_findings_kind_check" CHECK ("doseclub_reconciliation_findings"."kind" in ('missing_mapping','inactive_mapping','invalid_inventory_dimension','invalid_inventory_unit','state_version_gap','missing_reconcile_heartbeat')),
	CONSTRAINT "doseclub_reconciliation_findings_status_check" CHECK ("doseclub_reconciliation_findings"."status" in ('open','resolved','superseded')),
	CONSTRAINT "doseclub_reconciliation_findings_severity_check" CHECK ("doseclub_reconciliation_findings"."severity" in ('warning','critical')),
	CONSTRAINT "doseclub_reconciliation_findings_version_check" CHECK ("doseclub_reconciliation_findings"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "doseclub_reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"run_date" date NOT NULL,
	"trigger" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(180),
	"request_fingerprint" varchar(64),
	"requested_by_identity_id" uuid,
	"lease_owner" varchar(120),
	"lease_until" timestamp with time zone,
	"finding_count" integer DEFAULT 0 NOT NULL,
	"failure_code" varchar(80),
	"version" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doseclub_reconciliation_runs_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "doseclub_reconciliation_runs_trigger_check" CHECK ("doseclub_reconciliation_runs"."trigger" in ('scheduled','manual','retry')),
	CONSTRAINT "doseclub_reconciliation_runs_status_check" CHECK ("doseclub_reconciliation_runs"."status" in ('pending','running','completed','failed')),
	CONSTRAINT "doseclub_reconciliation_runs_version_check" CHECK ("doseclub_reconciliation_runs"."version" > 0),
	CONSTRAINT "doseclub_reconciliation_runs_idempotency_check" CHECK (("doseclub_reconciliation_runs"."idempotency_key" is null and "doseclub_reconciliation_runs"."request_fingerprint" is null) or ("doseclub_reconciliation_runs"."idempotency_key" is not null and "doseclub_reconciliation_runs"."request_fingerprint" is not null))
);
--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doseclub_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"external_club_id" varchar(180) NOT NULL,
	"external_offer_id" varchar(180),
	"external_customer_id" varchar(180),
	"sale_type" varchar(24) NOT NULL,
	"eligible_product_ids" jsonb NOT NULL,
	"purchase_snapshot" jsonb NOT NULL,
	"contract_version" varchar(8) NOT NULL,
	"version" integer NOT NULL,
	"remaining_doses" integer NOT NULL,
	"reserved_doses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doseclub_states_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "doseclub_states_external_scope_unique" UNIQUE("organization_id","unit_id","external_club_id"),
	CONSTRAINT "doseclub_states_sale_type_check" CHECK ("doseclub_states"."sale_type" in ('individual','combo_pool')),
	CONSTRAINT "doseclub_states_contract_check" CHECK ("doseclub_states"."contract_version" in ('v1','v2')),
	CONSTRAINT "doseclub_states_version_check" CHECK ("doseclub_states"."version" >= 0),
	CONSTRAINT "doseclub_states_doses_check" CHECK ("doseclub_states"."remaining_doses" >= 0 and "doseclub_states"."reserved_doses" >= 0 and "doseclub_states"."reserved_doses" <= "doseclub_states"."remaining_doses")
);
--> statement-breakpoint
ALTER TABLE "doseclub_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aggregate_sequence_states" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"occupancy_epoch" uuid NOT NULL,
	"last_sequence" integer NOT NULL,
	"resource_version" integer NOT NULL,
	"last_command_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aggregate_sequence_states_organization_id_unit_id_aggregate_type_aggregate_id_occupancy_epoch_pk" PRIMARY KEY("organization_id","unit_id","aggregate_type","aggregate_id","occupancy_epoch"),
	CONSTRAINT "aggregate_sequence_states_last_sequence_check" CHECK ("aggregate_sequence_states"."last_sequence" > 0),
	CONSTRAINT "aggregate_sequence_states_resource_version_check" CHECK ("aggregate_sequence_states"."resource_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "aggregate_sequence_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "command_inbox" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"fingerprint_key_version" varchar(32) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"command_type" varchar(100) NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"occupancy_epoch" uuid NOT NULL,
	"resource_version" integer NOT NULL,
	"aggregate_sequence" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "command_inbox_status" NOT NULL,
	"precondition_code" varchar(100),
	"result" jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "command_inbox_organization_id_unit_id_command_id_pk" PRIMARY KEY("organization_id","unit_id","command_id"),
	CONSTRAINT "command_inbox_resource_version_check" CHECK ("command_inbox"."resource_version" >= 0),
	CONSTRAINT "command_inbox_aggregate_sequence_check" CHECK ("command_inbox"."aggregate_sequence" > 0),
	CONSTRAINT "command_inbox_fingerprint_check" CHECK ("command_inbox"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "command_inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "command_quarantine" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"reason" varchar(100) NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" "command_quarantine_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recovered_at" timestamp with time zone,
	CONSTRAINT "command_quarantine_organization_id_unit_id_command_id_pk" PRIMARY KEY("organization_id","unit_id","command_id")
);
--> statement-breakpoint
ALTER TABLE "command_quarantine" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "management_inventory_issue_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"station_id" uuid,
	"location_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_issue_routes_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "management_inventory_transfer_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"quantity_received" numeric(16, 3) DEFAULT '0' NOT NULL,
	"quantity_divergent" numeric(16, 3) DEFAULT '0' NOT NULL,
	"divergence_reason" text,
	"evidence_metadata" jsonb DEFAULT '{"urls":[]}'::jsonb NOT NULL,
	"note" text NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"received_by_identity_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_transfer_receipts_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_transfer_receipts_quantity_check" CHECK ("management_inventory_transfer_receipts"."quantity_received" >= 0 and "management_inventory_transfer_receipts"."quantity_divergent" >= 0 and "management_inventory_transfer_receipts"."quantity_received" + "management_inventory_transfer_receipts"."quantity_divergent" > 0),
	CONSTRAINT "management_inventory_transfer_receipts_divergence_check" CHECK ("management_inventory_transfer_receipts"."quantity_divergent" = 0 or length(trim("management_inventory_transfer_receipts"."divergence_reason")) >= 3)
);
--> statement-breakpoint
CREATE TABLE "management_returnable_supplier_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"container_inventory_item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"status" "management_returnable_supplier_exchange_status" DEFAULT 'in_transit' NOT NULL,
	"note" text NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"sent_by_identity_id" uuid NOT NULL,
	"received_by_identity_id" uuid,
	"canceled_by_identity_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_returnable_supplier_exchanges_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_returnable_supplier_exchanges_quantity_check" CHECK ("management_returnable_supplier_exchanges"."quantity" > 0),
	CONSTRAINT "management_returnable_supplier_exchanges_status_check" CHECK (("management_returnable_supplier_exchanges"."status" = 'in_transit' and "management_returnable_supplier_exchanges"."received_at" is null and "management_returnable_supplier_exchanges"."canceled_at" is null) or ("management_returnable_supplier_exchanges"."status" = 'received' and "management_returnable_supplier_exchanges"."received_at" is not null and "management_returnable_supplier_exchanges"."received_by_identity_id" is not null and "management_returnable_supplier_exchanges"."canceled_at" is null) or ("management_returnable_supplier_exchanges"."status" = 'canceled' and "management_returnable_supplier_exchanges"."canceled_at" is not null and "management_returnable_supplier_exchanges"."canceled_by_identity_id" is not null and "management_returnable_supplier_exchanges"."received_at" is null))
);
--> statement-breakpoint
CREATE TABLE "management_stock_location_item_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"minimum_quantity" numeric(16, 3) DEFAULT '0' NOT NULL,
	"target_quantity" numeric(16, 3) DEFAULT '0' NOT NULL,
	"transfer_unit_label" varchar(40),
	"units_per_transfer_unit" numeric(16, 3) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_stock_location_item_settings_unique" UNIQUE("organization_id","unit_id","location_id","inventory_item_id"),
	CONSTRAINT "management_stock_location_item_settings_values_check" CHECK ("management_stock_location_item_settings"."minimum_quantity" >= 0 and "management_stock_location_item_settings"."target_quantity" >= "management_stock_location_item_settings"."minimum_quantity" and "management_stock_location_item_settings"."units_per_transfer_unit" > 0)
);
--> statement-breakpoint
CREATE TABLE "pos_kds_item_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"revision" varchar(64) NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"acknowledged_by_identity_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_kds_item_changes_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_kds_item_changes_kind_check" CHECK ("pos_kds_item_changes"."kind" IN ('added', 'updated', 'removed')),
	CONSTRAINT "pos_kds_item_changes_revision_check" CHECK ("pos_kds_item_changes"."revision" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pos_kds_item_changes_ack_check" CHECK (("pos_kds_item_changes"."acknowledged_at" IS NULL AND "pos_kds_item_changes"."acknowledged_by_identity_id" IS NULL) OR ("pos_kds_item_changes"."acknowledged_at" IS NOT NULL AND "pos_kds_item_changes"."acknowledged_by_identity_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "pos_terminal_profiles" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"mode" varchar(32) NOT NULL,
	"default_route" varchar(48) NOT NULL,
	"printer_id" varchar(120),
	"station_id" uuid,
	"compact" boolean DEFAULT true NOT NULL,
	"quick_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_terminal_profiles_organization_id_unit_id_installation_id_pk" PRIMARY KEY("organization_id","unit_id","installation_id"),
	CONSTRAINT "pos_terminal_profiles_mode_check" CHECK ("pos_terminal_profiles"."mode" IN ('waiter_mobile', 'reception', 'cashier', 'kds', 'expedition', 'shared')),
	CONSTRAINT "pos_terminal_profiles_route_check" CHECK ("pos_terminal_profiles"."default_route" IN ('dashboard', 'reservations', 'salon', 'counter', 'cash', 'kds'))
);
--> statement-breakpoint
CREATE TABLE "management_report_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"occurrence_key" varchar(160) NOT NULL,
	"kind" varchar(80) NOT NULL,
	"title" varchar(180) NOT NULL,
	"detail" text NOT NULL,
	"severity" varchar(12) NOT NULL,
	"status" "management_report_alert_status" DEFAULT 'open' NOT NULL,
	"actual_cents" integer,
	"target_cents" integer,
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assigned_to_identity_id" uuid,
	"due_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by_identity_id" uuid,
	"updated_by_identity_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_report_alerts_severity_check" CHECK ("management_report_alerts"."severity" in ('info','warning','critical')),
	CONSTRAINT "management_report_alerts_resolution_check" CHECK (("management_report_alerts"."status" = 'resolved' and "management_report_alerts"."resolved_at" is not null and "management_report_alerts"."resolved_by_identity_id" is not null) or ("management_report_alerts"."status" <> 'resolved' and "management_report_alerts"."resolved_at" is null and "management_report_alerts"."resolved_by_identity_id" is null)),
	CONSTRAINT "management_report_alerts_version_check" CHECK ("management_report_alerts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "management_report_cost_backfills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"allow_estimated" boolean DEFAULT false NOT NULL,
	"exact_count" integer DEFAULT 0 NOT NULL,
	"estimated_count" integer DEFAULT 0 NOT NULL,
	"unavailable_count" integer DEFAULT 0 NOT NULL,
	"requested_by_identity_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_report_cost_backfills_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_report_cost_backfills_period_check" CHECK ("management_report_cost_backfills"."to_date" >= "management_report_cost_backfills"."from_date"),
	CONSTRAINT "management_report_cost_backfills_counts_check" CHECK ("management_report_cost_backfills"."exact_count" >= 0 and "management_report_cost_backfills"."estimated_count" >= 0 and "management_report_cost_backfills"."unavailable_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_report_cost_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"backfill_id" uuid,
	"cost_cents" integer NOT NULL,
	"source" varchar(48) NOT NULL,
	"confidence" "management_report_cost_confidence" NOT NULL,
	"recorded_by_identity_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_report_cost_snapshots_cost_check" CHECK ("management_report_cost_snapshots"."cost_cents" >= 0),
	CONSTRAINT "management_report_cost_snapshots_source_check" CHECK (("management_report_cost_snapshots"."source" = 'inventory_consumption' and "management_report_cost_snapshots"."confidence" = 'exact') or ("management_report_cost_snapshots"."source" = 'catalog_cost_estimate' and "management_report_cost_snapshots"."confidence" = 'estimated'))
);
--> statement-breakpoint
CREATE TABLE "management_report_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"owner_identity_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"visibility" "management_report_view_visibility" DEFAULT 'private' NOT NULL,
	"query" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_report_views_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_report_views_version_check" CHECK ("management_report_views"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" DROP CONSTRAINT "management_inventory_transfers_quantity_check";--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" DROP CONSTRAINT "management_inventory_transfers_resolution_check";--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."management_inventory_transfer_status" RENAME TO "management_inventory_transfer_status_old";--> statement-breakpoint
CREATE TYPE "public"."management_inventory_transfer_status" AS ENUM('in_transit', 'partially_received', 'received', 'divergent', 'canceled');--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ALTER COLUMN "status" TYPE "public"."management_inventory_transfer_status" USING "status"::text::"public"."management_inventory_transfer_status";--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ALTER COLUMN "status" SET DEFAULT 'in_transit';--> statement-breakpoint
DROP TYPE "public"."management_inventory_transfer_status_old";--> statement-breakpoint
ALTER TABLE "management_report_schedules" DROP CONSTRAINT "management_report_schedules_family_check";--> statement-breakpoint
DROP INDEX "management_inventory_closings_period_unique";--> statement-breakpoint
ALTER TABLE "management_inventory_closings" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "management_inventory_closings" ADD COLUMN "shift_reference" varchar(80);--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD COLUMN "batch_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD COLUMN "line_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD COLUMN "quantity_received" numeric(16, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD COLUMN "quantity_divergent" numeric(16, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD COLUMN "deadline_at" timestamp with time zone DEFAULT now() + interval '30 minutes' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_report_exports" ADD COLUMN "content_encoding" varchar(12) DEFAULT 'utf8' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_report_exports" ADD COLUMN "mime_type" varchar(120) DEFAULT 'text/csv; charset=utf-8' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_report_schedules" ADD COLUMN "format" "management_report_export_format" DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_stock_locations" ADD COLUMN "barcode" varchar(80);--> statement-breakpoint
ALTER TABLE "management_stock_locations" ADD COLUMN "kind" "management_stock_location_kind" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_stock_locations" ADD COLUMN "responsible_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_stock_locations" ADD COLUMN "require_distinct_transfer_receiver" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "management_stock_locations" ADD COLUMN "transfer_sla_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "stage" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "course_held" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "dependency_held" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_kds_tickets" ADD COLUMN "claimed_by_installation_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_kds_tickets" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_kds_tickets" ADD COLUMN "claim_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN "runner_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN "runner_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN "runner_picked_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_product_stations" ADD COLUMN "stage" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.doseclub_operations'::regclass AND conname = 'doseclub_operations_organization_id_organizations_id_fk') THEN
		ALTER TABLE "doseclub_operations" ADD CONSTRAINT "doseclub_operations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.doseclub_operations'::regclass AND conname = 'doseclub_operations_unit_fk') THEN
		ALTER TABLE "doseclub_operations" ADD CONSTRAINT "doseclub_operations_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.doseclub_operations'::regclass AND conname = 'doseclub_operations_state_fk') THEN
		ALTER TABLE "doseclub_operations" ADD CONSTRAINT "doseclub_operations_state_fk" FOREIGN KEY ("organization_id","unit_id","state_id") REFERENCES "public"."doseclub_states"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.doseclub_product_mappings'::regclass AND conname = 'doseclub_product_mappings_organization_id_organizations_id_fk') THEN
		ALTER TABLE "doseclub_product_mappings" ADD CONSTRAINT "doseclub_product_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.doseclub_product_mappings'::regclass AND conname = 'doseclub_product_mappings_unit_fk') THEN
		ALTER TABLE "doseclub_product_mappings" ADD CONSTRAINT "doseclub_product_mappings_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.doseclub_product_mappings'::regclass AND conname = 'doseclub_product_mappings_product_fk') THEN
		ALTER TABLE "doseclub_product_mappings" ADD CONSTRAINT "doseclub_product_mappings_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.doseclub_product_mappings'::regclass AND conname = 'doseclub_product_mappings_inventory_item_fk') THEN
		ALTER TABLE "doseclub_product_mappings" ADD CONSTRAINT "doseclub_product_mappings_inventory_item_fk" FOREIGN KEY ("organization_id","unit_id","inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.doseclub_product_mappings'::regclass AND conname = 'doseclub_product_mappings_stock_location_fk') THEN
		ALTER TABLE "doseclub_product_mappings" ADD CONSTRAINT "doseclub_product_mappings_stock_location_fk" FOREIGN KEY ("organization_id","unit_id","stock_location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_findings" ADD CONSTRAINT "doseclub_reconciliation_findings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_findings" ADD CONSTRAINT "doseclub_reconciliation_findings_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_findings" ADD CONSTRAINT "doseclub_reconciliation_findings_run_fk" FOREIGN KEY ("organization_id","unit_id","last_run_id") REFERENCES "public"."doseclub_reconciliation_runs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_runs" ADD CONSTRAINT "doseclub_reconciliation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_runs" ADD CONSTRAINT "doseclub_reconciliation_runs_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doseclub_reconciliation_runs" ADD CONSTRAINT "doseclub_reconciliation_runs_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.doseclub_states'::regclass AND conname = 'doseclub_states_organization_id_organizations_id_fk') THEN
		ALTER TABLE "doseclub_states" ADD CONSTRAINT "doseclub_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.doseclub_states'::regclass AND conname = 'doseclub_states_unit_fk') THEN
		ALTER TABLE "doseclub_states" ADD CONSTRAINT "doseclub_states_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "aggregate_sequence_states" ADD CONSTRAINT "aggregate_sequence_states_organization_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_inbox" ADD CONSTRAINT "command_inbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_inbox" ADD CONSTRAINT "command_inbox_organization_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_quarantine" ADD CONSTRAINT "command_quarantine_inbox_fk" FOREIGN KEY ("organization_id","unit_id","command_id") REFERENCES "public"."command_inbox"("organization_id","unit_id","command_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_issue_routes" ADD CONSTRAINT "management_inventory_issue_routes_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_issue_routes" ADD CONSTRAINT "management_inventory_issue_routes_station_fk" FOREIGN KEY ("organization_id","unit_id","station_id") REFERENCES "public"."pos_production_stations"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_issue_routes" ADD CONSTRAINT "management_inventory_issue_routes_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_transfer_receipts" ADD CONSTRAINT "management_inventory_transfer_receipts_received_by_identity_id_identities_id_fk" FOREIGN KEY ("received_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_transfer_receipts" ADD CONSTRAINT "management_inventory_transfer_receipts_transfer_fk" FOREIGN KEY ("organization_id","unit_id","transfer_id") REFERENCES "public"."management_inventory_transfers"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_returnable_supplier_exchanges" ADD CONSTRAINT "management_returnable_supplier_exchanges_sent_by_identity_id_identities_id_fk" FOREIGN KEY ("sent_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_returnable_supplier_exchanges" ADD CONSTRAINT "management_returnable_supplier_exchanges_received_by_identity_id_identities_id_fk" FOREIGN KEY ("received_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_returnable_supplier_exchanges" ADD CONSTRAINT "management_returnable_supplier_exchanges_canceled_by_identity_id_identities_id_fk" FOREIGN KEY ("canceled_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_returnable_supplier_exchanges" ADD CONSTRAINT "management_returnable_supplier_exchanges_container_fk" FOREIGN KEY ("organization_id","unit_id","container_inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_returnable_supplier_exchanges" ADD CONSTRAINT "management_returnable_supplier_exchanges_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_returnable_supplier_exchanges" ADD CONSTRAINT "management_returnable_supplier_exchanges_supplier_fk" FOREIGN KEY ("organization_id","unit_id","supplier_id") REFERENCES "public"."management_suppliers"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_stock_location_item_settings" ADD CONSTRAINT "management_stock_location_item_settings_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_stock_location_item_settings" ADD CONSTRAINT "management_stock_location_item_settings_item_fk" FOREIGN KEY ("organization_id","unit_id","inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_item_changes" ADD CONSTRAINT "pos_kds_item_changes_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_item_changes" ADD CONSTRAINT "pos_kds_item_changes_acknowledged_by_identity_id_identities_id_fk" FOREIGN KEY ("acknowledged_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_item_changes" ADD CONSTRAINT "pos_kds_item_changes_assignment_fk" FOREIGN KEY ("organization_id","unit_id","ticket_id","order_item_id") REFERENCES "public"."pos_kds_ticket_items"("organization_id","unit_id","ticket_id","order_item_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD CONSTRAINT "pos_terminal_profiles_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD CONSTRAINT "pos_terminal_profiles_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD CONSTRAINT "pos_terminal_profiles_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD CONSTRAINT "pos_terminal_profiles_station_fk" FOREIGN KEY ("organization_id","unit_id","station_id") REFERENCES "public"."pos_production_stations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_alerts" ADD CONSTRAINT "management_report_alerts_assigned_to_identity_id_identities_id_fk" FOREIGN KEY ("assigned_to_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_alerts" ADD CONSTRAINT "management_report_alerts_resolved_by_identity_id_identities_id_fk" FOREIGN KEY ("resolved_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_alerts" ADD CONSTRAINT "management_report_alerts_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_alerts" ADD CONSTRAINT "management_report_alerts_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_cost_backfills" ADD CONSTRAINT "management_report_cost_backfills_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_cost_backfills" ADD CONSTRAINT "management_report_cost_backfills_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_cost_snapshots" ADD CONSTRAINT "management_report_cost_snapshots_recorded_by_identity_id_identities_id_fk" FOREIGN KEY ("recorded_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_cost_snapshots" ADD CONSTRAINT "management_report_cost_snapshots_order_item_fk" FOREIGN KEY ("organization_id","unit_id","order_item_id") REFERENCES "public"."pos_order_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_cost_snapshots" ADD CONSTRAINT "management_report_cost_snapshots_backfill_fk" FOREIGN KEY ("organization_id","unit_id","backfill_id") REFERENCES "public"."management_report_cost_backfills"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_views" ADD CONSTRAINT "management_report_views_owner_identity_id_identities_id_fk" FOREIGN KEY ("owner_identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_report_views" ADD CONSTRAINT "management_report_views_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doseclub_operations_idempotency_unique" ON "doseclub_operations" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doseclub_operations_operation_unique" ON "doseclub_operations" USING btree ("organization_id","unit_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doseclub_operations_v2_sequence_unique" ON "doseclub_operations" USING btree ("organization_id","unit_id","external_club_id","version") WHERE "doseclub_operations"."contract_version" = 'v2';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doseclub_operations_reversal_unique" ON "doseclub_operations" USING btree ("organization_id","unit_id","original_operation_id") WHERE "doseclub_operations"."operation" = 'reversal' and "doseclub_operations"."original_operation_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doseclub_operations_reconcile_idx" ON "doseclub_operations" USING btree ("organization_id","unit_id","external_club_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doseclub_product_mappings_external_unique" ON "doseclub_product_mappings" USING btree ("organization_id","unit_id","external_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doseclub_reconciliation_findings_fingerprint_unique" ON "doseclub_reconciliation_findings" USING btree ("organization_id","unit_id","fingerprint");--> statement-breakpoint
CREATE INDEX "doseclub_reconciliation_findings_status_idx" ON "doseclub_reconciliation_findings" USING btree ("organization_id","unit_id","status","last_detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "doseclub_reconciliation_runs_scheduled_day_unique" ON "doseclub_reconciliation_runs" USING btree ("organization_id","unit_id","run_date") WHERE "doseclub_reconciliation_runs"."trigger" = 'scheduled';--> statement-breakpoint
CREATE UNIQUE INDEX "doseclub_reconciliation_runs_idempotency_unique" ON "doseclub_reconciliation_runs" USING btree ("organization_id","unit_id","idempotency_key") WHERE "doseclub_reconciliation_runs"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "doseclub_reconciliation_runs_claim_idx" ON "doseclub_reconciliation_runs" USING btree ("status","lease_until","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doseclub_states_updated_idx" ON "doseclub_states" USING btree ("organization_id","unit_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "command_inbox_scope_idempotency_unique" ON "command_inbox" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "command_inbox_aggregate_sequence_idx" ON "command_inbox" USING btree ("organization_id","unit_id","aggregate_type","aggregate_id","occupancy_epoch","aggregate_sequence");--> statement-breakpoint
CREATE INDEX "command_inbox_received_idx" ON "command_inbox" USING btree ("organization_id","unit_id","received_at");--> statement-breakpoint
CREATE INDEX "command_quarantine_pending_idx" ON "command_quarantine" USING btree ("organization_id","unit_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_issue_routes_default_unique" ON "management_inventory_issue_routes" USING btree ("organization_id","unit_id","product_id") WHERE "management_inventory_issue_routes"."station_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_issue_routes_station_unique" ON "management_inventory_issue_routes" USING btree ("organization_id","unit_id","product_id","station_id") WHERE "management_inventory_issue_routes"."station_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_transfer_receipts_idempotency_unique" ON "management_inventory_transfer_receipts" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_inventory_transfer_receipts_transfer_idx" ON "management_inventory_transfer_receipts" USING btree ("organization_id","unit_id","transfer_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_returnable_supplier_exchanges_idempotency_unique" ON "management_returnable_supplier_exchanges" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_returnable_supplier_exchanges_status_idx" ON "management_returnable_supplier_exchanges" USING btree ("organization_id","unit_id","status","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_kds_item_changes_revision_unique" ON "pos_kds_item_changes" USING btree ("organization_id","unit_id","ticket_id","revision");--> statement-breakpoint
CREATE INDEX "pos_kds_item_changes_unacknowledged_idx" ON "pos_kds_item_changes" USING btree ("organization_id","unit_id","ticket_id","acknowledged_at","created_at");--> statement-breakpoint
CREATE INDEX "pos_terminal_profiles_unit_idx" ON "pos_terminal_profiles" USING btree ("organization_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "management_report_alerts_occurrence_unique" ON "management_report_alerts" USING btree ("organization_id","unit_id","occurrence_key");--> statement-breakpoint
CREATE INDEX "management_report_alerts_work_queue_idx" ON "management_report_alerts" USING btree ("organization_id","unit_id","status","due_at");--> statement-breakpoint
CREATE INDEX "management_report_cost_backfills_period_idx" ON "management_report_cost_backfills" USING btree ("organization_id","unit_id","from_date","to_date");--> statement-breakpoint
CREATE UNIQUE INDEX "management_report_cost_snapshots_order_item_unique" ON "management_report_cost_snapshots" USING btree ("organization_id","unit_id","order_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "management_report_views_owner_name_unique" ON "management_report_views" USING btree ("organization_id","unit_id","owner_identity_id","name");--> statement-breakpoint
CREATE INDEX "management_report_views_visible_idx" ON "management_report_views" USING btree ("organization_id","unit_id","visibility","updated_at");--> statement-breakpoint
ALTER TABLE "management_inventory_closings" ADD CONSTRAINT "management_inventory_closings_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_stock_locations" ADD CONSTRAINT "management_stock_locations_responsible_identity_id_identities_id_fk" FOREIGN KEY ("responsible_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_runner_identity_id_identities_id_fk" FOREIGN KEY ("runner_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_stock_locations_barcode_unique" ON "management_stock_locations" USING btree ("organization_id","unit_id","barcode") WHERE "management_stock_locations"."barcode" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_closings_period_unique" ON "management_inventory_closings" USING btree ("organization_id","unit_id","period",coalesce("location_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("shift_reference", ''));--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD CONSTRAINT "management_inventory_transfers_batch_line_unique" UNIQUE("organization_id","unit_id","batch_id","line_number");--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD CONSTRAINT "management_inventory_transfers_line_number_check" CHECK ("management_inventory_transfers"."line_number" > 0);--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD CONSTRAINT "management_inventory_transfers_quantity_check" CHECK ("management_inventory_transfers"."quantity" > 0 and "management_inventory_transfers"."quantity_received" >= 0 and "management_inventory_transfers"."quantity_divergent" >= 0 and "management_inventory_transfers"."quantity_received" + "management_inventory_transfers"."quantity_divergent" <= "management_inventory_transfers"."quantity");--> statement-breakpoint
ALTER TABLE "management_inventory_transfers" ADD CONSTRAINT "management_inventory_transfers_resolution_check" CHECK (("management_inventory_transfers"."status" in ('in_transit', 'partially_received') and "management_inventory_transfers"."canceled_at" is null) or ("management_inventory_transfers"."status" in ('received', 'divergent') and "management_inventory_transfers"."received_at" is not null and "management_inventory_transfers"."received_by_identity_id" is not null and "management_inventory_transfers"."canceled_at" is null) or ("management_inventory_transfers"."status" = 'canceled' and "management_inventory_transfers"."canceled_at" is not null and "management_inventory_transfers"."canceled_by_identity_id" is not null));--> statement-breakpoint
ALTER TABLE "management_report_exports" ADD CONSTRAINT "management_report_exports_encoding_check" CHECK ("management_report_exports"."content_encoding" in ('utf8','base64'));--> statement-breakpoint
ALTER TABLE "management_report_schedules" ADD CONSTRAINT "management_report_schedules_family_check" CHECK ("management_report_schedules"."family" in ('overview', 'sales', 'exceptions', 'inventory', 'purchasing', 'operations', 'profitability', 'multiunit', 'quality', 'labor', 'reconciliation', 'forecast'));--> statement-breakpoint
ALTER TABLE "management_stock_locations" ADD CONSTRAINT "management_stock_locations_sla_check" CHECK ("management_stock_locations"."transfer_sla_minutes" > 0);--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD CONSTRAINT "pos_kds_ticket_items_stage_check" CHECK ("pos_kds_ticket_items"."stage" BETWEEN 1 AND 20);--> statement-breakpoint
ALTER TABLE "pos_kds_tickets" ADD CONSTRAINT "pos_kds_claim_check" CHECK (("pos_kds_tickets"."claimed_by_installation_id" IS NULL AND "pos_kds_tickets"."claimed_at" IS NULL AND "pos_kds_tickets"."claim_expires_at" IS NULL) OR ("pos_kds_tickets"."claimed_by_installation_id" IS NOT NULL AND "pos_kds_tickets"."claimed_at" IS NOT NULL AND "pos_kds_tickets"."claim_expires_at" > "pos_kds_tickets"."claimed_at"));--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_runner_check" CHECK (("pos_orders"."runner_identity_id" IS NULL AND "pos_orders"."runner_claimed_at" IS NULL AND "pos_orders"."runner_picked_up_at" IS NULL) OR ("pos_orders"."runner_identity_id" IS NOT NULL AND "pos_orders"."runner_claimed_at" IS NOT NULL AND ("pos_orders"."runner_picked_up_at" IS NULL OR "pos_orders"."runner_picked_up_at" >= "pos_orders"."runner_claimed_at")));--> statement-breakpoint
ALTER TABLE "pos_product_stations" ADD CONSTRAINT "pos_product_stations_stage_check" CHECK ("pos_product_stations"."stage" BETWEEN 1 AND 20);
