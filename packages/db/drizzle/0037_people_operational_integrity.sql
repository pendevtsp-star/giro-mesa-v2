CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum value
    JOIN pg_type type ON type.oid = value.enumtypid
    WHERE type.typname = 'management_time_tracking_closure_status' AND value.enumlabel = 'reopened'
  ) THEN
    ALTER TABLE "management_time_tracking_closures" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TYPE "public"."management_time_tracking_closure_status" RENAME TO "management_time_tracking_closure_status_legacy";
    CREATE TYPE "public"."management_time_tracking_closure_status" AS ENUM ('closed', 'reopened');
    ALTER TABLE "management_time_tracking_closures" ALTER COLUMN "status" TYPE "public"."management_time_tracking_closure_status" USING "status"::text::"public"."management_time_tracking_closure_status";
    ALTER TABLE "management_time_tracking_closures" ALTER COLUMN "status" SET DEFAULT 'closed';
    DROP TYPE "public"."management_time_tracking_closure_status_legacy";
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "management_people" ADD COLUMN IF NOT EXISTS "updated_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_people" ADD COLUMN IF NOT EXISTS "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_people" ADD COLUMN IF NOT EXISTS "status_changed_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_people" ADD COLUMN IF NOT EXISTS "status_change_reason" varchar(1000);--> statement-breakpoint

ALTER TABLE "management_schedules" ADD COLUMN IF NOT EXISTS "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_schedules" ADD COLUMN IF NOT EXISTS "canceled_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_schedules" ADD COLUMN IF NOT EXISTS "cancellation_reason" varchar(1000);--> statement-breakpoint

ALTER TABLE "management_commissions" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_commissions" ADD COLUMN IF NOT EXISTS "reviewed_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_commissions" ADD COLUMN IF NOT EXISTS "review_note" varchar(1000);--> statement-breakpoint
ALTER TABLE "management_commissions" ADD COLUMN IF NOT EXISTS "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_commissions" ADD COLUMN IF NOT EXISTS "paid_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_commissions" ADD COLUMN IF NOT EXISTS "payment_note" varchar(1000);--> statement-breakpoint
ALTER TABLE "management_commissions" ADD COLUMN IF NOT EXISTS "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_commissions" ADD COLUMN IF NOT EXISTS "canceled_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_commissions" ADD COLUMN IF NOT EXISTS "cancellation_reason" varchar(1000);--> statement-breakpoint

