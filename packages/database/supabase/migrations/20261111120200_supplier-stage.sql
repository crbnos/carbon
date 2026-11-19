-- A company's own list of where a supplier is in onboarding. It is separate from
-- "supplierStatusType", which is the approval state and gates purchase orders.
CREATE TABLE "supplierStage" (
  "id" TEXT NOT NULL DEFAULT id('sstg'),
  "name" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT REFERENCES "user"("id"),

  CONSTRAINT "supplierStage_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "supplierStage_name_unique" UNIQUE ("name", "companyId"),
  CONSTRAINT "supplierStage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX "supplierStage_companyId_idx" ON "supplierStage" ("companyId");
CREATE INDEX "supplierStage_createdBy_idx" ON "supplierStage" ("createdBy");
CREATE INDEX "supplierStage_updatedBy_idx" ON "supplierStage" ("updatedBy");

ALTER TABLE "supplierStage" ENABLE ROW LEVEL SECURITY;

-- SET NULL clears the stage only, never "companyId".
ALTER TABLE "supplier"
  ADD COLUMN "supplierStageId" TEXT,
  ADD CONSTRAINT "supplier_supplierStageId_fkey"
    FOREIGN KEY ("supplierStageId", "companyId") REFERENCES "supplierStage"("id", "companyId")
    ON DELETE SET NULL ("supplierStageId");

CREATE INDEX "supplier_supplierStageId_idx" ON "supplier" ("supplierStageId");

-- Company creation seeds these for new companies. This covers existing ones.
INSERT INTO "supplierStage" ("name", "companyId", "createdBy")
SELECT stage, c."id", 'system'
FROM "company" c
CROSS JOIN unnest(ARRAY['Prospect', 'Sampling', 'Qualified', 'Production']) AS stage;

CREATE OR REPLACE VIEW "suppliers" WITH(SECURITY_INVOKER=true) AS
  SELECT
    s.id,
    s."readableId",
    s.name,
    s."supplierTypeId",
    s."supplierStatus" AS "status",
    stx."taxId",
    s."accountManagerId",
    s.logo,
    s.assignee,
    s."companyId",
    s."createdAt",
    s."createdBy",
    s."updatedAt",
    s."updatedBy",
    s."customFields",
    s."currencyCode",
    stx."vatNumber",
    stx."eori",
    s.website,
    (
      SELECT COALESCE(
        jsonb_object_agg(
          eim."integration",
          CASE
            WHEN eim."metadata" IS NOT NULL THEN eim."metadata"
            ELSE to_jsonb(eim."externalId")
          END
        ) FILTER (WHERE eim."externalId" IS NOT NULL OR eim."metadata" IS NOT NULL),
        '{}'::jsonb
      )
      FROM "externalIntegrationMapping" eim
      WHERE eim."entityType" = 'supplier' AND eim."entityId" = s.id
    ) AS "externalId",
    s.tags,
    s."taxPercent",
    s."purchasingContactId",
    s.embedding,
    s."defaultCc",
    st.name AS "type",
    po.count AS "orderCount",
    p.count AS "partCount",
    pc."workPhone" AS "phone",
    pc.fax AS "fax",
    s."supplierStageId",
    ss.name AS "stage"
  FROM "supplier" s
  LEFT JOIN "supplierTax" stx ON stx."supplierId" = s.id
  LEFT JOIN "supplierType" st ON st.id = s."supplierTypeId"
  LEFT JOIN "supplierStage" ss ON ss.id = s."supplierStageId" AND ss."companyId" = s."companyId"
  LEFT JOIN (
    SELECT
      "supplierId",
      COUNT(*) AS "count"
    FROM "purchaseOrder"
    GROUP BY "supplierId"
  ) po ON po."supplierId" = s.id
  LEFT JOIN (
    SELECT
      "supplierId",
      COUNT(*) AS "count"
    FROM "supplierPart"
    GROUP BY "supplierId"
  ) p ON p."supplierId" = s.id
  LEFT JOIN (
    SELECT DISTINCT ON (sc."supplierId")
      sc."supplierId" AS id,
      co."workPhone",
      co."fax"
    FROM "supplierContact" sc
    INNER JOIN "contact" co ON co.id = sc."contactId"
    ORDER BY sc."supplierId", sc.id
  ) pc ON pc.id = s.id;
