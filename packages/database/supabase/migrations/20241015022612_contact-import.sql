
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "externalId" JSONB;

-- Check if firstName and lastName are already nullable
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'contact'
      AND column_name IN ('firstName', 'lastName')
      AND is_nullable = 'NO'
  ) THEN
    -- Make firstName and lastName nullable if they are not already
    ALTER TABLE "contact" ALTER COLUMN "firstName" DROP NOT NULL;
    ALTER TABLE "contact" ALTER COLUMN "lastName" DROP NOT NULL;
  END IF;
END $$;

-- Check if fullName column exists and update it if necessary
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'contact' AND column_name = 'fullName'
  ) THEN
    -- Drop the view that depends on fullName
    DROP VIEW IF EXISTS "contractors";
    
    -- Drop existing fullName column
    ALTER TABLE "contact" DROP COLUMN "fullName";
  END IF;

  -- Add updated fullName column
  ALTER TABLE "contact" ADD COLUMN "fullName" TEXT GENERATED ALWAYS AS (
    CASE
      WHEN "firstName" IS NULL AND "lastName" IS NULL THEN "email"
      WHEN "firstName" IS NULL THEN "lastName"
      WHEN "lastName" IS NULL THEN "firstName"
      ELSE "firstName" || ' ' || "lastName"
    END
  ) STORED;
END $$;

DROP VIEW IF EXISTS "contractors";
-- Recreate the contractors view
CREATE OR REPLACE VIEW "contractors" WITH (security_invoker = on) AS
  SELECT 
    p.id AS "supplierContactId", 
    p."active", 
    p."hoursPerWeek", 
    p."companyId",
    p."customFields",
    s.id AS "supplierId", 
    s.name AS "supplierName", 
    c."fullName",
    c."firstName",
    c."lastName",
    c."email",
    array_agg(pa."abilityId") AS "abilityIds"
  FROM "contractor" p 
    INNER JOIN "supplierContact" sc 
      ON sc.id = p.id
    INNER JOIN "supplier" s
      ON s.id = sc."supplierId"
    INNER JOIN "contact" c 
      ON c.id = sc."contactId"
    LEFT JOIN "contractorAbility" pa
      ON pa."contractorId" = p.id
  WHERE p."active" = true
  GROUP BY p.id, p.active, p."hoursPerWeek", p."customFields", p."companyId", s.id, c.id, s.name, c."firstName", c."lastName", c."email";