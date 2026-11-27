-- Only a rental agreement takes Manual. A company default of Manual would stop
-- billing every agreement that inherits it, and contracts have no Manual mode.
ALTER TABLE "companySettings"
  DROP CONSTRAINT IF EXISTS "companySettings_invoiceAutomation_not_manual";
ALTER TABLE "companySettings"
  ADD CONSTRAINT "companySettings_invoiceAutomation_not_manual"
  CHECK ("invoiceAutomation" IS DISTINCT FROM 'Manual');

ALTER TABLE "customerContract"
  DROP CONSTRAINT IF EXISTS "customerContract_invoiceAutomation_not_manual";
ALTER TABLE "customerContract"
  ADD CONSTRAINT "customerContract_invoiceAutomation_not_manual"
  CHECK ("invoiceAutomation" IS DISTINCT FROM 'Manual');
