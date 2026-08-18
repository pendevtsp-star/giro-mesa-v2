CREATE TABLE "pos_combo_items" (
	"organization_id" uuid NOT NULL,
	"combo_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pos_combo_items_combo_id_product_id_pk" PRIMARY KEY("combo_id","product_id"),
	CONSTRAINT "pos_combo_items_quantity_check" CHECK ("pos_combo_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "pos_combos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"price_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_combos_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "pos_combos_price_check" CHECK ("pos_combos"."price_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos_products" ADD COLUMN "image_url" varchar(500);--> statement-breakpoint
ALTER TABLE "pos_combo_items" ADD CONSTRAINT "pos_combo_items_combo_fk" FOREIGN KEY ("organization_id","combo_id") REFERENCES "public"."pos_combos"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_combo_items" ADD CONSTRAINT "pos_combo_items_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_combos" ADD CONSTRAINT "pos_combos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;