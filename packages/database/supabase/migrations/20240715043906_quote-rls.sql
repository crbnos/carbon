ALTER TABLE "quote" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view quotes" ON "quote"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_view', "companyId")
  );

CREATE POLICY "Customers with sales_view can their own quotes" ON "quote"
  FOR SELECT
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_view', "companyId") AND
    "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
    )
  );

CREATE POLICY "Employees with sales_create can create quotes" ON "quote"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    has_company_permission('sales_create', "companyId")
  );


CREATE POLICY "Employees with sales_update can update quotes" ON "quote"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_update', "companyId")
  );

CREATE POLICY "Customers with sales_update can their own quotes" ON "quote"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_update', "companyId") AND
    "customerId" IN (
      SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
    )
  );

CREATE POLICY "Employees with sales_delete can delete quotes" ON "quote"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_delete', "companyId")
  );


CREATE POLICY "Customers with sales_view can search for their own quotes" ON "search"
  FOR SELECT
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_view', "companyId") AND
    entity = 'Quotation'  AND
    uuid IN (
        SELECT id FROM "quote" WHERE "customerId" IN (
          SELECT "customerId" FROM "quote" WHERE "customerId" IN (
            SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
          )
        )
      )
  );

-- Quotation Lines

ALTER TABLE "quoteLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view quote lines" ON "quoteLine"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_view', "companyId")
  );

CREATE POLICY "Customers with sales_view can their own quote lines" ON "quoteLine"
  FOR SELECT
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_view', "companyId") AND
    "quoteId" IN (
      SELECT id FROM "quote" WHERE "customerId" IN (
        SELECT "customerId" FROM "quote" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Employees with sales_create can create quote lines" ON "quoteLine"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    has_company_permission('sales_create', "companyId")
  );

CREATE POLICY "Customers with sales_create can create lines on their own quote" ON "quoteLine"
  FOR INSERT
  WITH CHECK (
    has_role('customer', "companyId") AND
    has_company_permission('sales_create', "companyId") AND
    "quoteId" IN (
      SELECT id FROM "quote" WHERE "customerId" IN (
        SELECT "customerId" FROM "quote" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Employees with sales_update can update quote lines" ON "quoteLine"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_update', "companyId")
  );

CREATE POLICY "Customers with sales_update can their own quote lines" ON "quoteLine"
  FOR UPDATE
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_update', "companyId") AND
    "quoteId" IN (
      SELECT id FROM "quote" WHERE "customerId" IN (
        SELECT "customerId" FROM "quote" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Employees with sales_delete can delete quote lines" ON "quoteLine"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_delete', "companyId")
  );

CREATE POLICY "Customers with sales_delete can delete lines on their own quote" ON "quoteLine"
  FOR DELETE
  USING (
    has_role('customer', "companyId") AND
    has_company_permission('sales_delete', "companyId") AND
    "quoteId" IN (
      SELECT id FROM "quote" WHERE "customerId" IN (
        SELECT "customerId" FROM "quote" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
        )
      )
    )
  );

ALTER TABLE "quoteMakeMethod" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view quote make methods" ON "quoteMakeMethod"
  FOR SELECT
  USING (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_view', get_company_id_from_foreign_key("quoteId", 'quote'))  
  );

CREATE POLICY "Customers with sales_view can their own quote make methods" ON "quoteMakeMethod"
  FOR SELECT
  USING (
    has_role('customer', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_view', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    "quoteId" IN (
      SELECT id FROM "quote" WHERE "customerId" IN (
        SELECT "customerId" FROM "quote" WHERE "customerId" IN (
          SELECT "customerId" FROM "customerAccount" WHERE id::uuid = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Employees with sales_create can create quote make methods" ON "quoteMakeMethod"
  FOR INSERT
  WITH CHECK (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_create', get_company_id_from_foreign_key("quoteId", 'quote'))
  );

CREATE POLICY "Employees with sales_update can update quote make methods" ON "quoteMakeMethod"
  FOR UPDATE
  USING (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_update', get_company_id_from_foreign_key("quoteId", 'quote'))
  );

CREATE POLICY "Employees with sales_delete can delete quote make methods" ON "quoteMakeMethod"
  FOR DELETE
  USING (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_delete', get_company_id_from_foreign_key("quoteId", 'quote'))
  );

ALTER TABLE "quoteOperation" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view quote operations" ON "quoteOperation"
  FOR SELECT
  USING (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_view', get_company_id_from_foreign_key("quoteId", 'quote'))
  );



-- TODO: fix these kinds of policies where we pass a select statement to has_company_permission
CREATE POLICY "Employees with sales_create can create quote operations" ON "quoteOperation"
  FOR INSERT
  WITH CHECK (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_create', get_company_id_from_foreign_key("quoteId", 'quote'))
  );

CREATE POLICY "Employees with sales_update can update quote operations" ON "quoteOperation"
  FOR UPDATE
  USING (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_update', get_company_id_from_foreign_key("quoteId", 'quote'))
  );

CREATE POLICY "Employees with sales_delete can delete quote operations" ON "quoteOperation"
  FOR DELETE
  USING (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_delete', get_company_id_from_foreign_key("quoteId", 'quote'))
  );

ALTER TABLE "quoteMaterial" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view quote materials" ON "quoteMaterial"
  FOR SELECT
  USING (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_view', get_company_id_from_foreign_key("quoteId", 'quote'))
  );


CREATE POLICY "Employees with sales_create can create quote materials" ON "quoteMaterial"
  FOR INSERT
  WITH CHECK (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_create', get_company_id_from_foreign_key("quoteId", 'quote'))
  );

CREATE POLICY "Employees with sales_update can update quote materials" ON "quoteMaterial"
  FOR UPDATE
  USING (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_update', get_company_id_from_foreign_key("quoteId", 'quote'))
  );

CREATE POLICY "Employees with sales_delete can delete quote materials" ON "quoteMaterial"
  FOR DELETE
  USING (
    has_role('employee', get_company_id_from_foreign_key("quoteId", 'quote')) AND
    has_company_permission('sales_delete', get_company_id_from_foreign_key("quoteId", 'quote'))
  );



-- Search

CREATE FUNCTION public.create_quotation_search_result()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.search(name, entity, uuid, link, "companyId")
  VALUES (new."quoteId",  'Quotation', new.id, '/x/quote/' || new.id, new."companyId");
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_quotation_search_result
  AFTER INSERT on public."quote"
  FOR EACH ROW EXECUTE PROCEDURE public.create_quotation_search_result();

CREATE OR REPLACE FUNCTION public.update_quotation_search_result()
RETURNS TRIGGER AS $$
BEGIN
  IF (old."quoteId" <> new."quoteId") THEN
    UPDATE public.search SET name = new."quoteId"
    WHERE entity = 'Quotation' AND uuid = new.id AND "companyId" = new."companyId";
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER update_quotation_search_result
  AFTER UPDATE on public."quote"
  FOR EACH ROW EXECUTE PROCEDURE public.update_quotation_search_result();

CREATE FUNCTION public.delete_quotation_search_result()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.search WHERE entity = 'Quotation' AND uuid = old.id AND "companyId" = old."companyId";
  RETURN old;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER delete_quotation_search_result
  AFTER DELETE on public."quote"
  FOR EACH ROW EXECUTE PROCEDURE public.delete_quotation_search_result();