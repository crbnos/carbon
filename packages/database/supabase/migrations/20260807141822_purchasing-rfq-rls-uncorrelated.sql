-- Convert the purchasingRfq family off the deprecated per-row RLS helpers.
--
-- These five tables are the last in the schema still using the deprecated pair
-- of per-row helpers -- the permission check and the role check, each passed the
-- row's own "companyId" and ANDed together (verified against pg_policies: 16
-- policies, 5 tables, nothing else).
--
-- The permission helper is VOLATILE and SECURITY DEFINER, so Postgres must
-- re-evaluate it for every row it considers and cannot hoist it out of the scan
-- or use it in an index condition. The modern form passes the row's companyId to
-- an uncorrelated `= ANY (array)` whose array is produced once by a STABLE
-- helper in an InitPlan -- one call per query instead of one per row, and an
-- index-able ScalarArrayOpExpr.
--
-- Semantics are preserved exactly, which matters in two ways here:
--
--   1. SELECT keeps its PERMISSION gate. The old predicate gated on
--      'purchasing_view' via the deprecated helper, so this uses
--      get_companies_with_employee_permission('purchasing_view') and NOT
--      get_companies_with_employee_role(). The generic template in
--      conventions-database.md would suggest the latter, but that grants read to
--      any employee of the company and would widen access. The same choice was
--      made for `journal` and `purchaseOrder` in 20260228000000_rls-refactor-3.
--
--   2. Write access is preserved per table. purchasingRfqToPurchaseOrder and
--      purchasingRfqToSupplierQuote permitted only SELECT + INSERT -- they are
--      insert-only join tables that clean up via ON DELETE CASCADE. Their
--      UPDATE/DELETE are now spelled out as USING (false) rather than left
--      absent: RLS denies either way, but an explicit deny cannot be mistaken
--      for a policy someone dropped, which is exactly the ambiguity that made
--      the `rework` drift hard to read.
--
-- The old policies carried long descriptive names; they are recreated with the
-- standardized SELECT/INSERT/UPDATE/DELETE names, matching the rest of the
-- schema. Original definitions: 20260115143000_purchasing-rfq.sql lines 71-255,
-- unaltered by any later migration.
--
-- NOT dropping has_company_permission/has_role: 7 storage.objects policies and 5
-- functions (get_next_sequence, is_claims_admin, create_rfq_from_model_v1,
-- create_rfq_from_models_v1, create_rfq_from_models_v2) still call them.

-- purchasingRfq

DROP POLICY IF EXISTS "Employees with purchasing_view can view purchasingRfq" ON "public"."purchasingRfq";
DROP POLICY IF EXISTS "Employees with purchasing_create can insert purchasingRfq" ON "public"."purchasingRfq";
DROP POLICY IF EXISTS "Employees with purchasing_update can update purchasingRfq" ON "public"."purchasingRfq";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete purchasingRfq" ON "public"."purchasingRfq";

CREATE POLICY "SELECT" ON "public"."purchasingRfq"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."purchasingRfq"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."purchasingRfq"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."purchasingRfq"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_delete'))::text[])
);

-- purchasingRfqLine

DROP POLICY IF EXISTS "Employees with purchasing_view can view purchasingRfqLine" ON "public"."purchasingRfqLine";
DROP POLICY IF EXISTS "Employees with purchasing_create can insert purchasingRfqLine" ON "public"."purchasingRfqLine";
DROP POLICY IF EXISTS "Employees with purchasing_update can update purchasingRfqLine" ON "public"."purchasingRfqLine";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete purchasingRfqLine" ON "public"."purchasingRfqLine";

CREATE POLICY "SELECT" ON "public"."purchasingRfqLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."purchasingRfqLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."purchasingRfqLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."purchasingRfqLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_delete'))::text[])
);

-- purchasingRfqSupplier

DROP POLICY IF EXISTS "Employees with purchasing_view can view purchasingRfqSupplier" ON "public"."purchasingRfqSupplier";
DROP POLICY IF EXISTS "Employees with purchasing_create can insert purchasingRfqSupplier" ON "public"."purchasingRfqSupplier";
DROP POLICY IF EXISTS "Employees with purchasing_update can update purchasingRfqSupplier" ON "public"."purchasingRfqSupplier";
DROP POLICY IF EXISTS "Employees with purchasing_delete can delete purchasingRfqSupplier" ON "public"."purchasingRfqSupplier";

CREATE POLICY "SELECT" ON "public"."purchasingRfqSupplier"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."purchasingRfqSupplier"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."purchasingRfqSupplier"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."purchasingRfqSupplier"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_delete'))::text[])
);

-- purchasingRfqToSupplierQuote -- insert-only join table; UPDATE/DELETE denied explicitly

DROP POLICY IF EXISTS "Employees with purchasing_view can view purchasingRfqToSupplierQuote" ON "public"."purchasingRfqToSupplierQuote";
DROP POLICY IF EXISTS "Employees with purchasing_create can insert purchasingRfqToSupplierQuote" ON "public"."purchasingRfqToSupplierQuote";

CREATE POLICY "SELECT" ON "public"."purchasingRfqToSupplierQuote"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."purchasingRfqToSupplierQuote"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);

-- Explicit rather than absent. RLS already denies what no policy permits, so
-- these change nothing -- but this PR exists partly because `rework` drifted and
-- nobody could tell a deliberate omission from a lost policy. Say it out loud.
CREATE POLICY "UPDATE" ON "public"."purchasingRfqToSupplierQuote"
FOR UPDATE USING (false);

CREATE POLICY "DELETE" ON "public"."purchasingRfqToSupplierQuote"
FOR DELETE USING (false);

-- purchasingRfqToPurchaseOrder -- insert-only join table; UPDATE/DELETE denied explicitly

DROP POLICY IF EXISTS "Employees with purchasing_view can view purchasingRfqToPurchaseOrder" ON "public"."purchasingRfqToPurchaseOrder";
DROP POLICY IF EXISTS "Employees with purchasing_create can insert purchasingRfqToPurchaseOrder" ON "public"."purchasingRfqToPurchaseOrder";

CREATE POLICY "SELECT" ON "public"."purchasingRfqToPurchaseOrder"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."purchasingRfqToPurchaseOrder"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."purchasingRfqToPurchaseOrder"
FOR UPDATE USING (false);

CREATE POLICY "DELETE" ON "public"."purchasingRfqToPurchaseOrder"
FOR DELETE USING (false);

-- The new predicate is an index-able `companyId = ANY (array)`. purchasingRfqLine
-- and purchasingRfqSupplier had only parent-FK indexes; the other three tables
-- above already carry a companyId index from 20260115143000.
CREATE INDEX IF NOT EXISTS "purchasingRfqLine_companyId_idx"
  ON "purchasingRfqLine" ("companyId");

CREATE INDEX IF NOT EXISTS "purchasingRfqSupplier_companyId_idx"
  ON "purchasingRfqSupplier" ("companyId");
