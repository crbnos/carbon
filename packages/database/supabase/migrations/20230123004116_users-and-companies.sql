CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT GENERATED ALWAYS AS ("firstName" || ' ' || "lastName") STORED,
    "about" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT,
    "active" BOOLEAN DEFAULT TRUE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "index_user_email_key" ON "user"("email");
CREATE INDEX "index_user_fullName" ON "user"("fullName");

CREATE TABLE "company" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "name" TEXT NOT NULL,
  "taxId" TEXT,
  "logo" TEXT,
  "addressLine1" TEXT,
  "addressLine2" TEXT,
  "city" TEXT,
  "state" TEXT,
  "postalCode" TEXT,
  "countryCode" TEXT,
  "phone" TEXT,
  "fax" TEXT,
  "email" TEXT,
  "website" TEXT,
  "updatedBy" TEXT,
  
  CONSTRAINT "company_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accountDefault_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
);

CREATE TYPE "role" AS ENUM ('customer', 'employee', 'supplier');

CREATE TABLE "userToCompany" (
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "company" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  "role" "role" NOT NULL,

  CONSTRAINT "userToCompany_pkey" PRIMARY KEY ("userId", "companyId")
);

CREATE TABLE "userPermission" (
    "id" TEXT NOT NULL,
    "permissions" JSONB DEFAULT '{}',

    CONSTRAINT "userPermission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "userPermission_id_fkey" FOREIGN KEY ("id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);