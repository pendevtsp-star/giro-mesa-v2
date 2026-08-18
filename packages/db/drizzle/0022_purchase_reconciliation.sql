ALTER TYPE "management_purchase_status" ADD VALUE IF NOT EXISTS 'rejected' BEFORE 'approved';--> statement-breakpoint
CREATE TYPE "management_supplier_invoice_status" AS ENUM('pending', 'matched', 'divergent', 'confirmed', 'canceled');--> statement-breakpoint

ALTER TABLE "management_suppliers" ADD COLUMN "normalized_document" varchar(20);--> statement-breakpoint
ALTER TABLE "management_suppliers" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "management_suppliers" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "management_suppliers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
WITH normalized AS (
  SELECT id,
    upper(regexp_replace(document, '[^[:alnum:]]', '', 'g')) AS value,
    row_number() OVER (
      PARTITION BY organization_id, unit_id, upper(regexp_replace(document, '[^[:alnum:]]', '', 'g'))
      ORDER BY created_at, id
    ) AS occurrence
  FROM management_suppliers
  WHERE document IS NOT NULL AND regexp_replace(document, '[^[:alnum:]]', '', 'g') <> ''
)
UPDATE management_suppliers supplier
SET normalized_document = normalized.value
FROM normalized
WHERE supplier.id = normalized.id AND normalized.occurrence = 1;--> statement-breakpoint
CREATE UNIQUE INDEX "management_suppliers_document_unique" ON "management_suppliers" ("organization_id", "unit_id", "normalized_document") WHERE "normalized_document" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "management_purchase_orders" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_purchase_orders" ADD COLUMN "rejected_by_identity_id" uuid REFERENCES "identities"("id");--> statement-breakpoint
ALTER TABLE "management_purchase_orders" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "management_purchase_orders" ADD COLUMN "human_number" integer GENERATED ALWAYS AS IDENTITY;--> statement-breakpoint
ALTER TABLE "management_purchase_orders" ADD CONSTRAINT "management_purchase_orders_human_number_unique" UNIQUE("human_number");--> statement-breakpoint

ALTER TABLE "management_purchase_order_items" ADD COLUMN "purchase_unit" varchar(20);--> statement-breakpoint
ALTER TABLE "management_purchase_order_items" ADD COLUMN "stock_unit" varchar(20);--> statement-breakpoint
ALTER TABLE "management_purchase_order_items" ADD COLUMN "purchase_to_stock_factor" numeric(16, 3);--> statement-breakpoint
UPDATE "management_purchase_order_items" line
SET "purchase_unit" = coalesce(item."purchase_unit", item."unit"),
    "stock_unit" = item."unit",
    "purchase_to_stock_factor" = item."purchase_to_stock_factor"
FROM "management_inventory_items" item
WHERE item."organization_id" = line."organization_id"
  AND item."unit_id" = line."unit_id"
  AND item."id" = line."inventory_item_id";--> statement-breakpoint
