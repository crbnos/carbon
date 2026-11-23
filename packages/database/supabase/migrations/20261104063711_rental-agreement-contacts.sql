-- Other contacts of a rental agreement's customer (site, ordered by, a backup).
-- The primary contact stays in "rentalAgreement"."customerContactId" and is
-- never a row here. RLS ships through the authz manifest.

CREATE TABLE IF NOT EXISTS "rentalAgreementContact" (
  "id" TEXT NOT NULL DEFAULT id('rac'),
  "companyId" TEXT NOT NULL,
  "rentalAgreementId" TEXT NOT NULL,
  "customerContactId" TEXT NOT NULL REFERENCES "customerContact"("id") ON DELETE CASCADE,
  "role" TEXT,
  -- The order the contacts were added: the next one takes over as primary.
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "rentalAgreementContact_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "rentalAgreementContact_rentalAgreementId_fkey"
    FOREIGN KEY ("rentalAgreementId", "companyId")
    REFERENCES "rentalAgreement"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "rentalAgreementContact_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rentalAgreementContact_unique"
    UNIQUE ("rentalAgreementId", "customerContactId", "companyId"),
  CONSTRAINT "rentalAgreementContact_role_length" CHECK (char_length("role") <= 50)
);
CREATE INDEX IF NOT EXISTS "rentalAgreementContact_companyId_idx" ON "rentalAgreementContact" ("companyId");
CREATE INDEX IF NOT EXISTS "rentalAgreementContact_rentalAgreementId_idx" ON "rentalAgreementContact" ("rentalAgreementId");
CREATE INDEX IF NOT EXISTS "rentalAgreementContact_customerContactId_idx" ON "rentalAgreementContact" ("customerContactId");
CREATE INDEX IF NOT EXISTS "rentalAgreementContact_createdBy_idx" ON "rentalAgreementContact" ("createdBy");

-- The contacts belong to the agreement's customer, and the list never holds
-- the primary contact. On a customer change the old customer's contacts go,
-- the primary one included unless the same update sets a new one. A primary
-- contact of another customer is refused, whoever writes it: it would be on
-- the invoices and get them by email. BEFORE, so the row being written is
-- corrected or refused. SECURITY DEFINER so the rows go whatever the caller's
-- delete permission. A trigger function is not callable as an RPC.
CREATE OR REPLACE FUNCTION rental_agreement_customer_change_clears_contacts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."customerId" IS DISTINCT FROM NEW."customerId" THEN
      IF NEW."customerContactId" IS NOT DISTINCT FROM OLD."customerContactId" THEN
        NEW."customerContactId" := NULL;
      END IF;
      DELETE FROM "rentalAgreementContact"
      WHERE "rentalAgreementId" = NEW."id" AND "companyId" = NEW."companyId";
    ELSIF NEW."customerContactId" IS NOT NULL THEN
      DELETE FROM "rentalAgreementContact"
      WHERE "rentalAgreementId" = NEW."id" AND "companyId" = NEW."companyId"
        AND "customerContactId" = NEW."customerContactId";
    END IF;
  END IF;

  IF NEW."customerContactId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "customerContact"
    WHERE "id" = NEW."customerContactId"
      AND "customerId" = NEW."customerId"
      AND "companyId" = NEW."companyId"
  ) THEN
    RAISE EXCEPTION 'The primary contact does not belong to the agreement''s customer'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rentalAgreement_customer_change_clears_contacts"
  BEFORE UPDATE OF "customerId", "customerContactId" ON "rentalAgreement"
  FOR EACH ROW
  WHEN (
    OLD."customerId" IS DISTINCT FROM NEW."customerId"
    OR OLD."customerContactId" IS DISTINCT FROM NEW."customerContactId"
  )
  EXECUTE FUNCTION rental_agreement_customer_change_clears_contacts();

CREATE TRIGGER "rentalAgreement_primary_contact_on_insert"
  BEFORE INSERT ON "rentalAgreement"
  FOR EACH ROW
  WHEN (NEW."customerContactId" IS NOT NULL)
  EXECUTE FUNCTION rental_agreement_customer_change_clears_contacts();
