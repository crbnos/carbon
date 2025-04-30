-- Drop the existing foreign key constraint
ALTER TABLE "account" DROP CONSTRAINT "account_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "account" ADD CONSTRAINT "account_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "warehouse" DROP CONSTRAINT "warehouse_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "service" DROP CONSTRAINT "service_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "service" ADD CONSTRAINT "service_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;


-- Drop the existing foreign key constraint
ALTER TABLE "quote" DROP CONSTRAINT "quote_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "quote" ADD CONSTRAINT "quote_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "quoteLine" DROP CONSTRAINT "quoteLine_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "quoteLine" ADD CONSTRAINT "quoteLine_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "quoteMaterial" DROP CONSTRAINT "quoteMaterial_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "quoteMaterial" ADD CONSTRAINT "quoteMaterial_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "quoteMakeMethod" DROP CONSTRAINT "quoteMakeMethod_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "quoteMakeMethod" ADD CONSTRAINT "quoteMakeMethod_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "quoteOperation" DROP CONSTRAINT "quoteOperation_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "quoteOperation" ADD CONSTRAINT "quoteOperation_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;


-- Drop the existing foreign key constraint
ALTER TABLE "job" DROP CONSTRAINT "job_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "job" ADD CONSTRAINT "job_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "jobMaterial" DROP CONSTRAINT "jobMaterial_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "jobMaterial" ADD CONSTRAINT "jobMaterial_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "jobOperation" DROP CONSTRAINT "jobOperation_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;


-- Drop the existing foreign key constraint
ALTER TABLE "jobMakeMethod" DROP CONSTRAINT "jobMakeMethod_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "jobMakeMethod" ADD CONSTRAINT "jobMakeMethod_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;


-- Drop the existing foreign key constraint
ALTER TABLE "supplierQuote" DROP CONSTRAINT IF EXISTS "supplierQuote_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "supplierQuote" ADD CONSTRAINT "supplierQuote_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "supplierQuoteLine" DROP CONSTRAINT IF EXISTS "supplierQuoteLine_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "supplierQuoteLine" ADD CONSTRAINT "supplierQuoteLine_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;


-- Drop the existing foreign key constraint
ALTER TABLE "tool" DROP CONSTRAINT "tool_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "tool" ADD CONSTRAINT "tool_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "consumable" DROP CONSTRAINT "consumable_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "consumable" ADD CONSTRAINT "consumable_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "fixture" DROP CONSTRAINT "fixture_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "fixture" ADD CONSTRAINT "fixture_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "material" DROP CONSTRAINT "material_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "material" ADD CONSTRAINT "material_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "modelUpload" DROP CONSTRAINT "modelUpload_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "modelUpload" ADD CONSTRAINT "modelUpload_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "productionQuantity" DROP CONSTRAINT "productionQuantity_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "productionQuantity" ADD CONSTRAINT "productionQuantity_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "externalLink" DROP CONSTRAINT "externalLinks_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "externalLink" ADD CONSTRAINT "externalLinks_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;


-- Drop the existing foreign key constraint
ALTER TABLE "sequence" DROP CONSTRAINT "sequence_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "sequence" ADD CONSTRAINT "sequence_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "companySettings" DROP CONSTRAINT "companySettings_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "companySettings" ADD CONSTRAINT "companySettings_companyId_fkey" 
  FOREIGN KEY ("id") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "methodOperationTool" DROP CONSTRAINT "methodOperationTool_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "methodOperationTool" ADD CONSTRAINT "methodOperationTool_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "quoteOperationTool" DROP CONSTRAINT "quoteOperationTool_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "quoteOperationTool" ADD CONSTRAINT "quoteOperationTool_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "jobOperationTool" DROP CONSTRAINT "jobOperationTool_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "jobOperationTool" ADD CONSTRAINT "jobOperationTool_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "invite" DROP CONSTRAINT "invite_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "invite" ADD CONSTRAINT "invite_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;

-- Drop the existing foreign key constraint
ALTER TABLE "configurationParameterGroup" DROP CONSTRAINT "configurationParameterGroup_companyId_fkey";

-- Add the foreign key constraint with ON DELETE CASCADE
ALTER TABLE "configurationParameterGroup" ADD CONSTRAINT "configurationParameterGroup_companyId_fkey" 
  FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE;
  


-- Drop the existing foreign key constraints for account references
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_costOfGoodsSoldAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_inventoryAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_inventoryInterimAccrualAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_inventoryReceivedNotInvoicedAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_inventoryInvoicedNotReceivedAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_inventoryShippedNotInvoicedAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_workInProgressAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_directCostAppliedAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_overheadCostAppliedAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_purchaseVarianceAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_inventoryAdjustmentVarianceAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_materialVarianceAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_capacityVarianceAccount_fkey";
ALTER TABLE "postingGroupInventory" DROP CONSTRAINT "postingGroupInventory_overheadAccount_fkey";

