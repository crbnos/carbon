-- Realtime moves from postgres_changes to broadcast.
--
-- The broadcast functions, the realtime.messages policies and the triggers that
-- attach them are declared in packages/database/src (authz manifest,
-- event-system/functions, event-system/attachments.ts) and shipped by generated
-- migrations. This file removes the old path and adds the list checksums.

-- 1. Nothing subscribes to postgres_changes any more: empty the publication.
DO $$
DECLARE
  published RECORD;
BEGIN
  FOR published IN
    SELECT schemaname, tablename FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
  LOOP
    EXECUTE format(
      'ALTER PUBLICATION supabase_realtime DROP TABLE %I.%I',
      published.schemaname, published.tablename
    );
  END LOOP;
END $$;

-- 2. One hash per live list, over the rows the caller can read (SECURITY INVOKER,
-- so table RLS applies exactly as it does to the list fetch). The client compares
-- it with the hash stored beside its IndexedDB copy and skips the fetch on a match.
-- The columns are the ones each list selects (useLiveList definitions).
CREATE OR REPLACE FUNCTION public.list_checksums(p_company_id TEXT)
RETURNS TABLE (list TEXT, checksum TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT 'items', md5(coalesce(string_agg(md5(row(
      i."id", i."readableId", i."revision", i."readableIdWithRevision",
      i."unitOfMeasureCode", i."name", i."type", i."replenishmentSystem",
      i."active", i."itemTrackingType", s."supersessionMode", s."successorItemId"
    )::text), '' ORDER BY i."id"), ''))
  FROM "item" i
  LEFT JOIN "itemSupersession" s ON s."itemId" = i."id"
  WHERE i."companyId" = p_company_id
  UNION ALL
  SELECT 'mesItems', md5(coalesce(string_agg(md5(row(
      i."id", i."readableIdWithRevision", i."name", i."type",
      i."replenishmentSystem", i."itemTrackingType", i."active",
      i."thumbnailPath", m."thumbnailPath"
    )::text), '' ORDER BY i."id"), ''))
  FROM "item" i
  LEFT JOIN "modelUpload" m ON m."id" = i."modelUploadId"
  WHERE i."companyId" = p_company_id
  UNION ALL
  SELECT 'customers', md5(coalesce(string_agg(md5(row(
      "id", "name", "website", "readableId")::text), '' ORDER BY "id"), ''))
  FROM "customer" WHERE "companyId" = p_company_id
  UNION ALL
  SELECT 'suppliers', md5(coalesce(string_agg(md5(row(
      "id", "name", "website", "supplierStatus", "readableId")::text), '' ORDER BY "id"), ''))
  FROM "supplier" WHERE "companyId" = p_company_id
  UNION ALL
  SELECT 'people', md5(coalesce(string_agg(md5(row(
      "id", "name", "email", "avatarUrl", "active")::text), '' ORDER BY "id"), ''))
  FROM "employees" WHERE "companyId" = p_company_id;
$$;

REVOKE ALL ON FUNCTION public.list_checksums(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_checksums(TEXT) TO authenticated;
