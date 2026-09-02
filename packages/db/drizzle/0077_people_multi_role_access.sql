ALTER TABLE "management_person_access" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE "management_person_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"role" "role_name" NOT NULL,
	"role_binding_id" uuid,
	"provenance" varchar(32) DEFAULT 'people_admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_person_role_assignment_provenance_check" CHECK ("provenance" in ('legacy_access','backfill_binding','people_invite','people_admin'))
);
--> statement-breakpoint
ALTER TABLE "management_person_role_assignments" ADD CONSTRAINT "management_person_role_assignment_person_fk" FOREIGN KEY ("person_id") REFERENCES "public"."management_people"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_person_role_assignments" ADD CONSTRAINT "management_person_role_assignment_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_person_role_assignments" ADD CONSTRAINT "management_person_role_assignment_binding_fk" FOREIGN KEY ("role_binding_id") REFERENCES "public"."role_bindings"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "management_person_role_assignment_scope_unique" ON "management_person_role_assignments" USING btree ("organization_id","unit_id","person_id","role");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_person_role_assignment_binding_unique" ON "management_person_role_assignments" USING btree ("role_binding_id") WHERE "management_person_role_assignments"."role_binding_id" is not null;
--> statement-breakpoint
CREATE INDEX "management_person_role_assignment_person_idx" ON "management_person_role_assignments" USING btree ("organization_id","person_id");
--> statement-breakpoint
INSERT INTO "management_person_role_assignments" (
	"person_id",
	"organization_id",
	"unit_id",
	"role",
	"role_binding_id",
	"provenance"
)
SELECT
	access."person_id",
	access."organization_id",
	access."unit_id",
	access."role",
	binding."id",
	'legacy_access'
FROM "management_person_access" access
LEFT JOIN "role_bindings" binding
	ON binding."id" = access."role_binding_id"
	AND binding."membership_id" = access."membership_id"
	AND binding."unit_id" = access."unit_id"
	AND binding."role" = access."role"
WHERE access."status" IN ('pending', 'active', 'suspended')
ON CONFLICT ("organization_id", "unit_id", "person_id", "role") DO NOTHING;
--> statement-breakpoint
INSERT INTO "management_person_role_assignments" (
	"person_id",
	"organization_id",
	"unit_id",
	"role",
	"role_binding_id",
	"provenance"
)
SELECT
	access."person_id",
	access."organization_id",
	access."unit_id",
	binding."role",
	binding."id",
	'backfill_binding'
FROM "management_person_access" access
INNER JOIN "role_bindings" binding
	ON binding."membership_id" = access."membership_id"
	AND binding."unit_id" = access."unit_id"
WHERE access."status" = 'active'
ON CONFLICT ("organization_id", "unit_id", "person_id", "role") DO UPDATE SET
	"role_binding_id" = excluded."role_binding_id",
	"provenance" = excluded."provenance",
	"updated_at" = now();
