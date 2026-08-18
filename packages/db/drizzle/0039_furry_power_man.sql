CREATE TYPE "public"."pos_kds_terminal_mode" AS ENUM('station', 'pass');--> statement-breakpoint
CREATE TABLE "pos_kds_terminal_profiles" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"mode" "pos_kds_terminal_mode" NOT NULL,
	"station_id" uuid,
	"label" varchar(120) NOT NULL,
	"sound_enabled" boolean DEFAULT false NOT NULL,
	"fullscreen_preferred" boolean DEFAULT false NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"updated_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_kds_terminal_profiles_organization_id_unit_id_installation_id_pk" PRIMARY KEY("organization_id","unit_id","installation_id"),
	CONSTRAINT "pos_kds_terminal_profiles_mode_station_check" CHECK (("pos_kds_terminal_profiles"."mode" = 'station' AND "pos_kds_terminal_profiles"."station_id" IS NOT NULL) OR ("pos_kds_terminal_profiles"."mode" = 'pass' AND "pos_kds_terminal_profiles"."station_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN "kds_priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN "kds_priority_reason" text;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN "kds_priority_updated_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD COLUMN "kds_priority_updated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "pos_orders" AS "orders"
SET
	"kds_priority" = "priorities"."priority",
	"kds_priority_reason" = 'Prioridade preservada na migração do KDS',
	"kds_priority_updated_at" = "priorities"."updated_at"
FROM (
	SELECT "order_id", max("priority") AS "priority", max("updated_at") AS "updated_at"
	FROM "pos_kds_tickets"
	WHERE "priority" > 0 AND "served_at" IS NULL AND "status" <> 'canceled'
	GROUP BY "order_id"
) AS "priorities"
WHERE "orders"."id" = "priorities"."order_id";--> statement-breakpoint
ALTER TABLE "pos_product_availability" ADD COLUMN "operational_reason" text;--> statement-breakpoint
ALTER TABLE "pos_product_availability" ADD COLUMN "operational_updated_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_product_availability" ADD COLUMN "operational_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_kds_terminal_profiles" ADD CONSTRAINT "pos_kds_terminal_profiles_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_terminal_profiles" ADD CONSTRAINT "pos_kds_terminal_profiles_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_terminal_profiles" ADD CONSTRAINT "pos_kds_terminal_profiles_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_terminal_profiles" ADD CONSTRAINT "pos_kds_terminal_profiles_station_fk" FOREIGN KEY ("organization_id","unit_id","station_id") REFERENCES "public"."pos_production_stations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_kds_terminal_profiles_unit_idx" ON "pos_kds_terminal_profiles" USING btree ("organization_id","unit_id");--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_kds_priority_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("kds_priority_updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_product_availability" ADD CONSTRAINT "pos_product_availability_operational_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("operational_updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_kds_priority_check" CHECK ("pos_orders"."kds_priority" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "pos_product_availability" ADD CONSTRAINT "pos_product_operational_reset_check" CHECK ("pos_product_availability"."operational_reset_at" IS NULL OR "pos_product_availability"."available" = false);
