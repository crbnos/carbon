-- Per-user, per-company notification channel opt-outs. Absence of a row =
-- enabled; "enabled" = false is an opt-out for that (topic, channel).
-- User-owned preference rows (like "userModulePreference"): no composite
-- companyId PK, no audit columns.
CREATE TABLE IF NOT EXISTS "notificationPreference" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "notificationPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notificationPreference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notificationPreference_channel_check" CHECK ("channel" IN ('email', 'slack')),
  CONSTRAINT "notificationPreference_userId_companyId_channel_topic_key" UNIQUE ("userId", "companyId", "channel", "topic")
);

ALTER TABLE "notificationPreference" ENABLE ROW LEVEL SECURITY;

-- Every policy scopes by owner AND membership in the target company.
CREATE POLICY "SELECT" ON "notificationPreference"
  FOR SELECT USING (
    "userId" = auth.uid()::text
    AND "companyId" IN (
      SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
    )
  );

CREATE POLICY "INSERT" ON "notificationPreference"
  FOR INSERT WITH CHECK (
    "userId" = auth.uid()::text
    AND "companyId" IN (
      SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
    )
  );

CREATE POLICY "UPDATE" ON "notificationPreference"
  FOR UPDATE USING ("userId" = auth.uid()::text)
  WITH CHECK (
    "userId" = auth.uid()::text
    AND "companyId" IN (
      SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
    )
  );

CREATE POLICY "DELETE" ON "notificationPreference"
  FOR DELETE USING (
    "userId" = auth.uid()::text
    AND "companyId" IN (
      SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
    )
  );

CREATE INDEX IF NOT EXISTS "notificationPreference_userId_companyId_idx"
  ON "notificationPreference" ("userId", "companyId");
