-- Tables whose owning page is in another module than the module their policy
-- checked before page permissions. The conversion (20261110050003) wrote module
-- grants from the old module checkboxes, so a role that wrote demandForecast
-- through Inventory would lose it: the table now belongs to Production's
-- Material Planning page. Mirrors 20261110050005 (Printing → settings.printing).
--
-- Where the new page is essentially the moved table's own home, each module
-- grant on the old module becomes a page grant on it, at the same level, capped
-- at the page's maxLevel. Where the new page owns much more (the item pages,
-- Shipments, Quotes, Quantities, Storage Rules, Quality Documents, Workflows,
-- Sales Orders), no grant is given: the new page lists the table in
-- `alsoWrittenBy` with the page that wrote it before (access/pages), so its
-- write rule accepts that page too and nobody loses it. Each moved table is
-- one or the other: authz/registry-sql.test.ts reads the rows below.
--
-- A subject that already holds a grant on the new page, or on its module,
-- keeps what it has. A person's override is carried too (None included, when
-- their role holds the old module), so it still beats their role on the new
-- page; it is skipped when their role already holds the new page or module,
-- which decided the page before as well. Re-running is safe: ON CONFLICT DO
-- NOTHING, and a subject holding the page is skipped.

WITH moved (old_module, new_module, page, cap) AS (
  VALUES
  -- Each page here owns the moved tables and next to nothing else.
  ('Accounting', 'Parts', 'parts.itemGroups', 'Full'), -- itemPostingGroup, the page's only table
  ('Accounting', 'Settings', 'settings.accounting', 'Full'), -- accountingCutoverIgnoredInvoice; its routes are the activation wizard, which Accounting gated before
  ('Inventory', 'Production', 'production.demandForecasts', 'Full'), -- demandProjection, the page's only table
  ('Inventory', 'Production', 'production.materialPlanning', 'Full'), -- demandActual, demandForecast, demandForecastSource, supplyActual, supplyForecast; besides them only planningAction, which nobody writes through the API
  ('Parts', 'Inventory', 'inventory.storageTypes', 'Full'), -- storageType, the page's only table
  ('Parts', 'Inventory', 'inventory.storageUnits', 'Full'), -- storageUnit, the page's only table
  ('People', 'Resources', 'resources.assignments', 'Full'), -- trainingAssignment, trainingCompletion: the page's only tables
  ('People', 'Resources', 'resources.training', 'Full'), -- trainingQuestion; besides it only training, whose questions are its content
  ('Resources', 'People', 'people.attributes', 'Full'), -- userAttribute, userAttributeCategory, userAttributeValue: the page's only tables
  ('Settings', 'Accounting', 'accounting.fiscalYear', 'Full')  -- fiscalYearSettings, the page's only table
),
typed AS (
  SELECT old_module::"module", new_module::"module", page, cap::"permissionLevel" FROM moved
),
candidate AS (
  SELECT p."companyId", p."employeeTypeId", p."userId", p."apiKeyId",
    m.new_module, m.page, LEAST(p.level, m.cap) AS level
  FROM "permission" p
  JOIN typed m ON m.old_module = p."module"
  WHERE p."page" IS NULL
    -- A role or key at None has nothing to carry; a person's None is an override.
    AND (p.level <> 'None' OR (p."userId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM employee e
      JOIN "permission" r ON r."employeeTypeId" = e."employeeTypeId" AND r."companyId" = e."companyId"
      WHERE e.id = p."userId" AND e."companyId" = p."companyId"
        AND r."module" = m.old_module AND r."page" IS NULL AND r.level <> 'None'
    )))
    -- The subject already holds the page or its module.
    AND NOT EXISTS (
      SELECT 1 FROM "permission" s
      WHERE s."companyId" = p."companyId"
        AND s."employeeTypeId" IS NOT DISTINCT FROM p."employeeTypeId"
        AND s."userId" IS NOT DISTINCT FROM p."userId"
        AND s."apiKeyId" IS NOT DISTINCT FROM p."apiKeyId"
        AND s."module" = m.new_module
        AND (s."page" IS NULL OR s."page" = m.page)
    )
    -- A person whose role holds the page or its module: the role decided it before.
    AND (p."userId" IS NULL OR NOT EXISTS (
      SELECT 1 FROM employee e
      JOIN "permission" r ON r."employeeTypeId" = e."employeeTypeId" AND r."companyId" = e."companyId"
      WHERE e.id = p."userId" AND e."companyId" = p."companyId"
        AND r."module" = m.new_module
        AND (r."page" IS NULL OR r."page" = m.page)
    ))
)
INSERT INTO "permission" ("companyId", "employeeTypeId", "userId", "apiKeyId", "module", "page", "level", "createdBy")
SELECT c."companyId", c."employeeTypeId", c."userId", c."apiKeyId", c.new_module, c.page,
  max(c.level), COALESCE(cg."ownerId", 'system')
FROM candidate c
JOIN company co ON co.id = c."companyId"
JOIN "companyGroup" cg ON cg.id = co."companyGroupId"
GROUP BY c."companyId", c."employeeTypeId", c."userId", c."apiKeyId", c.new_module, c.page, cg."ownerId"
ON CONFLICT ON CONSTRAINT "permission_unique" DO NOTHING;
