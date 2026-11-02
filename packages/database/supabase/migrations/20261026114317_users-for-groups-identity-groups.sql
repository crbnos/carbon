-- A person picked directly on a training assignment is stored as their own
-- identity group, which has no companyId. The API guard kept only groups of
-- the caller's companies, so it dropped every identity group and the
-- assignment listed nobody. Keep an identity group when its user belongs to
-- one of the caller's companies.
CREATE OR REPLACE FUNCTION public.users_for_groups(groups text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    retval jsonb;
    caller_companies text[];
  BEGIN
    IF current_setting('role', true) IN ('anon', 'authenticated') THEN
      caller_companies := get_companies_with_employee_role();
      groups := ARRAY(
        SELECT g.id FROM "group" g
        WHERE g.id = ANY (groups)
          AND (
            g."companyId" = ANY (caller_companies)
            OR (
              g."isIdentityGroup"
              AND EXISTS (
                SELECT 1 FROM "userToCompany" uc
                WHERE uc."userId" = g.id
                  AND uc."companyId" = ANY (caller_companies)
              )
            )
          )
      );
    END IF;

    WITH RECURSIVE "usersForGroups" AS (
    SELECT "groupId", "memberGroupId", "memberUserId" FROM "membership"
    WHERE "groupId" = ANY(groups)
    UNION
      SELECT g1."groupId", g1."memberGroupId", g1."memberUserId" FROM "membership" g1
      INNER JOIN "usersForGroups" g2 ON g2."memberGroupId" = g1."groupId"
    ) SELECT coalesce(jsonb_agg("memberUserId"), '[]') AS groups INTO retval FROM "usersForGroups" WHERE "memberUserId" IS NOT NULL;
    RETURN retval;
  END;
$function$;
