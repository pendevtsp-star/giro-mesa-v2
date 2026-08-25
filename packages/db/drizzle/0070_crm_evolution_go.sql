ALTER TABLE "growth_campaign_deliveries" ADD COLUMN "delivered_at" timestamp with time zone;
ALTER TABLE "growth_campaign_deliveries" ADD COLUMN "read_at" timestamp with time zone;
ALTER TABLE "growth_campaign_deliveries" ADD COLUMN "replied_at" timestamp with time zone;
ALTER TABLE "growth_campaign_deliveries" ADD COLUMN "attributed_order_ref" uuid;
ALTER TABLE "growth_campaign_deliveries" ADD COLUMN "attributed_coupon_redemption_id" uuid;
ALTER TABLE "growth_campaign_deliveries" ADD COLUMN "attributed_revenue_cents" integer;
ALTER TABLE "growth_campaign_deliveries" ADD CONSTRAINT "growth_campaign_delivery_org_id_unique" UNIQUE("organization_id", "id");

CREATE TABLE "growth_whatsapp_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "customer_id" uuid,
  "phone" varchar(15) NOT NULL,
  "status" varchar(20) DEFAULT 'open' NOT NULL,
  "unread_count" integer DEFAULT 0 NOT NULL,
  "last_message_at" timestamp with time zone,
  "last_inbound_at" timestamp with time zone,
  "last_outbound_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "growth_whatsapp_conversation_org_unit_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "growth_whatsapp_conversation_target_unique" UNIQUE("organization_id", "unit_id", "phone"),
  CONSTRAINT "growth_whatsapp_conversation_unread_check" CHECK ("unread_count" >= 0),
  CONSTRAINT "growth_whatsapp_conversation_unit_tenant_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "public"."units"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "growth_whatsapp_conversation_customer_tenant_fk" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "public"."growth_customers"("organization_id", "id") ON DELETE RESTRICT
);
CREATE INDEX "growth_whatsapp_conversation_inbox_idx" ON "growth_whatsapp_conversations" USING btree ("organization_id", "unit_id", "last_message_at");

CREATE TABLE "growth_whatsapp_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "customer_id" uuid,
  "campaign_delivery_id" uuid,
  "direction" varchar(12) NOT NULL,
  "content_kind" varchar(20) DEFAULT 'text' NOT NULL,
  "body" text NOT NULL,
  "status" varchar(20) NOT NULL,
  "provider_reference" varchar(180),
  "idempotency_key" varchar(180) NOT NULL,
  "error_code" varchar(80),
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "growth_whatsapp_message_org_unit_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "growth_whatsapp_message_idempotency_unique" UNIQUE("organization_id", "unit_id", "idempotency_key"),
  CONSTRAINT "growth_whatsapp_message_conversation_tenant_fk" FOREIGN KEY ("organization_id", "unit_id", "conversation_id") REFERENCES "public"."growth_whatsapp_conversations"("organization_id", "unit_id", "id") ON DELETE CASCADE,
  CONSTRAINT "growth_whatsapp_message_customer_tenant_fk" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "public"."growth_customers"("organization_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "growth_whatsapp_message_campaign_delivery_tenant_fk" FOREIGN KEY ("organization_id", "campaign_delivery_id") REFERENCES "public"."growth_campaign_deliveries"("organization_id", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "growth_whatsapp_message_provider_unique" ON "growth_whatsapp_messages" USING btree ("organization_id", "unit_id", "provider_reference") WHERE "provider_reference" IS NOT NULL;
CREATE INDEX "growth_whatsapp_message_conversation_idx" ON "growth_whatsapp_messages" USING btree ("conversation_id", "occurred_at");

CREATE TABLE "growth_crm_automation_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "trigger" varchar(30) NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "delay_minutes" integer DEFAULT 0 NOT NULL,
  "inactive_days" integer,
  "message_template" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "growth_crm_automation_rule_org_unit_id_unique" UNIQUE("organization_id", "unit_id", "id"),
  CONSTRAINT "growth_crm_automation_rule_trigger_unique" UNIQUE("organization_id", "unit_id", "trigger"),
  CONSTRAINT "growth_crm_automation_delay_check" CHECK ("delay_minutes" BETWEEN 0 AND 525600),
  CONSTRAINT "growth_crm_automation_inactive_check" CHECK ("inactive_days" IS NULL OR "inactive_days" BETWEEN 1 AND 3650),
  CONSTRAINT "growth_crm_automation_rule_unit_tenant_fk" FOREIGN KEY ("organization_id", "unit_id") REFERENCES "public"."units"("organization_id", "id") ON DELETE CASCADE
);

CREATE TABLE "growth_crm_automation_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "rule_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "message_id" uuid,
  "event_key" varchar(180) NOT NULL,
  "status" varchar(20) NOT NULL,
  "reason" varchar(80),
  "scheduled_for" timestamp with time zone NOT NULL,
  "executed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "growth_crm_automation_execution_event_unique" UNIQUE("rule_id", "customer_id", "event_key"),
  CONSTRAINT "growth_crm_automation_execution_rule_tenant_fk" FOREIGN KEY ("organization_id", "unit_id", "rule_id") REFERENCES "public"."growth_crm_automation_rules"("organization_id", "unit_id", "id") ON DELETE CASCADE,
  CONSTRAINT "growth_crm_automation_execution_customer_tenant_fk" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "public"."growth_customers"("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "growth_crm_automation_execution_message_tenant_fk" FOREIGN KEY ("organization_id", "unit_id", "message_id") REFERENCES "public"."growth_whatsapp_messages"("organization_id", "unit_id", "id") ON DELETE RESTRICT
);
CREATE INDEX "growth_crm_automation_execution_status_idx" ON "growth_crm_automation_executions" USING btree ("organization_id", "unit_id", "status", "scheduled_for");

UPDATE "growth_customers"
SET "phone" = CASE
  WHEN length(regexp_replace("phone", '[^0-9]', '', 'g')) IN (10, 11)
    THEN '+55' || regexp_replace("phone", '[^0-9]', '', 'g')
  WHEN length(regexp_replace("phone", '[^0-9]', '', 'g')) IN (12, 13)
    AND regexp_replace("phone", '[^0-9]', '', 'g') LIKE '55%'
    THEN '+' || regexp_replace("phone", '[^0-9]', '', 'g')
  ELSE "phone"
END
WHERE "phone" IS NOT NULL;
