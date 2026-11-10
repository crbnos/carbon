-- A company's API keys together were held to a fixed 60 requests per minute.
-- `companyPlan."apiRateLimit"` now overrides that for one company. It lives on
-- companyPlan because only the platform writes that table: tenants have a
-- SELECT policy and no other, and company backups never carry it. NULL keeps
-- the platform default, so changing the default later needs no backfill.

ALTER TABLE "companyPlan" ADD COLUMN "apiRateLimit" INTEGER;

ALTER TABLE "companyPlan" ADD CONSTRAINT "companyPlan_apiRateLimit_positive"
  CHECK ("apiRateLimit" > 0);

COMMENT ON COLUMN "companyPlan"."apiRateLimit" IS
  'Requests per minute across all of the company''s API keys. NULL is the platform default (60).';

-- Same signature and return shape as 20261002153217, so the Node
-- `requirePermissions` path and the edge functions need no code change. The
-- only change is where the company limit comes from.
CREATE OR REPLACE FUNCTION check_api_key_rate_limit(
  p_api_key_id TEXT,
  p_limit INTEGER,
  p_window TEXT  -- '1m', '1h', '1d'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  -- Requests per minute across all of one company's keys, unless its
  -- companyPlan row sets "apiRateLimit".
  v_default_company_limit CONSTANT INTEGER := 60;
  v_minute CONSTANT TIMESTAMPTZ := date_trunc('minute', NOW());
  v_window_start TIMESTAMPTZ;
  v_interval INTERVAL;
  v_count INTEGER;
  v_company_id TEXT;
  v_company_limit INTEGER;
  v_company_count INTEGER;
BEGIN
  v_interval := CASE p_window
    WHEN '1m' THEN INTERVAL '1 minute'
    WHEN '1h' THEN INTERVAL '1 hour'
    WHEN '1d' THEN INTERVAL '1 day'
    ELSE INTERVAL '1 hour'
  END;

  v_window_start := date_trunc(
    CASE p_window
      WHEN '1m' THEN 'minute'
      WHEN '1h' THEN 'hour'
      WHEN '1d' THEN 'day'
      ELSE 'hour'
    END,
    NOW()
  );

  -- Atomic upsert: insert or increment counter in one statement
  INSERT INTO "apiKeyRateLimit" ("apiKeyId", "windowStart", "requestCount")
  VALUES (p_api_key_id, v_window_start, 1)
  ON CONFLICT ("apiKeyId", "windowStart")
  DO UPDATE SET "requestCount" = "apiKeyRateLimit"."requestCount" + 1
  RETURNING "requestCount" INTO v_count;

  -- Every API-key request passes through here, on the Node path and in the edge
  -- functions, so this is the one place that records use. At most one write per
  -- key per minute.
  UPDATE "apiKey" SET "lastUsedAt" = NOW()
  WHERE "id" = p_api_key_id
    AND ("lastUsedAt" IS NULL OR "lastUsedAt" < v_minute);

  -- A company with no companyPlan row (self-hosted, or Carbon-owned on Cloud)
  -- gets the default.
  SELECT k."companyId", COALESCE(p."apiRateLimit", v_default_company_limit)
  INTO v_company_id, v_company_limit
  FROM "apiKey" k
  LEFT JOIN "companyPlan" p ON p."id" = k."companyId"
  WHERE k."id" = p_api_key_id;

  -- Probabilistic cleanup: ~1% of requests clean up expired windows
  IF random() < 0.01 THEN
    DELETE FROM "apiKeyRateLimit"
    WHERE "apiKeyId" = p_api_key_id
      AND "windowStart" < v_window_start;
  END IF;

  -- The company total is the sum of its keys' counters for this minute, so it
  -- needs no table of its own. Each key counts up to its own limit only: a
  -- counter keeps rising while its key is being refused, and those refused
  -- requests must not lock the company's other keys out.
  -- Two known ceilings, both fixed by a dedicated per-company counter table:
  -- deleting a key drops its share of the total (the counters cascade), and a
  -- key on an hourly or daily window is not counted (none exist: the window is
  -- platform-controlled and every key is '1m').
  SELECT COALESCE(SUM(LEAST(r."requestCount", k."rateLimit")), 0)
  INTO v_company_count
  FROM "apiKey" k
  JOIN "apiKeyRateLimit" r
    ON r."apiKeyId" = k."id" AND r."windowStart" = v_minute
  WHERE k."companyId" = v_company_id;

  IF v_count <= p_limit AND v_company_count > v_company_limit THEN
    RETURN jsonb_build_object(
      'success', false,
      'count', v_company_count,
      'limit', v_company_limit,
      'remaining', 0,
      'resetAt', EXTRACT(EPOCH FROM (v_minute + INTERVAL '1 minute'))::BIGINT * 1000
    );
  END IF;

  RETURN jsonb_build_object(
    'success', v_count <= p_limit,
    'count', v_count,
    'limit', p_limit,
    'remaining', GREATEST(
      LEAST(p_limit - v_count, v_company_limit - v_company_count),
      0
    ),
    'resetAt', EXTRACT(EPOCH FROM (v_window_start + v_interval))::BIGINT * 1000
  );
END;
$$;
