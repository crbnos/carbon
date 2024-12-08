CREATE TABLE "invite" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "code" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "permissions" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "role" "role" NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "acceptedAt" TIMESTAMPTZ,

  
  CONSTRAINT "invite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "invite_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id")
);

CREATE INDEX "invite_unaccepted_code_idx" ON "invite" ("code") WHERE "acceptedAt" IS NULL;

ALTER TABLE "invite" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "employee" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "supplierAccount" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "customerAccount" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT FALSE;

-- all existing employees are active
UPDATE "employee" SET "active" = true;
UPDATE "supplierAccount" SET "active" = true;
UPDATE "customerAccount" SET "active" = true;

DROP VIEW "employeesAcrossCompanies";
DROP VIEW "employees";

CREATE OR REPLACE VIEW "employees" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    u.id,
    u."email",
    u."firstName",
    u."lastName",
    u."fullName" AS "name",
    u."avatarUrl",
    e."employeeTypeId",
    e."companyId",
    e."active"
  FROM "user" u
  INNER JOIN "employee" e
    ON e.id = u.id
  WHERE u.active = TRUE;

CREATE OR REPLACE VIEW "employeesAcrossCompanies" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    u.id,
    u.email,
    u."firstName", 
    u."lastName", 
    u."fullName" AS "name", 
    u."avatarUrl", 
    u.active,
    array_agg(e."companyId") as "companyId"
  FROM "user" u
  INNER JOIN "employee" e
    ON e.id = u.id
  WHERE u.active = TRUE
  GROUP BY u.id, u.email, u."firstName", u."lastName", u."fullName", u."avatarUrl", u.active;
