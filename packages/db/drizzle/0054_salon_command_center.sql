ALTER TABLE "pos_terminal_profiles" ADD COLUMN "payment_mode" varchar(24) DEFAULT 'disabled' NOT NULL;--> statement-breakpoint
UPDATE "pos_terminal_profiles" SET "payment_mode" = 'cashier' WHERE "mode" = 'cashier';--> statement-breakpoint
ALTER TABLE "pos_terminal_profiles" ADD CONSTRAINT "pos_terminal_profiles_payment_mode_check" CHECK ("pos_terminal_profiles"."payment_mode" IN ('disabled', 'cashier', 'homologated_pos'));--> statement-breakpoint
ALTER TABLE "pos_dining_tables" ADD COLUMN "layout_width" integer DEFAULT 122 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_dining_tables" ADD COLUMN "layout_height" integer DEFAULT 76 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_dining_tables" ADD COLUMN "layout_rotation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_dining_tables" ADD COLUMN "layout_shape" varchar(16) DEFAULT 'rectangle' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_dining_tables" ADD CONSTRAINT "pos_tables_geometry_check" CHECK ("pos_dining_tables"."layout_width" BETWEEN 24 AND 2000 AND "pos_dining_tables"."layout_height" BETWEEN 24 AND 2000 AND "pos_dining_tables"."layout_rotation" BETWEEN 0 AND 359 AND "pos_dining_tables"."layout_shape" IN ('rectangle', 'round', 'square') AND ("pos_dining_tables"."layout_shape" <> 'square' OR "pos_dining_tables"."layout_width" = "pos_dining_tables"."layout_height"));--> statement-breakpoint
CREATE TABLE "pos_floor_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_floor_layouts_unit_unique" UNIQUE("organization_id","unit_id"),
	CONSTRAINT "pos_floor_layouts_revision_check" CHECK ("pos_floor_layouts"."revision" > 0)
);--> statement-breakpoint
ALTER TABLE "pos_floor_layouts" ADD CONSTRAINT "pos_floor_layouts_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_floor_layouts" ADD CONSTRAINT "pos_floor_layouts_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "pos_floor_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"label" varchar(120),
	"layout_x" integer NOT NULL,
	"layout_y" integer NOT NULL,
	"layout_width" integer NOT NULL,
	"layout_height" integer NOT NULL,
	"layout_rotation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_floor_elements_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_floor_elements_kind_check" CHECK ("pos_floor_elements"."kind" IN ('label', 'barrier')),
	CONSTRAINT "pos_floor_elements_geometry_check" CHECK ("pos_floor_elements"."layout_x" BETWEEN -1000000 AND 1000000 AND "pos_floor_elements"."layout_y" BETWEEN -1000000 AND 1000000 AND "pos_floor_elements"."layout_width" BETWEEN 1 AND 1000000 AND "pos_floor_elements"."layout_height" BETWEEN 1 AND 1000000 AND "pos_floor_elements"."layout_rotation" BETWEEN 0 AND 359)
);--> statement-breakpoint
CREATE INDEX "pos_floor_elements_room_idx" ON "pos_floor_elements" USING btree ("organization_id","unit_id","room_id");--> statement-breakpoint
ALTER TABLE "pos_floor_elements" ADD CONSTRAINT "pos_floor_elements_room_fk" FOREIGN KEY ("organization_id","unit_id","room_id") REFERENCES "public"."pos_dining_rooms"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_operational_shifts" ADD COLUMN "assignment_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shift_table_layouts" ADD COLUMN "layout_rotation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shift_table_layouts" DROP CONSTRAINT "pos_shift_table_layouts_coordinates_check";--> statement-breakpoint
ALTER TABLE "pos_shift_table_layouts" ADD CONSTRAINT "pos_shift_table_layouts_coordinates_check" CHECK ("pos_shift_table_layouts"."layout_x" BETWEEN -1000000 AND 1000000 AND "pos_shift_table_layouts"."layout_y" BETWEEN -1000000 AND 1000000 AND "pos_shift_table_layouts"."layout_rotation" BETWEEN 0 AND 359);--> statement-breakpoint
ALTER TABLE "pos_operational_shifts" ADD CONSTRAINT "pos_operational_shifts_assignment_revision_check" CHECK ("pos_operational_shifts"."assignment_revision" > 0);--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD COLUMN "reason_code" varchar(48) DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD COLUMN "reason_note" varchar(500);--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD COLUMN "tab_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD COLUMN "previous_shift_section_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD COLUMN "previous_responsible_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD COLUMN "applied_responsible_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD COLUMN "applied_tab_version" integer;--> statement-breakpoint
UPDATE "pos_shift_table_transfers" SET "reason_note" = "reason" WHERE "reason_code" = 'other' AND "reason_note" IS NULL;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD CONSTRAINT "pos_shift_table_transfers_tab_fk" FOREIGN KEY ("organization_id","unit_id","tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD CONSTRAINT "pos_shift_table_transfers_previous_section_fk" FOREIGN KEY ("organization_id","unit_id","shift_id","previous_shift_section_id") REFERENCES "public"."pos_shift_sections"("organization_id","unit_id","shift_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD CONSTRAINT "pos_shift_table_transfers_previous_responsible_identity_id_identities_id_fk" FOREIGN KEY ("previous_responsible_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD CONSTRAINT "pos_shift_table_transfers_applied_responsible_identity_id_identities_id_fk" FOREIGN KEY ("applied_responsible_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD CONSTRAINT "pos_shift_table_transfers_snapshot_check" CHECK (("pos_shift_table_transfers"."tab_id" IS NULL AND "pos_shift_table_transfers"."applied_tab_version" IS NULL) OR ("pos_shift_table_transfers"."tab_id" IS NOT NULL AND "pos_shift_table_transfers"."applied_tab_version" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD CONSTRAINT "pos_shift_table_transfers_reason_check" CHECK ("pos_shift_table_transfers"."reason_code" IN ('service_rebalance', 'staff_coverage', 'operational_reorganization', 'other') AND ("pos_shift_table_transfers"."reason_code" <> 'other' OR "pos_shift_table_transfers"."reason_note" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "pos_dining_table_groups" ADD COLUMN "reason_code" varchar(48) DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_dining_table_groups" ADD COLUMN "reason_note" varchar(500);--> statement-breakpoint
UPDATE "pos_dining_table_groups" SET "reason_note" = 'Agrupamento legado migrado' WHERE "reason_code" = 'other' AND "reason_note" IS NULL;--> statement-breakpoint
ALTER TABLE "pos_dining_table_groups" ADD CONSTRAINT "pos_table_groups_reason_check" CHECK ("pos_dining_table_groups"."reason_code" IN ('large_party', 'sit_together', 'accessibility', 'operational_reorganization', 'other') AND ("pos_dining_table_groups"."reason_code" <> 'other' OR "pos_dining_table_groups"."reason_note" IS NOT NULL));--> statement-breakpoint
CREATE TABLE "pos_print_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"tab_id" uuid NOT NULL,
	"balance_snapshot_cents" integer NOT NULL,
	"method" varchar(24) NOT NULL,
	"part_count" integer NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_print_splits_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_print_splits_balance_check" CHECK ("pos_print_splits"."balance_snapshot_cents" > 0),
	CONSTRAINT "pos_print_splits_method_check" CHECK ("pos_print_splits"."method" IN ('equal_people', 'fixed_amount')),
	CONSTRAINT "pos_print_splits_count_check" CHECK ("pos_print_splits"."part_count" BETWEEN 2 AND 50)
);--> statement-breakpoint
ALTER TABLE "pos_print_splits" ADD CONSTRAINT "pos_print_splits_tab_fk" FOREIGN KEY ("organization_id","unit_id","tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_print_splits" ADD CONSTRAINT "pos_print_splits_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "pos_print_split_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"split_id" uuid NOT NULL,
	"part_number" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_print_split_parts_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_print_split_parts_number_unique" UNIQUE("organization_id","unit_id","split_id","part_number"),
	CONSTRAINT "pos_print_split_parts_number_check" CHECK ("pos_print_split_parts"."part_number" > 0),
	CONSTRAINT "pos_print_split_parts_amount_check" CHECK ("pos_print_split_parts"."amount_cents" > 0)
);--> statement-breakpoint
ALTER TABLE "pos_print_split_parts" ADD CONSTRAINT "pos_print_split_parts_split_fk" FOREIGN KEY ("organization_id","unit_id","split_id") REFERENCES "public"."pos_print_splits"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD COLUMN "service_call_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD COLUMN "split_part_id" uuid;--> statement-breakpoint
ALTER TYPE "public"."pos_print_job_status" ADD VALUE 'confirmation_required' BEFORE 'printed';--> statement-breakpoint
ALTER TABLE "pos_print_jobs" DROP CONSTRAINT "pos_print_jobs_copies_check";--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD CONSTRAINT "pos_print_jobs_copies_check" CHECK ("pos_print_jobs"."copies" BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD CONSTRAINT "pos_print_jobs_service_call_fk" FOREIGN KEY ("organization_id","unit_id","service_call_id") REFERENCES "public"."pos_service_calls"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos_print_jobs" ADD CONSTRAINT "pos_print_jobs_split_part_fk" FOREIGN KEY ("organization_id","unit_id","split_part_id") REFERENCES "public"."pos_print_split_parts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
