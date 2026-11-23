-- Government Contracting 5a: the "Timesheets complete" close task.
--
-- An Auto task with no evaluator fails closed and blocks every close, so this
-- row ships with its evaluator (`timesheets-complete` in
-- `computePeriodReadiness`, accounting.service.ts). In Standard timekeeping
-- the check always passes; in DCAA mode it warns while an entry dated in the
-- period is not Posted or a scheduled work day in it has no time entered.
-- New companies get the row from `periodCloseTaskDefinitions` (seed-data.ts).

INSERT INTO "periodCloseTaskDefinition"
  ("companyId", "name", "taskType", "autoCheckKey", "sortOrder", "required", "severity", "active", "isSystem", "createdBy")
SELECT c."id", 'Timesheets complete', 'Auto', 'timesheets-complete', 9, true, 'Warning', true, true, 'system'
FROM "company" c
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = 'system')
  AND NOT EXISTS (
    SELECT 1 FROM "periodCloseTaskDefinition" d
    WHERE d."companyId" = c.id AND d.name = 'Timesheets complete'
  );
