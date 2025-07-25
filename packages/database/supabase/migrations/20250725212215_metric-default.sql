-- Create new function to insert both terms and settings
CREATE OR REPLACE FUNCTION insert_company_related_records()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert terms record
  INSERT INTO "terms" ("id")
  VALUES (NEW.id);
  
  -- Insert company settings record with metric setting based on country/currency
  INSERT INTO "companySettings" ("id", "useMetric") 
  VALUES (
    NEW.id, 
    CASE 
      WHEN NEW."countryCode" = 'US' OR NEW."baseCurrencyCode" = 'USD' THEN false
      ELSE true
    END
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update useMetric setting for all existing companies
UPDATE "companySettings" 
SET "useMetric" = CASE 
  WHEN c."countryCode" = 'US' OR c."baseCurrencyCode" = 'USD' THEN false
  ELSE true
END
FROM "company" c
WHERE "companySettings"."id" = c."id";
