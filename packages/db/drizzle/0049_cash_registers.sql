CREATE TABLE "management_cash_register_terminals" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"cash_register_id" uuid NOT NULL,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_cash_register_terminals_terminal_unique" UNIQUE("organization_id","unit_id","installation_id")
);
--> statement-breakpoint
CREATE TABLE "management_cash_registers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_identity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_cash_registers_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "management_cash_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"from_cash_shift_id" uuid NOT NULL,
	"to_cash_shift_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"transferred_by_identity_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_cash_transfers_amount_check" CHECK ("management_cash_transfers"."amount_cents" > 0),
	CONSTRAINT "management_cash_transfers_distinct_shifts_check" CHECK ("management_cash_transfers"."from_cash_shift_id" <> "management_cash_transfers"."to_cash_shift_id")
);
--> statement-breakpoint
ALTER TABLE "management_cash_entries" DROP CONSTRAINT "management_cash_entries_type_check";--> statement-breakpoint
DROP INDEX "management_cash_shifts_one_open_unique";--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ADD COLUMN "cash_register_id" uuid;--> statement-breakpoint
ALTER TABLE "management_cash_register_terminals" ADD CONSTRAINT "management_cash_register_terminals_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_register_terminals" ADD CONSTRAINT "management_cash_register_terminals_terminal_fk" FOREIGN KEY ("organization_id","unit_id","installation_id") REFERENCES "public"."pos_terminal_profiles"("organization_id","unit_id","installation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_register_terminals" ADD CONSTRAINT "management_cash_register_terminals_register_fk" FOREIGN KEY ("organization_id","unit_id","cash_register_id") REFERENCES "public"."management_cash_registers"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_registers" ADD CONSTRAINT "management_cash_registers_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_registers" ADD CONSTRAINT "management_cash_registers_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_transfers" ADD CONSTRAINT "management_cash_transfers_transferred_by_identity_id_identities_id_fk" FOREIGN KEY ("transferred_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_transfers" ADD CONSTRAINT "management_cash_transfers_from_shift_fk" FOREIGN KEY ("organization_id","unit_id","from_cash_shift_id") REFERENCES "public"."management_cash_shifts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_transfers" ADD CONSTRAINT "management_cash_transfers_to_shift_fk" FOREIGN KEY ("organization_id","unit_id","to_cash_shift_id") REFERENCES "public"."management_cash_shifts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "management_cash_register_terminals_register_idx" ON "management_cash_register_terminals" USING btree ("organization_id","unit_id","cash_register_id");--> statement-breakpoint
CREATE UNIQUE INDEX "management_cash_registers_name_unique" ON "management_cash_registers" USING btree ("organization_id","unit_id","name");--> statement-breakpoint
INSERT INTO "management_cash_registers" (
	"organization_id",
	"unit_id",
	"name",
	"active"
)
SELECT
	"organization_id",
	"id",
	'Caixa principal',
	true
FROM "units"
ON CONFLICT ("organization_id", "unit_id", "name") DO NOTHING;--> statement-breakpoint
UPDATE "management_cash_shifts" AS shift
SET "cash_register_id" = register."id"
FROM "management_cash_registers" AS register
WHERE register."organization_id" = shift."organization_id"
	AND register."unit_id" = shift."unit_id"
	AND register."name" = 'Caixa principal';--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ALTER COLUMN "cash_register_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "management_cash_transfers_idempotency_unique" ON "management_cash_transfers" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_cash_transfers_occurred_idx" ON "management_cash_transfers" USING btree ("organization_id","unit_id","occurred_at");--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ADD CONSTRAINT "management_cash_shifts_register_fk" FOREIGN KEY ("organization_id","unit_id","cash_register_id") REFERENCES "public"."management_cash_registers"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_cash_shifts_one_open_unique" ON "management_cash_shifts" USING btree ("organization_id","unit_id","cash_register_id") WHERE "management_cash_shifts"."status" = 'open';--> statement-breakpoint
ALTER TABLE "management_cash_entries" ADD CONSTRAINT "management_cash_entries_type_check" CHECK ("management_cash_entries"."entry_type" in ('pos_payment','receivable_payment','payable_payment','supply','withdrawal','refund','reversal','transfer_in','transfer_out'));
