ALTER TABLE "pos_payment_reversals" ALTER COLUMN "payment_attempt_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "pos_payment_reversals" ALTER COLUMN "installation_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "pos_payment_reversals" ADD CONSTRAINT "pos_payment_reversals_terminal_pair_check"
CHECK (("payment_attempt_id" IS NULL) = ("installation_id" IS NULL));
