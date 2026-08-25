CREATE TABLE "platform_incident_states" (
	"fingerprint" varchar(255) PRIMARY KEY NOT NULL,
	"source" varchar(24) NOT NULL,
	"organization_id" uuid,
	"unit_id" uuid,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"claimed_by_identity_id" uuid,
	"claimed_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"reason" text,
	"updated_by_identity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_incident_states_status_check" CHECK ("status" in ('open', 'claimed', 'snoozed', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "platform_action_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"action" varchar(80) NOT NULL,
	"target_type" varchar(40) NOT NULL,
	"target_id" varchar(255) NOT NULL,
	"reason" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_action_receipts_reason_check" CHECK (length(trim("reason")) >= 8)
);
--> statement-breakpoint
ALTER TABLE "platform_incident_states" ADD CONSTRAINT "platform_incident_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "platform_incident_states" ADD CONSTRAINT "platform_incident_states_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "platform_incident_states" ADD CONSTRAINT "platform_incident_states_claimed_by_identity_id_identities_id_fk" FOREIGN KEY ("claimed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "platform_incident_states" ADD CONSTRAINT "platform_incident_states_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "platform_action_receipts" ADD CONSTRAINT "platform_action_receipts_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id");--> statement-breakpoint
CREATE INDEX "platform_incident_states_status_idx" ON "platform_incident_states" USING btree ("status", "snoozed_until");--> statement-breakpoint
CREATE INDEX "platform_incident_states_org_idx" ON "platform_incident_states" USING btree ("organization_id", "updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_action_receipts_actor_key_unique" ON "platform_action_receipts" USING btree ("actor_identity_id", "idempotency_key");--> statement-breakpoint
CREATE INDEX "platform_action_receipts_target_idx" ON "platform_action_receipts" USING btree ("target_type", "target_id");
