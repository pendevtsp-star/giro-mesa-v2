CREATE TABLE "hub_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"hub_id" uuid NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"type" varchar(100) NOT NULL,
	"source" varchar(40) NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD COLUMN "public_protocol" varchar(40);--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD COLUMN "customer_name" varchar(120);--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD COLUMN "customer_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD COLUMN "payment_method" varchar(30) DEFAULT 'pay_on_fulfillment' NOT NULL;--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD COLUMN "payment_status" varchar(30) DEFAULT 'awaiting_payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "device_enrollments" ADD COLUMN "sync_key_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "device_enrollments" ADD CONSTRAINT "devices_scope_id_unique" UNIQUE("organization_id","unit_id","id");--> statement-breakpoint
ALTER TABLE "hub_commands" ADD CONSTRAINT "hub_commands_device_scope_fk" FOREIGN KEY ("organization_id","unit_id","hub_id") REFERENCES "public"."device_enrollments"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hub_commands_unit_idempotency_unique" ON "hub_commands" USING btree ("unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "hub_commands_pending_idx" ON "hub_commands" USING btree ("hub_id","acknowledged_at","created_at");--> statement-breakpoint
ALTER TABLE "hub_heartbeats" ADD CONSTRAINT "hub_heartbeats_device_scope_fk" FOREIGN KEY ("organization_id","unit_id","hub_id") REFERENCES "public"."device_enrollments"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "growth_delivery_public_protocol_unique" ON "growth_delivery_orders" USING btree ("public_protocol");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_sync_key_hash_unique" ON "device_enrollments" USING btree ("sync_key_hash");
