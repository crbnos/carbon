-- A digest that `notify` wrote (payload.sourceEvent set, e.g. the weekly
-- training reminder) belongs to `notify`: the next run of that event marks it
-- read by that marker. The digest function now skips such digests, so this
-- check must skip them too, or it wakes the function every 15 minutes for work
-- it will not do.
CREATE OR REPLACE FUNCTION util.notification_digest_has_work()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT "userId", "companyId", "topic", count(*) AS total
    FROM "notification"
    WHERE "readAt" IS NULL
      AND "digestedInto" IS NULL
      AND "event" <> 'digest'
      AND "createdAt" < now() - interval '60 minutes'
    GROUP BY "userId", "companyId", "topic"
  ),
  digests AS (
    SELECT "userId", "companyId", "topic", count(*) AS total
    FROM "notification"
    WHERE "readAt" IS NULL
      AND "digestedInto" IS NULL
      AND "event" = 'digest'
      AND ("payload" ->> 'sourceEvent') IS NULL
    GROUP BY "userId", "companyId", "topic"
  )
  SELECT
    EXISTS (
      SELECT 1
      FROM candidates c
      LEFT JOIN digests d USING ("userId", "companyId", "topic")
      WHERE d.total IS NOT NULL OR c.total >= 5
    )
    OR EXISTS (SELECT 1 FROM digests WHERE total > 1)
    OR EXISTS (
      SELECT 1
      FROM "notification" d
      WHERE d."readAt" IS NULL
        AND d."digestedInto" IS NULL
        AND d."event" = 'digest'
        AND (d."payload" ->> 'sourceEvent') IS NULL
        AND (d."payload" ->> 'count') IS DISTINCT FROM (
          SELECT count(*)::text FROM "notification" c WHERE c."digestedInto" = d."id"
        )
    );
$$;
