ALTER TABLE "device_enrollments" DROP CONSTRAINT "device_enrollments_unit_id_units_id_fk";
--> statement-breakpoint
ALTER TABLE "hub_heartbeats" DROP CONSTRAINT "hub_heartbeats_unit_id_units_id_fk";
--> statement-breakpoint
ALTER TABLE "operational_commands" DROP CONSTRAINT "operational_commands_unit_id_units_id_fk";
--> statement-breakpoint
ALTER TABLE "hub_heartbeats" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "units_organization_id_unique" ON "units" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "device_enrollments" ADD CONSTRAINT "devices_organization_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_heartbeats" ADD CONSTRAINT "hub_heartbeats_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_heartbeats" ADD CONSTRAINT "hub_heartbeats_organization_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_commands" ADD CONSTRAINT "operational_commands_organization_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
