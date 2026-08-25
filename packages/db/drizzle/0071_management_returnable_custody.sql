CREATE TABLE "management_returnable_policies" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"deposit_mode" varchar(16) DEFAULT 'disabled' NOT NULL,
	"default_due_days" integer DEFAULT 7 NOT NULL,
	"returnable_close_policy" varchar(16) DEFAULT 'warn' NOT NULL,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_returnable_policies_organization_id_unit_id_pk" PRIMARY KEY("organization_id","unit_id"),
	CONSTRAINT "management_returnable_policies_deposit_mode_check" CHECK ("management_returnable_policies"."deposit_mode" in ('disabled','manual')),
	CONSTRAINT "management_returnable_policies_close_policy_check" CHECK ("management_returnable_policies"."returnable_close_policy" in ('ignore','warn','block')),
	CONSTRAINT "management_returnable_policies_due_days_check" CHECK ("management_returnable_policies"."default_due_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "management_product_returnable_classifications" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"status" varchar(24) NOT NULL,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_product_returnable_classifications_organization_id_unit_id_product_id_pk" PRIMARY KEY("organization_id","unit_id","product_id"),
	CONSTRAINT "management_product_returnable_classifications_status_check" CHECK ("management_product_returnable_classifications"."status" in ('returnable','non_returnable'))
);
--> statement-breakpoint
CREATE TABLE "management_returnable_custody_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"issue_movement_id" uuid NOT NULL,
	"from_identity_id" uuid,
	"to_identity_id" uuid NOT NULL,
	"from_shift_reference" varchar(80),
	"to_shift_reference" varchar(80),
	"note" text NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_returnable_custody_handoffs_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_returnable_custody_handoffs_people_check" CHECK ("management_returnable_custody_handoffs"."from_identity_id" is null or "management_returnable_custody_handoffs"."from_identity_id" <> "management_returnable_custody_handoffs"."to_identity_id"),
	CONSTRAINT "management_returnable_custody_handoffs_note_check" CHECK (nullif(btrim("management_returnable_custody_handoffs"."note"), '') is not null)
);
--> statement-breakpoint
CREATE TABLE "management_returnable_deposit_charge_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"issue_movement_id" uuid NOT NULL,
	"container_inventory_item_id" uuid NOT NULL,
	"outstanding_quantity_at_charge" numeric(16, 3) NOT NULL,
	"deposit_cents_snapshot" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_returnable_deposit_charge_lines_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_returnable_deposit_charge_lines_issue_unique" UNIQUE("organization_id","unit_id","charge_id","issue_movement_id"),
	CONSTRAINT "management_returnable_deposit_charge_lines_values_check" CHECK ("management_returnable_deposit_charge_lines"."outstanding_quantity_at_charge" > 0 and "management_returnable_deposit_charge_lines"."deposit_cents_snapshot" > 0 and "management_returnable_deposit_charge_lines"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "management_returnable_deposit_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_returnable_deposit_reconciliations_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_returnable_deposit_reconciliations_amount_check" CHECK ("management_returnable_deposit_reconciliations"."amount_cents" > 0),
	CONSTRAINT "management_returnable_deposit_reconciliations_status_check" CHECK ("management_returnable_deposit_reconciliations"."status" in ('applied','formal_reversal_required')),
	CONSTRAINT "management_returnable_deposit_reconciliations_reason_check" CHECK (nullif(btrim("management_returnable_deposit_reconciliations"."reason"), '') is not null)
);
--> statement-breakpoint
ALTER TABLE "management_returnable_policies" ADD CONSTRAINT "management_returnable_policies_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_policies" ADD CONSTRAINT "management_returnable_policies_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_product_returnable_classifications" ADD CONSTRAINT "management_product_returnable_classifications_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_product_returnable_classifications" ADD CONSTRAINT "management_product_returnable_classifications_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_product_returnable_classifications" ADD CONSTRAINT "management_product_returnable_classifications_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_custody_handoffs" ADD CONSTRAINT "management_returnable_custody_handoffs_issue_fk" FOREIGN KEY ("organization_id","unit_id","issue_movement_id") REFERENCES "public"."management_returnable_custody_movements"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_custody_handoffs" ADD CONSTRAINT "management_returnable_custody_handoffs_from_identity_id_identities_id_fk" FOREIGN KEY ("from_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_custody_handoffs" ADD CONSTRAINT "management_returnable_custody_handoffs_to_identity_id_identities_id_fk" FOREIGN KEY ("to_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_custody_handoffs" ADD CONSTRAINT "management_returnable_custody_handoffs_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_deposit_charge_lines" ADD CONSTRAINT "management_returnable_deposit_charge_lines_charge_fk" FOREIGN KEY ("organization_id","unit_id","charge_id") REFERENCES "public"."management_returnable_deposit_charges"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_deposit_charge_lines" ADD CONSTRAINT "management_returnable_deposit_charge_lines_issue_fk" FOREIGN KEY ("organization_id","unit_id","issue_movement_id") REFERENCES "public"."management_returnable_custody_movements"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_deposit_charge_lines" ADD CONSTRAINT "management_returnable_deposit_charge_lines_container_fk" FOREIGN KEY ("organization_id","unit_id","container_inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_deposit_reconciliations" ADD CONSTRAINT "management_returnable_deposit_reconciliations_charge_fk" FOREIGN KEY ("organization_id","unit_id","charge_id") REFERENCES "public"."management_returnable_deposit_charges"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_returnable_deposit_reconciliations" ADD CONSTRAINT "management_returnable_deposit_reconciliations_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "management_returnable_custody_handoffs_idempotency_unique" ON "management_returnable_custody_handoffs" USING btree ("organization_id","unit_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "management_returnable_custody_handoffs_issue_idx" ON "management_returnable_custody_handoffs" USING btree ("organization_id","unit_id","issue_movement_id","occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_returnable_deposit_reconciliations_idempotency_unique" ON "management_returnable_deposit_reconciliations" USING btree ("organization_id","unit_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "management_returnable_deposit_reconciliations_charge_idx" ON "management_returnable_deposit_reconciliations" USING btree ("organization_id","unit_id","charge_id","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_management_returnable_ledger_mutation()
RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'returnable custody financial ledgers are immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "management_returnable_custody_handoffs_immutable"
BEFORE UPDATE OR DELETE ON "management_returnable_custody_handoffs"
FOR EACH ROW EXECUTE FUNCTION prevent_management_returnable_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER "management_returnable_deposit_charge_lines_immutable"
BEFORE UPDATE OR DELETE ON "management_returnable_deposit_charge_lines"
FOR EACH ROW EXECUTE FUNCTION prevent_management_returnable_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER "management_returnable_deposit_reconciliations_immutable"
BEFORE UPDATE OR DELETE ON "management_returnable_deposit_reconciliations"
FOR EACH ROW EXECUTE FUNCTION prevent_management_returnable_ledger_mutation();
--> statement-breakpoint
WITH "candidate_parent" AS (
	SELECT "child"."id" AS "child_id", (array_agg("issue"."id" ORDER BY "issue"."occurred_at", "issue"."id"))[1] AS "issue_id"
	FROM "management_returnable_custody_movements" "child"
	INNER JOIN "management_returnable_custody_movements" "issue"
		ON "issue"."organization_id" = "child"."organization_id"
		AND "issue"."unit_id" = "child"."unit_id"
		AND "issue"."container_inventory_item_id" = "child"."container_inventory_item_id"
		AND "issue"."type" = 'issue'
		AND (
			("child"."order_item_id" IS NOT NULL AND "issue"."order_item_id" = "child"."order_item_id")
			OR ("child"."order_item_id" IS NULL AND "child"."order_id" IS NOT NULL AND "issue"."order_id" = "child"."order_id")
		)
	WHERE "child"."parent_movement_id" IS NULL
		AND "child"."type" IN ('return','incident','correction')
	GROUP BY "child"."id"
	HAVING count(*) = 1
)
UPDATE "management_returnable_custody_movements" "child"
SET "parent_movement_id" = "candidate_parent"."issue_id"
FROM "candidate_parent"
WHERE "child"."id" = "candidate_parent"."child_id";
