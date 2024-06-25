-- Internal quote documents view

CREATE POLICY "Users with sales_view can view documents that start with quote" ON "document" 
  FOR SELECT USING (
    has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_view', (storage.foldername(name))[1])
    AND (storage.foldername(path))[2] = 'quote'
  );
  
CREATE POLICY "Users with sales_create can create documents that start with quote" ON "document" 
  FOR INSERT WITH CHECK (
    has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_create', (storage.foldername(name))[1])
    AND (storage.foldername(path))[2] = 'quote'
  );

CREATE POLICY "Users with sales_update can update documents that start with quote" ON "document"
  FOR UPDATE USING (
    has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_update', (storage.foldername(name))[1])
    AND (storage.foldername(path))[2] = 'quote'
  );

CREATE POLICY "Users with sales_delete can delete documents that start with quote" ON "document"
  FOR DELETE USING (
    has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('sales_delete', (storage.foldername(name))[1])
    AND (storage.foldername(path))[2] = 'quote'
  );

-- TODO: policies for suppliers