ALTER TABLE "management_purchase_order_items" ALTER COLUMN "purchase_unit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "management_purchase_order_items" ALTER COLUMN "stock_unit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "management_purchase_order_items" ALTER COLUMN "purchase_to_stock_factor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "management_purchase_order_items" DROP CONSTRAINT "management_purchase_order_items_cost_check";--> statement-breakpoint
ALTER TABLE "management_purchase_order_items" DROP CONSTRAINT "management_purchase_order_items_total_check";--> statement-breakpoint
ALTER TABLE "management_purchase_order_items" ADD CONSTRAINT "management_purchase_order_items_cost_check" CHECK ("unit_cost_cents" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "management_purchase_order_items" ADD CONSTRAINT "management_purchase_order_items_total_check" CHECK ("total_cents" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "management_purchase_order_items" ADD CONSTRAINT "management_purchase_order_items_factor_check" CHECK ("purchase_to_stock_factor" > 0);--> statement-breakpoint

ALTER TABLE "management_purchase_receipt_lines" ADD COLUMN "stock_quantity" numeric(16, 3);--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" ADD COLUMN "stock_unit_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" ADD COLUMN "lot_id" uuid;--> statement-breakpoint
UPDATE "management_purchase_receipt_lines" receipt
SET "stock_quantity" = round(receipt."quantity" * item."purchase_to_stock_factor", 3),
    "stock_unit_cost_cents" = round(
      receipt."total_cents" / nullif(receipt."quantity" * item."purchase_to_stock_factor", 0)
    )
FROM "management_purchase_order_items" item
WHERE item."organization_id" = receipt."organization_id"
  AND item."unit_id" = receipt."unit_id"
  AND item."id" = receipt."purchase_order_item_id";--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" ALTER COLUMN "stock_quantity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" ALTER COLUMN "stock_unit_cost_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" DROP CONSTRAINT "management_purchase_receipt_lines_cost_check";--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" ADD CONSTRAINT "management_purchase_receipt_lines_stock_quantity_check" CHECK ("stock_quantity" > 0);--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" ADD CONSTRAINT "management_purchase_receipt_lines_cost_check" CHECK ("unit_cost_cents" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" ADD CONSTRAINT "management_purchase_receipt_lines_stock_cost_check" CHECK ("stock_unit_cost_cents" >= 0);--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" ADD CONSTRAINT "management_purchase_receipt_lines_lot_fk" FOREIGN KEY ("organization_id", "unit_id", "lot_id") REFERENCES "management_inventory_lots"("organization_id", "unit_id", "id") ON DELETE restrict;--> statement-breakpoint

CREATE TABLE "management_supplier_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "purchase_order_id" uuid NOT NULL,
  "supplier_id" uuid NOT NULL,
  "document_number" varchar(80) NOT NULL,
  "normalized_document_number" varchar(80) NOT NULL,
  "status" "management_supplier_invoice_status" DEFAULT 'pending' NOT NULL,
  "total_cents" integer NOT NULL,
  "competence_date" date NOT NULL,
  "due_date" date NOT NULL,
  "issued_at" date NOT NULL,
  "tolerance_cents" integer DEFAULT 0 NOT NULL,
  "reconciliation" jsonb,
  "reconciled_at" timestamp with time zone,
  "confirmed_at" timestamp with time zone,
  "confirmed_by_identity_id" uuid REFERENCES "identities"("id"),
  "idempotency_key" varchar(160) NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "management_supplier_invoices_scope_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "management_supplier_invoices_document_unique" UNIQUE("organization_id", "unit_id", "supplier_id", "normalized_document_number"),
  CONSTRAINT "management_supplier_invoices_idempotency_unique" UNIQUE("organization_id", "unit_id", "idempotency_key"),
  CONSTRAINT "management_supplier_invoices_order_unique" UNIQUE("organization_id", "unit_id", "purchase_order_id"),
  CONSTRAINT "management_supplier_invoices_order_fk" FOREIGN KEY ("organization_id", "unit_id", "purchase_order_id") REFERENCES "management_purchase_orders"("organization_id", "unit_id", "id") ON DELETE restrict,
  CONSTRAINT "management_supplier_invoices_supplier_fk" FOREIGN KEY ("organization_id", "unit_id", "supplier_id") REFERENCES "management_suppliers"("organization_id", "unit_id", "id") ON DELETE restrict,
  CONSTRAINT "management_supplier_invoices_total_check" CHECK ("total_cents" > 0),
  CONSTRAINT "management_supplier_invoices_tolerance_check" CHECK ("tolerance_cents" >= 0),
  CONSTRAINT "management_supplier_invoices_dates_check" CHECK ("due_date" >= "issued_at"),
  CONSTRAINT "management_supplier_invoices_version_check" CHECK ("version" > 0)
);--> statement-breakpoint

CREATE TABLE "management_supplier_invoice_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "invoice_id" uuid NOT NULL,
  "purchase_order_item_id" uuid NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "quantity" numeric(16, 3) NOT NULL,
  "unit_cost_cents" integer NOT NULL,
  "total_cents" integer NOT NULL,
  CONSTRAINT "management_supplier_invoice_lines_item_unique" UNIQUE("invoice_id", "purchase_order_item_id"),
  CONSTRAINT "management_supplier_invoice_lines_invoice_fk" FOREIGN KEY ("organization_id", "unit_id", "invoice_id") REFERENCES "management_supplier_invoices"("organization_id", "unit_id", "id") ON DELETE cascade,
  CONSTRAINT "management_supplier_invoice_lines_order_item_fk" FOREIGN KEY ("organization_id", "unit_id", "purchase_order_item_id") REFERENCES "management_purchase_order_items"("organization_id", "unit_id", "id") ON DELETE restrict,
  CONSTRAINT "management_supplier_invoice_lines_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "management_supplier_invoice_lines_cost_check" CHECK ("unit_cost_cents" > 0),
  CONSTRAINT "management_supplier_invoice_lines_total_check" CHECK ("total_cents" > 0)
);--> statement-breakpoint

ALTER TABLE "management_accounts_payable" ADD COLUMN "supplier_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD CONSTRAINT "management_payables_supplier_invoice_fk" FOREIGN KEY ("organization_id", "unit_id", "supplier_invoice_id") REFERENCES "management_supplier_invoices"("organization_id", "unit_id", "id") ON DELETE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "management_payables_supplier_invoice_unique" ON "management_accounts_payable" ("organization_id", "unit_id", "supplier_invoice_id") WHERE "supplier_invoice_id" IS NOT NULL;
