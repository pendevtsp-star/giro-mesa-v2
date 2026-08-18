CREATE TABLE "growth_delivery_couriers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "reference" varchar(80) NOT NULL,
  "name" varchar(120) NOT NULL,
  "phone" varchar(40),
  "idempotency_key" varchar(180) NOT NULL,
  "request_fingerprint" varchar(64) NOT NULL,
  "status" varchar(20) DEFAULT 'available' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "last_latitude" double precision,
  "last_longitude" double precision,
  "last_position_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "growth_delivery_courier_org_id_unique" UNIQUE("organization_id", "id"),
  CONSTRAINT "growth_delivery_courier_unit_reference_unique" UNIQUE("unit_id", "reference"),
  CONSTRAINT "growth_delivery_courier_idempotency_unique" UNIQUE("organization_id", "idempotency_key"),
  CONSTRAINT "growth_delivery_courier_status_check" CHECK ("status" in ('available', 'assigned', 'delivering', 'offline')),
  CONSTRAINT "growth_delivery_courier_position_check" CHECK (("last_latitude" is null and "last_longitude" is null and "last_position_at" is null) or ("last_latitude" between -90 and 90 and "last_longitude" between -180 and 180 and "last_position_at" is not null)),
  CONSTRAINT "growth_delivery_courier_org_unit_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "units"("organization_id", "id") ON DELETE cascade
);--> statement-breakpoint

ALTER TABLE "growth_delivery_orders" ADD COLUMN "courier_id" uuid;--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD COLUMN "courier_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD COLUMN "address_validation_status" varchar(20) DEFAULT 'unchecked' NOT NULL;--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD CONSTRAINT "growth_delivery_order_address_validation_check" CHECK ("address_validation_status" in ('covered', 'unchecked', 'unavailable'));--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD CONSTRAINT "growth_delivery_orders_courier_id_growth_delivery_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "growth_delivery_couriers"("id") ON DELETE no action;--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD CONSTRAINT "growth_delivery_order_courier_tenant_fk" FOREIGN KEY ("organization_id", "courier_id") REFERENCES "growth_delivery_couriers"("organization_id", "id") ON DELETE restrict;--> statement-breakpoint

CREATE TABLE "growth_delivery_order_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "delivery_order_id" uuid NOT NULL,
  "from_status" "growth_delivery_status",
  "to_status" "growth_delivery_status" NOT NULL,
  "actor_identity_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "growth_delivery_history_order_tenant_fk" FOREIGN KEY ("organization_id", "delivery_order_id") REFERENCES "growth_delivery_orders"("organization_id", "id") ON DELETE cascade,
  CONSTRAINT "growth_delivery_history_unit_tenant_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "units"("organization_id", "id") ON DELETE cascade,
  CONSTRAINT "growth_delivery_history_actor_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "identities"("id") ON DELETE set null
);--> statement-breakpoint
CREATE INDEX "growth_delivery_history_order_time_idx" ON "growth_delivery_order_status_history" ("delivery_order_id", "occurred_at");--> statement-breakpoint
INSERT INTO "growth_delivery_order_status_history" ("organization_id", "unit_id", "delivery_order_id", "to_status", "metadata", "occurred_at")
SELECT "organization_id", "unit_id", "id", "status", '{"source":"migration_backfill"}'::jsonb, "created_at"
FROM "growth_delivery_orders";--> statement-breakpoint

CREATE TABLE "growth_delivery_courier_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "delivery_order_id" uuid NOT NULL,
  "courier_id" uuid NOT NULL,
  "assigned_by_identity_id" uuid,
  "idempotency_key" varchar(180) NOT NULL,
  "request_fingerprint" varchar(64) NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "growth_delivery_assignment_idempotency_unique" UNIQUE("organization_id", "idempotency_key"),
  CONSTRAINT "growth_delivery_assignment_order_tenant_fk" FOREIGN KEY ("organization_id", "delivery_order_id") REFERENCES "growth_delivery_orders"("organization_id", "id") ON DELETE cascade,
  CONSTRAINT "growth_delivery_assignment_courier_tenant_fk" FOREIGN KEY ("organization_id", "courier_id") REFERENCES "growth_delivery_couriers"("organization_id", "id") ON DELETE restrict,
  CONSTRAINT "growth_delivery_assignment_actor_fk" FOREIGN KEY ("assigned_by_identity_id") REFERENCES "identities"("id") ON DELETE set null
);--> statement-breakpoint
CREATE INDEX "growth_delivery_assignment_order_time_idx" ON "growth_delivery_courier_assignments" ("delivery_order_id", "assigned_at");--> statement-breakpoint

CREATE TABLE "growth_delivery_courier_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "courier_id" uuid NOT NULL,
  "event_type" varchar(20) NOT NULL,
  "status" varchar(20),
  "latitude" double precision,
  "longitude" double precision,
  "actor_identity_id" uuid,
  "idempotency_key" varchar(180) NOT NULL,
  "request_fingerprint" varchar(64) NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "growth_delivery_courier_event_idempotency_unique" UNIQUE("organization_id", "idempotency_key"),
  CONSTRAINT "growth_delivery_courier_event_shape_check" CHECK (("event_type" = 'status' and "status" is not null and "latitude" is null and "longitude" is null) or ("event_type" = 'position' and "status" is null and "latitude" between -90 and 90 and "longitude" between -180 and 180)),
  CONSTRAINT "growth_delivery_courier_event_courier_tenant_fk" FOREIGN KEY ("organization_id", "courier_id") REFERENCES "growth_delivery_couriers"("organization_id", "id") ON DELETE cascade,
  CONSTRAINT "growth_delivery_courier_event_actor_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "identities"("id") ON DELETE set null
);--> statement-breakpoint
CREATE INDEX "growth_delivery_courier_event_time_idx" ON "growth_delivery_courier_events" ("courier_id", "occurred_at");--> statement-breakpoint

CREATE TABLE "growth_delivery_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "delivery_order_id" uuid NOT NULL,
  "audience" varchar(20) NOT NULL,
  "type" varchar(40) NOT NULL,
  "status" varchar(30) DEFAULT 'pending_provider' NOT NULL,
  "requested_by_identity_id" uuid,
  "idempotency_key" varchar(180) NOT NULL,
  "request_fingerprint" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "growth_delivery_notification_idempotency_unique" UNIQUE("organization_id", "idempotency_key"),
  CONSTRAINT "growth_delivery_notification_status_check" CHECK ("status" = 'pending_provider'),
  CONSTRAINT "growth_delivery_notification_order_tenant_fk" FOREIGN KEY ("organization_id", "delivery_order_id") REFERENCES "growth_delivery_orders"("organization_id", "id") ON DELETE cascade,
  CONSTRAINT "growth_delivery_notification_actor_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "identities"("id") ON DELETE set null
);--> statement-breakpoint
CREATE INDEX "growth_delivery_notification_order_time_idx" ON "growth_delivery_notifications" ("delivery_order_id", "created_at");
