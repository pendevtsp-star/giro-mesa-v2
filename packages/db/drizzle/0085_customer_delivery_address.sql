ALTER TABLE "growth_customers" ADD COLUMN "default_delivery_address" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "growth_customers_org_idempotency_key_unique" ON "growth_customers" USING btree ("organization_id","idempotency_key");
