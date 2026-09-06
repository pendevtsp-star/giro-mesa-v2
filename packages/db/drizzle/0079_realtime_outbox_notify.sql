CREATE OR REPLACE FUNCTION notify_realtime_outbox_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM pg_notify('giromesa_realtime_outbox', NEW.id::text);
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER outbox_events_realtime_notify
AFTER INSERT ON outbox_events
FOR EACH ROW
EXECUTE FUNCTION notify_realtime_outbox_insert();
