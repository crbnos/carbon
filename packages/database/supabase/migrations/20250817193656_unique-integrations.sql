-- Find and handle duplicate id/companyId combinations in companyIntegration table

-- First, identify duplicates
DO $$
DECLARE
    duplicate_count INTEGER;
BEGIN
    -- Count duplicates
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT "id", "companyId", COUNT(*) as cnt
        FROM "companyIntegration"
        GROUP BY "id", "companyId"
        HAVING COUNT(*) > 1
    ) duplicates;
    
    -- If duplicates exist, remove them keeping the most recent one
    IF duplicate_count > 0 THEN
        RAISE NOTICE 'Found % duplicate id/companyId combinations in companyIntegration table', duplicate_count;
        
        -- Delete duplicates, keeping only the most recent (highest updatedAt)
        DELETE FROM "companyIntegration" 
        WHERE ctid NOT IN (
            SELECT DISTINCT ON ("id", "companyId") ctid
            FROM "companyIntegration"
            ORDER BY "id", "companyId", "updatedAt" DESC
        );
        
        RAISE NOTICE 'Removed duplicate records, keeping most recent for each id/companyId combination';
    ELSE
        RAISE NOTICE 'No duplicate id/companyId combinations found in companyIntegration table';
    END IF;
END $$;

-- Add unique constraint to prevent future duplicates
ALTER TABLE "companyIntegration" 
ADD CONSTRAINT "companyIntegration_id_companyId_unique" 
UNIQUE ("id", "companyId");
