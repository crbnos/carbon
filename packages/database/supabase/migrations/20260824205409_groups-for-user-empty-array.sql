-- groups_for_user must never return NULL. `array_agg` over an empty set returns
-- NULL, so a valid authenticated user with zero memberships (an enterprise/
-- self-hosted first-run user, before onboarding creates their company) yielded
-- NULL, which the /x shell loader treated as an auth failure and logged out —
-- making onboarding unreachable. COALESCE to an empty array so "no groups" is a
-- well-formed result, not NULL. Same name / signature / SECURITY DEFINER /
-- search_path as 20230123004632_groups.sql; RLS `= ANY(groups_for_user(...))`
-- treats NULL and '{}' identically, so no policy is affected.
CREATE OR REPLACE FUNCTION groups_for_user(uid text) RETURNS TEXT[]
  LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE retval TEXT[];
  BEGIN
    WITH RECURSIVE "groupsForUser" AS (
      SELECT "groupId", "memberGroupId", "memberUserId" FROM "membership"
      WHERE "memberUserId" = uid::text
      UNION
        SELECT g1."groupId", g1."memberGroupId", g1."memberUserId" FROM "membership" g1
        INNER JOIN "groupsForUser" g2 ON g2."groupId" = g1."memberGroupId"
    ) SELECT COALESCE(array_agg("groupId"), '{}') INTO retval FROM "groupsForUser";

    RETURN retval;
  END;
$$;
