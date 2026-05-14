CREATE TABLE "userModulePreference" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "position" DOUBLE PRECISION NOT NULL,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "userModulePreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "userModulePreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "userModulePreference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "userModulePreference_userId_companyId_module_key" UNIQUE ("userId", "companyId", "module")
);

ALTER TABLE "userModulePreference" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "userModulePreference"
  FOR SELECT USING ("userId" = auth.uid()::text);

CREATE POLICY "INSERT" ON "userModulePreference"
  FOR INSERT WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "UPDATE" ON "userModulePreference"
  FOR UPDATE USING ("userId" = auth.uid()::text);

CREATE POLICY "DELETE" ON "userModulePreference"
  FOR DELETE USING ("userId" = auth.uid()::text);

CREATE INDEX "userModulePreference_userId_companyId_idx"
  ON "userModulePreference" ("userId", "companyId");
