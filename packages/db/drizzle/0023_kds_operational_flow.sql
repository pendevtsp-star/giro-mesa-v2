ALTER TABLE "pos_order_items" ADD COLUMN "estimated_prep_time_minutes" integer;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN "ready_notified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "pos_orders" orders
SET "ready_notified_at" = tabs."ready_notified_at"
FROM "pos_tabs" tabs
WHERE tabs."organization_id" = orders."organization_id"
  AND tabs."unit_id" = orders."unit_id"
  AND tabs."id" = orders."tab_id"
  AND tabs."ready_notified_at" IS NOT NULL
  AND orders."status" IN ('ready', 'served');--> statement-breakpoint
UPDATE "pos_order_items" item
SET "estimated_prep_time_minutes" = product."estimated_prep_time_minutes"
FROM "pos_products" product
WHERE product."organization_id" = item."organization_id"
  AND product."id" = item."product_id";--> statement-breakpoint
ALTER TABLE "pos_order_items" ADD CONSTRAINT "pos_order_items_estimated_prep_check" CHECK ("estimated_prep_time_minutes" IS NULL OR "estimated_prep_time_minutes" >= 0);--> statement-breakpoint

WITH ranked AS (
  SELECT mapping.ctid AS row_id,
    row_number() OVER (
      PARTITION BY mapping."organization_id", mapping."unit_id", mapping."product_id"
      ORDER BY
        station."active" DESC,
        (mapping."station_id" = category_config."default_station_id") DESC NULLS LAST,
        station."code",
        mapping."station_id"
    ) AS position
  FROM "pos_product_stations" mapping
  JOIN "pos_products" product
    ON product."organization_id" = mapping."organization_id"
   AND product."id" = mapping."product_id"
  JOIN "pos_production_stations" station
    ON station."organization_id" = mapping."organization_id"
   AND station."unit_id" = mapping."unit_id"
   AND station."id" = mapping."station_id"
  LEFT JOIN "pos_category_unit_configs" category_config
    ON category_config."organization_id" = mapping."organization_id"
   AND category_config."unit_id" = mapping."unit_id"
   AND category_config."category_id" = product."category_id"
)
DELETE FROM "pos_product_stations" mapping
USING ranked
WHERE mapping.ctid = ranked.row_id AND ranked.position > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_product_stations_primary_unique" ON "pos_product_stations" ("organization_id", "unit_id", "product_id");--> statement-breakpoint

ALTER TABLE "pos_kds_tickets" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_kds_tickets" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_kds_tickets" ADD COLUMN "handed_off_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_kds_tickets" ADD COLUMN "served_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_kds_tickets" ADD COLUMN "recall_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_kds_tickets" ADD COLUMN "refire_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_kds_tickets" ADD CONSTRAINT "pos_kds_priority_check" CHECK ("priority" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "pos_kds_tickets" ADD CONSTRAINT "pos_kds_counters_check" CHECK ("recall_count" >= 0 AND "refire_count" >= 0);--> statement-breakpoint
CREATE INDEX "pos_kds_active_queue_idx" ON "pos_kds_tickets" ("organization_id", "unit_id", "station_id", "status", "priority", "due_at", "created_at");--> statement-breakpoint

ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "ready_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "status" "pos_item_status" DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "held" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "fired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "pos_kds_ticket_items" assignment
SET "quantity" = item."quantity",
    "ready_quantity" = CASE WHEN item."status" IN ('ready', 'served') THEN item."quantity" ELSE 0 END,
    "status" = CASE WHEN item."status" = 'draft' THEN 'queued'::"pos_item_status" ELSE item."status" END,
    "fired_at" = ticket."created_at",
    "started_at" = ticket."started_at",
    "ready_at" = ticket."ready_at",
    "completed_at" = ticket."completed_at"
FROM "pos_order_items" item, "pos_kds_tickets" ticket
WHERE item."organization_id" = assignment."organization_id"
  AND item."unit_id" = assignment."unit_id"
  AND item."id" = assignment."order_item_id"
  AND ticket."organization_id" = assignment."organization_id"
  AND ticket."unit_id" = assignment."unit_id"
  AND ticket."id" = assignment."ticket_id";--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD CONSTRAINT "pos_kds_ticket_items_quantity_check" CHECK ("quantity" > 0);--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD CONSTRAINT "pos_kds_ticket_items_ready_quantity_check" CHECK ("ready_quantity" BETWEEN 0 AND "quantity");--> statement-breakpoint
CREATE INDEX "pos_kds_ticket_items_order_item_idx" ON "pos_kds_ticket_items" ("organization_id", "unit_id", "order_item_id");--> statement-breakpoint

WITH ticket_deadlines AS (
  SELECT ticket."id",
    coalesce(
      tab."promised_at",
      CASE
        WHEN max(item."estimated_prep_time_minutes") IS NULL THEN NULL
        ELSE ticket."created_at" + make_interval(mins => max(item."estimated_prep_time_minutes"))
      END
    ) AS due_at
  FROM "pos_kds_tickets" ticket
  JOIN "pos_orders" orders
    ON orders."organization_id" = ticket."organization_id"
   AND orders."unit_id" = ticket."unit_id"
   AND orders."id" = ticket."order_id"
  JOIN "pos_tabs" tab
    ON tab."organization_id" = orders."organization_id"
   AND tab."unit_id" = orders."unit_id"
   AND tab."id" = orders."tab_id"
  JOIN "pos_kds_ticket_items" assignment
    ON assignment."organization_id" = ticket."organization_id"
   AND assignment."unit_id" = ticket."unit_id"
   AND assignment."ticket_id" = ticket."id"
  JOIN "pos_order_items" item
    ON item."organization_id" = assignment."organization_id"
   AND item."unit_id" = assignment."unit_id"
   AND item."id" = assignment."order_item_id"
  GROUP BY ticket."id", ticket."created_at", tab."promised_at"
)
UPDATE "pos_kds_tickets" ticket
SET "due_at" = ticket_deadlines.due_at
FROM ticket_deadlines
WHERE ticket."id" = ticket_deadlines."id";--> statement-breakpoint
