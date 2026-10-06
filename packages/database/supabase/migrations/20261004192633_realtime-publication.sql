-- Realtime moves from postgres_changes to broadcast.
--
-- The broadcast functions, the realtime.messages policies and the triggers that
-- attach them are declared in packages/database/src (authz manifest,
-- event-system/functions, event-system/attachments.ts) and shipped by generated
-- migrations. This file removes the old path.

-- 1. Nothing subscribes to postgres_changes any more: empty the publication.
DO $$
DECLARE
  published RECORD;
BEGIN
  FOR published IN
    SELECT schemaname, tablename FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
  LOOP
    EXECUTE format(
      'ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I',
      published.schemaname, published.tablename
    );
  END LOOP;
END $$;
