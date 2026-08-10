CREATE TYPE "public"."growth_campaign_status" AS ENUM('draft', 'blocked', 'queued', 'sending', 'sent', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."growth_consent_decision" AS ENUM('granted', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."growth_delivery_status" AS ENUM('draft', 'placed', 'confirmed', 'preparing', 'ready', 'dispatched', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."growth_loyalty_entry_type" AS ENUM('earn', 'redeem', 'expire', 'reverse', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."growth_reservation_status" AS ENUM('booked', 'confirmed', 'seated', 'completed', 'canceled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."growth_transfer_status" AS ENUM('draft', 'in_transit', 'received', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."growth_waitlist_status" AS ENUM('waiting', 'notified', 'seated', 'left', 'canceled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."management_cash_shift_status" AS ENUM('open', 'closed', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."management_payable_status" AS ENUM('open', 'partially_paid', 'paid', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."management_purchase_status" AS ENUM('draft', 'approved', 'partially_received', 'received', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."management_receivable_status" AS ENUM('open', 'partially_received', 'received', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."pos_approval_action" AS ENUM('discount', 'cancel');--> statement-breakpoint
CREATE TYPE "public"."pos_item_status" AS ENUM('draft', 'queued', 'preparing', 'ready', 'served', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."pos_kds_status" AS ENUM('pending', 'preparing', 'ready', 'done', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."pos_order_status" AS ENUM('draft', 'sent', 'preparing', 'ready', 'served', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."pos_tab_status" AS ENUM('open', 'merged', 'closed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."pos_table_status" AS ENUM('available', 'occupied', 'reserved');--> statement-breakpoint
CREATE TABLE "growth_campaign_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(180) NOT NULL,
	"provider_reference" varchar(180),
	"error_code" varchar(80),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"coupon_id" uuid NOT NULL,
	"customer_id" uuid,
	"order_ref" uuid NOT NULL,
	"discount_cents" integer NOT NULL,
	"idempotency_key" varchar(180) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid,
	"code" varchar(64) NOT NULL,
	"type" varchar(20) NOT NULL,
	"value" integer NOT NULL,
	"minimum_order_cents" integer DEFAULT 0 NOT NULL,
	"maximum_discount_cents" integer,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unit_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"per_customer_limit" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_coupons_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "growth_coupon_value_check" CHECK ("growth_coupons"."value" > 0),
	CONSTRAINT "growth_coupon_percentage_check" CHECK ("growth_coupons"."type" <> 'percentage' or "growth_coupons"."value" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "growth_customer_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"purpose" varchar(60) NOT NULL,
	"decision" "growth_consent_decision" NOT NULL,
	"channel" varchar(30) NOT NULL,
	"source" varchar(60) NOT NULL,
	"legal_basis" varchar(60) NOT NULL,
	"policy_version" varchar(40) NOT NULL,
	"actor_identity_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_customer_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"filters" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_segments_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "growth_delivery_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"delivery_order_id" uuid NOT NULL,
	"courier_reference" varchar(160) NOT NULL,
	"status" varchar(30) DEFAULT 'assigned' NOT NULL,
	"idempotency_key" varchar(180) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_delivery_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"customer_id" uuid,
	"zone_id" uuid,
	"order_ref" uuid NOT NULL,
	"fulfillment" varchar(20) NOT NULL,
	"status" "growth_delivery_status" DEFAULT 'draft' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"delivery_fee_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"address" jsonb,
	"scheduled_for" timestamp with time zone,
	"idempotency_key" varchar(180) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_delivery_order_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "growth_delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"fee_cents" integer NOT NULL,
	"minimum_order_cents" integer DEFAULT 0 NOT NULL,
	"geometry" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_delivery_zone_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "growth_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"default_unit_id" uuid,
	"name" varchar(160) NOT NULL,
	"email" varchar(254),
	"phone" varchar(40),
	"birth_date" varchar(10),
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_customers_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "growth_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid,
	"provider" varchar(60) NOT NULL,
	"status" varchar(30) DEFAULT 'disabled' NOT NULL,
	"credential_reference" varchar(180),
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_inventory_transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"inventory_item_ref" varchar(180) NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	CONSTRAINT "growth_transfer_line_quantity_check" CHECK ("growth_inventory_transfer_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "growth_inventory_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"origin_unit_id" uuid NOT NULL,
	"destination_unit_id" uuid NOT NULL,
	"status" "growth_transfer_status" DEFAULT 'draft' NOT NULL,
	"notes" varchar(500),
	"idempotency_key" varchar(180) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_transfer_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "growth_transfer_distinct_units_check" CHECK ("growth_inventory_transfers"."origin_unit_id" <> "growth_inventory_transfers"."destination_unit_id")
);
--> statement-breakpoint
CREATE TABLE "growth_loyalty_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid,
	"program_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"source_ref" varchar(180),
	"type" "growth_loyalty_entry_type" NOT NULL,
	"amount" integer NOT NULL,
	"description" varchar(240),
	"idempotency_key" varchar(180) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"reversal_of_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_loyalty_amount_check" CHECK ("growth_loyalty_ledger"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "growth_loyalty_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"mode" varchar(20) NOT NULL,
	"rate" numeric(12, 4) NOT NULL,
	"minimum_order_cents" integer DEFAULT 0 NOT NULL,
	"expires_after_days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_loyalty_program_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "growth_loyalty_rate_check" CHECK ("growth_loyalty_programs"."rate" > 0),
	CONSTRAINT "growth_loyalty_minimum_check" CHECK ("growth_loyalty_programs"."minimum_order_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "growth_marketing_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid,
	"segment_id" uuid,
	"name" varchar(160) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"status" "growth_campaign_status" DEFAULT 'draft' NOT NULL,
	"subject" varchar(180),
	"content" text NOT NULL,
	"created_by_identity_id" uuid,
	"queued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_campaign_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "growth_marketing_opt_out_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_public_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"key_last_four" varchar(4) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_identity_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"customer_id" uuid,
	"guest_name" varchar(160) NOT NULL,
	"guest_phone" varchar(40),
	"party_size" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 120 NOT NULL,
	"status" "growth_reservation_status" DEFAULT 'booked' NOT NULL,
	"notes" varchar(500),
	"idempotency_key" varchar(180) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_unit_price_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_ref" varchar(180) NOT NULL,
	"price_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"customer_id" uuid,
	"guest_name" varchar(160) NOT NULL,
	"guest_phone" varchar(40),
	"party_size" integer NOT NULL,
	"quoted_wait_minutes" integer,
	"status" "growth_waitlist_status" DEFAULT 'waiting' NOT NULL,
	"idempotency_key" varchar(180) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"url" text NOT NULL,
	"event_types" jsonb NOT NULL,
	"signing_key_version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_identity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_webhook_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" varchar(160) NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" varchar(180) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "management_accounts_payable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"supplier_id" uuid,
	"purchase_receipt_id" uuid,
	"description" varchar(240) NOT NULL,
	"status" "management_payable_status" DEFAULT 'open' NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"competence_date" date NOT NULL,
	"due_date" date NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_payables_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_payables_amount_check" CHECK ("management_accounts_payable"."amount_cents" > 0),
	CONSTRAINT "management_payables_paid_check" CHECK ("management_accounts_payable"."paid_cents" >= 0 and "management_accounts_payable"."paid_cents" <= "management_accounts_payable"."amount_cents")
);
--> statement-breakpoint
CREATE TABLE "management_accounts_receivable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"source_order_id" uuid,
	"description" varchar(240) NOT NULL,
	"status" "management_receivable_status" DEFAULT 'open' NOT NULL,
	"amount_cents" integer NOT NULL,
	"received_cents" integer DEFAULT 0 NOT NULL,
	"competence_date" date NOT NULL,
	"due_date" date NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_receivables_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_receivables_amount_check" CHECK ("management_accounts_receivable"."amount_cents" > 0),
	CONSTRAINT "management_receivables_received_check" CHECK ("management_accounts_receivable"."received_cents" >= 0 and "management_accounts_receivable"."received_cents" <= "management_accounts_receivable"."amount_cents")
);
--> statement-breakpoint
CREATE TABLE "management_cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"cash_shift_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_cash_movements_type_check" CHECK ("management_cash_movements"."type" in ('supply','withdrawal')),
	CONSTRAINT "management_cash_movements_amount_check" CHECK ("management_cash_movements"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "management_cash_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"operator_identity_id" uuid NOT NULL,
	"status" "management_cash_shift_status" DEFAULT 'open' NOT NULL,
	"opening_cents" integer NOT NULL,
	"expected_cents" integer,
	"counted_cents" integer,
	"difference_cents" integer,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"open_idempotency_key" varchar(160) NOT NULL,
	"close_idempotency_key" varchar(160),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_cash_shifts_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_cash_shifts_opening_check" CHECK ("management_cash_shifts"."opening_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"basis_points" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_commission_rules_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_commission_rules_rate_check" CHECK ("management_commission_rules"."basis_points" >= 0 and "management_commission_rules"."basis_points" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "management_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"rule_id" uuid,
	"source_order_id" uuid,
	"base_cents" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_commissions_base_check" CHECK ("management_commissions"."base_cents" >= 0),
	CONSTRAINT "management_commissions_amount_check" CHECK ("management_commissions"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_idempotency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"operation" varchar(80) NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "management_inventory_event_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"previous_quantity" numeric(16, 3) NOT NULL,
	"quantity_delta" numeric(16, 3) NOT NULL,
	"resulting_quantity" numeric(16, 3) NOT NULL,
	CONSTRAINT "management_inventory_event_lines_delta_check" CHECK ("management_inventory_event_lines"."quantity_delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "management_inventory_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"type" varchar(24) NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_events_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_events_type_check" CHECK ("management_inventory_events"."type" in ('loss','count','adjustment'))
);
--> statement-breakpoint
CREATE TABLE "management_inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_id" uuid,
	"name" varchar(160) NOT NULL,
	"sku" varchar(80),
	"unit" varchar(20) NOT NULL,
	"minimum_quantity" numeric(16, 3) DEFAULT '0' NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_items_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_inventory_items_minimum_check" CHECK ("management_inventory_items"."minimum_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"quantity_delta" numeric(16, 3) NOT NULL,
	"unit_cost_cents" integer,
	"source_type" varchar(48) NOT NULL,
	"source_id" uuid NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_inventory_movements_delta_check" CHECK ("management_inventory_movements"."quantity_delta" <> 0),
	CONSTRAINT "management_inventory_movements_cost_check" CHECK ("management_inventory_movements"."unit_cost_cents" is null or "management_inventory_movements"."unit_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_payable_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"payable_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" varchar(32) NOT NULL,
	"reference" varchar(160),
	"idempotency_key" varchar(160) NOT NULL,
	"paid_by_identity_id" uuid NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_payable_payments_amount_check" CHECK ("management_payable_payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "management_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"identity_id" uuid,
	"name" varchar(160) NOT NULL,
	"employment_code" varchar(80),
	"role_label" varchar(80) NOT NULL,
	"hourly_rate_cents" integer,
	"active" boolean DEFAULT true NOT NULL,
	"hired_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_people_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_people_hourly_rate_check" CHECK ("management_people"."hourly_rate_cents" is null or "management_people"."hourly_rate_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"received_quantity" numeric(16, 3) DEFAULT '0' NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_purchase_order_items_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_purchase_order_items_quantity_check" CHECK ("management_purchase_order_items"."quantity" > 0),
	CONSTRAINT "management_purchase_order_items_received_check" CHECK ("management_purchase_order_items"."received_quantity" >= 0 and "management_purchase_order_items"."received_quantity" <= "management_purchase_order_items"."quantity"),
	CONSTRAINT "management_purchase_order_items_cost_check" CHECK ("management_purchase_order_items"."unit_cost_cents" >= 0),
	CONSTRAINT "management_purchase_order_items_total_check" CHECK ("management_purchase_order_items"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "management_purchase_status" DEFAULT 'draft' NOT NULL,
	"total_cents" integer NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"expected_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_identity_id" uuid,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_purchase_orders_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_purchase_orders_total_check" CHECK ("management_purchase_orders"."total_cents" >= 0),
	CONSTRAINT "management_purchase_orders_version_check" CHECK ("management_purchase_orders"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "management_purchase_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"purchase_order_item_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" numeric(16, 3) NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	CONSTRAINT "management_purchase_receipt_lines_quantity_check" CHECK ("management_purchase_receipt_lines"."quantity" > 0),
	CONSTRAINT "management_purchase_receipt_lines_cost_check" CHECK ("management_purchase_receipt_lines"."unit_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_purchase_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"total_cents" integer NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"received_by_identity_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_purchase_receipts_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_purchase_receipts_total_check" CHECK ("management_purchase_receipts"."total_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "management_receivable_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"receivable_id" uuid NOT NULL,
	"product_id" uuid,
	"description" varchar(180) NOT NULL,
	"revenue_cents" integer NOT NULL,
	"cost_cents" integer,
	CONSTRAINT "management_receivable_lines_revenue_check" CHECK ("management_receivable_lines"."revenue_cents" >= 0),
	CONSTRAINT "management_receivable_lines_cost_check" CHECK ("management_receivable_lines"."cost_cents" is null or "management_receivable_lines"."cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_receivable_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"receivable_id" uuid NOT NULL,
	"cash_shift_id" uuid,
	"amount_cents" integer NOT NULL,
	"method" varchar(32) NOT NULL,
	"reference" varchar(160),
	"idempotency_key" varchar(160) NOT NULL,
	"received_by_identity_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_receivable_payments_amount_check" CHECK ("management_receivable_payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "management_reconciliation_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"payment_direction" varchar(16) NOT NULL,
	"payment_id" uuid,
	"external_key" varchar(160) NOT NULL,
	"gross_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"net_cents" integer NOT NULL,
	"status" varchar(20) NOT NULL,
	"resolution_note" text,
	"resolved_by_identity_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_reconciliation_entry_direction_check" CHECK ("management_reconciliation_entries"."payment_direction" in ('payable','receivable')),
	CONSTRAINT "management_reconciliation_entry_amount_check" CHECK ("management_reconciliation_entries"."gross_cents" > 0 and "management_reconciliation_entries"."fee_cents" >= 0 and "management_reconciliation_entries"."net_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_reconciliation_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"source" varchar(32) NOT NULL,
	"file_hash" varchar(64),
	"idempotency_key" varchar(160) NOT NULL,
	"imported_by_identity_id" uuid NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_reconciliation_import_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "management_reconciliation_import_source_check" CHECK ("management_reconciliation_imports"."source" in ('manual','imported'))
);
--> statement-breakpoint
CREATE TABLE "management_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_schedules_window_check" CHECK ("management_schedules"."ends_at" > "management_schedules"."starts_at"),
	CONSTRAINT "management_schedules_break_check" CHECK ("management_schedules"."break_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_stock_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"quantity" numeric(16, 3) DEFAULT '0' NOT NULL,
	"average_cost_cents" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_stock_balance_unique" UNIQUE("organization_id","unit_id","location_id","inventory_item_id"),
	CONSTRAINT "management_stock_balance_version_check" CHECK ("management_stock_balances"."version" > 0),
	CONSTRAINT "management_stock_balance_cost_check" CHECK ("management_stock_balances"."average_cost_cents" is null or "management_stock_balances"."average_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "management_stock_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"code" varchar(40) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_stock_locations_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "management_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"document" varchar(20),
	"contact_name" varchar(120),
	"email" varchar(254),
	"phone" varchar(24),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_suppliers_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "management_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"clocked_in_at" timestamp with time zone NOT NULL,
	"clocked_out_at" timestamp with time zone,
	"source" varchar(24) DEFAULT 'manual' NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"recorded_by_identity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "management_time_entries_window_check" CHECK ("management_time_entries"."clocked_out_at" is null or "management_time_entries"."clocked_out_at" > "management_time_entries"."clocked_in_at")
);
--> statement-breakpoint
CREATE TABLE "pos_allergens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_allergens_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "pos_catalog_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_categories_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "pos_dining_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_rooms_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "pos_dining_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"label" varchar(60) NOT NULL,
	"seats" integer DEFAULT 4 NOT NULL,
	"status" "pos_table_status" DEFAULT 'available' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_tables_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_tables_seats_check" CHECK ("pos_dining_tables"."seats" > 0)
);
--> statement-breakpoint
CREATE TABLE "pos_idempotency_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"key" varchar(160) NOT NULL,
	"operation" varchar(100) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_kds_ticket_items" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	CONSTRAINT "pos_kds_ticket_items_ticket_id_order_item_id_pk" PRIMARY KEY("ticket_id","order_item_id")
);
--> statement-breakpoint
CREATE TABLE "pos_kds_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"status" "pos_kds_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_kds_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "pos_manager_pins" (
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"pin_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"minimum_selections" integer DEFAULT 0 NOT NULL,
	"maximum_selections" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_modifier_groups_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "pos_modifier_selection_range_check" CHECK ("pos_modifier_groups"."minimum_selections" >= 0 AND "pos_modifier_groups"."maximum_selections" >= "pos_modifier_groups"."minimum_selections")
);
--> statement-breakpoint
CREATE TABLE "pos_modifier_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"price_delta_cents" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_modifier_options_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "pos_modifier_option_price_check" CHECK ("pos_modifier_options"."price_delta_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pos_operation_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"action" "pos_approval_action" NOT NULL,
	"entity_type" varchar(60) NOT NULL,
	"entity_id" uuid NOT NULL,
	"requested_by_identity_id" uuid NOT NULL,
	"approved_by_membership_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_order_item_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_delta_cents" integer DEFAULT 0 NOT NULL,
	"total_delta_cents" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pos_order_item_modifiers_quantity_check" CHECK ("pos_order_item_modifiers"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "pos_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"station_id" uuid,
	"product_name" varchar(160) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"modifiers_cents" integer DEFAULT 0 NOT NULL,
	"gross_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"net_cents" integer NOT NULL,
	"status" "pos_item_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"canceled_at" timestamp with time zone,
	"canceled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_order_items_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_order_items_amounts_check" CHECK ("pos_order_items"."quantity" > 0 AND "pos_order_items"."unit_price_cents" >= 0 AND "pos_order_items"."modifiers_cents" >= 0 AND "pos_order_items"."gross_cents" >= 0 AND "pos_order_items"."discount_cents" >= 0 AND "pos_order_items"."net_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pos_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"tab_id" uuid NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"status" "pos_order_status" DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_orders_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "pos_product_allergens" (
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"allergen_id" uuid NOT NULL,
	"may_contain" boolean DEFAULT false NOT NULL,
	CONSTRAINT "pos_product_allergens_product_id_allergen_id_pk" PRIMARY KEY("product_id","allergen_id")
);
--> statement-breakpoint
CREATE TABLE "pos_product_availability" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"schedule" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_product_availability_unit_id_product_id_pk" PRIMARY KEY("unit_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "pos_product_modifier_groups" (
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pos_product_modifier_groups_product_id_group_id_pk" PRIMARY KEY("product_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "pos_product_prices" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_product_prices_unit_id_product_id_pk" PRIMARY KEY("unit_id","product_id"),
	CONSTRAINT "pos_product_price_check" CHECK ("pos_product_prices"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pos_product_stations" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	CONSTRAINT "pos_product_stations_unit_id_product_id_station_id_pk" PRIMARY KEY("unit_id","product_id","station_id")
);
--> statement-breakpoint
CREATE TABLE "pos_production_stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"code" varchar(40) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_stations_scope_id_unique" UNIQUE("organization_id","unit_id","id")
);
--> statement-breakpoint
CREATE TABLE "pos_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"sku" varchar(80),
	"name" varchar(160) NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_products_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "pos_recipe_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"ingredient_name" varchar(160) NOT NULL,
	"quantity_milli" integer NOT NULL,
	"unit" varchar(20) NOT NULL,
	"loss_basis_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_recipe_quantity_check" CHECK ("pos_recipe_components"."quantity_milli" > 0),
	CONSTRAINT "pos_recipe_loss_check" CHECK ("pos_recipe_components"."loss_basis_points" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "pos_tab_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"tab_id" uuid NOT NULL,
	"actor_identity_id" uuid NOT NULL,
	"type" varchar(80) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_tabs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"table_id" uuid,
	"opened_by_identity_id" uuid NOT NULL,
	"label" varchar(120),
	"guest_count" integer DEFAULT 1 NOT NULL,
	"status" "pos_tab_status" DEFAULT 'open' NOT NULL,
	"merged_into_tab_id" uuid,
	"service_charge_basis_points" integer DEFAULT 0 NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"service_charge_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_tabs_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_tabs_guest_count_check" CHECK ("pos_tabs"."guest_count" > 0),
	CONSTRAINT "pos_tabs_service_rate_check" CHECK ("pos_tabs"."service_charge_basis_points" BETWEEN 0 AND 10000),
	CONSTRAINT "pos_tabs_totals_check" CHECK ("pos_tabs"."tip_cents" >= 0 AND "pos_tabs"."subtotal_cents" >= 0 AND "pos_tabs"."discount_cents" >= 0 AND "pos_tabs"."service_charge_cents" >= 0 AND "pos_tabs"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mfa_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"trusted_device" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_factors" (
	"identity_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_secret" text NOT NULL,
	"iv" varchar(24) NOT NULL,
	"auth_tag" varchar(32) NOT NULL,
	"recovery_code_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "growth_campaign_deliveries" ADD CONSTRAINT "growth_campaign_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_campaign_deliveries" ADD CONSTRAINT "growth_campaign_deliveries_campaign_id_growth_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."growth_marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_campaign_deliveries" ADD CONSTRAINT "growth_campaign_deliveries_customer_id_growth_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."growth_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_campaign_deliveries" ADD CONSTRAINT "growth_campaign_delivery_campaign_tenant_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."growth_marketing_campaigns"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_campaign_deliveries" ADD CONSTRAINT "growth_campaign_delivery_customer_tenant_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."growth_customers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_coupon_redemptions" ADD CONSTRAINT "growth_coupon_redemptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_coupon_redemptions" ADD CONSTRAINT "growth_coupon_redemptions_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_coupon_redemptions" ADD CONSTRAINT "growth_coupon_redemptions_coupon_id_growth_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."growth_coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_coupon_redemptions" ADD CONSTRAINT "growth_coupon_redemptions_customer_id_growth_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."growth_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_coupon_redemptions" ADD CONSTRAINT "growth_coupon_redemption_unit_tenant_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_coupon_redemptions" ADD CONSTRAINT "growth_coupon_redemption_coupon_tenant_fk" FOREIGN KEY ("organization_id","coupon_id") REFERENCES "public"."growth_coupons"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_coupon_redemptions" ADD CONSTRAINT "growth_coupon_redemption_customer_tenant_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."growth_customers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_coupon_redemptions" ADD CONSTRAINT "growth_coupon_redemption_tab_fk" FOREIGN KEY ("organization_id","unit_id","order_ref") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_coupons" ADD CONSTRAINT "growth_coupons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_coupons" ADD CONSTRAINT "growth_coupons_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_coupons" ADD CONSTRAINT "growth_coupon_unit_tenant_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_customer_consents" ADD CONSTRAINT "growth_customer_consents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_customer_consents" ADD CONSTRAINT "growth_customer_consents_customer_id_growth_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."growth_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_customer_consents" ADD CONSTRAINT "growth_customer_consents_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_customer_consents" ADD CONSTRAINT "growth_consent_customer_tenant_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."growth_customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_customer_segments" ADD CONSTRAINT "growth_customer_segments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_delivery_dispatches" ADD CONSTRAINT "growth_delivery_dispatches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_delivery_dispatches" ADD CONSTRAINT "growth_delivery_dispatches_delivery_order_id_growth_delivery_orders_id_fk" FOREIGN KEY ("delivery_order_id") REFERENCES "public"."growth_delivery_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_delivery_dispatches" ADD CONSTRAINT "growth_dispatch_unit_tenant_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_delivery_dispatches" ADD CONSTRAINT "growth_dispatch_order_tenant_fk" FOREIGN KEY ("organization_id","delivery_order_id") REFERENCES "public"."growth_delivery_orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD CONSTRAINT "growth_delivery_orders_customer_id_growth_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."growth_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD CONSTRAINT "growth_delivery_orders_zone_id_growth_delivery_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."growth_delivery_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD CONSTRAINT "growth_delivery_order_org_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD CONSTRAINT "growth_delivery_order_customer_tenant_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."growth_customers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD CONSTRAINT "growth_delivery_order_zone_tenant_fk" FOREIGN KEY ("organization_id","zone_id") REFERENCES "public"."growth_delivery_zones"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_delivery_orders" ADD CONSTRAINT "growth_delivery_order_tab_fk" FOREIGN KEY ("organization_id","unit_id","order_ref") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_delivery_zones" ADD CONSTRAINT "growth_delivery_zone_org_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_customers" ADD CONSTRAINT "growth_customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_customers" ADD CONSTRAINT "growth_customers_default_unit_id_units_id_fk" FOREIGN KEY ("default_unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_customers" ADD CONSTRAINT "growth_customer_default_unit_tenant_fk" FOREIGN KEY ("organization_id","default_unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_integrations" ADD CONSTRAINT "growth_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_integrations" ADD CONSTRAINT "growth_integrations_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_integrations" ADD CONSTRAINT "growth_integration_unit_tenant_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_inventory_transfer_lines" ADD CONSTRAINT "growth_inventory_transfer_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_inventory_transfer_lines" ADD CONSTRAINT "growth_inventory_transfer_lines_transfer_id_growth_inventory_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."growth_inventory_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_inventory_transfer_lines" ADD CONSTRAINT "growth_transfer_line_tenant_fk" FOREIGN KEY ("organization_id","transfer_id") REFERENCES "public"."growth_inventory_transfers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_inventory_transfers" ADD CONSTRAINT "growth_inventory_transfers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_inventory_transfers" ADD CONSTRAINT "growth_inventory_transfers_origin_unit_id_units_id_fk" FOREIGN KEY ("origin_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_inventory_transfers" ADD CONSTRAINT "growth_inventory_transfers_destination_unit_id_units_id_fk" FOREIGN KEY ("destination_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_inventory_transfers" ADD CONSTRAINT "growth_transfer_origin_tenant_fk" FOREIGN KEY ("organization_id","origin_unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_inventory_transfers" ADD CONSTRAINT "growth_transfer_destination_tenant_fk" FOREIGN KEY ("organization_id","destination_unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_loyalty_ledger" ADD CONSTRAINT "growth_loyalty_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_loyalty_ledger" ADD CONSTRAINT "growth_loyalty_ledger_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_loyalty_ledger" ADD CONSTRAINT "growth_loyalty_ledger_program_id_growth_loyalty_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."growth_loyalty_programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_loyalty_ledger" ADD CONSTRAINT "growth_loyalty_ledger_customer_id_growth_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."growth_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_loyalty_ledger" ADD CONSTRAINT "growth_loyalty_reversal_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."growth_loyalty_ledger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_loyalty_ledger" ADD CONSTRAINT "growth_loyalty_unit_tenant_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_loyalty_ledger" ADD CONSTRAINT "growth_loyalty_program_tenant_fk" FOREIGN KEY ("organization_id","program_id") REFERENCES "public"."growth_loyalty_programs"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_loyalty_ledger" ADD CONSTRAINT "growth_loyalty_customer_tenant_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."growth_customers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_loyalty_programs" ADD CONSTRAINT "growth_loyalty_programs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_marketing_campaigns" ADD CONSTRAINT "growth_marketing_campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_marketing_campaigns" ADD CONSTRAINT "growth_marketing_campaigns_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_marketing_campaigns" ADD CONSTRAINT "growth_marketing_campaigns_segment_id_growth_customer_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."growth_customer_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_marketing_campaigns" ADD CONSTRAINT "growth_marketing_campaigns_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_marketing_campaigns" ADD CONSTRAINT "growth_campaign_unit_tenant_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_marketing_campaigns" ADD CONSTRAINT "growth_campaign_segment_tenant_fk" FOREIGN KEY ("organization_id","segment_id") REFERENCES "public"."growth_customer_segments"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_marketing_opt_out_tokens" ADD CONSTRAINT "growth_marketing_opt_out_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_marketing_opt_out_tokens" ADD CONSTRAINT "growth_marketing_opt_out_tokens_customer_id_growth_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."growth_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_marketing_opt_out_tokens" ADD CONSTRAINT "growth_opt_out_customer_tenant_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."growth_customers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_public_api_keys" ADD CONSTRAINT "growth_public_api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_public_api_keys" ADD CONSTRAINT "growth_public_api_keys_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_reservations" ADD CONSTRAINT "growth_reservations_customer_id_growth_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."growth_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_reservations" ADD CONSTRAINT "growth_reservation_org_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_reservations" ADD CONSTRAINT "growth_reservation_customer_tenant_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."growth_customers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_unit_price_overrides" ADD CONSTRAINT "growth_price_override_org_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_waitlist_entries" ADD CONSTRAINT "growth_waitlist_entries_customer_id_growth_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."growth_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_waitlist_entries" ADD CONSTRAINT "growth_waitlist_org_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_waitlist_entries" ADD CONSTRAINT "growth_waitlist_customer_tenant_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."growth_customers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_webhook_endpoints" ADD CONSTRAINT "growth_webhook_endpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_webhook_endpoints" ADD CONSTRAINT "growth_webhook_endpoints_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_webhook_publications" ADD CONSTRAINT "growth_webhook_publications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD CONSTRAINT "management_payables_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD CONSTRAINT "management_payables_supplier_fk" FOREIGN KEY ("organization_id","unit_id","supplier_id") REFERENCES "public"."management_suppliers"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_accounts_payable" ADD CONSTRAINT "management_payables_receipt_fk" FOREIGN KEY ("organization_id","unit_id","purchase_receipt_id") REFERENCES "public"."management_purchase_receipts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_accounts_receivable" ADD CONSTRAINT "management_receivables_order_fk" FOREIGN KEY ("organization_id","unit_id","source_order_id") REFERENCES "public"."pos_orders"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_movements" ADD CONSTRAINT "management_cash_movements_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_movements" ADD CONSTRAINT "management_cash_movements_shift_fk" FOREIGN KEY ("organization_id","unit_id","cash_shift_id") REFERENCES "public"."management_cash_shifts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ADD CONSTRAINT "management_cash_shifts_operator_identity_id_identities_id_fk" FOREIGN KEY ("operator_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_cash_shifts" ADD CONSTRAINT "management_cash_shifts_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_commission_rules" ADD CONSTRAINT "management_commission_rules_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_commissions" ADD CONSTRAINT "management_commissions_person_fk" FOREIGN KEY ("organization_id","unit_id","person_id") REFERENCES "public"."management_people"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_commissions" ADD CONSTRAINT "management_commissions_rule_fk" FOREIGN KEY ("organization_id","unit_id","rule_id") REFERENCES "public"."management_commission_rules"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_commissions" ADD CONSTRAINT "management_commissions_order_fk" FOREIGN KEY ("organization_id","unit_id","source_order_id") REFERENCES "public"."pos_orders"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_idempotency" ADD CONSTRAINT "management_idempotency_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_idempotency" ADD CONSTRAINT "management_idempotency_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_idempotency" ADD CONSTRAINT "management_idempotency_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_event_lines" ADD CONSTRAINT "management_inventory_event_lines_event_fk" FOREIGN KEY ("organization_id","unit_id","event_id") REFERENCES "public"."management_inventory_events"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_event_lines" ADD CONSTRAINT "management_inventory_event_lines_balance_fk" FOREIGN KEY ("organization_id","unit_id","location_id","inventory_item_id") REFERENCES "public"."management_stock_balances"("organization_id","unit_id","location_id","inventory_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_events" ADD CONSTRAINT "management_inventory_events_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_events" ADD CONSTRAINT "management_inventory_events_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD CONSTRAINT "management_inventory_items_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_items" ADD CONSTRAINT "management_inventory_items_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_movements" ADD CONSTRAINT "management_inventory_movements_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_inventory_movements" ADD CONSTRAINT "management_inventory_movements_balance_fk" FOREIGN KEY ("organization_id","unit_id","location_id","inventory_item_id") REFERENCES "public"."management_stock_balances"("organization_id","unit_id","location_id","inventory_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_payable_payments" ADD CONSTRAINT "management_payable_payments_paid_by_identity_id_identities_id_fk" FOREIGN KEY ("paid_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_payable_payments" ADD CONSTRAINT "management_payable_payments_payable_fk" FOREIGN KEY ("organization_id","unit_id","payable_id") REFERENCES "public"."management_accounts_payable"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_people" ADD CONSTRAINT "management_people_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_people" ADD CONSTRAINT "management_people_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_purchase_order_items" ADD CONSTRAINT "management_purchase_order_items_order_fk" FOREIGN KEY ("organization_id","unit_id","purchase_order_id") REFERENCES "public"."management_purchase_orders"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_purchase_order_items" ADD CONSTRAINT "management_purchase_order_items_inventory_fk" FOREIGN KEY ("organization_id","unit_id","inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_purchase_orders" ADD CONSTRAINT "management_purchase_orders_approved_by_identity_id_identities_id_fk" FOREIGN KEY ("approved_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_purchase_orders" ADD CONSTRAINT "management_purchase_orders_supplier_fk" FOREIGN KEY ("organization_id","unit_id","supplier_id") REFERENCES "public"."management_suppliers"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" ADD CONSTRAINT "management_purchase_receipt_lines_receipt_fk" FOREIGN KEY ("organization_id","unit_id","receipt_id") REFERENCES "public"."management_purchase_receipts"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" ADD CONSTRAINT "management_purchase_receipt_lines_item_fk" FOREIGN KEY ("organization_id","unit_id","purchase_order_item_id") REFERENCES "public"."management_purchase_order_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" ADD CONSTRAINT "management_purchase_receipt_lines_inventory_fk" FOREIGN KEY ("organization_id","unit_id","inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_purchase_receipt_lines" ADD CONSTRAINT "management_purchase_receipt_lines_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_purchase_receipts" ADD CONSTRAINT "management_purchase_receipts_received_by_identity_id_identities_id_fk" FOREIGN KEY ("received_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_purchase_receipts" ADD CONSTRAINT "management_purchase_receipts_order_fk" FOREIGN KEY ("organization_id","unit_id","purchase_order_id") REFERENCES "public"."management_purchase_orders"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_purchase_receipts" ADD CONSTRAINT "management_purchase_receipts_supplier_fk" FOREIGN KEY ("organization_id","unit_id","supplier_id") REFERENCES "public"."management_suppliers"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_receivable_lines" ADD CONSTRAINT "management_receivable_lines_receivable_fk" FOREIGN KEY ("organization_id","unit_id","receivable_id") REFERENCES "public"."management_accounts_receivable"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_receivable_lines" ADD CONSTRAINT "management_receivable_lines_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_receivable_payments" ADD CONSTRAINT "management_receivable_payments_received_by_identity_id_identities_id_fk" FOREIGN KEY ("received_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_receivable_payments" ADD CONSTRAINT "management_receivable_payments_receivable_fk" FOREIGN KEY ("organization_id","unit_id","receivable_id") REFERENCES "public"."management_accounts_receivable"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_receivable_payments" ADD CONSTRAINT "management_receivable_payments_shift_fk" FOREIGN KEY ("organization_id","unit_id","cash_shift_id") REFERENCES "public"."management_cash_shifts"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_reconciliation_entries" ADD CONSTRAINT "management_reconciliation_entries_resolved_by_identity_id_identities_id_fk" FOREIGN KEY ("resolved_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_reconciliation_entries" ADD CONSTRAINT "management_reconciliation_entry_import_fk" FOREIGN KEY ("organization_id","unit_id","import_id") REFERENCES "public"."management_reconciliation_imports"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_reconciliation_imports" ADD CONSTRAINT "management_reconciliation_imports_imported_by_identity_id_identities_id_fk" FOREIGN KEY ("imported_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_reconciliation_imports" ADD CONSTRAINT "management_reconciliation_import_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_schedules" ADD CONSTRAINT "management_schedules_person_fk" FOREIGN KEY ("organization_id","unit_id","person_id") REFERENCES "public"."management_people"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_stock_balances" ADD CONSTRAINT "management_stock_balance_location_fk" FOREIGN KEY ("organization_id","unit_id","location_id") REFERENCES "public"."management_stock_locations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_stock_balances" ADD CONSTRAINT "management_stock_balance_item_fk" FOREIGN KEY ("organization_id","unit_id","inventory_item_id") REFERENCES "public"."management_inventory_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_stock_locations" ADD CONSTRAINT "management_stock_locations_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_suppliers" ADD CONSTRAINT "management_suppliers_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD CONSTRAINT "management_time_entries_recorded_by_identity_id_identities_id_fk" FOREIGN KEY ("recorded_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_time_entries" ADD CONSTRAINT "management_time_entries_person_fk" FOREIGN KEY ("organization_id","unit_id","person_id") REFERENCES "public"."management_people"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_allergens" ADD CONSTRAINT "pos_allergens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_catalog_categories" ADD CONSTRAINT "pos_catalog_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_dining_rooms" ADD CONSTRAINT "pos_rooms_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_dining_tables" ADD CONSTRAINT "pos_tables_room_fk" FOREIGN KEY ("organization_id","unit_id","room_id") REFERENCES "public"."pos_dining_rooms"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_idempotency_receipts" ADD CONSTRAINT "pos_idempotency_receipts_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_idempotency_receipts" ADD CONSTRAINT "pos_idempotency_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD CONSTRAINT "pos_kds_ticket_items_ticket_fk" FOREIGN KEY ("organization_id","unit_id","ticket_id") REFERENCES "public"."pos_kds_tickets"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD CONSTRAINT "pos_kds_ticket_items_item_fk" FOREIGN KEY ("organization_id","unit_id","order_item_id") REFERENCES "public"."pos_order_items"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_tickets" ADD CONSTRAINT "pos_kds_order_fk" FOREIGN KEY ("organization_id","unit_id","order_id") REFERENCES "public"."pos_orders"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_tickets" ADD CONSTRAINT "pos_kds_station_fk" FOREIGN KEY ("organization_id","unit_id","station_id") REFERENCES "public"."pos_production_stations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_manager_pins" ADD CONSTRAINT "pos_manager_pins_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_manager_pins" ADD CONSTRAINT "pos_manager_pins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_modifier_groups" ADD CONSTRAINT "pos_modifier_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_modifier_options" ADD CONSTRAINT "pos_modifier_options_group_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."pos_modifier_groups"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_operation_approvals" ADD CONSTRAINT "pos_operation_approvals_requested_by_identity_id_identities_id_fk" FOREIGN KEY ("requested_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_operation_approvals" ADD CONSTRAINT "pos_operation_approvals_approved_by_membership_id_memberships_id_fk" FOREIGN KEY ("approved_by_membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order_item_modifiers" ADD CONSTRAINT "pos_order_item_modifiers_item_fk" FOREIGN KEY ("organization_id","unit_id","order_item_id") REFERENCES "public"."pos_order_items"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order_item_modifiers" ADD CONSTRAINT "pos_order_item_modifiers_option_fk" FOREIGN KEY ("organization_id","option_id") REFERENCES "public"."pos_modifier_options"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order_items" ADD CONSTRAINT "pos_order_items_order_fk" FOREIGN KEY ("organization_id","unit_id","order_id") REFERENCES "public"."pos_orders"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_order_items" ADD CONSTRAINT "pos_order_items_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_orders" ADD CONSTRAINT "pos_orders_tab_fk" FOREIGN KEY ("organization_id","unit_id","tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_product_allergens" ADD CONSTRAINT "pos_product_allergens_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_product_allergens" ADD CONSTRAINT "pos_product_allergens_allergen_fk" FOREIGN KEY ("organization_id","allergen_id") REFERENCES "public"."pos_allergens"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_product_availability" ADD CONSTRAINT "pos_product_availability_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_product_availability" ADD CONSTRAINT "pos_product_availability_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_product_modifier_groups" ADD CONSTRAINT "pos_product_modifier_groups_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_product_modifier_groups" ADD CONSTRAINT "pos_product_modifier_groups_group_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."pos_modifier_groups"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_product_prices" ADD CONSTRAINT "pos_product_prices_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_product_prices" ADD CONSTRAINT "pos_product_prices_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_product_stations" ADD CONSTRAINT "pos_product_stations_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_product_stations" ADD CONSTRAINT "pos_product_stations_station_fk" FOREIGN KEY ("organization_id","unit_id","station_id") REFERENCES "public"."pos_production_stations"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_production_stations" ADD CONSTRAINT "pos_stations_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_products" ADD CONSTRAINT "pos_products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_products" ADD CONSTRAINT "pos_products_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."pos_catalog_categories"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_recipe_components" ADD CONSTRAINT "pos_recipe_components_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tab_events" ADD CONSTRAINT "pos_tab_events_actor_identity_id_identities_id_fk" FOREIGN KEY ("actor_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tab_events" ADD CONSTRAINT "pos_tab_events_tab_fk" FOREIGN KEY ("organization_id","unit_id","tab_id") REFERENCES "public"."pos_tabs"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_opened_by_identity_id_identities_id_fk" FOREIGN KEY ("opened_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_unit_fk" FOREIGN KEY ("organization_id","unit_id") REFERENCES "public"."units"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_tabs" ADD CONSTRAINT "pos_tabs_table_fk" FOREIGN KEY ("organization_id","unit_id","table_id") REFERENCES "public"."pos_dining_tables"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "growth_campaign_delivery_target_unique" ON "growth_campaign_deliveries" USING btree ("organization_id","campaign_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_campaign_delivery_idempotency_unique" ON "growth_campaign_deliveries" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_coupon_redemption_idempotency_unique" ON "growth_coupon_redemptions" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_coupon_redemption_order_unique" ON "growth_coupon_redemptions" USING btree ("organization_id","order_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_coupons_org_code_unique" ON "growth_coupons" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "growth_consents_customer_time_idx" ON "growth_customer_consents" USING btree ("organization_id","customer_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_segments_org_name_unique" ON "growth_customer_segments" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_dispatch_idempotency_unique" ON "growth_delivery_dispatches" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_delivery_order_ref_unique" ON "growth_delivery_orders" USING btree ("organization_id","order_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_delivery_idempotency_unique" ON "growth_delivery_orders" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "growth_delivery_unit_status_idx" ON "growth_delivery_orders" USING btree ("unit_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_delivery_zone_unit_name_unique" ON "growth_delivery_zones" USING btree ("unit_id","name");--> statement-breakpoint
CREATE INDEX "growth_customers_org_name_idx" ON "growth_customers" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_customers_org_email_unique" ON "growth_customers" USING btree ("organization_id","email") WHERE "growth_customers"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "growth_integrations_org_unit_provider_unique" ON "growth_integrations" USING btree ("organization_id","unit_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_transfer_line_item_unique" ON "growth_inventory_transfer_lines" USING btree ("transfer_id","inventory_item_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_transfer_idempotency_unique" ON "growth_inventory_transfers" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_loyalty_idempotency_unique" ON "growth_loyalty_ledger" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_loyalty_reversal_unique" ON "growth_loyalty_ledger" USING btree ("organization_id","reversal_of_id") WHERE "growth_loyalty_ledger"."reversal_of_id" is not null;--> statement-breakpoint
CREATE INDEX "growth_loyalty_customer_time_idx" ON "growth_loyalty_ledger" USING btree ("organization_id","customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_loyalty_one_active_unique" ON "growth_loyalty_programs" USING btree ("organization_id") WHERE "growth_loyalty_programs"."active" = true;--> statement-breakpoint
CREATE INDEX "growth_campaign_org_status_idx" ON "growth_marketing_campaigns" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_opt_out_token_hash_unique" ON "growth_marketing_opt_out_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_public_api_key_hash_unique" ON "growth_public_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "growth_public_api_keys_org_idx" ON "growth_public_api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_reservation_idempotency_unique" ON "growth_reservations" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "growth_reservation_unit_schedule_idx" ON "growth_reservations" USING btree ("unit_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_price_override_unit_product_unique" ON "growth_unit_price_overrides" USING btree ("unit_id","product_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_waitlist_idempotency_unique" ON "growth_waitlist_entries" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "growth_waitlist_unit_status_idx" ON "growth_waitlist_entries" USING btree ("unit_id","status","joined_at");--> statement-breakpoint
CREATE INDEX "growth_webhook_endpoints_org_idx" ON "growth_webhook_endpoints" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_webhook_publication_idempotency_unique" ON "growth_webhook_publications" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_payables_idempotency_unique" ON "management_accounts_payable" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_payables_due_idx" ON "management_accounts_payable" USING btree ("organization_id","unit_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "management_receivables_idempotency_unique" ON "management_accounts_receivable" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_cash_movements_idempotency_unique" ON "management_cash_movements" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_cash_shifts_open_idempotency_unique" ON "management_cash_shifts" USING btree ("organization_id","unit_id","open_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_cash_shifts_close_idempotency_unique" ON "management_cash_shifts" USING btree ("organization_id","unit_id","close_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_cash_shifts_one_open_unique" ON "management_cash_shifts" USING btree ("organization_id","unit_id") WHERE "management_cash_shifts"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "management_commissions_idempotency_unique" ON "management_commissions" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_idempotency_unique" ON "management_idempotency" USING btree ("organization_id","unit_id","operation","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_events_idempotency_unique" ON "management_inventory_events" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_items_sku_unique" ON "management_inventory_items" USING btree ("organization_id","unit_id","sku");--> statement-breakpoint
CREATE INDEX "management_inventory_movements_ledger_idx" ON "management_inventory_movements" USING btree ("organization_id","unit_id","location_id","inventory_item_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_inventory_movements_source_unique" ON "management_inventory_movements" USING btree ("organization_id","unit_id","source_type","source_id","inventory_item_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "management_payable_payments_idempotency_unique" ON "management_payable_payments" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_people_identity_unique" ON "management_people" USING btree ("organization_id","unit_id","identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "management_purchase_orders_idempotency_unique" ON "management_purchase_orders" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_purchase_orders_status_idx" ON "management_purchase_orders" USING btree ("organization_id","unit_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "management_purchase_receipts_idempotency_unique" ON "management_purchase_receipts" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_receivable_payments_idempotency_unique" ON "management_receivable_payments" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_reconciliation_entry_unique" ON "management_reconciliation_entries" USING btree ("organization_id","unit_id","import_id","external_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_reconciliation_import_idempotency_unique" ON "management_reconciliation_imports" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "management_schedules_person_time_idx" ON "management_schedules" USING btree ("organization_id","unit_id","person_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "management_stock_locations_code_unique" ON "management_stock_locations" USING btree ("organization_id","unit_id","code");--> statement-breakpoint
CREATE INDEX "management_suppliers_scope_name_idx" ON "management_suppliers" USING btree ("organization_id","unit_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "management_time_entries_idempotency_unique" ON "management_time_entries" USING btree ("organization_id","unit_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "management_time_entries_one_open_unique" ON "management_time_entries" USING btree ("organization_id","unit_id","person_id") WHERE "management_time_entries"."clocked_out_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_allergens_org_code_unique" ON "pos_allergens" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_categories_org_slug_unique" ON "pos_catalog_categories" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_tables_room_label_unique" ON "pos_dining_tables" USING btree ("room_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_idempotency_scope_key_unique" ON "pos_idempotency_receipts" USING btree ("organization_id","unit_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_kds_order_station_unique" ON "pos_kds_tickets" USING btree ("order_id","station_id");--> statement-breakpoint
CREATE INDEX "pos_manager_pins_org_idx" ON "pos_manager_pins" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pos_approvals_entity_idx" ON "pos_operation_approvals" USING btree ("organization_id","unit_id","entity_id");--> statement-breakpoint
CREATE INDEX "pos_order_items_order_idx" ON "pos_order_items" USING btree ("organization_id","unit_id","order_id");--> statement-breakpoint
CREATE INDEX "pos_orders_tab_idx" ON "pos_orders" USING btree ("organization_id","unit_id","tab_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_stations_org_unit_code_unique" ON "pos_production_stations" USING btree ("organization_id","unit_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_products_org_sku_unique" ON "pos_products" USING btree ("organization_id","sku");--> statement-breakpoint
CREATE INDEX "pos_products_category_idx" ON "pos_products" USING btree ("organization_id","category_id");--> statement-breakpoint
CREATE INDEX "pos_tab_events_tab_idx" ON "pos_tab_events" USING btree ("organization_id","unit_id","tab_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_tabs_one_open_per_table_unique" ON "pos_tabs" USING btree ("organization_id","unit_id","table_id") WHERE "pos_tabs"."status" = 'open' AND "pos_tabs"."table_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pos_tabs_open_idx" ON "pos_tabs" USING btree ("organization_id","unit_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_challenges_token_hash_unique" ON "mfa_challenges" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mfa_challenges_identity_idx" ON "mfa_challenges" USING btree ("identity_id");