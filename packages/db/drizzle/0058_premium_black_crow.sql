CREATE TABLE "pos_table_qr_print_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"format" varchar(24) NOT NULL,
	"output" varchar(8) NOT NULL,
	"template" varchar(24) NOT NULL,
	"status" varchar(16) DEFAULT 'generated' NOT NULL,
	"menu_slug" varchar(100) NOT NULL,
	"include_wifi" boolean DEFAULT false NOT NULL,
	"settings_revision" integer NOT NULL,
	"settings_snapshot" jsonb NOT NULL,
	"tables_snapshot" jsonb NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"printed_by_identity_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"printed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_table_qr_print_batches_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_table_qr_print_batches_format_check" CHECK ("pos_table_qr_print_batches"."format" IN ('a4_2', 'a4_4', 'a4_6', 'a5', 'table_tent', 'sticker')),
	CONSTRAINT "pos_table_qr_print_batches_output_check" CHECK ("pos_table_qr_print_batches"."output" IN ('print', 'svg', 'png', 'pdf')),
	CONSTRAINT "pos_table_qr_print_batches_template_check" CHECK ("pos_table_qr_print_batches"."template" IN ('classic', 'compact', 'minimal')),
	CONSTRAINT "pos_table_qr_print_batches_status_check" CHECK ("pos_table_qr_print_batches"."status" IN ('generated', 'printed')),
	CONSTRAINT "pos_table_qr_print_batches_revision_check" CHECK ("pos_table_qr_print_batches"."settings_revision" >= 0),
	CONSTRAINT "pos_table_qr_print_batches_printed_check" CHECK (("pos_table_qr_print_batches"."status" = 'generated' AND "pos_table_qr_print_batches"."printed_at" IS NULL AND "pos_table_qr_print_batches"."printed_by_identity_id" IS NULL) OR ("pos_table_qr_print_batches"."status" = 'printed' AND "pos_table_qr_print_batches"."printed_at" IS NOT NULL AND "pos_table_qr_print_batches"."printed_by_identity_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "pos_table_qr_settings" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"headline" varchar(160) NOT NULL,
	"instructions" varchar(500) NOT NULL,
	"logo_url" varchar(2000),
	"primary_color" varchar(7) NOT NULL,
	"wifi_notice" varchar(200),
	"service_charge_notice" varchar(200),
	"template" varchar(24) DEFAULT 'classic' NOT NULL,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_table_qr_settings_organization_id_unit_id_pk" PRIMARY KEY("organization_id","unit_id"),
	CONSTRAINT "pos_table_qr_settings_revision_check" CHECK ("pos_table_qr_settings"."revision" > 0),
	CONSTRAINT "pos_table_qr_settings_color_check" CHECK ("pos_table_qr_settings"."primary_color" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "pos_table_qr_settings_template_check" CHECK ("pos_table_qr_settings"."template" IN ('classic', 'compact', 'minimal'))
);
--> statement-breakpoint
ALTER TABLE "pos_table_qr_print_batches" ADD CONSTRAINT "pos_table_qr_print_batches_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_table_qr_print_batches" ADD CONSTRAINT "pos_table_qr_print_batches_printed_by_identity_id_identities_id_fk" FOREIGN KEY ("printed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_table_qr_print_batches" ADD CONSTRAINT "pos_table_qr_print_batches_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_table_qr_settings" ADD CONSTRAINT "pos_table_qr_settings_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_table_qr_settings" ADD CONSTRAINT "pos_table_qr_settings_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_table_qr_print_batches_unit_time_idx" ON "pos_table_qr_print_batches" USING btree ("organization_id","unit_id","generated_at");