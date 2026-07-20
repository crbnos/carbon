-- Maps distinct model components (graph.json geometry hashes) to items from the
-- engineering bill of materials (methodMaterial). Keyed by modelUpload so a
-- mapping is authored once per model and shared by every instruction using
-- it; geometryHash identifies a distinct component across all of its instances
-- (with a "name:<name>" fallback key for components without a hash).

CREATE TABLE "assemblyComponentMapping" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "modelUploadId" TEXT NOT NULL,
  "geometryHash" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  -- 'high' = exact/strong name match or human-confirmed, 'low' = heuristic
  "confidence" TEXT NOT NULL DEFAULT 'high' CHECK ("confidence" IN ('high', 'low')),
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyComponentMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyComponentMapping_modelUploadId_geometryHash_key"
    UNIQUE ("modelUploadId", "geometryHash"),
  CONSTRAINT "assemblyComponentMapping_modelUploadId_fkey"
    FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyComponentMapping_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyComponentMapping_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyComponentMapping_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyComponentMapping_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assemblyComponentMapping_modelUploadId_idx"
  ON "assemblyComponentMapping" ("modelUploadId");
CREATE INDEX "assemblyComponentMapping_itemId_idx"
  ON "assemblyComponentMapping" ("itemId");
CREATE INDEX "assemblyComponentMapping_companyId_idx"
  ON "assemblyComponentMapping" ("companyId");

ALTER TABLE "assemblyComponentMapping" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "assemblyComponentMapping"
  FOR SELECT USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_view')::text[]
    )
  );

CREATE POLICY "INSERT" ON "assemblyComponentMapping"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_create')::text[]
    )
  );

CREATE POLICY "UPDATE" ON "assemblyComponentMapping"
  FOR UPDATE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_update')::text[]
    )
  );

CREATE POLICY "DELETE" ON "assemblyComponentMapping"
  FOR DELETE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_delete')::text[]
    )
  );
