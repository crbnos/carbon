-- One browser push subscription per endpoint, owned by the user signed into
-- that browser. A user-owned row, shaped like "notificationPreference": xid()
-- id, no audit columns. "companyId" is the company the user enabled it from
-- (tenant attribution and the RLS check); the user gets the push of every
-- company they belong to.
CREATE TABLE IF NOT EXISTS "pushSubscription" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "pushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pushSubscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pushSubscription_endpoint_key" UNIQUE ("endpoint")
);

ALTER TABLE "pushSubscription" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "pushSubscription_userId_companyId_idx"
  ON "pushSubscription" ("userId", "companyId");

CREATE INDEX IF NOT EXISTS "pushSubscription_companyId_idx"
  ON "pushSubscription" ("companyId");
