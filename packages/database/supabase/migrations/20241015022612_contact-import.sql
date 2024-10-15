
ALTER TABLE "contact" ADD COLUMN "externalId" JSONB;

-- Make firstName and lastName nullable
ALTER TABLE "contact" ALTER COLUMN "firstName" DROP NOT NULL;
ALTER TABLE "contact" ALTER COLUMN "lastName" DROP NOT NULL;

-- Update the fullName generation to use email if firstName or lastName is null
ALTER TABLE "contact" DROP COLUMN "fullName";
ALTER TABLE "contact" ADD COLUMN "fullName" TEXT GENERATED ALWAYS AS (
  CASE
    WHEN "firstName" IS NULL AND "lastName" IS NULL THEN "email"
    WHEN "firstName" IS NULL THEN "lastName"
    WHEN "lastName" IS NULL THEN "firstName"
    ELSE "firstName" || ' ' || "lastName"
  END
) STORED;

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