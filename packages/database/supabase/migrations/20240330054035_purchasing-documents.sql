-- Internal purchasing documents view

CREATE POLICY "Users with purchasing_view can view documents that start with purchasing" ON "document" 
  FOR SELECT USING (
    has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_view', (storage.foldername(name))[1])
    AND (storage.foldername(path))[2] = 'purchasing'
  );
  
CREATE POLICY "Users with purchasing_create can create documents that start with purchasing" ON "document" 
  FOR INSERT WITH CHECK (
    has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_create', (storage.foldername(name))[1])
    AND (storage.foldername(path))[2] = 'purchasing'
  );

CREATE POLICY "Users with purchasing_update can update documents that start with purchasing" ON "document"
  FOR UPDATE USING (
    has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_update', (storage.foldername(name))[1])
    AND (storage.foldername(path))[2] = 'purchasing'
  );

CREATE POLICY "Users with purchasing_delete can delete documents that start with purchasing" ON "document"
  FOR DELETE USING (
    has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('purchasing_delete', (storage.foldername(name))[1])
    AND (storage.foldername(path))[2] = 'purchasing'
  );

-- TODO: policies for suppliers

