INSERT INTO storage.buckets (id, name, public)
SELECT 
    id,
    id,
    false
FROM company;

-- Drop all existing storage.objects policies to avoid conflicts
DROP POLICY IF EXISTS "Employees can upload imports" ON storage.objects;
DROP POLICY IF EXISTS "Job documents insert requires employee role" ON storage.objects;
DROP POLICY IF EXISTS "Sales RFQ documents view requires sales_view" ON storage.objects;
DROP POLICY IF EXISTS "Sales RFQ documents insert requires sales_create" ON storage.objects;
DROP POLICY IF EXISTS "Sales RFQ documents update requires sales_update" ON storage.objects;
DROP POLICY IF EXISTS "Sales RFQ documents delete requires sales_delete" ON storage.objects;
DROP POLICY IF EXISTS "Sales RFQ line documents view requires sales_view" ON storage.objects;
DROP POLICY IF EXISTS "Sales RFQ line documents insert requires sales_create" ON storage.objects;
DROP POLICY IF EXISTS "Sales RFQ line documents update requires sales_update" ON storage.objects;
DROP POLICY IF EXISTS "Sales RFQ line documents delete requires sales_delete" ON storage.objects;
DROP POLICY IF EXISTS "Quote documents view requires sales_view" ON storage.objects;
DROP POLICY IF EXISTS "Quote line documents view requires sales_view" ON storage.objects;
DROP POLICY IF EXISTS "Quote documents insert requires sales_create" ON storage.objects;
DROP POLICY IF EXISTS "Quote line document insert requires sales_create" ON storage.objects;
DROP POLICY IF EXISTS "Quote documents update requires sales_update" ON storage.objects;
DROP POLICY IF EXISTS "Quote line documents update requires sales_update" ON storage.objects;
DROP POLICY IF EXISTS "Quote documents delete requires sales_delete" ON storage.objects;
DROP POLICY IF EXISTS "Quote line documents delete requires sales_delete" ON storage.objects;
DROP POLICY IF EXISTS "Internal purchasing documents view requires purchasing_view" ON storage.objects;
DROP POLICY IF EXISTS "Internal purchasing documents insert requires purchasing_create" ON storage.objects;
DROP POLICY IF EXISTS "Internal purchasing documents update requires purchasing_update" ON storage.objects;
DROP POLICY IF EXISTS "Internal purchasing documents delete requires purchasing_delete" ON storage.objects;
DROP POLICY IF EXISTS "External purchasing documents view requires purchasing_view" ON storage.objects;
DROP POLICY IF EXISTS "External purchasing documents insert requires purchasing_create" ON storage.objects;
DROP POLICY IF EXISTS "External purchasing documents update requires purchasing_update" ON storage.objects;
DROP POLICY IF EXISTS "External purchasing documents delete requires purchasing_delete" ON storage.objects;
DROP POLICY IF EXISTS "Employees can view internal parts documents" ON storage.objects;
DROP POLICY IF EXISTS "Internal parts documents insert requires parts_create" ON storage.objects;
DROP POLICY IF EXISTS "Internal parts documents update requires parts_update" ON storage.objects;
DROP POLICY IF EXISTS "Internal parts documents delete requires parts_delete" ON storage.objects;
DROP POLICY IF EXISTS "Opportunity documents view requires sales_view" ON storage.objects;
DROP POLICY IF EXISTS "Opportunity documents insert requires sales_create" ON storage.objects;
DROP POLICY IF EXISTS "Opportunity documents update requires sales_update" ON storage.objects;
DROP POLICY IF EXISTS "Opportunity documents delete requires sales_delete" ON storage.objects;
DROP POLICY IF EXISTS "Opportunity line document view requires sales_view" ON storage.objects;
DROP POLICY IF EXISTS "Opportunity line document insert requires sales_create" ON storage.objects;
DROP POLICY IF EXISTS "Opportunity line document update requires sales_update" ON storage.objects;
DROP POLICY IF EXISTS "Opportunity line document delete requires sales_delete" ON storage.objects;
DROP POLICY IF EXISTS "Job documents view requires production_view" ON storage.objects;
DROP POLICY IF EXISTS "Job documents insert requires production_create" ON storage.objects;
DROP POLICY IF EXISTS "Job documents update requires production_update" ON storage.objects;
DROP POLICY IF EXISTS "Job documents delete requires production_delete" ON storage.objects;
DROP POLICY IF EXISTS "Supplier interaction documents view requires purchasing_view" ON storage.objects;
DROP POLICY IF EXISTS "Supplier interaction documents insert requires purchasing_create" ON storage.objects;
DROP POLICY IF EXISTS "Supplier interaction documents update requires purchasing_update" ON storage.objects;
DROP POLICY IF EXISTS "Supplier interaction documents delete requires purchasing_delete" ON storage.objects;
DROP POLICY IF EXISTS "Supplier interaction line document view requires purchasing_view" ON storage.objects;
DROP POLICY IF EXISTS "Supplier interaction line document insert requires purchasing_create" ON storage.objects;
DROP POLICY IF EXISTS "Supplier interaction line document update requires purchasing_update" ON storage.objects;
DROP POLICY IF EXISTS "Supplier interaction line document delete requires purchasing_delete" ON storage.objects;
DROP POLICY IF EXISTS "Requests with an API key can view part models" ON storage.objects;
DROP POLICY IF EXISTS "Requests with an API key can upload models" ON storage.objects;
DROP POLICY IF EXISTS "Requests with an API key can update models" ON storage.objects;
DROP POLICY IF EXISTS "Requests with an API key can delete models" ON storage.objects;
DROP POLICY IF EXISTS "Private buckets view requires ownership or document.readGroups" ON storage.objects;
DROP POLICY IF EXISTS "Private buckets insert requires ownership or document.writeGroups" ON storage.objects;
DROP POLICY IF EXISTS "Private buckets update requires ownership or document.writeGroups" ON storage.objects;
DROP POLICY IF EXISTS "Private buckets delete requires ownership or document.writeGroups" ON storage.objects;
DROP POLICY IF EXISTS "Inventory document view requires inventory_view" ON storage.objects;
DROP POLICY IF EXISTS "Inventory document insert requires inventory_create" ON storage.objects;
DROP POLICY IF EXISTS "Inventory document update requires inventory_update" ON storage.objects;
DROP POLICY IF EXISTS "Inventory document delete requires inventory_delete" ON storage.objects;
DROP POLICY IF EXISTS "Company bucket access" ON storage.objects;
DROP POLICY IF EXISTS "Employees can view part models" ON storage.objects;
DROP POLICY IF EXISTS "Employees with parts_view can upload models" ON storage.objects;
DROP POLICY IF EXISTS "Employees with parts_update can update models" ON storage.objects;
DROP POLICY IF EXISTS "Employees with parts_delete can delete models" ON storage.objects;
DROP POLICY IF EXISTS "Employees can view item thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Thumbnail insert requires parts_update" ON storage.objects;
DROP POLICY IF EXISTS "Thumbnail update requires parts_update" ON storage.objects;
DROP POLICY IF EXISTS "Thumbnail delete requires parts_delete" ON storage.objects;

CREATE POLICY "Shared Private Bucket" ON storage.objects
FOR ALL USING (
    bucket_id = 'private'
    AND (storage.foldername(name))[1] = ANY (
        (
            SELECT
                get_companies_with_employee_role()
        )::text[]
    )
);

-- Create comprehensive policy for company buckets
CREATE POLICY "Company bucket access" ON storage.objects
FOR ALL USING (
  bucket_id = ANY (
    (
      SELECT
        get_companies_with_employee_role()
    )::text[]
  )
);


CREATE INDEX idx_objects_bucket_id ON storage.objects(bucket_id);