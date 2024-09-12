DROP POLICY IF EXISTS "Certain employees can view the parts ledger" ON public."itemLedger";
CREATE POLICY "Certain employees can view the parts ledger" ON "itemLedger"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    (
      has_company_permission('inventory_view', "companyId") OR
      has_company_permission('accounting_view', "companyId")
    )
  );

  CREATE POLICY "Certain employees can insert into the parts ledger" ON "itemLedger"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    (
      has_company_permission('inventory_create', "companyId") OR
      has_company_permission('accounting_create', "companyId")
    )
  );

DROP POLICY IF EXISTS "Requests with an API key can access item ledger" ON "itemLedger";
CREATE POLICY "Requests with an API key can view item ledger" ON "itemLedger"
FOR SELECT USING (
  has_valid_api_key_for_company("companyId")
);

CREATE POLICY "Requests with an API key can insert into item ledger" ON "itemLedger"
FOR INSERT WITH CHECK (
  has_valid_api_key_for_company("companyId")
);