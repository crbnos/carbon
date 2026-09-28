-- Rename the party-contact settings to say they also require a location.
--
-- WHY THIS IS A SEPARATE MIGRATION. `20260927002910_require-party-contact.sql`
-- was pushed adding `requireSupplierContact` / `requireCustomerContact`, and was
-- then edited in place to add the `…ContactAndLocation` columns instead. The
-- migration runner keys applied migrations on the VERSION alone
-- (`packages/dev/src/services/migrations.ts`, `SELECT version FROM
-- supabase_migrations.schema_migrations`), so any database that had already run
-- the original file would never receive the edited one: it would keep the two old
-- columns, never get the two new ones, and every read in the app — which now
-- names only the new ones — would come back undefined. Silent, not loud.
--
-- So the original file is restored byte-for-byte and this moves the schema
-- forward instead. `.ai/lessons.md` already recorded the rule ("don't rename
-- already-partially-applied files").
--
-- Guarded for BOTH start states, because by now different databases are in
-- different ones: a database that ran the original has the old columns; one that
-- ran the edited file (or a fresh reset against it) already has the new ones.
-- Renaming preserves whatever value a company had already chosen.

DO $$
BEGIN
  -- Supplier
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companySettings'
      AND column_name = 'requireSupplierContact'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companySettings'
      AND column_name = 'requireSupplierContactAndLocation'
  ) THEN
    ALTER TABLE "companySettings"
      RENAME COLUMN "requireSupplierContact" TO "requireSupplierContactAndLocation";
  END IF;

  -- Customer
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companySettings'
      AND column_name = 'requireCustomerContact'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companySettings'
      AND column_name = 'requireCustomerContactAndLocation'
  ) THEN
    ALTER TABLE "companySettings"
      RENAME COLUMN "requireCustomerContact" TO "requireCustomerContactAndLocation";
  END IF;
END $$;

-- A database that ran the ORIGINAL file and nothing else still lacks the new
-- columns if the rename above was skipped (both present is impossible, but a
-- half-migrated database with neither is). Idempotent add covers it.
ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "requireSupplierContactAndLocation" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "requireCustomerContactAndLocation" BOOLEAN NOT NULL DEFAULT FALSE;

-- If both the old and the new column somehow coexist, the old one is dead weight
-- the app no longer reads. Dropping it is safe only after the value has moved.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companySettings'
      AND column_name = 'requireSupplierContact'
  ) THEN
    UPDATE "companySettings"
      SET "requireSupplierContactAndLocation" = "requireSupplierContact"
      WHERE "requireSupplierContact" IS TRUE;
    ALTER TABLE "companySettings" DROP COLUMN "requireSupplierContact";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companySettings'
      AND column_name = 'requireCustomerContact'
  ) THEN
    UPDATE "companySettings"
      SET "requireCustomerContactAndLocation" = "requireCustomerContact"
      WHERE "requireCustomerContact" IS TRUE;
    ALTER TABLE "companySettings" DROP COLUMN "requireCustomerContact";
  END IF;
END $$;

COMMENT ON COLUMN "companySettings"."requireSupplierContactAndLocation" IS
  'When true, a supplier must have at least one contact with an email address AND at least one location whose address carries a country (plus a state when that country is US) before its purchase orders, supplier quotes and purchase invoices can be released or posted.';

COMMENT ON COLUMN "companySettings"."requireCustomerContactAndLocation" IS
  'When true, a customer must have at least one contact with an email address AND at least one location whose address carries a country (plus a state when that country is US) before its quotes, sales orders and sales invoices can be released or posted.';
