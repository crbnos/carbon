-- User-select rewrite: purpose-built, non-recursive, company-scoped group reads.
-- Replaces the recursive "groups" view on the user-select hot path.
-- SECURITY INVOKER: membership/user RLS applies to the caller.
-- plpgsql (not LANGUAGE sql) so the internal ORDER BY survives PostgREST.

CREATE OR REPLACE FUNCTION get_user_select_groups(
  p_company_id TEXT,
  p_type TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
) RETURNS TABLE (
  "id" TEXT,
  "name" TEXT,
  "isEmployeeTypeGroup" BOOLEAN,
  "isCustomerOrgGroup" BOOLEAN,
  "isCustomerTypeGroup" BOOLEAN,
  "isSupplierOrgGroup" BOOLEAN,
  "isSupplierTypeGroup" BOOLEAN,
  "userCount" INT,
  "groupCount" INT,
  "isRoot" BOOLEAN
) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  -- Deterministic per-company root group ids. Must match the expressions in
  -- 20230123004632_groups.sql (create_employee_type_group / create_customer_type_group /
  -- create_supplier_type_group triggers).
  _roots TEXT[] := ARRAY[
    '00000000-0000-' || substring(p_company_id, 1, 4) || '-' || substring(p_company_id, 5, 4) || '-' || substring(p_company_id, 9, 12),
    '11111111-1111-' || substring(p_company_id, 1, 4) || '-' || substring(p_company_id, 5, 4) || '-' || substring(p_company_id, 9, 12),
    '22222222-2222-' || substring(p_company_id, 1, 4) || '-' || substring(p_company_id, 5, 4) || '-' || substring(p_company_id, 9, 12)
  ];
BEGIN
  RETURN QUERY
  SELECT
    g."id",
    g."name",
    g."isEmployeeTypeGroup",
    g."isCustomerOrgGroup",
    g."isCustomerTypeGroup",
    g."isSupplierOrgGroup",
    g."isSupplierTypeGroup",
    (SELECT count(*)::INT FROM "membership" m
       JOIN "user" u ON u."id" = m."memberUserId"
      WHERE m."groupId" = g."id" AND u."active" = TRUE)              AS "userCount",
    (SELECT count(*)::INT FROM "membership" m
      WHERE m."groupId" = g."id" AND m."memberGroupId" IS NOT NULL)  AS "groupCount",
    (g."id" = ANY(_roots))                                           AS "isRoot"
  FROM "group" g
  WHERE g."companyId" = p_company_id
    AND g."isIdentityGroup" = FALSE
    AND CASE
      WHEN p_type = 'employee' THEN NOT (
        g."isCustomerOrgGroup" OR g."isCustomerTypeGroup"
        OR g."isSupplierOrgGroup" OR g."isSupplierTypeGroup")
      WHEN p_type = 'customer' THEN (g."isCustomerTypeGroup" OR g."isCustomerOrgGroup")
      WHEN p_type = 'supplier' THEN (g."isSupplierTypeGroup" OR g."isSupplierOrgGroup")
      ELSE TRUE
    END
    AND CASE
      WHEN p_search IS NOT NULL AND p_search <> ''
        -- search mode: any depth, flat
        THEN g."name" ILIKE '%' || p_search || '%'
        -- browse mode: top-level only (roots, children of roots, parentless groups)
      ELSE (
        g."id" = ANY(_roots)
        OR EXISTS (SELECT 1 FROM "membership" m
                    WHERE m."memberGroupId" = g."id" AND m."groupId" = ANY(_roots))
        OR NOT EXISTS (SELECT 1 FROM "membership" m WHERE m."memberGroupId" = g."id")
      )
    END
  ORDER BY
    (g."id" = ANY(_roots)) DESC,
    (g."isEmployeeTypeGroup" OR g."isCustomerTypeGroup" OR g."isSupplierTypeGroup") DESC,
    g."name" ASC,
    g."id" ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- Direct members of one group: child groups (with counts) + direct active users.
CREATE OR REPLACE FUNCTION get_user_select_group_members(
  p_company_id TEXT,
  p_group_id TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  _result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "group" g
    WHERE g."id" = p_group_id AND g."companyId" = p_company_id
  ) THEN
    RETURN jsonb_build_object('groups', '[]'::jsonb, 'users', '[]'::jsonb);
  END IF;

  SELECT jsonb_build_object(
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cg."id",
        'name', cg."name",
        'isEmployeeTypeGroup', cg."isEmployeeTypeGroup",
        'isCustomerOrgGroup', cg."isCustomerOrgGroup",
        'isCustomerTypeGroup', cg."isCustomerTypeGroup",
        'isSupplierOrgGroup', cg."isSupplierOrgGroup",
        'isSupplierTypeGroup', cg."isSupplierTypeGroup",
        'userCount', (SELECT count(*)::INT FROM "membership" m2
                        JOIN "user" u2 ON u2."id" = m2."memberUserId"
                       WHERE m2."groupId" = cg."id" AND u2."active" = TRUE),
        'groupCount', (SELECT count(*)::INT FROM "membership" m3
                        WHERE m3."groupId" = cg."id" AND m3."memberGroupId" IS NOT NULL)
      ) ORDER BY cg."name" ASC, cg."id" ASC)
      FROM "membership" m
      JOIN "group" cg ON cg."id" = m."memberGroupId"
      WHERE m."groupId" = p_group_id
        AND m."memberGroupId" IS NOT NULL
        AND cg."isIdentityGroup" = FALSE
    ), '[]'::jsonb),
    'users', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u."id",
        'firstName', u."firstName",
        'lastName', u."lastName",
        'fullName', u."fullName",
        'email', u."email",
        'avatarUrl', u."avatarUrl"
      ) ORDER BY u."lastName" ASC, u."firstName" ASC, u."id" ASC)
      FROM "membership" m
      JOIN "user" u ON u."id" = m."memberUserId"
      WHERE m."groupId" = p_group_id
        AND m."memberUserId" IS NOT NULL
        AND u."active" = TRUE
    ), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END;
$$;

NOTIFY pgrst, 'reload schema';