ALTER TABLE "management_time_tracking_closures" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(160);--> statement-breakpoint
ALTER TABLE "management_time_tracking_closures" ADD COLUMN IF NOT EXISTS "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "management_time_tracking_closures" ADD COLUMN IF NOT EXISTS "reopened_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "management_time_tracking_closures" ADD COLUMN IF NOT EXISTS "reopen_reason" varchar(1000);--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_people_updated_by_identity_id_identities_id_fk') THEN
    ALTER TABLE "management_people" ADD CONSTRAINT "management_people_updated_by_identity_id_identities_id_fk" FOREIGN KEY ("updated_by_identity_id") REFERENCES "public"."identities"("id");
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = LEFT('management_people_status_changed_by_identity_id_identities_id_fk', 63)) THEN
    ALTER TABLE "management_people" ADD CONSTRAINT "management_people_status_changed_by_identity_id_identities_id_fk" FOREIGN KEY ("status_changed_by_identity_id") REFERENCES "public"."identities"("id");
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_schedules_canceled_by_identity_id_identities_id_fk') THEN
    ALTER TABLE "management_schedules" ADD CONSTRAINT "management_schedules_canceled_by_identity_id_identities_id_fk" FOREIGN KEY ("canceled_by_identity_id") REFERENCES "public"."identities"("id");
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_commissions_reviewed_by_identity_id_identities_id_fk') THEN
    ALTER TABLE "management_commissions" ADD CONSTRAINT "management_commissions_reviewed_by_identity_id_identities_id_fk" FOREIGN KEY ("reviewed_by_identity_id") REFERENCES "public"."identities"("id");
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_commissions_paid_by_identity_id_identities_id_fk') THEN
    ALTER TABLE "management_commissions" ADD CONSTRAINT "management_commissions_paid_by_identity_id_identities_id_fk" FOREIGN KEY ("paid_by_identity_id") REFERENCES "public"."identities"("id");
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_commissions_canceled_by_identity_id_identities_id_fk') THEN
    ALTER TABLE "management_commissions" ADD CONSTRAINT "management_commissions_canceled_by_identity_id_identities_id_fk" FOREIGN KEY ("canceled_by_identity_id") REFERENCES "public"."identities"("id");
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = LEFT('management_time_tracking_closures_reopened_by_identity_id_identities_id_fk', 63)) THEN
    ALTER TABLE "management_time_tracking_closures" ADD CONSTRAINT "management_time_tracking_closures_reopened_by_identity_id_identities_id_fk" FOREIGN KEY ("reopened_by_identity_id") REFERENCES "public"."identities"("id");
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_people_status_actor_check') THEN
    ALTER TABLE "management_people" ADD CONSTRAINT "management_people_status_actor_check" CHECK (("status_changed_at" IS NULL AND "status_changed_by_identity_id" IS NULL) OR ("status_changed_at" IS NOT NULL AND "status_changed_by_identity_id" IS NOT NULL));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_people_inactive_reason_check') THEN
    -- ponytail: legacy inactive rows have no trustworthy actor; validate after an audited backfill.
    ALTER TABLE "management_people" ADD CONSTRAINT "management_people_inactive_reason_check" CHECK ("active" OR ("status_changed_at" IS NOT NULL AND "status_changed_by_identity_id" IS NOT NULL AND NULLIF(BTRIM("status_change_reason"), '') IS NOT NULL)) NOT VALID;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_schedules_cancellation_check') THEN
    ALTER TABLE "management_schedules" ADD CONSTRAINT "management_schedules_cancellation_check" CHECK (("canceled_at" IS NULL AND "canceled_by_identity_id" IS NULL AND "cancellation_reason" IS NULL) OR ("canceled_at" IS NOT NULL AND "canceled_by_identity_id" IS NOT NULL AND NULLIF(BTRIM("cancellation_reason"), '') IS NOT NULL));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_commissions_status_check') THEN
    ALTER TABLE "management_commissions" ADD CONSTRAINT "management_commissions_status_check" CHECK ("status" IN ('pending','approved','rejected','paid','canceled'));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_commissions_actor_pairs_check') THEN
    ALTER TABLE "management_commissions" ADD CONSTRAINT "management_commissions_actor_pairs_check" CHECK ((("reviewed_at" IS NULL) = ("reviewed_by_identity_id" IS NULL)) AND (("paid_at" IS NULL) = ("paid_by_identity_id" IS NULL)) AND (("canceled_at" IS NULL) = ("canceled_by_identity_id" IS NULL)));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_commissions_lifecycle_check') THEN
    ALTER TABLE "management_commissions" ADD CONSTRAINT "management_commissions_lifecycle_check" CHECK (("status" = 'pending' AND "reviewed_at" IS NULL AND "paid_at" IS NULL AND "canceled_at" IS NULL) OR ("status" = 'approved' AND "reviewed_at" IS NOT NULL AND "reviewed_by_identity_id" IS NOT NULL AND "paid_at" IS NULL AND "canceled_at" IS NULL) OR ("status" = 'rejected' AND "reviewed_at" IS NOT NULL AND "reviewed_by_identity_id" IS NOT NULL AND NULLIF(BTRIM("review_note"), '') IS NOT NULL AND "paid_at" IS NULL AND "canceled_at" IS NULL) OR ("status" = 'paid' AND "reviewed_at" IS NOT NULL AND "reviewed_by_identity_id" IS NOT NULL AND "paid_at" IS NOT NULL AND "paid_by_identity_id" IS NOT NULL AND "canceled_at" IS NULL) OR ("status" = 'canceled' AND "paid_at" IS NULL AND "canceled_at" IS NOT NULL AND "canceled_by_identity_id" IS NOT NULL AND NULLIF(BTRIM("cancellation_reason"), '') IS NOT NULL));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_time_tracking_closure_lifecycle_check') THEN
    ALTER TABLE "management_time_tracking_closures" ADD CONSTRAINT "management_time_tracking_closure_lifecycle_check" CHECK (("status" = 'closed' AND "reopened_at" IS NULL AND "reopened_by_identity_id" IS NULL AND "reopen_reason" IS NULL) OR ("status" = 'reopened' AND "reopened_at" IS NOT NULL AND "reopened_by_identity_id" IS NOT NULL AND NULLIF(BTRIM("reopen_reason"), '') IS NOT NULL));
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "management_time_tracking_closure_idempotency_unique" ON "management_time_tracking_closures" ("organization_id", "unit_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_schedules_no_overlap_excl') THEN
    ALTER TABLE "management_schedules" ADD CONSTRAINT "management_schedules_no_overlap_excl" EXCLUDE USING gist (
      "organization_id" WITH =,
      "unit_id" WITH =,
      "person_id" WITH =,
      tstzrange("starts_at", "ends_at", '[)') WITH &&
    ) WHERE ("canceled_at" IS NULL);
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'management_time_tracking_closure_no_overlap_excl') THEN
    ALTER TABLE "management_time_tracking_closures" ADD CONSTRAINT "management_time_tracking_closure_no_overlap_excl" EXCLUDE USING gist (
      "organization_id" WITH =,
      "unit_id" WITH =,
      daterange("period_start", "period_end", '[]') WITH &&
    ) WHERE ("status" = 'closed');
  END IF;
END $$;
