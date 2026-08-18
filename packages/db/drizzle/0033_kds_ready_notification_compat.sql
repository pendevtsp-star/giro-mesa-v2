ALTER TABLE "pos_orders"
ADD COLUMN IF NOT EXISTS "ready_notified_at" timestamp with time zone;--> statement-breakpoint

UPDATE "pos_orders" AS orders
SET "ready_notified_at" = tabs."ready_notified_at"
FROM "pos_tabs" AS tabs
WHERE orders."ready_notified_at" IS NULL
  AND tabs."organization_id" = orders."organization_id"
  AND tabs."unit_id" = orders."unit_id"
  AND tabs."id" = orders."tab_id"
  AND tabs."ready_notified_at" IS NOT NULL
  AND orders."status" IN ('ready', 'served');
