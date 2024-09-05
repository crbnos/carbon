DROP POLICY "Employees with sales_create can insert opportunities" ON "opportunity";
CREATE POLICY "Employees with sales_create can insert opportunities" ON "opportunity" FOR INSERT WITH CHECK (
  has_company_permission('sales_create', "companyId") AND
  has_role('employee', "companyId")
);

DROP POLICY "Employees with sales_create can update opportunities" ON "opportunity";
CREATE POLICY "Employees with sales_create can update opportunities" ON "opportunity" FOR UPDATE USING (
  has_company_permission('sales_update', "companyId") AND
  has_role('employee', "companyId")
);