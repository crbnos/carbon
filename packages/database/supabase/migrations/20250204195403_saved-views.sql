CREATE TYPE "tableViewType" AS ENUM ('Public', 'Private');

DROP TABLE IF EXISTS "tableView";
CREATE TABLE IF NOT EXISTS "tableView" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "table" TEXT NOT NULL,
  "description" TEXT,
  "module" module,
  "type" "tableViewType" NOT NULL DEFAULT 'Private',
  "columnOrder" TEXT ARRAY,
  "columnPinning" JSONB,
  "columnVisibility" JSONB,
  "filter" TEXT,
  "sort" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "tableView_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tableView_table_fkey" FOREIGN KEY ("table") REFERENCES "customFieldTable"("table") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tableView_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tableView_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON UPDATE CASCADE,
  CONSTRAINT "tableView_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON UPDATE CASCADE
);

CREATE INDEX "tableView_module_createdBy_idx" ON "tableView" ("module", "createdBy");
CREATE INDEX "tableView_companyId_idx" ON "tableView" ("companyId");



ALTER TABLE "tableView" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "tableView"
  FOR SELECT
  USING (
    "createdBy" = (SELECT auth.uid()::text) OR 
    (
      "type" = 'Public' AND
      "companyId" = ANY (
        (
          SELECT get_companies_with_any_role()
        )::text[]
      )
    )
  );
  
CREATE POLICY "INSERT" ON "tableView"
  FOR INSERT
  WITH CHECK (
    "createdBy" = (SELECT auth.uid()::text) AND 
    "companyId" = ANY (
      (
        SELECT get_companies_with_any_role()
      )::text[]
    )
  );
  
CREATE POLICY "UPDATE" ON "tableView"
  FOR UPDATE
  USING (
    "createdBy" = (SELECT auth.uid()::text)
  );
  

CREATE POLICY "DELETE" ON "tableView"
  FOR DELETE
  USING (
    "createdBy" = (SELECT auth.uid()::text)
  );