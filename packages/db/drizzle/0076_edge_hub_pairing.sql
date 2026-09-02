CREATE TABLE "edge_hub_pairing_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "label" varchar(120) NOT NULL,
  "code_hash" varchar(64) NOT NULL,
  "created_by_identity_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "consumed_by_device_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "edge_hub_pairing_codes_created_by_fk"
    FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id"),
  CONSTRAINT "edge_hub_pairing_codes_unit_fk"
    FOREIGN KEY ("organization_id", "unit_id")
    REFERENCES "public"."units"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "edge_hub_pairing_codes_consumed_device_fk"
    FOREIGN KEY ("organization_id", "unit_id", "consumed_by_device_id")
    REFERENCES "public"."device_enrollments"("organization_id", "unit_id", "id")
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "edge_hub_pairing_codes_hash_unique"
  ON "edge_hub_pairing_codes" ("code_hash");
CREATE INDEX "edge_hub_pairing_codes_scope_idx"
  ON "edge_hub_pairing_codes" ("organization_id", "unit_id", "expires_at");
