-- Tighten pickingListLineTrackedEntity RLS so writes require the matching
-- inventory permission on the parent line's company, not merely line
-- visibility. The original policies (20260601143527_picking-lists.sql) gated
-- every operation on the same `EXISTS (pickingListLine WHERE id = …)`
-- predicate, so a user with only inventory_view could INSERT/UPDATE/DELETE
-- tracked-entity allocations. This table has no companyId column; it reaches
-- the company through pickingListLine.

DROP POLICY IF EXISTS "SELECT" ON "pickingListLineTrackedEntity";
CREATE POLICY "SELECT" ON "pickingListLineTrackedEntity"
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine" pll
    WHERE pll."id" = "pickingListLineId"
      AND pll."companyId" = ANY (
        (SELECT get_companies_with_employee_permission('inventory_view'))::text[]
      )
  )
);

DROP POLICY IF EXISTS "INSERT" ON "pickingListLineTrackedEntity";
CREATE POLICY "INSERT" ON "pickingListLineTrackedEntity"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "pickingListLine" pll
    WHERE pll."id" = "pickingListLineId"
      AND pll."companyId" = ANY (
        (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
      )
  )
);

DROP POLICY IF EXISTS "UPDATE" ON "pickingListLineTrackedEntity";
CREATE POLICY "UPDATE" ON "pickingListLineTrackedEntity"
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine" pll
    WHERE pll."id" = "pickingListLineId"
      AND pll."companyId" = ANY (
        (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
      )
  )
);

DROP POLICY IF EXISTS "DELETE" ON "pickingListLineTrackedEntity";
CREATE POLICY "DELETE" ON "pickingListLineTrackedEntity"
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM "pickingListLine" pll
    WHERE pll."id" = "pickingListLineId"
      AND pll."companyId" = ANY (
        (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
      )
  )
);
