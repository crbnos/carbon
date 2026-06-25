-- apiKeyRateLimit shipped without RLS but is exposed through PostgREST, so any
-- authenticated user could read every company's rate-limit counters or POST to
-- tamper with them. It is an internal counter table written only by
-- check_api_key_rate_limit() (SECURITY DEFINER, bypasses RLS), so enabling RLS
-- does not affect rate limiting. It has no companyId column, so reach the owning
-- company through the parent apiKey.

ALTER TABLE "public"."apiKeyRateLimit" ENABLE ROW LEVEL SECURITY;

-- Read: employees who can view API keys, scoped to the parent key's company.
CREATE POLICY "SELECT" ON "public"."apiKeyRateLimit"
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM "apiKey" k
    WHERE k."id" = "apiKeyRateLimit"."apiKeyId"
      AND k."companyId" = ANY (
        (SELECT get_companies_with_employee_permission('settings_view'))::text[]
      )
  )
);

-- No INSERT/UPDATE/DELETE policies: counters are written exclusively by the
-- SECURITY DEFINER function check_api_key_rate_limit() (and the service role),
-- both of which bypass RLS. Tenant clients must never write this table directly,
-- so RLS leaves writes denied.
