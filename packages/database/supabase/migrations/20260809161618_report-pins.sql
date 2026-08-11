-- ============================================================
-- reportPin: per-user pin overrides for the reports hub
-- (/x/accounting/reports). Reports are static definitions keyed by slug
-- ("balance-sheet", "income-statement", "trial-balance"), not entity rows, so
-- unlike documentFavorite (presence = favorited) a row here stores an explicit
-- "pinned" value: the core financial statements default to PINNED, and a row
-- overrides that default in either direction. Absent row = the report's
-- default pin state.
-- ============================================================

CREATE TABLE "reportPin" (
    "reportKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "companyId" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("reportKey", "userId", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "reportPin_userId_idx" ON "reportPin" ("userId");
CREATE INDEX "reportPin_companyId_idx" ON "reportPin" ("companyId");
CREATE INDEX "reportPin_createdBy_idx" ON "reportPin" ("createdBy");

ALTER TABLE "public"."reportPin" ENABLE ROW LEVEL SECURITY;

-- A personal UI preference: rows are visible/writable only by their owner,
-- within companies the user belongs to (documentFavorite pattern + company
-- scoping).
CREATE POLICY "SELECT" ON "public"."reportPin"
FOR SELECT USING (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "INSERT" ON "public"."reportPin"
FOR INSERT WITH CHECK (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "UPDATE" ON "public"."reportPin"
FOR UPDATE USING (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);

CREATE POLICY "DELETE" ON "public"."reportPin"
FOR DELETE USING (
  (SELECT auth.uid())::text = "userId"
  AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
