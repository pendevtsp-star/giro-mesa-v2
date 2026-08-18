ALTER TABLE "growth_delivery_couriers"
  ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(180);--> statement-breakpoint
ALTER TABLE "growth_delivery_couriers"
  ADD COLUMN IF NOT EXISTS "request_fingerprint" varchar(64);--> statement-breakpoint

UPDATE "growth_delivery_couriers"
SET
  "idempotency_key" = coalesce("idempotency_key", 'migration/' || "id"::text),
  "request_fingerprint" = coalesce("request_fingerprint", md5("id"::text) || md5("id"::text))
WHERE "idempotency_key" IS NULL OR "request_fingerprint" IS NULL;--> statement-breakpoint

ALTER TABLE "growth_delivery_couriers"
  ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "growth_delivery_couriers"
  ALTER COLUMN "request_fingerprint" SET NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "growth_delivery_courier_idempotency_unique"
  ON "growth_delivery_couriers" ("organization_id", "idempotency_key");
