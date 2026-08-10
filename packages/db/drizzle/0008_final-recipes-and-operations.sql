CREATE TABLE "management_recipe_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity_milli" integer NOT NULL,
	"loss_basis_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_recipe_component_unique" UNIQUE("recipe_version_id","inventory_item_id","location_id"),
	CONSTRAINT "management_recipe_component_quantity_check" CHECK ("management_recipe_components"."quantity_milli" > 0),
	CONSTRAINT "management_recipe_component_loss_check" CHECK ("management_recipe_components"."loss_basis_points" between 0 and 9999)
);
--> statement-breakpoint
CREATE TABLE "management_recipe_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"created_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_recipe_versions_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_recipe_versions_number_unique" UNIQUE("organization_id","unit_id","product_id","version"),
	CONSTRAINT "management_recipe_version_positive_check" CHECK ("management_recipe_versions"."version" > 0),
	CONSTRAINT "management_recipe_version_window_check" CHECK ("management_recipe_versions"."valid_until" is null or "management_recipe_versions"."valid_until" > "management_recipe_versions"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "management_inventory_movements" ALTER COLUMN "actor_identity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trial_applications" ADD COLUMN "segment" varchar(80);--> statement-breakpoint
ALTER TABLE "management_recipe_components" ADD CONSTRAINT "management_recipe_component_version_fk" FOREIGN KEY ("organization_id","unit_id","recipe_version_id") REFERENCES "public"."management_recipe_versions"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_recipe_components" ADD CONSTRAINT "management_recipe_component_item_fk" FOREIGN KEY ("organization_id","unit_id","inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_recipe_components" ADD CONSTRAINT "management_recipe_component_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_recipe_versions" ADD CONSTRAINT "management_recipe_versions_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_recipe_versions" ADD CONSTRAINT "management_recipe_versions_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_recipe_versions" ADD CONSTRAINT "management_recipe_versions_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_recipe_versions_active_unique" ON "management_recipe_versions" USING btree ("organization_id","unit_id","product_id") WHERE "management_recipe_versions"."valid_until" is null;