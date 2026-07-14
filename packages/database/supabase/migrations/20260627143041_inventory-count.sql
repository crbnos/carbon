-- Inventory Count / Cycle Count
-- Warehouse staff count real stock against a frozen system-quantity snapshot, review
-- variances, and post the differences as inventory adjustments. The document follows
-- the Draft -> Pending -> Posted lifecycle; posting is atomic and handled by the
-- `post-inventory-count` edge function.

-- ============================================================================
-- inventoryCount (header)
-- ============================================================================
CREATE TYPE "inventoryCountStatus" AS ENUM ('Draft', 'Pending', 'Posted');

CREATE TABLE "inventoryCount" (
    "id" TEXT NOT NULL DEFAULT id('ic'),
    "companyId" TEXT NOT NULL,
    "inventoryCountId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL REFERENCES "location"("id"),
    "status" "inventoryCountStatus" NOT NULL DEFAULT 'Draft',
    "isBlind" BOOLEAN NOT NULL DEFAULT FALSE,
    "scope" JSONB,
    "snapshotAt" TIMESTAMP WITH TIME ZONE,
    "notes" TEXT,
    "postedBy" TEXT REFERENCES "user"("id"),
    "postedAt" TIMESTAMP WITH TIME ZONE,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "inventoryCount_companyId_idx" ON "inventoryCount" ("companyId");
CREATE INDEX "inventoryCount_locationId_idx" ON "inventoryCount" ("locationId");
CREATE INDEX "inventoryCount_postedBy_idx" ON "inventoryCount" ("postedBy");
CREATE INDEX "inventoryCount_createdBy_idx" ON "inventoryCount" ("createdBy");

ALTER TABLE "inventoryCount" ADD CONSTRAINT "inventoryCount_inventoryCountId_key"
    UNIQUE ("inventoryCountId", "companyId");

ALTER TABLE "public"."inventoryCount" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."inventoryCount"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."inventoryCount"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."inventoryCount"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."inventoryCount"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_delete'))::text[])
);

-- ============================================================================
-- inventoryCountLine
-- ============================================================================
CREATE TABLE "inventoryCountLine" (
    "id" TEXT NOT NULL DEFAULT id('icl'),
    "companyId" TEXT NOT NULL,
    "inventoryCountId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL REFERENCES "item"("id"),
    "locationId" TEXT,
    "storageUnitId" TEXT,
    "trackedEntityId" TEXT,
    "readableId" TEXT,
    "systemQuantity" NUMERIC NOT NULL DEFAULT 0,
    "countedQuantity" NUMERIC,
    "variance" NUMERIC GENERATED ALWAYS AS ("countedQuantity" - "systemQuantity") STORED,
    "countedBy" TEXT REFERENCES "user"("id"),
    "countedAt" TIMESTAMP WITH TIME ZONE,
    "postedItemLedgerId" TEXT,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("inventoryCountId", "companyId")
        REFERENCES "inventoryCount"("id", "companyId") ON DELETE CASCADE
);

CREATE INDEX "inventoryCountLine_companyId_idx" ON "inventoryCountLine" ("companyId");
CREATE INDEX "inventoryCountLine_inventoryCountId_idx" ON "inventoryCountLine" ("inventoryCountId");
CREATE INDEX "inventoryCountLine_itemId_idx" ON "inventoryCountLine" ("itemId");
CREATE INDEX "inventoryCountLine_countedBy_idx" ON "inventoryCountLine" ("countedBy");
CREATE INDEX "inventoryCountLine_createdBy_idx" ON "inventoryCountLine" ("createdBy");

ALTER TABLE "public"."inventoryCountLine" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."inventoryCountLine"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."inventoryCountLine"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."inventoryCountLine"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."inventoryCountLine"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('inventory_delete'))::text[])
);

-- ============================================================================
-- Readable id sequence ("IC000001") for existing companies
-- ============================================================================
INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'inventoryCount', 'Inventory Count', 'IC', NULL, 0, 6, 1, "id"
FROM "company"
ON CONFLICT DO NOTHING;
