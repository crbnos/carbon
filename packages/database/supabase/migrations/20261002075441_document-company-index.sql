-- Every documents query filters by company, but "document" had no index on
-- "companyId", so each one scanned every company's documents.
CREATE INDEX IF NOT EXISTS "document_companyId_active_idx"
  ON "document" ("companyId", "active");

-- The file-type filter's options for one company. Replaces reading the
-- "documentExtensions" view, a DISTINCT over every document the caller can
-- read in any company. SECURITY INVOKER: the document policies still apply.
CREATE OR REPLACE FUNCTION public.get_document_extensions(company_id TEXT)
RETURNS TABLE (extension TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT d.extension
  FROM "document" d
  WHERE d."companyId" = company_id
    AND d.extension IS NOT NULL
  ORDER BY d.extension
$$;
