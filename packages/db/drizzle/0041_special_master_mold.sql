ALTER TABLE "pos_tabs"
ADD COLUMN IF NOT EXISTS "ready_notification_consent" boolean DEFAULT false NOT NULL;
