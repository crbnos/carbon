


CREATE TABLE "nonConformanceItem" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "nonConformanceId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "nonConformanceItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nonConformanceItem_nonConformanceId_fkey" FOREIGN KEY ("nonConformanceId") REFERENCES "nonConformance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "nonConformanceItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "nonConformanceItem_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);


CREATE POLICY "SELECT" ON "public"."nonConformanceItem"
FOR SELECT USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_view')
    )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."nonConformanceItem"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_create')
    )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."nonConformanceItem"
FOR UPDATE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_update')
    )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."nonConformanceItem"
FOR DELETE USING (
  "companyId" = ANY (
    (
      SELECT
        get_companies_with_employee_permission ('quality_delete')
    )::text[]
  )
);

INSERT INTO "nonConformanceItem" ("nonConformanceId", "itemId", "companyId")
SELECT 
  ncr."id",
  ncr."itemId",
  ncr."companyId"
FROM "nonConformance" ncr
WHERE ncr."itemId" IS NOT NULL
AND ncr."companyId" IS NOT NULL;

DROP VIEW IF EXISTS "qualityActions";

ALTER TABLE "nonConformance" DROP COLUMN "itemId";

DROP VIEW IF EXISTS "qualityActions";
CREATE OR REPLACE VIEW "qualityActions" WITH(SECURITY_INVOKER=true) AS
  SELECT
    ncat.*,
    ncra."name" AS "actionType",
    ncr."nonConformanceId" AS "readableNonConformanceId",
    ncr."name" AS "nonConformanceName",
    ncr."status" AS "nonConformanceStatus",
    ncr."openDate" AS "nonConformanceOpenDate",
    ncr."dueDate" AS "nonConformanceDueDate",
    ncr."closeDate" AS "nonConformanceCloseDate",
    nct."name" AS "nonConformanceTypeName",
    nci."items"
  FROM "nonConformanceActionTask" ncat
  INNER JOIN "nonConformance" ncr ON ncat."nonConformanceId" = ncr."id"
  LEFT JOIN "nonConformanceRequiredAction" ncra ON ncra."id" = ncat."actionTypeId"
  LEFT JOIN "nonConformanceType" nct ON ncr."nonConformanceTypeId" = nct."id"
  LEFT JOIN (
    SELECT
      "nonConformanceId",
      array_agg("itemId"::text) as items
    FROM "nonConformanceItem" nci
    GROUP BY "nonConformanceId"
  ) nci ON nci."nonConformanceId" = ncr."id";

CREATE OR REPLACE VIEW "issues" WITH(SECURITY_INVOKER=true) AS
  SELECT
    ncr.*,
    nci."items"
  FROM "nonConformance" ncr
  LEFT JOIN (
    SELECT
      "nonConformanceId",
      array_agg("itemId"::text) as items
    FROM "nonConformanceItem" nci
    GROUP BY "nonConformanceId"
  ) nci ON nci."nonConformanceId" = ncr."id";