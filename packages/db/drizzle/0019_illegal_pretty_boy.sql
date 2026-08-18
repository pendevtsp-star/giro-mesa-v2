CREATE TABLE "pos_catalog_branding" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_catalog_branding_organization_id_unit_id_pk" PRIMARY KEY("organization_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "pos_catalog_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"discount_type" varchar(20) NOT NULL,
	"discount_value" integer NOT NULL,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"combo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"channels" jsonb DEFAULT '["salon"]'::jsonb NOT NULL,
	"days_of_week" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_time" varchar(5),
	"end_time" varchar(5),
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_catalog_promotions_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_catalog_promotion_discount_check" CHECK ("pos_catalog_promotions"."discount_value" > 0 AND ("pos_catalog_promotions"."discount_type" <> 'percentage' OR "pos_catalog_promotions"."discount_value" <= 10000))
);
--> statement-breakpoint
CREATE TABLE "pos_category_unit_configs" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"channels" jsonb DEFAULT '["salon","delivery","qr","pickup"]'::jsonb NOT NULL,
	"schedule" jsonb,
	"default_station_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_category_unit_configs_unit_id_category_id_pk" PRIMARY KEY("unit_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "pos_allergens" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_catalog_categories" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "pos_dining_tables" ADD COLUMN "public_access_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_product_availability" ADD COLUMN "daily_stock" integer;--> statement-breakpoint
ALTER TABLE "pos_product_availability" ADD COLUMN "sold_today" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_product_availability" ADD COLUMN "auto_deduct_stock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_product_availability" ADD COLUMN "stock_date" date;--> statement-breakpoint
ALTER TABLE "pos_product_prices" ADD COLUMN "delivery_price_cents" integer;--> statement-breakpoint
ALTER TABLE "pos_product_prices" ADD COLUMN "cost_cents" integer;--> statement-breakpoint
ALTER TABLE "pos_products" ADD COLUMN "ean" varchar(14);--> statement-breakpoint
ALTER TABLE "pos_products" ADD COLUMN "product_type" varchar(30) DEFAULT 'prepared' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_products" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_products" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "public_menus" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "public_menus" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_catalog_branding" ADD CONSTRAINT "pos_catalog_branding_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_catalog_promotions" ADD CONSTRAINT "pos_catalog_promotions_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_category_unit_configs" ADD CONSTRAINT "pos_category_unit_config_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_category_unit_configs" ADD CONSTRAINT "pos_category_unit_config_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."pos_catalog_categories"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_category_unit_configs" ADD CONSTRAINT "pos_category_unit_config_station_fk" FOREIGN KEY ("organization_id","unit_id","default_station_id") REFERENCES "public"."pos_production_stations"("organization_id","unit_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_products_org_ean_unique" ON "pos_products" USING btree ("organization_id","ean");--> statement-breakpoint
ALTER TABLE "pos_product_availability" ADD CONSTRAINT "pos_product_daily_stock_check" CHECK (("pos_product_availability"."daily_stock" IS NULL OR "pos_product_availability"."daily_stock" >= 0) AND "pos_product_availability"."sold_today" >= 0);--> statement-breakpoint
ALTER TABLE "pos_product_prices" ADD CONSTRAINT "pos_product_channel_prices_check" CHECK (("pos_product_prices"."delivery_price_cents" IS NULL OR "pos_product_prices"."delivery_price_cents" >= 0) AND ("pos_product_prices"."cost_cents" IS NULL OR "pos_product_prices"."cost_cents" >= 0));