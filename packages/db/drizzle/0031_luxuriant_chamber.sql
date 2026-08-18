ALTER TABLE "management_report_exports" DROP CONSTRAINT "management_report_exports_schedule_fk";
--> statement-breakpoint
ALTER TABLE "management_report_exports" ADD CONSTRAINT "management_report_exports_schedule_fk" FOREIGN KEY ("organization_id","unit_id","schedule_id") REFERENCES "public"."management_report_schedules"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;
