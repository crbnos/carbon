-- get_item_used_in for several items in one call, so a change notice's impact
-- panel no longer opens one connection per affected item. Runs under the caller's RLS.
CREATE OR REPLACE FUNCTION get_items_used_in(item_ids TEXT[], company_id TEXT)
RETURNS TABLE ("itemId" TEXT, "usedIn" JSONB)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT ids."itemId", get_item_used_in(ids."itemId", company_id)
  FROM unnest(item_ids) AS ids("itemId");
$$;
