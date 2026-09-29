ALTER TABLE "pos_tab_payments" ADD COLUMN "received_cents" integer;
--> statement-breakpoint
ALTER TABLE "pos_tab_payments" ADD COLUMN "change_cents" integer;
--> statement-breakpoint
ALTER TABLE "pos_tab_payments" ADD CONSTRAINT "pos_tab_payments_cash_exchange_check"
CHECK (
  ("received_cents" IS NULL AND "change_cents" IS NULL)
  OR (
    "method" = 'cash' AND "received_cents" IS NOT NULL AND "change_cents" IS NOT NULL
    AND "received_cents" >= "amount_cents"
    AND "change_cents" = "received_cents" - "amount_cents"
  )
);