-- Add the foreign key constraints with ON DELETE CASCADE
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_costOfGoodsSoldAccount_fkey" 
  FOREIGN KEY ("costOfGoodsSoldAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_inventoryAccount_fkey" 
  FOREIGN KEY ("inventoryAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_inventoryInterimAccrualAccount_fkey" 
  FOREIGN KEY ("inventoryInterimAccrualAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_inventoryReceivedNotInvoicedAccount_fkey" 
  FOREIGN KEY ("inventoryReceivedNotInvoicedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_inventoryInvoicedNotReceivedAccount_fkey" 
  FOREIGN KEY ("inventoryInvoicedNotReceivedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_inventoryShippedNotInvoicedAccount_fkey" 
  FOREIGN KEY ("inventoryShippedNotInvoicedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_workInProgressAccount_fkey" 
  FOREIGN KEY ("workInProgressAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_directCostAppliedAccount_fkey" 
  FOREIGN KEY ("directCostAppliedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_overheadCostAppliedAccount_fkey" 
  FOREIGN KEY ("overheadCostAppliedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_purchaseVarianceAccount_fkey" 
  FOREIGN KEY ("purchaseVarianceAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_inventoryAdjustmentVarianceAccount_fkey" 
  FOREIGN KEY ("inventoryAdjustmentVarianceAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_materialVarianceAccount_fkey" 
  FOREIGN KEY ("materialVarianceAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_capacityVarianceAccount_fkey" 
  FOREIGN KEY ("capacityVarianceAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupInventory" ADD CONSTRAINT "postingGroupInventory_overheadAccount_fkey" 
  FOREIGN KEY ("overheadAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Update postingGroupPurchasing foreign key constraints to CASCADE on delete

-- Drop existing constraints
ALTER TABLE "postingGroupPurchasing" DROP CONSTRAINT "postingGroupPurchasing_payablesAccount_fkey";
ALTER TABLE "postingGroupPurchasing" DROP CONSTRAINT "postingGroupPurchasing_purchaseAccount_fkey";
ALTER TABLE "postingGroupPurchasing" DROP CONSTRAINT "postingGroupPurchasing_purchaseDiscountAccount_fkey";
ALTER TABLE "postingGroupPurchasing" DROP CONSTRAINT "postingGroupPurchasing_purchaseCreditAccount_fkey";
ALTER TABLE "postingGroupPurchasing" DROP CONSTRAINT "postingGroupPurchasing_purchasePrepaymentAccount_fkey";
ALTER TABLE "postingGroupPurchasing" DROP CONSTRAINT "postingGroupPurchasing_purchaseTaxPayableAccount_fkey";

-- Add constraints with ON DELETE CASCADE
ALTER TABLE "postingGroupPurchasing" ADD CONSTRAINT "postingGroupPurchasing_payablesAccount_fkey" 
  FOREIGN KEY ("payablesAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupPurchasing" ADD CONSTRAINT "postingGroupPurchasing_purchaseAccount_fkey" 
  FOREIGN KEY ("purchaseAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupPurchasing" ADD CONSTRAINT "postingGroupPurchasing_purchaseDiscountAccount_fkey" 
  FOREIGN KEY ("purchaseDiscountAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupPurchasing" ADD CONSTRAINT "postingGroupPurchasing_purchaseCreditAccount_fkey" 
  FOREIGN KEY ("purchaseCreditAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupPurchasing" ADD CONSTRAINT "postingGroupPurchasing_purchasePrepaymentAccount_fkey" 
  FOREIGN KEY ("purchasePrepaymentAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupPurchasing" ADD CONSTRAINT "postingGroupPurchasing_purchaseTaxPayableAccount_fkey" 
  FOREIGN KEY ("purchaseTaxPayableAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;



-- Update postingGroupSales foreign key constraints to CASCADE on delete

-- Drop existing constraints
ALTER TABLE "postingGroupSales" DROP CONSTRAINT "postingGroupSales_receivablesAccount_fkey";
ALTER TABLE "postingGroupSales" DROP CONSTRAINT "postingGroupSales_salesAccount_fkey";
ALTER TABLE "postingGroupSales" DROP CONSTRAINT "postingGroupSales_salesDiscountAccount_fkey";
ALTER TABLE "postingGroupSales" DROP CONSTRAINT "postingGroupSales_salesCreditAccount_fkey";
ALTER TABLE "postingGroupSales" DROP CONSTRAINT "postingGroupSales_salesPrepaymentAccount_fkey";
ALTER TABLE "postingGroupSales" DROP CONSTRAINT "postingGroupSales_salesTaxPayableAccount_fkey";

-- Add constraints with ON DELETE CASCADE
ALTER TABLE "postingGroupSales" ADD CONSTRAINT "postingGroupSales_receivablesAccount_fkey" 
  FOREIGN KEY ("receivablesAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupSales" ADD CONSTRAINT "postingGroupSales_salesAccount_fkey" 
  FOREIGN KEY ("salesAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupSales" ADD CONSTRAINT "postingGroupSales_salesDiscountAccount_fkey" 
  FOREIGN KEY ("salesDiscountAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupSales" ADD CONSTRAINT "postingGroupSales_salesCreditAccount_fkey" 
  FOREIGN KEY ("salesCreditAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupSales" ADD CONSTRAINT "postingGroupSales_salesPrepaymentAccount_fkey" 
  FOREIGN KEY ("salesPrepaymentAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "postingGroupSales" ADD CONSTRAINT "postingGroupSales_salesTaxPayableAccount_fkey" 
  FOREIGN KEY ("salesTaxPayableAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

