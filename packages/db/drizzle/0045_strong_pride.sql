CREATE TABLE "management_waiter_settlement_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"settlement_line_id" uuid NOT NULL,
	"source_key" varchar(180) NOT NULL,
	"source_unit_id" uuid NOT NULL,
	"tab_id" uuid NOT NULL,
	"order_id" uuid,
	"gross_sales_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"canceled_cents" integer NOT NULL,
	"received_cents" integer NOT NULL,
	"service_charge_cents" integer NOT NULL,
	"tip_cents" integer NOT NULL,
	"operational_loss_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_waiter_settlement_sources_key_unique" UNIQUE("organization_id","unit_id","settlement_id","source_key"),
	CONSTRAINT "management_waiter_settlement_sources_totals_check" CHECK ("management_waiter_settlement_sources"."gross_sales_cents" >= 0 and "management_waiter_settlement_sources"."discount_cents" >= 0 and "management_waiter_settlement_sources"."canceled_cents" >= 0 and "management_waiter_settlement_sources"."received_cents" >= 0 and "management_waiter_settlement_sources"."service_charge_cents" >= 0 and "management_waiter_settlement_sources"."tip_cents" >= 0 and "management_waiter_settlement_sources"."operational_loss_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" DROP CONSTRAINT "management_waiter_settlement_lines_person_unique";--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" DROP CONSTRAINT "management_waiter_settlement_lines_totals_check";--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" DROP CONSTRAINT "management_waiter_settlement_lines_person_fk";
--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ALTER COLUMN "person_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_in_session_id" varchar(160);--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_in_geofence_label" varchar(160);--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_in_offline_justification" varchar(1000);--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_out_session_id" varchar(160);--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_out_geofence_label" varchar(160);--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD COLUMN "clock_out_offline_justification" varchar(1000);--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "start_session_id" varchar(160);--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "start_geofence_label" varchar(160);--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "start_offline_justification" varchar(1000);--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "end_session_id" varchar(160);--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "end_geofence_label" varchar(160);--> statement-breakpoint
ALTER TABLE "management_time_entry_breaks" ADD COLUMN "end_offline_justification" varchar(1000);--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD COLUMN "person_identity_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD COLUMN "person_name" varchar(160) NOT NULL;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD COLUMN "role_label" varchar(80) NOT NULL;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD COLUMN "eligible_for_payment" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD COLUMN "tab_count" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD COLUMN "order_count" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD COLUMN "tip_cents" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "management_waiter_settlements" ADD COLUMN "operational_shift_id" uuid;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD CONSTRAINT "management_waiter_settlement_lines_scope_id_unique" UNIQUE("organization_id","unit_id","settlement_id","id");--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_sources" ADD CONSTRAINT "management_waiter_settlement_sources_line_fk" FOREIGN KEY ("organization_id","unit_id","settlement_id","settlement_line_id") REFERENCES "public"."management_waiter_settlement_lines"("organization_id","unit_id","settlement_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_sources" ADD CONSTRAINT "management_waiter_settlement_sources_tab_fk" FOREIGN KEY ("organization_id","source_unit_id","tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_sources" ADD CONSTRAINT "management_waiter_settlement_sources_order_fk" FOREIGN KEY ("organization_id","source_unit_id","order_id") REFERENCES "public"."pos_orders"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD CONSTRAINT "management_waiter_settlement_lines_person_id_management_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."management_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD CONSTRAINT "management_waiter_settlement_lines_person_identity_id_identities_id_fk" FOREIGN KEY ("person_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlements" ADD CONSTRAINT "management_waiter_settlements_shift_fk" FOREIGN KEY ("organization_id","unit_id","operational_shift_id") REFERENCES "public"."pos_operational_shifts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD CONSTRAINT "management_waiter_settlement_lines_person_unique" UNIQUE("organization_id","unit_id","settlement_id","person_identity_id");--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD CONSTRAINT "management_waiter_settlement_lines_payable_check" CHECK ("management_waiter_settlement_lines"."payable_cents" = "management_waiter_settlement_lines"."service_share_cents" + "management_waiter_settlement_lines"."partnership_cents" and ("management_waiter_settlement_lines"."eligible_for_payment" or "management_waiter_settlement_lines"."payable_cents" = 0));--> statement-breakpoint
ALTER TABLE "management_waiter_settlement_lines" ADD CONSTRAINT "management_waiter_settlement_lines_totals_check" CHECK ("management_waiter_settlement_lines"."tab_count" >= 0 and "management_waiter_settlement_lines"."order_count" >= 0 and "management_waiter_settlement_lines"."gross_sales_cents" >= 0 and "management_waiter_settlement_lines"."discount_cents" >= 0 and "management_waiter_settlement_lines"."canceled_cents" >= 0 and "management_waiter_settlement_lines"."received_cents" >= 0 and "management_waiter_settlement_lines"."service_charge_cents" >= 0 and "management_waiter_settlement_lines"."tip_cents" >= 0 and "management_waiter_settlement_lines"."service_share_cents" >= 0 and "management_waiter_settlement_lines"."partnership_base_cents" >= 0 and "management_waiter_settlement_lines"."partnership_cents" >= 0 and "management_waiter_settlement_lines"."operational_loss_cents" >= 0 and "management_waiter_settlement_lines"."payable_cents" >= 0);--> statement-breakpoint
ALTER TABLE "management_waiter_settlements" ADD CONSTRAINT "management_waiter_settlements_lifecycle_check" CHECK (("management_waiter_settlements"."status" = 'closed' and "management_waiter_settlements"."approved_at" is null and "management_waiter_settlements"."paid_at" is null and "management_waiter_settlements"."canceled_at" is null) or ("management_waiter_settlements"."status" = 'approved' and "management_waiter_settlements"."approved_at" is not null and "management_waiter_settlements"."approved_by_identity_id" is not null and nullif(btrim("management_waiter_settlements"."approval_note"), '') is not null and "management_waiter_settlements"."paid_at" is null and "management_waiter_settlements"."canceled_at" is null) or ("management_waiter_settlements"."status" = 'paid' and "management_waiter_settlements"."approved_at" is not null and "management_waiter_settlements"."approved_by_identity_id" is not null and "management_waiter_settlements"."paid_at" is not null and "management_waiter_settlements"."paid_by_identity_id" is not null and nullif(btrim("management_waiter_settlements"."payment_note"), '') is not null and "management_waiter_settlements"."canceled_at" is null) or ("management_waiter_settlements"."status" = 'canceled' and "management_waiter_settlements"."paid_at" is null and "management_waiter_settlements"."canceled_at" is not null and "management_waiter_settlements"."canceled_by_identity_id" is not null and nullif(btrim("management_waiter_settlements"."cancellation_note"), '') is not null));
