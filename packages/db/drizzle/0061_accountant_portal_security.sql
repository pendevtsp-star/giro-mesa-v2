ALTER TABLE "accountant_requests" ADD COLUMN "target_audience" varchar(20);--> statement-breakpoint
UPDATE "accountant_requests" AS request
SET "target_audience" = CASE
  WHEN EXISTS (
    SELECT 1
    FROM "memberships" AS membership
    INNER JOIN "role_bindings" AS binding ON binding."membership_id" = membership."id"
    WHERE membership."identity_id" = request."created_by_identity_id"
      AND membership."organization_id" = request."organization_id"
      AND membership."status" = 'active'
      AND binding."role"::text = 'accountant'
      AND (binding."unit_id" IS NULL OR binding."unit_id" = request."unit_id")
  ) THEN 'establishment'
  ELSE 'accountant'
END;--> statement-breakpoint
ALTER TABLE "accountant_requests" ALTER COLUMN "target_audience" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accountant_requests" ADD CONSTRAINT "accountant_requests_target_audience_check" CHECK ("accountant_requests"."target_audience" IN ('accountant', 'establishment'));
