-- A foreign restore or backup import remapped "projectElementId" but kept the
-- source company's "projectId" on these rows (the remap missed the composite FK).
-- The composite FK to "projectElement"(id, "projectId", "companyId") fixes the one
-- valid value: the element's own project. Only mismatched rows change.

UPDATE "projectElementCost" r
SET "projectId" = pe."projectId"
FROM "projectElement" pe
WHERE pe."id" = r."projectElementId"
  AND pe."companyId" = r."companyId"
  AND r."projectId" IS DISTINCT FROM pe."projectId";

UPDATE "projectElementLabor" r
SET "projectId" = pe."projectId"
FROM "projectElement" pe
WHERE pe."id" = r."projectElementId"
  AND pe."companyId" = r."companyId"
  AND r."projectId" IS DISTINCT FROM pe."projectId";

UPDATE "projectElementMaterial" r
SET "projectId" = pe."projectId"
FROM "projectElement" pe
WHERE pe."id" = r."projectElementId"
  AND pe."companyId" = r."companyId"
  AND r."projectId" IS DISTINCT FROM pe."projectId";

-- A link has two composite FKs, one per end: repair it only when both elements
-- are in the same project, the only value both accept.
UPDATE "projectElementLink" r
SET "projectId" = pe."projectId"
FROM "projectElement" pe, "projectElement" pt
WHERE pe."id" = r."fromElementId"
  AND pe."companyId" = r."companyId"
  AND pt."id" = r."toElementId"
  AND pt."companyId" = r."companyId"
  AND pt."projectId" = pe."projectId"
  AND r."projectId" IS DISTINCT FROM pe."projectId";
