ALTER TABLE "pos_tabs" ADD COLUMN "service_root_tab_id" uuid;
--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD COLUMN "service_charge_adjustment_cents" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_service_root_fk" FOREIGN KEY ("organization_id", "unit_id", "service_root_tab_id") REFERENCES "pos_tabs" ("organization_id", "unit_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_service_root_not_self_check" CHECK ("service_root_tab_id" IS NULL OR "service_root_tab_id" <> "id");
--> statement-breakpoint
CREATE INDEX "pos_tabs_service_root_idx" ON "pos_tabs" ("organization_id", "unit_id", "service_root_tab_id");
--> statement-breakpoint
DROP INDEX "pos_tabs_one_open_per_table_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "pos_tabs_one_open_per_table_unique" ON "pos_tabs" ("organization_id", "unit_id", "table_id") WHERE "status" = 'open' AND "table_id" IS NOT NULL AND "service_root_tab_id" IS NULL;
--> statement-breakpoint
CREATE TABLE "pos_bill_printing_policies" (
  "organization_id" uuid NOT NULL,
  "unit_id" uuid PRIMARY KEY,
  "mode" varchar(24) NOT NULL DEFAULT 'notify_cashier',
  "printer_id" uuid,
  "revision" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pos_bill_printing_policies_unit_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "units" ("organization_id", "id") ON DELETE cascade,
  CONSTRAINT "pos_bill_printing_policies_printer_fk" FOREIGN KEY ("organization_id", "unit_id", "printer_id") REFERENCES "pos_production_printers" ("organization_id", "unit_id", "id"),
  CONSTRAINT "pos_bill_printing_policies_mode_check" CHECK (("mode" = 'cashier_printer' AND "printer_id" IS NOT NULL) OR ("mode" IN ('notify_cashier', 'local_terminal') AND "printer_id" IS NULL)),
  CONSTRAINT "pos_bill_printing_policies_revision_check" CHECK ("revision" > 0)
);
