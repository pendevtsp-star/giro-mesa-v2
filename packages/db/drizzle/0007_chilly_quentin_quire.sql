ALTER TABLE "pos_idempotency_receipts" ALTER COLUMN "actor_identity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_orders" ALTER COLUMN "created_by_identity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_tab_events" ALTER COLUMN "actor_identity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_tabs" ALTER COLUMN "opened_by_identity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "identities" ADD COLUMN "kind" varchar(20) DEFAULT 'human' NOT NULL;