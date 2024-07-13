-- Search
ALTER TYPE "searchEntity" ADD VALUE 'Sales RFQ';
COMMIT;

CREATE FUNCTION public.create_sales_rfq_search_result()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.search(name, entity, uuid, link, "companyId")
  VALUES (new."rfqId", 'Sales RFQ', new.id, '/x/sales-rfq/' || new.id, new."companyId");
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_sales_rfq_search_result
  AFTER INSERT on public."salesRfq"
  FOR EACH ROW EXECUTE PROCEDURE public.create_sales_rfq_search_result();

CREATE FUNCTION public.update_sales_rfq_search_result()
RETURNS TRIGGER AS $$
BEGIN
  IF (old."rfqId" <> new."rfqId") THEN
    UPDATE public.search SET name = new."rfqId"
    WHERE entity = 'Sales RFQ' AND uuid = new.id AND "companyId" = new."companyId";
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_sales_rfq_search_result
  AFTER UPDATE on public."salesRfq"
  FOR EACH ROW EXECUTE PROCEDURE public.update_sales_rfq_search_result();

CREATE FUNCTION public.delete_sales_rfq_search_result()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.search WHERE entity = 'Sales RFQ' AND uuid = old.id AND "companyId" = old."companyId";
  RETURN old;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER delete_sales_rfq_search_result
  AFTER DELETE on public."salesRfq"
  FOR EACH ROW EXECUTE PROCEDURE public.delete_sales_rfq_search_result();
  


CREATE POLICY "Employees with sales_view can search for sales rfqs" ON "search"
  FOR SELECT
  USING (
    has_company_permission('sales_view', "companyId") AND 
    entity IN ('Sales RFQ') AND 
    has_role('employee', "companyId")
  );



-- Custom Fields

INSERT INTO "customFieldTable" ("table", "name", "module") 
VALUES ('salesRfq', 'RFQ (Sales)', 'Sales');

INSERT INTO "customFieldTable" ("table", "name", "module")
VALUES ('salesRfqLine', 'RFQ Line (Sales)', 'Sales');

-- RLS
ALTER TABLE "salesRfq" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees with sales_view can view sales rfqs" ON "salesRfq"
  FOR SELECT
  USING (
    has_company_permission('sales_view', "companyId") AND 
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with sales_create can create sales rfqs" ON "salesRfq"
  FOR INSERT
  WITH CHECK (
    has_company_permission('sales_create', "companyId") AND 
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with sales_update can edit sales rfqs" ON "salesRfq"
  FOR UPDATE
  USING (
    has_company_permission('sales_update', "companyId") AND 
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with sales_delete can delete sales rfqs" ON "salesRfq"
  FOR DELETE
  USING (
    has_company_permission('sales_delete', "companyId") AND 
    has_role('employee', "companyId")
  );

CREATE POLICY "Customer with sales_view can view their own sales rfqs" ON "salesRfq"
  FOR SELECT
  USING (
    has_company_permission('sales_view', "companyId") AND 
    has_role('customer', "companyId") AND 
    "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
    )
  );

ALTER TABLE "salesRfq" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Employees with sales_view can view sales rfq lines" ON "salesRfqLine"
  FOR SELECT
  USING (
    has_company_permission('sales_view', "companyId") AND 
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with sales_create can create sales rfq lines" ON "salesRfqLine"
  FOR INSERT
  WITH CHECK (
    has_company_permission('sales_create', "companyId") AND 
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with sales_update can edit sales rfq lines" ON "salesRfqLine"
  FOR UPDATE
  USING (
    has_company_permission('sales_update', "companyId") AND 
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with sales_delete can delete sales rfq lines" ON "salesRfqLine"
  FOR DELETE
  USING (
    has_company_permission('sales_delete', "companyId") AND 
    has_role('employee', "companyId")
  );

CREATE POLICY "Customers with sales_view can their own purchase order lines" ON "salesRfqLine"
  FOR SELECT
  USING (
    has_company_permission('sales_view', "companyId") AND
    has_role('customer', "companyId") AND
    "salesRfqId" IN (
      SELECT id FROM "salesRfq" WHERE "customerId" IN (
        SELECT "customerId" FROM "salesRfq" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
        )
      )
    )
  );