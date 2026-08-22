CREATE TABLE "management_person_access" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"email" varchar(254) NOT NULL,
	"role" "role_name" NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"invitation_id" uuid,
	"membership_id" uuid,
	"role_binding_id" uuid,
	"status_changed_at" timestamp with time zone,
	"status_changed_by_identity_id" uuid,
	"status_change_reason" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_person_access_status_check" CHECK ("management_person_access"."status" in ('pending','active','suspended','canceled','terminated'))
);
--> statement-breakpoint
CREATE TABLE "terminal_operator_pins" (
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"pin_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terminal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"opened_by_identity_id" uuid NOT NULL,
	"active_actor_membership_id" uuid,
	"actor_epoch" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"failure_window_started_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "management_person_access" ADD CONSTRAINT "management_person_access_invitation_id_membership_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."membership_invitations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_person_access" ADD CONSTRAINT "management_person_access_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_person_access" ADD CONSTRAINT "management_person_access_role_binding_id_role_bindings_id_fk" FOREIGN KEY ("role_binding_id") REFERENCES "public"."role_bindings"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_person_access" ADD CONSTRAINT "management_person_access_status_changed_by_identity_id_identities_id_fk" FOREIGN KEY ("status_changed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_person_access" ADD CONSTRAINT "management_person_access_person_fk" FOREIGN KEY ("organization_id","unit_id","person_id") REFERENCES "public"."management_people"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "management_person_access" ADD CONSTRAINT "management_person_access_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "terminal_operator_pins" ADD CONSTRAINT "terminal_operator_pins_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_opened_by_identity_id_identities_id_fk" FOREIGN KEY ("opened_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_active_actor_membership_id_memberships_id_fk" FOREIGN KEY ("active_actor_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_organization_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "management_person_access_invitation_unique" ON "management_person_access" USING btree ("invitation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_person_access_role_binding_unique" ON "management_person_access" USING btree ("role_binding_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "management_person_access_membership_unit_unique" ON "management_person_access" USING btree ("organization_id","unit_id","membership_id") WHERE "management_person_access"."membership_id" is not null;
--> statement-breakpoint
CREATE INDEX "management_person_access_scope_status_idx" ON "management_person_access" USING btree ("organization_id","unit_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "terminal_sessions_token_hash_unique" ON "terminal_sessions" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "terminal_sessions_scope_idx" ON "terminal_sessions" USING btree ("organization_id","unit_id");
--> statement-breakpoint
CREATE INDEX "terminal_sessions_actor_idx" ON "terminal_sessions" USING btree ("active_actor_membership_id");
