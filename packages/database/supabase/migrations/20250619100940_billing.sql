ALTER TABLE "company" ADD COLUMN "ownerId" TEXT REFERENCES "user"("id") ON DELETE SET NULL;

CREATE TABLE "plan" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "userBasedPricing" BOOLEAN NOT NULL DEFAULT TRUE,
  "stripePriceId" TEXT NOT NULL,
  "tasksLimit" INTEGER NOT NULL DEFAULT 10000,
  "aiTokensLimit" INTEGER NOT NULL DEFAULT 1000000,
  "stripeTrialPeriodDays" INTEGER NOT NULL DEFAULT 7,
  "public" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "pk_plan" PRIMARY KEY ("id"),
  CONSTRAINT "uq_plan_stripePriceId" UNIQUE ("stripePriceId")
);

ALTER TABLE "plan" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "plan"
  FOR SELECT
  USING (
    auth.role() = 'authenticated' 
  );


INSERT INTO "plan" ("id", "name", "userBasedPricing", "stripePriceId", "tasksLimit", "aiTokensLimit", "stripeTrialPeriodDays", "public") VALUES
  ('STARTER', 'Starter', TRUE, 'price_1RgUYhFV6ecOa0XvD37hQOhK', 10000, 1000000, 14, TRUE),
  ('BUSINESS', 'Business', TRUE, 'price_1RgUZ3FV6ecOa0XvQFLFQsX4', 10000, 1000000, 14, TRUE),
  ('PARTNER', 'Design Partner', FALSE, 'price_1RgXMSFV6ecOa0XvLQtlhQr0', 10000, 1000000, 14, FALSE);

CREATE TABLE "companyPlan" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "planId" TEXT NOT NULL,
  "tasksLimit" INTEGER NOT NULL DEFAULT 10000,
  "aiTokensLimit" INTEGER NOT NULL DEFAULT 1000000,
  "usersLimit" INTEGER NOT NULL DEFAULT 10,
  "subscriptionStartDate" TIMESTAMP WITH TIME ZONE NOT NULL,
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT NOT NULL,
  "stripeSubscriptionStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  "trialPeriodEndsAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "pk_companyPlan" PRIMARY KEY ("id"),
  CONSTRAINT "fk_companyPlan_plan" FOREIGN KEY ("planId") REFERENCES "plan"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_companyPlan_company" FOREIGN KEY ("id") REFERENCES "company"("id") ON DELETE CASCADE
);

ALTER TABLE "companyPlan" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "companyPlan"
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND "id" IN (
      SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
    )
  );

CREATE TABLE "companyUsage" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "users" INTEGER NOT NULL DEFAULT 0,
  "tasks" INTEGER NOT NULL DEFAULT 0,
  "aiTokens" INTEGER NOT NULL DEFAULT 0,
  "nextResetDatetime" TIMESTAMP WITH TIME ZONE NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "pk_companyUsage" PRIMARY KEY ("id"),
  CONSTRAINT "fk_companyUsage_company" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_companyUsage_companyId" ON "companyUsage" ("companyId");

CREATE POLICY "SELECT" ON "companyUsage"
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND "id" IN (
      SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
    )
  );