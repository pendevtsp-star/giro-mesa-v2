CREATE TABLE "management_finance_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "file_name" varchar(180) NOT NULL,
  "content_type" varchar(120) NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "storage_key" text NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "uploaded_by_identity_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "management_finance_attachments_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
  CONSTRAINT "management_finance_attachments_idempotency_unique" UNIQUE("organization_id","unit_id","idempotency_key"),
  CONSTRAINT "management_finance_attachments_size_check" CHECK ("size_bytes" > 0),
  CONSTRAINT "management_finance_attachments_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade,
  CONSTRAINT "management_finance_attachments_uploader_fk" FOREIGN KEY ("uploaded_by_identity_id") REFERENCES "public"."identities"("id")
);

ALTER TABLE "management_waiter_settlements"
  ADD COLUMN "payment_method" varchar(32),
  ADD COLUMN "payment_reference" varchar(160),
  ADD COLUMN "payment_attachment_id" uuid,
  ADD COLUMN "finance_payable_id" uuid,
  ADD COLUMN "finance_payment_id" uuid,
  ADD CONSTRAINT "management_waiter_settlements_payment_attachment_fk" FOREIGN KEY ("organization_id","unit_id","payment_attachment_id") REFERENCES "public"."management_finance_attachments"("organization_id","unit_id","id") ON DELETE restrict,
  ADD CONSTRAINT "management_waiter_settlements_finance_payable_fk" FOREIGN KEY ("organization_id","unit_id","finance_payable_id") REFERENCES "public"."management_accounts_payable"("organization_id","unit_id","id") ON DELETE restrict,
  ADD CONSTRAINT "management_waiter_settlements_finance_payment_fk" FOREIGN KEY ("finance_payment_id") REFERENCES "public"."management_payable_payments"("id") ON DELETE restrict;

CREATE INDEX "management_waiter_settlements_finance_payable_idx"
  ON "management_waiter_settlements" ("organization_id", "unit_id", "finance_payable_id");

UPDATE "management_waiter_settlements"
   SET "payment_method" = 'other',
       "payment_reference" = coalesce("payment_reference", 'Registro anterior à versão 81')
 WHERE "status" = 'paid' AND "payment_method" IS NULL;

ALTER TABLE "management_waiter_settlements"
  DROP CONSTRAINT "management_waiter_settlements_lifecycle_check",
  ADD CONSTRAINT "management_waiter_settlements_lifecycle_check" CHECK (
    ("status" = 'closed' AND "approved_at" IS NULL AND "paid_at" IS NULL AND "canceled_at" IS NULL AND "payment_method" IS NULL)
    OR ("status" = 'approved' AND "approved_at" IS NOT NULL AND "approved_by_identity_id" IS NOT NULL AND nullif(btrim("approval_note"), '') IS NOT NULL AND "paid_at" IS NULL AND "canceled_at" IS NULL AND "payment_method" IS NULL)
    OR ("status" = 'paid' AND "approved_at" IS NOT NULL AND "approved_by_identity_id" IS NOT NULL AND "paid_at" IS NOT NULL AND "paid_by_identity_id" IS NOT NULL AND nullif(btrim("payment_note"), '') IS NOT NULL AND "payment_method" IN ('cash','pix','credit_card','debit_card','bank_transfer','other') AND "canceled_at" IS NULL)
    OR ("status" = 'canceled' AND "paid_at" IS NULL AND "canceled_at" IS NOT NULL AND "canceled_by_identity_id" IS NOT NULL AND nullif(btrim("cancellation_note"), '') IS NOT NULL)
  );
