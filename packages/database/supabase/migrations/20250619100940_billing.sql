ALTER TABLE "company" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "user" ALTER COLUMN "firstName" SET DEFAULT '';
ALTER TABLE "user" ALTER COLUMN "lastName" SET DEFAULT '';
ALTER TABLE "user" ADD COLUMN "acknowledgedUniversity" BOOLEAN NOT NULL DEFAULT FALSE;

DROP VIEW IF EXISTS "companies";
CREATE OR REPLACE VIEW "companies" WITH(SECURITY_INVOKER=true) AS
  SELECT DISTINCT
    c.*,
    uc.*,
    et.name AS "employeeType"
    FROM "userToCompany" uc
    INNER JOIN "company" c
      ON c.id = uc."companyId"
    LEFT JOIN "employee" e
      ON e.id = uc."userId" AND e."companyId" = uc."companyId"
    LEFT JOIN "employeeType" et
      ON et.id = e."employeeTypeId";

ALTER POLICY "Users can view other users from their same company" ON "user" USING (
   id = auth.uid()::text OR
   "id" IN (
        SELECT "userId" FROM "userToCompany" WHERE "companyId" IN (
            SELECT "companyId" FROM "userToCompany" WHERE "userId" = auth.uid()::text
        )
   )
);


CREATE OR REPLACE FUNCTION public.create_public_user()
RETURNS TRIGGER AS $$
DECLARE
  full_name TEXT;
  name_parts TEXT[];
BEGIN
  -- Get the full name from raw_user_metadata if it exists
  full_name := NEW.raw_user_meta_data->>'name';
  
  -- Split name into parts if we have a full name
  IF full_name IS NOT NULL THEN
    name_parts := regexp_split_to_array(full_name, '\s+');
    INSERT INTO public."user" ("id", "email", "active", "firstName", "lastName", "about")
    VALUES (
      NEW.id,
      NEW.email,
      true,
      COALESCE(name_parts[1], ''),
      COALESCE(array_to_string(name_parts[2:], ' '), ''),
      ''
    );
  ELSE
    -- Use firstName/lastName from user_metadata if available, otherwise empty strings
    INSERT INTO public."user" ("id", "email", "active", "firstName", "lastName", "about")
    VALUES (
      NEW.id,
      NEW.email,
      true,
      '',
      '',
      ''
    );
  END IF;

  INSERT INTO public."userPermission" (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.create_public_user();


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
  ('STARTER', 'Cloud Starter', TRUE, 'price_1RgUYhFV6ecOa0XvD37hQOhK', 10000, 1000000, 30, TRUE),
  ('BUSINESS', 'Cloud Business', TRUE, 'price_1RgUZ3FV6ecOa0XvQFLFQsX4', 10000, 1000000, 30, TRUE),
  ('PARTNER-400', 'Design Partner', FALSE, 'price_1RgXMSFV6ecOa0XvLQtlhQr0', 10000, 1000000, 30, FALSE),
  ('PARTNER-300', 'Design Partner', FALSE, 'price_1Rj20jFV6ecOa0Xvk4WV6b7l', 10000, 1000000, 30, FALSE),
  ('PARTNER-500', 'Design Partner', FALSE, 'price_1Rj21OFV6ecOa0XvCTdELYdv', 10000, 1000000, 30, FALSE);

CREATE TABLE "companyPlan" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "planId" TEXT NOT NULL,
  "tasksLimit" INTEGER NOT NULL DEFAULT 10000,
  "aiTokensLimit" INTEGER NOT NULL DEFAULT 1000000,
  "usersLimit" INTEGER NOT NULL DEFAULT 10,
  "subscriptionStartDate" TIMESTAMP WITH TIME ZONE NOT NULL,
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "stripeSubscriptionStatus" TEXT NOT NULL DEFAULT 'Active',
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