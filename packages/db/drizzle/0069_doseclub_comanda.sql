CREATE TABLE IF NOT EXISTS "doseclub_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"external_customer_id" varchar(180) NOT NULL,
	"external_club_id" varchar(180) NOT NULL,
	"external_product_id" varchar(180) NOT NULL,
	"doses" integer NOT NULL,
	"status" varchar(32) DEFAULT 'pending_reservation' NOT NULL,
	"operation_id" varchar(180),
	"reserve_idempotency_key" varchar(180) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"available_doses" integer,
	"reserved_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"last_error_code" varchar(100),
	"last_error_message" varchar(500),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doseclub_redemptions_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "doseclub_redemptions_doses_check" CHECK ("doseclub_redemptions"."doses" between 1 and 500),
	CONSTRAINT "doseclub_redemptions_status_check" CHECK ("doseclub_redemptions"."status" in ('pending_reservation','reserved','commit_pending','committed','cancel_pending','canceled','expired','reverse_pending','reversed','failed')),
	CONSTRAINT "doseclub_redemptions_fingerprint_check" CHECK ("doseclub_redemptions"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "doseclub_redemptions_version_check" CHECK ("doseclub_redemptions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "doseclub_redemptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "doseclub_redemptions" ADD CONSTRAINT "doseclub_redemptions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "doseclub_redemptions" ADD CONSTRAINT "doseclub_redemptions_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "doseclub_redemptions" ADD CONSTRAINT "doseclub_redemptions_integration_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."growth_integrations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "doseclub_redemptions" ADD CONSTRAINT "doseclub_redemptions_order_fk" FOREIGN KEY ("organization_id","unit_id","order_id") REFERENCES "public"."pos_orders"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "doseclub_redemptions" ADD CONSTRAINT "doseclub_redemptions_order_item_fk" FOREIGN KEY ("organization_id","unit_id","order_item_id") REFERENCES "public"."pos_order_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doseclub_redemptions_order_item_unique" ON "doseclub_redemptions" USING btree ("organization_id","unit_id","order_item_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doseclub_redemptions_reserve_key_unique" ON "doseclub_redemptions" USING btree ("integration_id","reserve_idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "doseclub_redemptions_operation_unique" ON "doseclub_redemptions" USING btree ("integration_id","operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doseclub_redemptions_order_idx" ON "doseclub_redemptions" USING btree ("organization_id","unit_id","order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doseclub_redemptions_status_idx" ON "doseclub_redemptions" USING btree ("status","updated_at");
