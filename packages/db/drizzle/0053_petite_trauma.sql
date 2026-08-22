ALTER TABLE "management_person_access" DROP CONSTRAINT "management_person_access_person_fk";
--> statement-breakpoint
ALTER TABLE "management_person_access" DROP CONSTRAINT "management_person_access_pkey";--> statement-breakpoint
ALTER TABLE "management_person_access" ADD CONSTRAINT "management_person_access_person_unit_pk" PRIMARY KEY("person_id","unit_id");--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD COLUMN "device_id" varchar(160);--> statement-breakpoint
ALTER TABLE "management_person_access" ADD CONSTRAINT "management_person_access_person_id_management_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."management_people"("id") ON DELETE cascade ON UPDATE no action;
