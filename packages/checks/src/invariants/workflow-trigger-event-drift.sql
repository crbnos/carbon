-- invariant: an active workflow's workflowTriggerEvent rows equal the event ids
-- on its active version's trigger nodes; returns violating rows (none = healthy)
WITH active AS (
    SELECT w."id" AS "workflowId",
           w."companyId",
           w."activeVersionId",
           v."nodes"
    FROM "workflow" w
    JOIN "workflowVersion" v
        ON v."id" = w."activeVersionId"
       AND v."companyId" = w."companyId"
    WHERE w."active" = TRUE
),
declared AS (
    SELECT a."workflowId",
           a."companyId",
           a."activeVersionId",
           e AS "eventId"
    FROM active a,
         LATERAL jsonb_array_elements(a."nodes") n,
         LATERAL jsonb_array_elements_text(n -> 'data' -> 'events') e
    WHERE n ->> 'type' = 'trigger'
)
SELECT d."workflowId", d."companyId", d."eventId",
       'trigger node lists this event but no dispatch row exists' AS "violation"
FROM declared d
LEFT JOIN "workflowTriggerEvent" t
    ON t."workflowId" = d."workflowId"
   AND t."companyId" = d."companyId"
   AND t."eventId" = d."eventId"
WHERE t."eventId" IS NULL

UNION ALL

SELECT t."workflowId", t."companyId", t."eventId",
       'dispatch row with no matching trigger node on an active, promoted version' AS "violation"
FROM "workflowTriggerEvent" t
LEFT JOIN declared d
    ON d."workflowId" = t."workflowId"
   AND d."companyId" = t."companyId"
   AND d."eventId" = t."eventId"
WHERE d."eventId" IS NULL

UNION ALL

SELECT t."workflowId", t."companyId", t."eventId",
       'dispatch row points at a version that is no longer the active one' AS "violation"
FROM "workflowTriggerEvent" t
JOIN declared d
    ON d."workflowId" = t."workflowId"
   AND d."companyId" = t."companyId"
   AND d."eventId" = t."eventId"
WHERE t."workflowVersionId" <> d."activeVersionId";
