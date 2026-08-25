CREATE TABLE "pos_operational_push_subscriptions" (
	"installation_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"endpoint_hash" varchar(64) NOT NULL,
	"encrypted_subscription" text NOT NULL,
	"encryption_iv" varchar(24) NOT NULL,
	"encryption_auth_tag" varchar(32) NOT NULL,
	"subscription_expires_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_delivered_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"last_failure_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos_operational_push_subscriptions" ADD CONSTRAINT "pos_operational_push_subscriptions_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_operational_push_subscriptions" ADD CONSTRAINT "pos_operational_push_subscriptions_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_operational_push_subscriptions" ADD CONSTRAINT "pos_operational_push_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_operational_push_endpoint_unique" ON "pos_operational_push_subscriptions" USING btree ("endpoint_hash");--> statement-breakpoint
CREATE INDEX "pos_operational_push_scope_idx" ON "pos_operational_push_subscriptions" USING btree ("organization_id","unit_id","enabled");--> statement-breakpoint
CREATE INDEX "pos_operational_push_identity_idx" ON "pos_operational_push_subscriptions" USING btree ("identity_id");