-- A log of which rows changed, so a client that kept a copy of a list (items,
-- customers, suppliers, people) can ask for the changes since it last looked and
-- re-read only those rows — not the whole table on every page load.
--
-- Written by the log_table_changes / log_user_changes statement handlers
-- (packages/database/src/event-system/functions, attached in attachments.ts);
-- read through table_changes_since below. Its RLS rule (no API access) is in
-- the authz manifest.

-- UNLOGGED: it skips WAL, so the extra insert on each write to a list table is
-- cheap. The price is that a crash empties it. A reader detects that by the
-- "epoch" below and falls back to a full fetch
-- (20261005053648_table-change-epoch.sql replaced the server's start time,
-- which a backend crash does not change, with a token the same crash empties).
CREATE UNLOGGED TABLE IF NOT EXISTS "tableChange" (
  "id" BIGINT GENERATED ALWAYS AS IDENTITY,
  "companyId" TEXT NOT NULL,
  "table" TEXT NOT NULL,
  -- NULL: more than 100 rows of the table changed in one statement.
  "rowId" TEXT,
  -- The writing transaction. The cursor a reader keeps is a transaction id, not
  -- this table's "id": ids are handed out before commit, so a reader that
  -- remembered "the highest id I saw" would skip a row whose transaction
  -- committed late. A snapshot's xmin has no such gap.
  "xid" XID8 NOT NULL DEFAULT pg_current_xact_id(),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- No foreign key to "company": see 20261004213812_table-change-drop-company-fk.sql.
  CONSTRAINT "tableChange_pkey" PRIMARY KEY ("id", "companyId")
);

CREATE INDEX IF NOT EXISTS "tableChange_companyId_xid_idx" ON "tableChange" ("companyId", "xid");
CREATE INDEX IF NOT EXISTS "tableChange_createdAt_idx" ON "tableChange" ("createdAt");

-- How long a change stays in the log. A reader whose last look is older than
-- this (less a day of margin) is told to fetch everything again.
CREATE OR REPLACE FUNCTION util.table_change_retention()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '7 days' $$;

-- The changes to a company's tables since a cursor.
--
-- Call it with no cursor the first time: it answers "reset" (fetch everything)
-- and hands back a cursor. Pass that cursor (xid, epoch, at) on the next call.
--
--   reset    true when the log cannot answer for that cursor: there is none, the
--            server restarted since it was issued (a crash empties the log), or
--            it is older than the retention.
--   changes  { "<table>": ["<rowId>", ...] | null } — null means "that table
--            changed too much to list: read it again". A row may be listed
--            again on a later call; re-reading it is harmless.
--   xid, epoch, at   the cursor for the next call.
--
-- STABLE is load-bearing: the read of the log and pg_current_snapshot() then
-- share the calling statement's snapshot. As VOLATILE each would take its own,
-- and a change committed between the two would be skipped for good.
--
-- SECURITY DEFINER because the table has no API access; it checks the caller's
-- company itself. What it reveals is row ids, the same as a realtime broadcast.
CREATE OR REPLACE FUNCTION public.table_changes_since(
  p_company_id TEXT,
  p_xid TEXT DEFAULT NULL,
  p_epoch TEXT DEFAULT NULL,
  p_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_epoch TEXT := extract(epoch FROM pg_postmaster_start_time())::TEXT;
  v_reset BOOLEAN;
  v_changes JSONB := '{}'::JSONB;
BEGIN
  IF NOT (p_company_id = ANY (COALESCE(get_companies_with_employee_role(), ARRAY[]::TEXT[]))) THEN
    RAISE EXCEPTION 'Not a member of this company' USING ERRCODE = '42501';
  END IF;

  v_reset := p_xid IS NULL
    OR p_epoch IS DISTINCT FROM v_epoch
    OR p_at IS NULL
    OR p_at < NOW() - (util.table_change_retention() - interval '1 day');

  IF NOT v_reset THEN
    SELECT COALESCE(jsonb_object_agg(c."table", c.ids), '{}'::JSONB)
      INTO v_changes
      FROM (
        SELECT "table",
               CASE WHEN bool_or("rowId" IS NULL) THEN NULL
                    ELSE to_jsonb(array_agg(DISTINCT "rowId")) END AS ids
          FROM "tableChange"
         WHERE "companyId" = p_company_id AND "xid" >= p_xid::XID8
         GROUP BY "table"
      ) c;
  END IF;

  RETURN jsonb_build_object(
    'reset', v_reset,
    'changes', v_changes,
    -- Every transaction older than the snapshot's xmin has finished, so every
    -- change it logged is visible above. Anything at or after it is asked for
    -- again next time.
    'xid', pg_snapshot_xmin(pg_current_snapshot())::TEXT,
    'epoch', v_epoch,
    'at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.table_changes_since(TEXT, TEXT, TEXT, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.table_changes_since(TEXT, TEXT, TEXT, TIMESTAMP WITH TIME ZONE) TO authenticated;

-- Retention, hourly.
CREATE OR REPLACE FUNCTION util.purge_table_changes()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM "tableChange" WHERE "createdAt" < NOW() - util.table_change_retention();
$$;

REVOKE ALL ON FUNCTION util.purge_table_changes() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'table-change-retention') THEN
    PERFORM cron.unschedule('table-change-retention');
  END IF;
  PERFORM cron.schedule('table-change-retention', '17 * * * *', 'SELECT util.purge_table_changes();');
END;
$$;
