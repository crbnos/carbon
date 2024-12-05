
WITH
  duplicates AS (
    SELECT
      email,
      "companyId",
      COUNT(*) AS count
    FROM
      "contact"
    GROUP BY
      email,
      "companyId"
    HAVING
      COUNT(*) > 1
  )
DELETE FROM "contact"
WHERE
  (email, "companyId") IN (
    SELECT
      email,
      "companyId"
    FROM
      duplicates
  );

-- Now, add the unique constraint
ALTER TABLE "contact"
ADD CONSTRAINT "contact_email_companyId_unique" UNIQUE ("email", "companyId");