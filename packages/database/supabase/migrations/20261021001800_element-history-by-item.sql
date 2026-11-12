-- The element history by part: what elements linked to an item have charged,
-- averaged per element. The element page's Budget section shows it.
CREATE OR REPLACE FUNCTION get_element_history_by_item(p_company_id TEXT, p_item_id TEXT)
RETURNS TABLE ("elementCount" INTEGER, "averageHours" NUMERIC, "averageMaterialCost" NUMERIC, "lastPostingDate" DATE)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM assert_company_access(p_company_id);
  RETURN QUERY
  WITH per_element AS (
    SELECT e."id",
           SUM(CASE WHEN l."costType" = 'Labor' THEN l."quantity" ELSE 0 END) AS hours,
           SUM(CASE WHEN l."costType" = 'Material' THEN l."amount" ELSE 0 END) AS material,
           MAX(l."postingDate") AS last_date
    FROM "projectElement" e
    JOIN "projectLedger" l ON l."projectElementId" = e."id" AND l."companyId" = e."companyId"
    WHERE e."companyId" = p_company_id AND e."itemId" = p_item_id
    GROUP BY e."id"
  )
  SELECT COUNT(*)::INTEGER, AVG(hours), AVG(material), MAX(last_date) FROM per_element;
END $$;
