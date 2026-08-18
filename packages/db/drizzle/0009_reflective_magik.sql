CREATE TYPE "public"."pos_table_group_mode" AS ENUM('physical_only', 'single_tab');--> statement-breakpoint
CREATE TABLE "pos_dining_table_group_members" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_dining_table_group_members_organization_id_unit_id_group_id_table_id_pk" PRIMARY KEY("organization_id","unit_id","group_id","table_id")
);
--> statement-breakpoint
CREATE TABLE "pos_dining_table_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"anchor_table_id" uuid NOT NULL,
	"primary_tab_id" uuid,
	"mode" "pos_table_group_mode" NOT NULL,
	"responsible_identity_id" uuid,
	"created_by_identity_id" uuid NOT NULL,
	"dissolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_table_groups_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN "origin_table_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_dining_table_group_members" ADD CONSTRAINT "pos_table_group_members_group_fk" FOREIGN KEY ("organization_id","unit_id","group_id") REFERENCES "public"."pos_dining_table_groups"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_dining_table_group_members" ADD CONSTRAINT "pos_table_group_members_table_fk" FOREIGN KEY ("organization_id","unit_id","table_id") REFERENCES "public"."pos_dining_tables"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_dining_table_groups" ADD CONSTRAINT "pos_dining_table_groups_responsible_identity_id_identities_id_fk" FOREIGN KEY ("responsible_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_dining_table_groups" ADD CONSTRAINT "pos_dining_table_groups_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_dining_table_groups" ADD CONSTRAINT "pos_table_groups_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_dining_table_groups" ADD CONSTRAINT "pos_table_groups_anchor_fk" FOREIGN KEY ("organization_id","unit_id","anchor_table_id") REFERENCES "public"."pos_dining_tables"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_dining_table_groups" ADD CONSTRAINT "pos_table_groups_primary_tab_fk" FOREIGN KEY ("organization_id","unit_id","primary_tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_table_group_member_active_unique" ON "pos_dining_table_group_members" USING btree ("organization_id","unit_id","table_id");--> statement-breakpoint
CREATE INDEX "pos_table_groups_active_idx" ON "pos_dining_table_groups" USING btree ("organization_id","unit_id","dissolved_at");--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_origin_table_fk" FOREIGN KEY ("organization_id","unit_id","origin_table_id") REFERENCES "public"."pos_dining_tables"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;