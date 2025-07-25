
-- Add unique constraints for code within company scope
ALTER TABLE "materialSubstance" ADD CONSTRAINT "materialSubstance_code_companyId_unique" UNIQUE ("code", "companyId");
ALTER TABLE "materialForm" ADD CONSTRAINT "materialForm_code_companyId_unique" UNIQUE ("code", "companyId");
