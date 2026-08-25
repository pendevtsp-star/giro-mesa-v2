CREATE TABLE "pos_table_qr_metrics" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"last_scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_table_qr_metrics_organization_id_unit_id_table_id_pk" PRIMARY KEY("organization_id","unit_id","table_id"),
	CONSTRAINT "pos_table_qr_metrics_scan_count_check" CHECK ("pos_table_qr_metrics"."scan_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos_table_qr_settings" ADD COLUMN "presence_protection" varchar(24) DEFAULT 'session_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_table_qr_metrics" ADD CONSTRAINT "pos_table_qr_metrics_table_fk" FOREIGN KEY ("organization_id","unit_id","table_id") REFERENCES "public"."pos_dining_tables"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_table_qr_settings" ADD CONSTRAINT "pos_table_qr_settings_presence_check" CHECK ("pos_table_qr_settings"."presence_protection" IN ('session_only', 'daily_code'));