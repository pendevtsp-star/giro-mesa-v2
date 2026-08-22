CREATE TABLE "management_cash_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"cash_shift_id" uuid NOT NULL,
	"direction" varchar(3) NOT NULL,
	"entry_type" varchar(32) NOT NULL,
	"payment_method" varchar(32),
	"affects_drawer" boolean DEFAULT true NOT NULL,
	"amount_cents" integer NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"source_id" uuid NOT NULL,
	"description" text,
	"actor_identity_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_cash_entries_direction_check" CHECK ("management_cash_entries"."direction" in ('in','out')),
	CONSTRAINT "management_cash_entries_type_check" CHECK ("management_cash_entries"."entry_type" in ('pos_payment','receivable_payment','payable_payment','supply','withdrawal','refund','reversal')),
	CONSTRAINT "management_cash_entries_amount_check" CHECK ("management_cash_entries"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ADD COLUMN "closed_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ADD COLUMN "reviewed_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ADD COLUMN "review_idempotency_key" varchar(160);--> statement-breakpoint
ALTER TABLE "management_cash_entries" ADD CONSTRAINT "management_cash_entries_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_entries" ADD CONSTRAINT "management_cash_entries_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_entries" ADD CONSTRAINT "management_cash_entries_shift_fk" FOREIGN KEY ("organization_id","unit_id","cash_shift_id") REFERENCES "public"."management_cash_shifts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_cash_entries_source_unique" ON "management_cash_entries" USING btree ("organization_id","unit_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "management_cash_entries_shift_occurred_idx" ON "management_cash_entries" USING btree ("organization_id","unit_id","cash_shift_id","occurred_at");--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ADD CONSTRAINT "management_cash_shifts_closed_by_identity_id_identities_id_fk" FOREIGN KEY ("closed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ADD CONSTRAINT "management_cash_shifts_reviewed_by_identity_id_identities_id_fk" FOREIGN KEY ("reviewed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_cash_shifts_review_idempotency_unique" ON "management_cash_shifts" USING btree ("organization_id","unit_id","review_idempotency_key") WHERE "management_cash_shifts"."review_idempotency_key" is not null;--> statement-breakpoint
CREATE FUNCTION prevent_cash_entry_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION USING
		ERRCODE = '55000',
		MESSAGE = 'cash entries are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER management_cash_entries_immutable
BEFORE UPDATE OR DELETE ON management_cash_entries
FOR EACH ROW EXECUTE FUNCTION prevent_cash_entry_mutation();--> statement-breakpoint
CREATE TRIGGER management_cash_entries_no_truncate
BEFORE TRUNCATE ON management_cash_entries
FOR EACH STATEMENT EXECUTE FUNCTION prevent_cash_entry_mutation();
