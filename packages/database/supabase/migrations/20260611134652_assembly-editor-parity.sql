-- Assembly units: sets of model leaf nodes the motion planner treats as one
-- rigid body (e.g. a purchased PCB whose CAD model shows every component). A
-- user override on top of the automatic BOM-driven unit derivation. Scoped to
-- the model upload (like assemblyComponentMapping) so it survives instruction
-- delete/recreate; instructions attach to items, so a subassembly with its own
-- build steps is simply the child item's own instruction — no child link here.

CREATE TABLE "assemblyUnit" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "modelUploadId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "componentNodeIds" TEXT[] NOT NULL DEFAULT '{}',
  "itemId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "assemblyUnit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblyUnit_modelUploadId_fkey"
    FOREIGN KEY ("modelUploadId") REFERENCES "modelUpload"("id") ON DELETE CASCADE,
  CONSTRAINT "assemblyUnit_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE SET NULL,
  CONSTRAINT "assemblyUnit_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "assemblyUnit_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblyUnit_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assemblyUnit_modelUploadId_idx"
  ON "assemblyUnit" ("modelUploadId");
CREATE INDEX "assemblyUnit_itemId_idx"
  ON "assemblyUnit" ("itemId");
CREATE INDEX "assemblyUnit_companyId_idx"
  ON "assemblyUnit" ("companyId");

ALTER TABLE "assemblyUnit" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "assemblyUnit"
  FOR SELECT USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_view')::text[]
    )
  );

CREATE POLICY "INSERT" ON "assemblyUnit"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_create')::text[]
    )
  );

CREATE POLICY "UPDATE" ON "assemblyUnit"
  FOR UPDATE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_update')::text[]
    )
  );

CREATE POLICY "DELETE" ON "assemblyUnit"
  FOR DELETE USING (
    "companyId" = ANY (
      get_companies_with_employee_permission('production_delete')::text[]
    )
  );
