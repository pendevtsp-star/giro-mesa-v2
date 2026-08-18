CREATE TYPE "public"."pos_operational_shift_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."pos_section_staff_role" AS ENUM('primary', 'support');--> statement-breakpoint
CREATE TYPE "public"."pos_service_mode" AS ENUM('full_service', 'quick_service', 'bar', 'hybrid');--> statement-breakpoint
CREATE TABLE "pos_operational_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"service_mode" "pos_service_mode" DEFAULT 'hybrid' NOT NULL,
	"status" "pos_operational_shift_status" DEFAULT 'active' NOT NULL,
	"opened_by_identity_id" uuid NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_operational_shifts_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "pos_service_section_tables" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_service_section_tables_organization_id_unit_id_section_id_table_id_pk" PRIMARY KEY("organization_id","unit_id","section_id","table_id")
);
--> statement-breakpoint
CREATE TABLE "pos_service_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"color" varchar(7) DEFAULT '#176B4D' NOT NULL,
	"service_mode" "pos_service_mode" DEFAULT 'hybrid' NOT NULL,
	"default_responsible_identity_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_service_sections_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_service_sections_color_check" CHECK ("pos_service_sections"."color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "pos_shift_section_staff" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"shift_section_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"role" "pos_section_staff_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_shift_section_staff_organization_id_unit_id_shift_id_shift_section_id_identity_id_pk" PRIMARY KEY("organization_id","unit_id","shift_id","shift_section_id","identity_id")
);
--> statement-breakpoint
CREATE TABLE "pos_shift_section_tables" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"shift_section_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_shift_section_tables_organization_id_unit_id_shift_id_shift_section_id_table_id_pk" PRIMARY KEY("organization_id","unit_id","shift_id","shift_section_id","table_id")
);
--> statement-breakpoint
CREATE TABLE "pos_shift_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"section_template_id" uuid,
	"name" varchar(120) NOT NULL,
	"color" varchar(7) NOT NULL,
	"service_mode" "pos_service_mode" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_shift_sections_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_shift_sections_shift_id_unique" UNIQUE("organization_id","unit_id","shift_id","id"),
	CONSTRAINT "pos_shift_sections_color_check" CHECK ("pos_shift_sections"."color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "pos_shift_table_layouts" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"layout_x" integer NOT NULL,
	"layout_y" integer NOT NULL,
	"moved_by_identity_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_shift_table_layouts_organization_id_unit_id_shift_id_table_id_pk" PRIMARY KEY("organization_id","unit_id","shift_id","table_id"),
	CONSTRAINT "pos_shift_table_layouts_coordinates_check" CHECK ("pos_shift_table_layouts"."layout_x" BETWEEN -1000000 AND 1000000 AND "pos_shift_table_layouts"."layout_y" BETWEEN -1000000 AND 1000000)
);
--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "operational_shift_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "shift_section_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_operational_shifts" ADD CONSTRAINT "pos_operational_shifts_opened_by_identity_id_identities_id_fk" FOREIGN KEY ("opened_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_operational_shifts" ADD CONSTRAINT "pos_operational_shifts_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_service_section_tables" ADD CONSTRAINT "pos_service_section_tables_section_fk" FOREIGN KEY ("organization_id","unit_id","section_id") REFERENCES "public"."pos_service_sections"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_service_section_tables" ADD CONSTRAINT "pos_service_section_tables_table_fk" FOREIGN KEY ("organization_id","unit_id","table_id") REFERENCES "public"."pos_dining_tables"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_service_sections" ADD CONSTRAINT "pos_service_sections_default_responsible_identity_id_identities_id_fk" FOREIGN KEY ("default_responsible_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_service_sections" ADD CONSTRAINT "pos_service_sections_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_section_staff" ADD CONSTRAINT "pos_shift_section_staff_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_section_staff" ADD CONSTRAINT "pos_shift_section_staff_section_fk" FOREIGN KEY ("organization_id","unit_id","shift_id","shift_section_id") REFERENCES "public"."pos_shift_sections"("organization_id","unit_id","shift_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_section_tables" ADD CONSTRAINT "pos_shift_section_tables_section_fk" FOREIGN KEY ("organization_id","unit_id","shift_id","shift_section_id") REFERENCES "public"."pos_shift_sections"("organization_id","unit_id","shift_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_section_tables" ADD CONSTRAINT "pos_shift_section_tables_table_fk" FOREIGN KEY ("organization_id","unit_id","table_id") REFERENCES "public"."pos_dining_tables"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_sections" ADD CONSTRAINT "pos_shift_sections_shift_fk" FOREIGN KEY ("organization_id","unit_id","shift_id") REFERENCES "public"."pos_operational_shifts"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_sections" ADD CONSTRAINT "pos_shift_sections_template_fk" FOREIGN KEY ("organization_id","unit_id","section_template_id") REFERENCES "public"."pos_service_sections"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_table_layouts" ADD CONSTRAINT "pos_shift_table_layouts_moved_by_identity_id_identities_id_fk" FOREIGN KEY ("moved_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_table_layouts" ADD CONSTRAINT "pos_shift_table_layouts_shift_fk" FOREIGN KEY ("organization_id","unit_id","shift_id") REFERENCES "public"."pos_operational_shifts"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_table_layouts" ADD CONSTRAINT "pos_shift_table_layouts_table_fk" FOREIGN KEY ("organization_id","unit_id","table_id") REFERENCES "public"."pos_dining_tables"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_table_layouts" ADD CONSTRAINT "pos_shift_table_layouts_room_fk" FOREIGN KEY ("organization_id","unit_id","room_id") REFERENCES "public"."pos_dining_rooms"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_operational_shifts_one_active_unique" ON "pos_operational_shifts" USING btree ("organization_id","unit_id") WHERE "pos_operational_shifts"."status" = 'active';--> statement-breakpoint
CREATE INDEX "pos_operational_shifts_history_idx" ON "pos_operational_shifts" USING btree ("organization_id","unit_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_service_section_tables_one_section_unique" ON "pos_service_section_tables" USING btree ("organization_id","unit_id","table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_service_sections_name_unique" ON "pos_service_sections" USING btree ("organization_id","unit_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_shift_section_staff_one_primary_unique" ON "pos_shift_section_staff" USING btree ("organization_id","unit_id","shift_id","shift_section_id") WHERE "pos_shift_section_staff"."role" = 'primary';--> statement-breakpoint
CREATE UNIQUE INDEX "pos_shift_section_tables_one_section_unique" ON "pos_shift_section_tables" USING btree ("organization_id","unit_id","shift_id","table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_shift_sections_name_unique" ON "pos_shift_sections" USING btree ("organization_id","unit_id","shift_id","name");--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_shift_section_fk" FOREIGN KEY ("organization_id","unit_id","operational_shift_id","shift_section_id") REFERENCES "public"."pos_shift_sections"("organization_id","unit_id","shift_id","id") ON DELETE restrict ON UPDATE no action;