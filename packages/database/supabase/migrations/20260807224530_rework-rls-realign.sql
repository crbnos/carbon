-- Realign `rework` RLS with the definitions in 20260527142837_rework.sql.
--
-- Production's policies do not match that migration. They were changed outside
-- the migration stream at some point, so the deployed authorization differs from
-- what the repository says it is -- found by restoring a production snapshot and
-- diffing pg_policies against the source.
--
--   verb    | production (restored 2026-08-07)          | 20260527142837 intends
--   --------+------------------------------------------+------------------------
--   SELECT  | employee AND member of the company        | production_view
--   INSERT  | employee AND member of the company        | production_create
--   UPDATE  | employee AND production_update            | production_update
--   DELETE  | (absent -- every delete denied)           | production_delete
--
-- So production is BROADER on read/insert (any employee of the company, not just
-- those granted production access) and NARROWER on delete (nobody can delete a
-- rework record at all). It also still calls the deprecated per-row helpers,
-- which is how it surfaced: after 20260807141822 converted the purchasingRfq
-- family, `rework` was the only thing left in public still using them.
--
-- This restores the migration's intent. Measured impact on the restored
-- snapshot, across the companies that actually have rework rows:
--
--   19 employees in those companies
--   16 hold production_view  -> read access unchanged
--    3 do NOT                -> LOSE read access to rework (this is the point:
--                              the repo gates rework on production access)
--   16 hold production_delete -> gain delete, which no one could do before
--
-- Written to converge from either state: on a database that already matches the
-- source (a fresh stack) the DROP/CREATE pairs are a no-op rewrite; on one
-- carrying the drift they replace it. Policy names are already the standardized
-- four in both.

DROP POLICY IF EXISTS "SELECT" ON "public"."rework";
DROP POLICY IF EXISTS "INSERT" ON "public"."rework";
DROP POLICY IF EXISTS "UPDATE" ON "public"."rework";
DROP POLICY IF EXISTS "DELETE" ON "public"."rework";

CREATE POLICY "SELECT" ON "public"."rework"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."rework"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."rework"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."rework"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('production_delete'))::text[])
);
