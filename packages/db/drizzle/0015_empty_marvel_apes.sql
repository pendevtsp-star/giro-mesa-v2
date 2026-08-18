CREATE TABLE "pos_shift_table_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"source_shift_section_id" uuid NOT NULL,
	"target_shift_section_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"reason" varchar(500) NOT NULL,
	"transferred_by_identity_id" uuid NOT NULL,
	"ended_by_identity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_shift_table_transfers_distinct_sections_check" CHECK ("pos_shift_table_transfers"."source_shift_section_id" <> "pos_shift_table_transfers"."target_shift_section_id"),
	CONSTRAINT "pos_shift_table_transfers_expiry_check" CHECK ("pos_shift_table_transfers"."expires_at" > "pos_shift_table_transfers"."created_at")
);
--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD CONSTRAINT "pos_shift_table_transfers_transferred_by_identity_id_identities_id_fk" FOREIGN KEY ("transferred_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD CONSTRAINT "pos_shift_table_transfers_ended_by_identity_id_identities_id_fk" FOREIGN KEY ("ended_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD CONSTRAINT "pos_shift_table_transfers_shift_fk" FOREIGN KEY ("organization_id","unit_id","shift_id") REFERENCES "public"."pos_operational_shifts"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD CONSTRAINT "pos_shift_table_transfers_table_fk" FOREIGN KEY ("organization_id","unit_id","table_id") REFERENCES "public"."pos_dining_tables"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD CONSTRAINT "pos_shift_table_transfers_source_section_fk" FOREIGN KEY ("organization_id","unit_id","shift_id","source_shift_section_id") REFERENCES "public"."pos_shift_sections"("organization_id","unit_id","shift_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_table_transfers" ADD CONSTRAINT "pos_shift_table_transfers_target_section_fk" FOREIGN KEY ("organization_id","unit_id","shift_id","target_shift_section_id") REFERENCES "public"."pos_shift_sections"("organization_id","unit_id","shift_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_shift_table_transfers_one_open_unique" ON "pos_shift_table_transfers" USING btree ("organization_id","unit_id","shift_id","table_id") WHERE "pos_shift_table_transfers"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pos_shift_table_transfers_active_idx" ON "pos_shift_table_transfers" USING btree ("organization_id","unit_id","shift_id","expires_at");