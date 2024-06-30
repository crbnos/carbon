CREATE TABLE "requestForQuote" (
  "id" TEXT NOT NULL DEFAULT xid(),
  CONSTRAINT "requestForQuote_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "item" ADD COLUMN "thumbnailPath" TEXT;

CREATE TABLE "modelUpload" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "modelPath" TEXT,
  "autodeskUrn" TEXT,
  "itemId" TEXT,
  -- "requestForQuoteId" TEXT,
  -- "quoteId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "updatedBy" TEXT,

  CONSTRAINT "modelUpload_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "modelUpload_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item" ("id"),
  -- CONSTRAINT "modelUpload_requestForQuoteId_fkey" FOREIGN KEY ("requestForQuoteId") REFERENCES "requestForQuote" ("id"),
  -- CONSTRAINT "modelUpload_quoteId_fkey" FOREIGN KEY ("quote") REFERENCES "quote" ("id"),
  CONSTRAINT "modelUpload_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id"),
  CONSTRAINT "modelUpload_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id"),
  CONSTRAINT "modelUpload_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id")
);

-- Parts documents
CREATE POLICY "Employees can view part models" ON storage.objects 
FOR SELECT USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'models'
);

CREATE POLICY "Employees with parts_view can upload models" ON storage.objects 
FOR INSERT WITH CHECK (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('parts_create', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'models'
);

CREATE POLICY "Employees with parts_update can update models" ON storage.objects 
FOR UPDATE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('parts_update', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'models'
);

CREATE POLICY "Employees with parts_delete can delete models" ON storage.objects 
FOR DELETE USING (
    bucket_id = 'private'
    AND has_role('employee', (storage.foldername(name))[1])
    AND has_company_permission('parts_delete', (storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = 'models'
);
