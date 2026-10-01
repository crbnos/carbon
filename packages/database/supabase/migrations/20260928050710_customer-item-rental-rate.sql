-- Customer rental rates: a day / week / month ladder agreed with one customer
-- or with every customer of a type, for one item in one currency. A rental
-- agreement line defaults to the customer's ladder, then the customer type's,
-- then the item's own (`itemRentalRate`). One row per scope, item and
-- currency; validFrom / validTo gate it on the agreement's start date.
-- RLS is in the authz manifest.

CREATE TABLE IF NOT EXISTS "customerItemRentalRate" (
  "id" TEXT NOT NULL DEFAULT id('cirr'),
  "companyId" TEXT NOT NULL,
  "customerId" TEXT REFERENCES "customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "customerTypeId" TEXT REFERENCES "customerType"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "itemId" TEXT NOT NULL REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "currencyCode" TEXT NOT NULL,
  "dayRate" NUMERIC,
  "weekRate" NUMERIC,
  "monthRate" NUMERIC,
  "validFrom" DATE,
  "validTo" DATE,
  "notes" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "customerItemRentalRate_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "customerItemRentalRate_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customerItemRentalRate_scope_check"
    CHECK (num_nonnulls("customerId", "customerTypeId") = 1),
  CONSTRAINT "customerItemRentalRate_tier_check"
    CHECK (num_nonnulls("dayRate", "weekRate", "monthRate") >= 1),
  CONSTRAINT "customerItemRentalRate_validity_check"
    CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validTo" >= "validFrom")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customerItemRentalRate_customer_key"
  ON "customerItemRentalRate" ("companyId", "customerId", "itemId", "currencyCode")
  WHERE "customerId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "customerItemRentalRate_customerType_key"
  ON "customerItemRentalRate" ("companyId", "customerTypeId", "itemId", "currencyCode")
  WHERE "customerTypeId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "customerItemRentalRate_companyId_idx"
  ON "customerItemRentalRate" ("companyId");
CREATE INDEX IF NOT EXISTS "customerItemRentalRate_itemId_idx"
  ON "customerItemRentalRate" ("itemId");
CREATE INDEX IF NOT EXISTS "customerItemRentalRate_customerId_idx"
  ON "customerItemRentalRate" ("customerId");
CREATE INDEX IF NOT EXISTS "customerItemRentalRate_customerTypeId_idx"
  ON "customerItemRentalRate" ("customerTypeId");
CREATE INDEX IF NOT EXISTS "customerItemRentalRate_createdBy_idx"
  ON "customerItemRentalRate" ("createdBy");
