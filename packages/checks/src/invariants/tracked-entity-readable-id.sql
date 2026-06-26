-- invariant: every tracked entity has a readableId
-- returns rows that VIOLATE the rule (none = healthy)
SELECT "id", "companyId"
FROM "trackedEntity"
WHERE "readableId" IS NULL;
