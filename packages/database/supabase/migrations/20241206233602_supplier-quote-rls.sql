ALTER TABLE "supplierQuote" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view or purchasing_view can view supplier quotes" ON "supplierQuote"
  FOR SELECT
  USING (
    (
      has_company_permission('purchasing_view', "companyId") OR
      has_company_permission('purchasing_view', "companyId") OR
      has_company_permission('parts_view', "companyId")
    ) AND has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_create can create supplier quotes" ON "supplierQuote"
  FOR INSERT
  WITH CHECK (has_company_permission('purchasing_create', "companyId") AND has_role('employee', "companyId"));


CREATE POLICY "Employees with purchasing_update can update supplier quotes" ON "supplierQuote"
  FOR UPDATE
  USING (has_company_permission('purchasing_update', "companyId") AND has_role('employee', "companyId"));


CREATE POLICY "Employees with purchasing_delete can delete supplier quotes" ON "supplierQuote"
  FOR DELETE
  USING (has_company_permission('purchasing_delete', "companyId") AND has_role('employee', "companyId"));

CREATE POLICY "Requests with an API key can access supplier quotes" ON "supplierQuote"
  FOR ALL USING (
    has_valid_api_key_for_company("companyId")
  );


ALTER TABLE "supplierQuoteLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view supplier quote lines" ON "supplierQuoteLine"
  FOR SELECT
  USING (has_company_permission('purchasing_view', "companyId") AND has_role('employee', "companyId"));


CREATE POLICY "Employees with purchasing_create can create supplier quote lines" ON "supplierQuoteLine"
  FOR INSERT
  WITH CHECK (has_company_permission('purchasing_create', "companyId") AND has_role('employee', "companyId"));

CREATE POLICY "Suppliers with purchasing_create can create lines on their own supplier quote" ON "supplierQuoteLine"
  FOR INSERT
  WITH CHECK (
    has_company_permission('purchasing_create', "companyId") 
    AND has_role('supplier', "companyId") 
    AND "supplierQuoteId" IN (
      SELECT id FROM "supplierQuote" WHERE "supplierId" IN (
        SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
      )
    )
  );

CREATE POLICY "Employees with purchasing_update can update supplier quote lines" ON "supplierQuoteLine"
  FOR UPDATE
  USING (has_company_permission('purchasing_update', "companyId") AND has_role('employee', "companyId"));


CREATE POLICY "Employees with purchasing_delete can delete supplier quote lines" ON "supplierQuoteLine"
  FOR DELETE
  USING (has_company_permission('purchasing_delete', "companyId") AND has_role('employee', "companyId"));


CREATE POLICY "Requests with an API key can access supplier quotes" ON "supplierQuoteLine"
  FOR ALL USING (
    has_valid_api_key_for_company("companyId")
  );


ALTER TABLE "supplierQuoteLinePrice" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view supplier quote line pricing" ON "supplierQuoteLinePrice"
  FOR SELECT
  USING (has_company_permission('purchasing_view', get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote')) AND has_role('employee', get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote')));

CREATE POLICY "Suppliers with purchasing_view can view their own quote line pricing" ON "supplierQuoteLinePrice"
  FOR SELECT
  USING (
    has_company_permission('purchasing_view', get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote')) 
    AND has_role('supplier', get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote'))
    AND "supplierQuoteId" IN (
      SELECT id FROM "supplierQuote" WHERE "supplierId" IN (
        SELECT "supplierId" FROM "supplierAccount" WHERE id::uuid = auth.uid()
      )
    )
  );

CREATE POLICY "Employees with purchasing_create can insert supplier quote line pricing" ON "supplierQuoteLinePrice"
  FOR INSERT
  WITH CHECK (
    has_role('employee', get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote')) AND
    has_company_permission('purchasing_create', get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote'))
  );


CREATE POLICY "Employees with purchasing_update can update supplier quote line pricing" ON "supplierQuoteLinePrice"
  FOR UPDATE
  USING (
    has_role('employee', get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote')) AND
    has_company_permission('purchasing_update', get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote'))
  );


CREATE POLICY "Employees with purchasing_delete can delete supplier quote line pricing" ON "supplierQuoteLinePrice"
  FOR DELETE
  USING (
    has_role('employee', get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote')) AND
    has_company_permission('purchasing_delete', get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote'))
  );



CREATE POLICY "Requests with an API key can access supplier quote line pricing" ON "supplierQuoteLinePrice"
  FOR ALL USING (
    has_valid_api_key_for_company(get_company_id_from_foreign_key("supplierQuoteId", 'supplierQuote'))
  );


ALTER TABLE "supplierInteraction" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with purchasing_view can view supplier interactions" ON "supplierInteraction"
  FOR SELECT
  USING (has_company_permission('purchasing_view', "companyId") AND has_role('employee', "companyId"));

CREATE POLICY "Employees with purchasing_create can create supplier interactions" ON "supplierInteraction"
  FOR INSERT
  WITH CHECK (has_company_permission('purchasing_create', "companyId") AND has_role('employee', "companyId"));

CREATE POLICY "Employees with purchasing_update can update supplier interactions" ON "supplierInteraction"
  FOR UPDATE
  USING (has_company_permission('purchasing_update', "companyId") AND has_role('employee', "companyId"));

CREATE POLICY "Employees with purchasing_delete can delete supplier interactions" ON "supplierInteraction"
  FOR DELETE
  USING (has_company_permission('purchasing_delete', "companyId") AND has_role('employee', "companyId"));

CREATE POLICY "Requests with an API key can access supplier interactions" ON "supplierInteraction"
  FOR ALL USING (
    has_valid_api_key_for_company("companyId")
  );


CREATE POLICY "Supplier interaction documents view requires purchasing_view" ON storage.objects 
FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_view', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'supplier-interaction'
);

CREATE POLICY "Supplier interaction documents insert requires purchasing_create" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_create', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'supplier-interaction'
);

CREATE POLICY "Supplier interaction documents update requires purchasing_update" ON storage.objects 
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_update', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'supplier-interaction'
);

CREATE POLICY "Supplier interaction documents delete requires purchasing_delete" ON storage.objects 
FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_delete', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'supplier-interaction'
);

CREATE POLICY "Supplier interaction line document view requires purchasing_view" ON storage.objects 
FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_view', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'supplier-interaction-line'
);

CREATE POLICY "Supplier interaction line document insert requires purchasing_create" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_create', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'supplier-interaction-line'
);

CREATE POLICY "Supplier interaction line document update requires purchasing_update" ON storage.objects 
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_update', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'supplier-interaction-line'
);

CREATE POLICY "Supplier interaction line document delete requires purchasing_delete" ON storage.objects 
FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_delete', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'supplier-interaction-line'
);
