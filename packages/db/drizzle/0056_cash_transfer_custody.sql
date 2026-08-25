ALTER TABLE "management_cash_transfers" ADD COLUMN "status" varchar(16) DEFAULT 'accepted' NOT NULL;--> statement-breakpoint
ALTER TABLE "management_cash_transfers" ADD COLUMN "decided_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_cash_transfers" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "management_cash_transfers" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
UPDATE "management_cash_transfers"
SET "decided_by_identity_id" = "transferred_by_identity_id",
    "decided_at" = "occurred_at";--> statement-breakpoint
ALTER TABLE "management_cash_transfers" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "management_cash_transfers" ADD CONSTRAINT "management_cash_transfers_decided_by_identity_id_identities_id_fk" FOREIGN KEY ("decided_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "management_cash_transfers_status_idx" ON "management_cash_transfers" USING btree ("organization_id", "unit_id", "status", "occurred_at");--> statement-breakpoint
ALTER TABLE "management_cash_transfers" ADD CONSTRAINT "management_cash_transfers_status_check" CHECK ("management_cash_transfers"."status" in ('pending','accepted','rejected'));--> statement-breakpoint
ALTER TABLE "management_cash_transfers" ADD CONSTRAINT "management_cash_transfers_decision_check" CHECK (("management_cash_transfers"."status" = 'pending' and "management_cash_transfers"."decided_by_identity_id" is null and "management_cash_transfers"."decided_at" is null and "management_cash_transfers"."decision_note" is null) or ("management_cash_transfers"."status" = 'accepted' and "management_cash_transfers"."decided_by_identity_id" is not null and "management_cash_transfers"."decided_at" is not null) or ("management_cash_transfers"."status" = 'rejected' and "management_cash_transfers"."decided_by_identity_id" is not null and "management_cash_transfers"."decided_at" is not null and nullif(btrim("management_cash_transfers"."decision_note"), '') is not null));
