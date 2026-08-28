CREATE TABLE "platform_staff_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(254) NOT NULL,
  "role" varchar(24) NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "invited_by_identity_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "accepted_by_identity_id" uuid,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_staff_invitations_token_unique" UNIQUE("token_hash"),
  CONSTRAINT "platform_staff_invitations_role_check" CHECK ("role" IN ('viewer', 'support', 'finance', 'fiscal', 'engineering')),
  CONSTRAINT "platform_staff_invitations_inviter_fk" FOREIGN KEY ("invited_by_identity_id") REFERENCES "public"."identities"("id"),
  CONSTRAINT "platform_staff_invitations_acceptor_fk" FOREIGN KEY ("accepted_by_identity_id") REFERENCES "public"."identities"("id")
);

CREATE UNIQUE INDEX "platform_staff_invitations_pending_email_unique"
  ON "platform_staff_invitations" ("email")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
CREATE INDEX "platform_staff_invitations_expiry_idx" ON "platform_staff_invitations" ("expires_at");

CREATE TABLE "platform_staff_access" (
  "identity_id" uuid PRIMARY KEY NOT NULL,
  "role" varchar(24) NOT NULL,
  "granted_by_identity_id" uuid NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by_identity_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_staff_access_role_check" CHECK ("role" IN ('viewer', 'support', 'finance', 'fiscal', 'engineering', 'admin')),
  CONSTRAINT "platform_staff_access_identity_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE CASCADE,
  CONSTRAINT "platform_staff_access_granter_fk" FOREIGN KEY ("granted_by_identity_id") REFERENCES "public"."identities"("id"),
  CONSTRAINT "platform_staff_access_revoker_fk" FOREIGN KEY ("revoked_by_identity_id") REFERENCES "public"."identities"("id")
);

CREATE INDEX "platform_staff_access_active_idx" ON "platform_staff_access" ("revoked_at", "role");
