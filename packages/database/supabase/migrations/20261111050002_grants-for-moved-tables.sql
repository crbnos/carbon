-- Printing grants became settings.printing grants in place (20261110050005). A
-- person's own Settings grant beats their role's page grant, so a person without
-- their own Printing grant gets the role's level as a person grant.
--
-- The other moved tables get no grant: a grant on a page of the new module reads
-- every table of that module (RLS reads are module-wide). They stay reachable via
-- `alsoWrittenBy` / `readers`, checked by @carbon/checks `moved-tables-covered`.
--
-- Re-running is safe: a person already at the role's level is skipped.

INSERT INTO "permission" ("companyId", "userId", "module", "page", "level", "createdBy")
SELECT e."companyId", e.id, 'Settings', 'settings.printing', r.level, COALESCE(cg."ownerId", 'system')
FROM employee e
JOIN "permission" r ON r."companyId" = e."companyId"
  AND r."employeeTypeId" = e."employeeTypeId" AND r."page" = 'settings.printing'
JOIN company co ON co.id = e."companyId"
JOIN "companyGroup" cg ON cg.id = co."companyGroupId"
WHERE util.access_level(e.id, NULL, e."companyId", 'settings.printing') < r.level
ON CONFLICT ON CONSTRAINT "permission_unique" DO NOTHING;
