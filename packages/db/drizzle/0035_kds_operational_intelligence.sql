CREATE TYPE "public"."pos_kds_batch_status" AS ENUM('active', 'completed', 'canceled');--> statement-breakpoint
CREATE TABLE "pos_kds_attention_acknowledgements" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"note_id" varchar(20) NOT NULL,
	"revision" varchar(64) NOT NULL,
	"acknowledged_by_identity_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_kds_attention_acknowledgements_organization_id_unit_id_ticket_id_order_item_id_note_id_revision_pk" PRIMARY KEY("organization_id","unit_id","ticket_id","order_item_id","note_id","revision"),
	CONSTRAINT "pos_kds_attention_note_check" CHECK ("pos_kds_attention_acknowledgements"."note_id" IN ('allergy', 'notes')),
	CONSTRAINT "pos_kds_attention_revision_check" CHECK ("pos_kds_attention_acknowledgements"."revision" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "pos_kds_batch_assignments" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"quantity" integer NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "pos_kds_batch_assignments_batch_id_ticket_id_order_item_id_pk" PRIMARY KEY("batch_id","ticket_id","order_item_id"),
	CONSTRAINT "pos_kds_batch_assignments_position_unique" UNIQUE("batch_id","position"),
	CONSTRAINT "pos_kds_batch_assignments_position_check" CHECK ("pos_kds_batch_assignments"."position" > 0),
	CONSTRAINT "pos_kds_batch_assignments_quantity_check" CHECK ("pos_kds_batch_assignments"."quantity" > 0),
	CONSTRAINT "pos_kds_batch_assignments_release_check" CHECK ("pos_kds_batch_assignments"."released_at" IS NULL OR "pos_kds_batch_assignments"."released_at" >= "pos_kds_batch_assignments"."joined_at")
);
--> statement-breakpoint
CREATE TABLE "pos_kds_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"product_id" uuid,
	"status" "pos_kds_batch_status" DEFAULT 'active' NOT NULL,
	"created_by_identity_id" uuid NOT NULL,
	"completed_by_identity_id" uuid,
	"canceled_by_identity_id" uuid,
	"completion_reason" text,
	"cancel_reason" text,
	"completed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_kds_batches_scope_id_unique" UNIQUE("organization_id","unit_id","id"),
	CONSTRAINT "pos_kds_batches_state_check" CHECK ((
        "pos_kds_batches"."status" = 'active'
        AND "pos_kds_batches"."completed_at" IS NULL
        AND "pos_kds_batches"."completed_by_identity_id" IS NULL
        AND "pos_kds_batches"."canceled_at" IS NULL
        AND "pos_kds_batches"."canceled_by_identity_id" IS NULL
        AND "pos_kds_batches"."completion_reason" IS NULL
        AND "pos_kds_batches"."cancel_reason" IS NULL
      ) OR (
        "pos_kds_batches"."status" = 'completed'
        AND "pos_kds_batches"."completed_at" IS NOT NULL
        AND "pos_kds_batches"."completed_by_identity_id" IS NOT NULL
        AND "pos_kds_batches"."canceled_at" IS NULL
        AND "pos_kds_batches"."canceled_by_identity_id" IS NULL
        AND "pos_kds_batches"."cancel_reason" IS NULL
      ) OR (
        "pos_kds_batches"."status" = 'canceled'
        AND "pos_kds_batches"."canceled_at" IS NOT NULL
        AND "pos_kds_batches"."canceled_by_identity_id" IS NOT NULL
        AND "pos_kds_batches"."cancel_reason" IS NOT NULL
        AND "pos_kds_batches"."completed_at" IS NULL
        AND "pos_kds_batches"."completed_by_identity_id" IS NULL
        AND "pos_kds_batches"."completion_reason" IS NULL
      ))
);
--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "block_code" varchar(40);--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "block_reason" text;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "blocked_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "unblocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "unblocked_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD COLUMN "block_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD CONSTRAINT "pos_kds_ticket_items_scope_unique" UNIQUE("organization_id","unit_id","ticket_id","order_item_id");--> statement-breakpoint
ALTER TABLE "pos_kds_attention_acknowledgements" ADD CONSTRAINT "pos_kds_attention_acknowledgements_acknowledged_by_identity_id_identities_id_fk" FOREIGN KEY ("acknowledged_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_attention_acknowledgements" ADD CONSTRAINT "pos_kds_attention_assignment_fk" FOREIGN KEY ("organization_id","unit_id","ticket_id","order_item_id") REFERENCES "public"."pos_kds_ticket_items"("organization_id","unit_id","ticket_id","order_item_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pos_kds_batch_assignments" ADD CONSTRAINT "pos_kds_batch_assignments_batch_fk" FOREIGN KEY ("organization_id","unit_id","batch_id") REFERENCES "public"."pos_kds_batches"("organization_id","unit_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_batch_assignments" ADD CONSTRAINT "pos_kds_batch_assignments_assignment_fk" FOREIGN KEY ("organization_id","unit_id","ticket_id","order_item_id") REFERENCES "public"."pos_kds_ticket_items"("organization_id","unit_id","ticket_id","order_item_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pos_kds_batches" ADD CONSTRAINT "pos_kds_batches_created_by_identity_id_identities_id_fk" FOREIGN KEY ("created_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_batches" ADD CONSTRAINT "pos_kds_batches_completed_by_identity_id_identities_id_fk" FOREIGN KEY ("completed_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_batches" ADD CONSTRAINT "pos_kds_batches_canceled_by_identity_id_identities_id_fk" FOREIGN KEY ("canceled_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_batches" ADD CONSTRAINT "pos_kds_batches_station_fk" FOREIGN KEY ("organization_id","unit_id","station_id") REFERENCES "public"."pos_production_stations"("organization_id","unit_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_batches" ADD CONSTRAINT "pos_kds_batches_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."pos_products"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_kds_attention_item_idx" ON "pos_kds_attention_acknowledgements" USING btree ("organization_id","unit_id","ticket_id","order_item_id","acknowledged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_kds_batch_assignments_active_unique" ON "pos_kds_batch_assignments" USING btree ("organization_id","unit_id","ticket_id","order_item_id") WHERE "pos_kds_batch_assignments"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pos_kds_batch_assignments_batch_idx" ON "pos_kds_batch_assignments" USING btree ("organization_id","unit_id","batch_id","position");--> statement-breakpoint
CREATE INDEX "pos_kds_batches_active_idx" ON "pos_kds_batches" USING btree ("organization_id","unit_id","station_id","status","created_at");--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD CONSTRAINT "pos_kds_ticket_items_blocked_by_identity_id_identities_id_fk" FOREIGN KEY ("blocked_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD CONSTRAINT "pos_kds_ticket_items_unblocked_by_identity_id_identities_id_fk" FOREIGN KEY ("unblocked_by_identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD CONSTRAINT "pos_kds_ticket_items_block_count_check" CHECK ("pos_kds_ticket_items"."block_count" >= 0);--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD CONSTRAINT "pos_kds_ticket_items_block_code_check" CHECK ("pos_kds_ticket_items"."block_code" IS NULL OR "pos_kds_ticket_items"."block_code" IN ('missing_ingredient', 'equipment_issue', 'quality_check', 'dependency', 'other'));--> statement-breakpoint
ALTER TABLE "pos_kds_ticket_items" ADD CONSTRAINT "pos_kds_ticket_items_block_state_check" CHECK ((
        "pos_kds_ticket_items"."blocked_at" IS NULL
        AND "pos_kds_ticket_items"."block_code" IS NULL
        AND "pos_kds_ticket_items"."block_reason" IS NULL
        AND "pos_kds_ticket_items"."blocked_by_identity_id" IS NULL
        AND "pos_kds_ticket_items"."unblocked_at" IS NULL
        AND "pos_kds_ticket_items"."unblocked_by_identity_id" IS NULL
      ) OR (
        "pos_kds_ticket_items"."blocked_at" IS NOT NULL
        AND "pos_kds_ticket_items"."block_code" IS NOT NULL
        AND "pos_kds_ticket_items"."block_reason" IS NOT NULL
        AND "pos_kds_ticket_items"."blocked_by_identity_id" IS NOT NULL
        AND (
          ("pos_kds_ticket_items"."unblocked_at" IS NULL AND "pos_kds_ticket_items"."unblocked_by_identity_id" IS NULL)
          OR (
            "pos_kds_ticket_items"."unblocked_at" IS NOT NULL
            AND "pos_kds_ticket_items"."unblocked_by_identity_id" IS NOT NULL
            AND "pos_kds_ticket_items"."unblocked_at" >= "pos_kds_ticket_items"."blocked_at"
          )
        )
      ));
