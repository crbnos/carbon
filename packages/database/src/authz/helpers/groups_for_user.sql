CREATE OR REPLACE FUNCTION public.groups_for_user(uid text)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE retval TEXT[];
  BEGIN
    WITH RECURSIVE "groupsForUser" AS (
      SELECT "groupId", "memberGroupId", "memberUserId" FROM "membership"
      WHERE "memberUserId" = uid::text
      UNION
        SELECT g1."groupId", g1."memberGroupId", g1."memberUserId" FROM "membership" g1
        INNER JOIN "groupsForUser" g2 ON g2."groupId" = g1."memberGroupId"
    ) SELECT COALESCE(array_agg("groupId"), '{}') INTO retval FROM "groupsForUser";

    -- Someone else's groups: only those in a company the caller belongs to.
    IF current_setting('role', true) IN ('anon', 'authenticated')
       AND uid IS DISTINCT FROM auth.uid()::text THEN
      SELECT COALESCE(array_agg(g.id), '{}') INTO retval
      FROM "group" g
      WHERE g.id = ANY (retval)
        AND g."companyId" = ANY (get_companies_with_employee_role());
    END IF;

    RETURN retval;
  END;
$function$;
