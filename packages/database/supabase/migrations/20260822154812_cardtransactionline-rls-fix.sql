-- ============================================================
-- Fix cardTransactionLine RLS: qualify the outer FK column
--
-- The original policies (20260820143726) wrote the Draft-parent guard as
--   EXISTS (SELECT 1 FROM "cardTransaction" ct
--           WHERE ct."id" = "cardTransactionId" AND ct."status" = 'Draft')
-- but "cardTransaction" ALSO has a column named "cardTransactionId" (the readable
-- id), so the unqualified reference bound to the INNER scope (ct."cardTransactionId")
-- instead of the outer cardTransactionLine FK. The predicate collapsed to
-- ct."id" = ct."cardTransactionId" (an xid compared to a CARD-… string) — false for
-- every row, so EXISTS was always false and the policies unconditionally DENIED all
-- RLS'd line writes. Masked today only because the sync writes lines as the service
-- role (RLS bypassed). Recreate the three write policies with the outer column
-- explicitly qualified.
-- ============================================================

DROP POLICY IF EXISTS "INSERT" ON "public"."cardTransactionLine";
CREATE POLICY "INSERT" ON "public"."cardTransactionLine"
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "cardTransaction" ct
    WHERE ct."id" = "cardTransactionLine"."cardTransactionId" AND ct."status" = 'Draft'
  ) AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
  )
);

DROP POLICY IF EXISTS "UPDATE" ON "public"."cardTransactionLine";
CREATE POLICY "UPDATE" ON "public"."cardTransactionLine"
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM "cardTransaction" ct
    WHERE ct."id" = "cardTransactionLine"."cardTransactionId" AND ct."status" = 'Draft'
  ) AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
  )
);

DROP POLICY IF EXISTS "DELETE" ON "public"."cardTransactionLine";
CREATE POLICY "DELETE" ON "public"."cardTransactionLine"
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM "cardTransaction" ct
    WHERE ct."id" = "cardTransactionLine"."cardTransactionId" AND ct."status" = 'Draft'
  ) AND
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
  )
);
