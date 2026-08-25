ALTER TABLE "growth_marketing_campaigns" ADD COLUMN "variant_b_content" text;
ALTER TABLE "growth_marketing_campaigns" ADD COLUMN "attribution_window_days" integer DEFAULT 7 NOT NULL;
ALTER TABLE "growth_marketing_campaigns" ADD COLUMN "holdout_percentage" integer DEFAULT 0 NOT NULL;
ALTER TABLE "growth_marketing_campaigns" ADD CONSTRAINT "growth_campaign_attribution_window_check" CHECK ("attribution_window_days" BETWEEN 1 AND 90);
ALTER TABLE "growth_marketing_campaigns" ADD CONSTRAINT "growth_campaign_holdout_percentage_check" CHECK ("holdout_percentage" BETWEEN 0 AND 50);

ALTER TABLE "growth_campaign_deliveries" ADD COLUMN "experiment_variant" varchar(10) DEFAULT 'a' NOT NULL;

ALTER TABLE "growth_whatsapp_conversations" ADD COLUMN "assigned_identity_id" uuid;
ALTER TABLE "growth_whatsapp_conversations" ADD COLUMN "priority" varchar(12) DEFAULT 'normal' NOT NULL;
ALTER TABLE "growth_whatsapp_conversations" ADD COLUMN "sla_due_at" timestamp with time zone;
ALTER TABLE "growth_whatsapp_conversations" ADD COLUMN "first_response_at" timestamp with time zone;
ALTER TABLE "growth_whatsapp_conversations" ADD COLUMN "closed_at" timestamp with time zone;
ALTER TABLE "growth_whatsapp_conversations" ADD CONSTRAINT "growth_whatsapp_conversation_assignee_fk" FOREIGN KEY ("assigned_identity_id") REFERENCES "public"."identities"("id") ON DELETE SET NULL;
CREATE INDEX "growth_whatsapp_conversation_queue_idx" ON "growth_whatsapp_conversations" USING btree ("organization_id", "unit_id", "status", "priority", "sla_due_at");
CREATE INDEX "growth_whatsapp_conversation_assignee_idx" ON "growth_whatsapp_conversations" USING btree ("organization_id", "unit_id", "assigned_identity_id", "status");

ALTER TABLE "growth_whatsapp_messages" ADD COLUMN "media_storage_key" text;
ALTER TABLE "growth_whatsapp_messages" ADD COLUMN "media_mime_type" varchar(120);
ALTER TABLE "growth_whatsapp_messages" ADD COLUMN "media_file_name" varchar(180);
ALTER TABLE "growth_whatsapp_messages" ADD COLUMN "media_size_bytes" integer;
ALTER TABLE "growth_whatsapp_messages" ADD COLUMN "media_sha256" varchar(64);
ALTER TABLE "growth_whatsapp_messages" ADD COLUMN "media_error_code" varchar(80);

CREATE TABLE "growth_crm_quick_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "title" varchar(80) NOT NULL,
  "body" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by_identity_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "growth_crm_quick_reply_org_unit_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "growth_crm_quick_reply_title_unique" UNIQUE("organization_id", "unit_id", "title"),
  CONSTRAINT "growth_crm_quick_reply_unit_tenant_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "public"."units"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "growth_crm_quick_reply_creator_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE SET NULL
);

ALTER TABLE "growth_crm_automation_executions" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "growth_crm_automation_executions" ADD COLUMN "last_retry_at" timestamp with time zone;
