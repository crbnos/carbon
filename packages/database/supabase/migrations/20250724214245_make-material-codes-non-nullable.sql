-- Make code columns non-nullable now that all records have codes
ALTER TABLE "materialSubstance" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "materialForm" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "materialType" ALTER COLUMN "code" SET NOT NULL;