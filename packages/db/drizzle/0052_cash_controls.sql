CREATE TABLE "management_cash_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"cash_register_id" uuid,
	"original_cash_shift_id" uuid,
	"direction" varchar(3) NOT NULL,
	"entry_type" varchar(16) NOT NULL,
	"payment_method" varchar(32),
	"affects_drawer" boolean DEFAULT true NOT NULL,
	"amount_cents" integer NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"source_id" uuid NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"description" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_cash_adjustments_direction_check" CHECK ("management_cash_adjustments"."direction" in ('in','out')),
	CONSTRAINT "management_cash_adjustments_type_check" CHECK ("management_cash_adjustments"."entry_type" in ('reversal','refund')),
	CONSTRAINT "management_cash_adjustments_amount_check" CHECK ("management_cash_adjustments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "management_cash_approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"cash_shift_id" uuid NOT NULL,
	"target_cash_shift_id" uuid,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"requested_by_identity_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"decided_by_identity_id" uuid,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"executed_movement_id" uuid,
	"executed_transfer_id" uuid,
	"idempotency_key" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_cash_approval_requests_kind_check" CHECK ("management_cash_approval_requests"."kind" in ('supply','withdrawal','transfer')),
	CONSTRAINT "management_cash_approval_requests_status_check" CHECK ("management_cash_approval_requests"."status" in ('pending','approved','rejected')),
	CONSTRAINT "management_cash_approval_requests_amount_check" CHECK ("management_cash_approval_requests"."amount_cents" > 0),
	CONSTRAINT "management_cash_approval_requests_target_check" CHECK (("management_cash_approval_requests"."kind" = 'transfer' and "management_cash_approval_requests"."target_cash_shift_id" is not null and "management_cash_approval_requests"."target_cash_shift_id" <> "management_cash_approval_requests"."cash_shift_id") or ("management_cash_approval_requests"."kind" in ('supply','withdrawal') and "management_cash_approval_requests"."target_cash_shift_id" is null)),
	CONSTRAINT "management_cash_approval_requests_decision_check" CHECK (("management_cash_approval_requests"."status" = 'pending' and "management_cash_approval_requests"."decided_by_identity_id" is null and "management_cash_approval_requests"."decided_at" is null and "management_cash_approval_requests"."decision_note" is null) or ("management_cash_approval_requests"."status" = 'approved' and "management_cash_approval_requests"."decided_by_identity_id" is not null and "management_cash_approval_requests"."decided_at" is not null) or ("management_cash_approval_requests"."status" = 'rejected' and "management_cash_approval_requests"."decided_by_identity_id" is not null and "management_cash_approval_requests"."decided_at" is not null and nullif(btrim("management_cash_approval_requests"."decision_note"), '') is not null)),
	CONSTRAINT "management_cash_approval_requests_execution_check" CHECK (("management_cash_approval_requests"."executed_movement_id" is null or ("management_cash_approval_requests"."status" = 'approved' and "management_cash_approval_requests"."kind" in ('supply','withdrawal'))) and ("management_cash_approval_requests"."executed_transfer_id" is null or ("management_cash_approval_requests"."status" = 'approved' and "management_cash_approval_requests"."kind" = 'transfer')) and not ("management_cash_approval_requests"."executed_movement_id" is not null and "management_cash_approval_requests"."executed_transfer_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "management_cash_settings" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"movement_approval_threshold_cents" integer DEFAULT 50000 NOT NULL,
	"discrepancy_critical_threshold_cents" integer DEFAULT 1000 NOT NULL,
	"max_shift_minutes" integer DEFAULT 720 NOT NULL,
	"updated_by_identity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_cash_settings_unit_unique" UNIQUE("organization_id","unit_id"),
	CONSTRAINT "management_cash_settings_movement_threshold_check" CHECK ("management_cash_settings"."movement_approval_threshold_cents" >= 0),
	CONSTRAINT "management_cash_settings_discrepancy_threshold_check" CHECK ("management_cash_settings"."discrepancy_critical_threshold_cents" >= 0),
	CONSTRAINT "management_cash_settings_max_shift_check" CHECK ("management_cash_settings"."max_shift_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "management_cash_shift_responsibilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"cash_shift_id" uuid NOT NULL,
	"from_identity_id" uuid NOT NULL,
	"to_identity_id" uuid NOT NULL,
	"transferred_by_identity_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_cash_shift_responsibilities_distinct_check" CHECK ("management_cash_shift_responsibilities"."from_identity_id" <> "management_cash_shift_responsibilities"."to_identity_id")
);
--> statement-breakpoint
CREATE TABLE "management_cash_shift_tender_counts" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"cash_shift_id" uuid NOT NULL,
	"method" varchar(32) NOT NULL,
	"expected_cents" integer NOT NULL,
	"observed_cents" integer NOT NULL,
	"difference_cents" integer NOT NULL,
	"source" varchar(16) NOT NULL,
	"recorded_by_identity_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_cash_shift_tender_counts_method_unique" UNIQUE("organization_id","unit_id","cash_shift_id","method"),
	CONSTRAINT "management_cash_shift_tender_counts_expected_check" CHECK ("management_cash_shift_tender_counts"."expected_cents" >= 0),
	CONSTRAINT "management_cash_shift_tender_counts_observed_check" CHECK ("management_cash_shift_tender_counts"."observed_cents" >= 0),
	CONSTRAINT "management_cash_shift_tender_counts_difference_check" CHECK ("management_cash_shift_tender_counts"."difference_cents" = "management_cash_shift_tender_counts"."observed_cents" - "management_cash_shift_tender_counts"."expected_cents"),
	CONSTRAINT "management_cash_shift_tender_counts_source_check" CHECK ("management_cash_shift_tender_counts"."source" in ('manual','smartpos'))
);
--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ADD COLUMN "current_responsible_identity_id" uuid;--> statement-breakpoint
UPDATE "management_cash_shifts"
SET "current_responsible_identity_id" = "operator_identity_id";--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ALTER COLUMN "current_responsible_identity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "management_cash_adjustments" ADD CONSTRAINT "management_cash_adjustments_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_adjustments" ADD CONSTRAINT "management_cash_adjustments_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_adjustments" ADD CONSTRAINT "management_cash_adjustments_register_fk" FOREIGN KEY ("organization_id","unit_id","cash_register_id") REFERENCES "public"."management_cash_registers"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_adjustments" ADD CONSTRAINT "management_cash_adjustments_shift_fk" FOREIGN KEY ("organization_id","unit_id","original_cash_shift_id") REFERENCES "public"."management_cash_shifts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_movements" ADD CONSTRAINT "management_cash_movements_scope_id_unique" UNIQUE("organization_id","unit_id","id");--> statement-breakpoint
ALTER TABLE "management_cash_transfers" ADD CONSTRAINT "management_cash_transfers_scope_id_unique" UNIQUE("organization_id","unit_id","id");--> statement-breakpoint
ALTER TABLE "management_cash_approval_requests" ADD CONSTRAINT "management_cash_approval_requests_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_approval_requests" ADD CONSTRAINT "management_cash_approval_requests_decided_by_identity_id_identities_id_fk" FOREIGN KEY ("decided_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_approval_requests" ADD CONSTRAINT "management_cash_approval_requests_shift_fk" FOREIGN KEY ("organization_id","unit_id","cash_shift_id") REFERENCES "public"."management_cash_shifts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_approval_requests" ADD CONSTRAINT "management_cash_approval_requests_target_shift_fk" FOREIGN KEY ("organization_id","unit_id","target_cash_shift_id") REFERENCES "public"."management_cash_shifts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_approval_requests" ADD CONSTRAINT "management_cash_approval_requests_movement_fk" FOREIGN KEY ("organization_id","unit_id","executed_movement_id") REFERENCES "public"."management_cash_movements"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_approval_requests" ADD CONSTRAINT "management_cash_approval_requests_transfer_fk" FOREIGN KEY ("organization_id","unit_id","executed_transfer_id") REFERENCES "public"."management_cash_transfers"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_settings" ADD CONSTRAINT "management_cash_settings_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_settings" ADD CONSTRAINT "management_cash_settings_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "management_cash_settings" ("organization_id", "unit_id")
SELECT "organization_id", "id"
FROM "units"
ON CONFLICT ("organization_id", "unit_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "management_cash_shift_responsibilities" ADD CONSTRAINT "management_cash_shift_responsibilities_from_identity_id_identities_id_fk" FOREIGN KEY ("from_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_shift_responsibilities" ADD CONSTRAINT "management_cash_shift_responsibilities_to_identity_id_identities_id_fk" FOREIGN KEY ("to_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_shift_responsibilities" ADD CONSTRAINT "management_cash_shift_responsibilities_transferred_by_identity_id_identities_id_fk" FOREIGN KEY ("transferred_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_shift_responsibilities" ADD CONSTRAINT "management_cash_shift_responsibilities_shift_fk" FOREIGN KEY ("organization_id","unit_id","cash_shift_id") REFERENCES "public"."management_cash_shifts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_shift_tender_counts" ADD CONSTRAINT "management_cash_shift_tender_counts_recorded_by_identity_id_identities_id_fk" FOREIGN KEY ("recorded_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_shift_tender_counts" ADD CONSTRAINT "management_cash_shift_tender_counts_shift_fk" FOREIGN KEY ("organization_id","unit_id","cash_shift_id") REFERENCES "public"."management_cash_shifts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_cash_adjustments_source_unique" ON "management_cash_adjustments" USING btree ("organization_id","unit_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "management_cash_adjustments_occurred_idx" ON "management_cash_adjustments" USING btree ("organization_id","unit_id","occurred_at");--> statement-breakpoint
CREATE FUNCTION prevent_cash_adjustment_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION USING
		ERRCODE = '55000',
		MESSAGE = 'cash adjustments are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER management_cash_adjustments_immutable
BEFORE UPDATE OR DELETE ON management_cash_adjustments
FOR EACH ROW EXECUTE FUNCTION prevent_cash_adjustment_mutation();--> statement-breakpoint
CREATE TRIGGER management_cash_adjustments_no_truncate
BEFORE TRUNCATE ON management_cash_adjustments
FOR EACH STATEMENT EXECUTE FUNCTION prevent_cash_adjustment_mutation();--> statement-breakpoint
CREATE UNIQUE INDEX "management_cash_approval_requests_idempotency_unique" ON "management_cash_approval_requests" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_cash_approval_requests_status_idx" ON "management_cash_approval_requests" USING btree ("organization_id","unit_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_cash_shift_responsibilities_idempotency_unique" ON "management_cash_shift_responsibilities" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_cash_shift_responsibilities_shift_idx" ON "management_cash_shift_responsibilities" USING btree ("organization_id","unit_id","cash_shift_id","occurred_at");--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ADD CONSTRAINT "management_cash_shifts_current_responsible_identity_id_identities_id_fk" FOREIGN KEY ("current_responsible_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
