CREATE TABLE "note" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "documentId" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "noteRichText" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notes_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "notes_documentId_idx" ON "note"("documentId");
CREATE INDEX "notes_companyId_idx" ON "note" ("companyId");

ALTER TABLE "note" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view notes" ON "note"
  FOR SELECT
  USING (
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )
  );

CREATE POLICY "Employees can insert notes" ON "note"
  FOR INSERT
  WITH CHECK (   
    has_role('employee', "companyId")
    AND "companyId" = ANY(
        SELECT "companyId" from "userToCompany" where "userId" = auth.uid()::text
    )  
);

CREATE POLICY "Employees can update their own notes" ON "note"
  FOR UPDATE
  USING (
   has_role('employee', "companyId")
    AND "createdBy"::uuid = auth.uid()
  );

CREATE POLICY "Employees can delete their own notes" ON "note"
  FOR DELETE
  USING (
    has_role('employee', "companyId")
    AND "createdBy"::uuid = auth.uid()
  );
