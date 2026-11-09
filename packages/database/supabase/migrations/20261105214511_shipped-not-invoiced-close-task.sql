-- The "Invoice shipped sales orders" close task.
--
-- A sales shipment posts cost of goods sold when it posts; the sales invoice
-- posts the revenue when it posts. Nothing warned when a period end fell
-- between the two, so a period could carry the cost of a sale and the next
-- period its revenue. This Auto task (`shipped-not-invoiced` in
-- `computePeriodReadiness`, accounting.service.ts) warns while a sales order
-- shipment posted in the period has a line with no posted sales invoice dated
-- on or before the period end. An Auto task with no evaluator fails closed and
-- blocks every close, so this row ships with its evaluator. New companies get
-- the row from `periodCloseTaskDefinitions` (seed-data.ts).

INSERT INTO "periodCloseTaskDefinition"
  ("companyId", "name", "taskType", "autoCheckKey", "sortOrder", "required", "severity", "active", "isSystem", "createdBy")
SELECT c."id", 'Invoice shipped sales orders', 'Auto', 'shipped-not-invoiced', 10, true, 'Warning', true, true, 'system'
FROM "company" c
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = 'system')
  AND NOT EXISTS (
    SELECT 1 FROM "periodCloseTaskDefinition" d
    WHERE d."companyId" = c.id AND d."autoCheckKey" = 'shipped-not-invoiced'
  );
