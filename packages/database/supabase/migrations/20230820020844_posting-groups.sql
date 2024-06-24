CREATE TABLE "accountDefault" (
  "companyId" TEXT NOT NULL,
  -- income statement
    -- revenue
    "salesAccount" TEXT NOT NULL,
    "salesDiscountAccount" TEXT NOT NULL,

    -- part cost
    "costOfGoodsSoldAccount" TEXT NOT NULL,
    "purchaseAccount" TEXT NOT NULL,
    "directCostAppliedAccount" TEXT NOT NULL,
    "overheadCostAppliedAccount" TEXT NOT NULL,
    "purchaseVarianceAccount" TEXT NOT NULL,
    "inventoryAdjustmentVarianceAccount" TEXT NOT NULL,

    -- costs
    "materialVarianceAccount" TEXT NOT NULL,
    "capacityVarianceAccount" TEXT NOT NULL,
    "overheadAccount" TEXT NOT NULL,
    "maintenanceAccount" TEXT NOT NULL,

    -- depreciaition of fixed assets
    "assetDepreciationExpenseAccount" TEXT NOT NULL,
    "assetGainsAndLossesAccount" TEXT NOT NULL,
    "serviceChargeAccount" TEXT NOT NULL,

    -- interest
    "interestAccount" TEXT NOT NULL,
    "supplierPaymentDiscountAccount" TEXT NOT NULL,
    "customerPaymentDiscountAccount" TEXT NOT NULL,
    "roundingAccount" TEXT NOT NULL,

  -- balance sheet
    -- assets
    "assetAquisitionCostAccount" TEXT NOT NULL,
    "assetAquisitionCostOnDisposalAccount" TEXT NOT NULL,
    "accumulatedDepreciationAccount" TEXT NOT NULL,
    "accumulatedDepreciationOnDisposalAccount" TEXT NOT NULL,

    -- current assets
    "inventoryAccount" TEXT NOT NULL,
    "inventoryInterimAccrualAccount" TEXT NOT NULL,
    "workInProgressAccount" TEXT NOT NULL,
    "receivablesAccount" TEXT NOT NULL,
    "inventoryShippedNotInvoicedAccount" TEXT NOT NULL,
    "inventoryInvoicedNotReceivedAccount" TEXT NOT NULL,
    "bankCashAccount" TEXT NOT NULL,
    "bankLocalCurrencyAccount" TEXT NOT NULL,
    "bankForeignCurrencyAccount" TEXT NOT NULL,

    -- liabilities
    "prepaymentAccount" TEXT NOT NULL,
    "payablesAccount" TEXT NOT NULL,
    "inventoryReceivedNotInvoicedAccount" TEXT NOT NULL,
    "salesTaxPayableAccount" TEXT NOT NULL,
    "purchaseTaxPayableAccount" TEXT NOT NULL,
    "reverseChargeSalesTaxPayableAccount" TEXT NOT NULL,

    -- retained earnings
    "retainedEarningsAccount" TEXT NOT NULL,

    "updatedBy" TEXT,



  CONSTRAINT "accountDefault_pkey" PRIMARY KEY ("companyId"),
  CONSTRAINT "accountDefault_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_salesAccount_fkey" FOREIGN KEY ("salesAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_salesDiscountAccount_fkey" FOREIGN KEY ("salesDiscountAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_costOfGoodsSoldAccount_fkey" FOREIGN KEY ("costOfGoodsSoldAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_purchaseAccount_fkey" FOREIGN KEY ("purchaseAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_directCostAppliedAccount_fkey" FOREIGN KEY ("directCostAppliedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_overheadCostAppliedAccount_fkey" FOREIGN KEY ("overheadCostAppliedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_purchaseVarianceAccount_fkey" FOREIGN KEY ("purchaseVarianceAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_inventoryAdjustmentVarianceAccount_fkey" FOREIGN KEY ("inventoryAdjustmentVarianceAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_materialVarianceAccount_fkey" FOREIGN KEY ("materialVarianceAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_capacityVarianceAccount_fkey" FOREIGN KEY ("capacityVarianceAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_overheadAccount_fkey" FOREIGN KEY ("overheadAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_maintenanceAccount_fkey" FOREIGN KEY ("maintenanceAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_assetDepreciationExpenseAccount_fkey" FOREIGN KEY ("assetDepreciationExpenseAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_assetGainsAndLossesAccount_fkey" FOREIGN KEY ("assetGainsAndLossesAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_serviceChargeAccount_fkey" FOREIGN KEY ("serviceChargeAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_interestAccount_fkey" FOREIGN KEY ("interestAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_supplierPaymentDiscountAccount_fkey" FOREIGN KEY ("supplierPaymentDiscountAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_customerPaymentDiscountAccount_fkey" FOREIGN KEY ("customerPaymentDiscountAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_roundingAccount_fkey" FOREIGN KEY ("roundingAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_aquisitionCostAccount_fkey" FOREIGN KEY ("assetAquisitionCostAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_aquisitionCostOnDisposalAccount_fkey" FOREIGN KEY ("assetAquisitionCostOnDisposalAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_accumulatedDepreciationAccount_fkey" FOREIGN KEY ("accumulatedDepreciationAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_accumulatedDepreciationOnDisposalAccount_fkey" FOREIGN KEY ("accumulatedDepreciationOnDisposalAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_inventoryAccount_fkey" FOREIGN KEY ("inventoryAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_inventoryInterimAccrualAccount_fkey" FOREIGN KEY ("inventoryInterimAccrualAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_workInProgressAccount_fkey" FOREIGN KEY ("workInProgressAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_receivablesAccount_fkey" FOREIGN KEY ("receivablesAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_inventoryShippedNotInvoicedAccount_fkey" FOREIGN KEY ("inventoryShippedNotInvoicedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_bankCashAccount_fkey" FOREIGN KEY ("bankCashAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_bankLocalCurrencyAccount_fkey" FOREIGN KEY ("bankLocalCurrencyAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_bankForeignCurrencyAccount_fkey" FOREIGN KEY ("bankForeignCurrencyAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_prepaymentAccount_fkey" FOREIGN KEY ("prepaymentAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_payablesAccount_fkey" FOREIGN KEY ("payablesAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_inventoryReceivedNotInvoicedAccount_fkey" FOREIGN KEY ("inventoryReceivedNotInvoicedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_salesTaxPayableAccount_fkey" FOREIGN KEY ("salesTaxPayableAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_reverseChargeSalesTaxPayableAccount_fkey" FOREIGN KEY ("reverseChargeSalesTaxPayableAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_purchaseTaxPayableAccount_fkey" FOREIGN KEY ("purchaseTaxPayableAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_retainedEarningsAccount_fkey" FOREIGN KEY ("retainedEarningsAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accountDefault_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "accountDefault" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with accounting_view can view account defaults" ON "accountDefault"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('accounting_view', "companyId")
  );

CREATE POLICY "Employees with accounting_update can update account defaults" ON "accountDefault"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('accounting_update', "companyId")
  );



CREATE TABLE "postingGroupInventory" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "itemPostingGroupId" TEXT,
  "locationId" TEXT,
  "costOfGoodsSoldAccount" TEXT NOT NULL,
  "inventoryAccount" TEXT NOT NULL,
  "inventoryInterimAccrualAccount" TEXT NOT NULL,
  "inventoryReceivedNotInvoicedAccount" TEXT NOT NULL,
  "inventoryInvoicedNotReceivedAccount" TEXT NOT NULL,
  "inventoryShippedNotInvoicedAccount" TEXT NOT NULL,
  "workInProgressAccount" TEXT NOT NULL,
  "directCostAppliedAccount" TEXT NOT NULL,
  "overheadAccount" TEXT NOT NULL,
  "overheadCostAppliedAccount" TEXT NOT NULL,
  "purchaseVarianceAccount" TEXT NOT NULL,
  "inventoryAdjustmentVarianceAccount" TEXT NOT NULL,
  "materialVarianceAccount" TEXT NOT NULL,
  "capacityVarianceAccount" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "updatedBy" TEXT,

  CONSTRAINT "postingGroupInventory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "postingGroupInventory_id_itemPostingGroupId_locationId_key" UNIQUE ("itemPostingGroupId", "locationId"),
  CONSTRAINT "postingGroupInventory_itemPostingGroupId_fkey" FOREIGN KEY ("itemPostingGroupId") REFERENCES "itemPostingGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_costOfGoodsSoldAccount_fkey" FOREIGN KEY ("costOfGoodsSoldAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_inventoryAccount_fkey" FOREIGN KEY ("inventoryAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_inventoryInterimAccrualAccount_fkey" FOREIGN KEY ("inventoryInterimAccrualAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_inventoryReceivedNotInvoicedAccount_fkey" FOREIGN KEY ("inventoryReceivedNotInvoicedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_inventoryInvoicedNotReceivedAccount_fkey" FOREIGN KEY ("inventoryInvoicedNotReceivedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_inventoryShippedNotInvoicedAccount_fkey" FOREIGN KEY ("inventoryShippedNotInvoicedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_workInProgressAccount_fkey" FOREIGN KEY ("workInProgressAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_directCostAppliedAccount_fkey" FOREIGN KEY ("directCostAppliedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_overheadCostAppliedAccount_fkey" FOREIGN KEY ("overheadCostAppliedAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_purchaseVarianceAccount_fkey" FOREIGN KEY ("purchaseVarianceAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_inventoryAdjustmentVarianceAccount_fkey" FOREIGN KEY ("inventoryAdjustmentVarianceAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_materialVarianceAccount_fkey" FOREIGN KEY ("materialVarianceAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_capacityVarianceAccount_fkey" FOREIGN KEY ("capacityVarianceAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_overheadAccount_fkey" FOREIGN KEY ("overheadAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupInventory_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "postingGroupInventory_itemPostingGroupId_locationId_idx" ON "postingGroupInventory" ("itemPostingGroupId", "locationId");
CREATE INDEX "postingGroupInventory_companyId_idx" ON "postingGroupInventory" ("companyId");

ALTER TABLE "postingGroupInventory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with accounting_view can view inventory posting groups" ON "postingGroupInventory"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('accounting_view', "companyId")
  );

CREATE POLICY "Employees with accounting_update can update inventory posting groups" ON "postingGroupInventory"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('accounting_update', "companyId")
  );


CREATE TABLE "postingGroupPurchasing" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "supplierTypeId" TEXT,
  "itemPostingGroupId" TEXT,
  "payablesAccount" TEXT NOT NULL,
  "purchaseAccount" TEXT NOT NULL,
  "purchaseDiscountAccount" TEXT NOT NULL,
  "purchaseCreditAccount" TEXT NOT NULL,
  "purchasePrepaymentAccount" TEXT NOT NULL,
  "purchaseTaxPayableAccount" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "updatedBy" TEXT,

  CONSTRAINT "postingGroupPurchasing_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "postingGroupPurchasing_id_supplierTypeId_itemPostingGroupId_key" UNIQUE ("supplierTypeId", "itemPostingGroupId"),
  CONSTRAINT "postingGroupPurchasing_itemPostingGroupId_fkey" FOREIGN KEY ("itemPostingGroupId") REFERENCES "itemPostingGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "postingGroupPurchasing_supplierTypeId_fkey" FOREIGN KEY ("supplierTypeId") REFERENCES "supplierType" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "postingGroupPurchasing_payablesAccount_fkey" FOREIGN KEY ("payablesAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupPurchasing_purchaseAccount_fkey" FOREIGN KEY ("purchaseAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupPurchasing_purchaseDiscountAccount_fkey" FOREIGN KEY ("purchaseDiscountAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupPurchasing_purchaseCreditAccount_fkey" FOREIGN KEY ("purchaseCreditAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupPurchasing_purchasePrepaymentAccount_fkey" FOREIGN KEY ("purchasePrepaymentAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupPurchasing_purchaseTaxPayableAccount_fkey" FOREIGN KEY ("purchaseTaxPayableAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupPurchasing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "postingGroupPurchasing_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "postingGroupPurchasing_itemPostingGroupId_supplierTypeId_idx" ON "postingGroupPurchasing" ("itemPostingGroupId", "supplierTypeId");
CREATE INDEX "postingGroupPurchasing_companyId_idx" ON "postingGroupPurchasing" ("companyId");

ALTER TABLE "postingGroupPurchasing" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with accounting_view can view purchasing posting groups" ON "postingGroupPurchasing"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('accounting_view', "companyId")
  );

CREATE POLICY "Employees with accounting_update can update purchasing posting groups" ON "postingGroupPurchasing"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('accounting_update', "companyId")
  );

CREATE TABLE "postingGroupSales" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "customerTypeId" TEXT,
  "itemPostingGroupId" TEXT,
  "receivablesAccount" TEXT NOT NULL,
  "salesAccount" TEXT NOT NULL,
  "salesDiscountAccount" TEXT NOT NULL,
  "salesCreditAccount" TEXT NOT NULL,
  "salesPrepaymentAccount" TEXT NOT NULL,
  "salesTaxPayableAccount" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "updatedBy" TEXT,

  CONSTRAINT "postingGroupSales_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "postingGroupSales_id_customerTypeId_itemPostingGroupId_key" UNIQUE ("customerTypeId", "itemPostingGroupId"),
  CONSTRAINT "postingGroupSales_itemPostingGroupId_fkey" FOREIGN KEY ("itemPostingGroupId") REFERENCES "itemPostingGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "postingGroupSales_customerTypeId_fkey" FOREIGN KEY ("customerTypeId") REFERENCES "customerType" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "postingGroupSales_receivablesAccount_fkey" FOREIGN KEY ("receivablesAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupSales_salesAccount_fkey" FOREIGN KEY ("salesAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupSales_salesDiscountAccount_fkey" FOREIGN KEY ("salesDiscountAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupSales_salesCreditAccount_fkey" FOREIGN KEY ("salesCreditAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupSales_salesPrepaymentAccount_fkey" FOREIGN KEY ("salesPrepaymentAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupSales_salesTaxPayableAccount_fkey" FOREIGN KEY ("salesTaxPayableAccount", "companyId") REFERENCES "account" ("number", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "postingGroupSales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "postingGroupSales_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "postingGroupSales_itemPostingGroupId_customerTypeId_idx" ON "postingGroupSales" ("itemPostingGroupId", "customerTypeId");
CREATE INDEX "postingGroupSales_companyId_idx" ON "postingGroupSales" ("companyId");

CREATE POLICY "Employees with accounting_view can view sales posting groups" ON "postingGroupSales"
  FOR SELECT
  USING (
    has_role('employee') AND
    has_company_permission('accounting_view', "companyId")
  );

CREATE POLICY "Employees with accounting_update can update sales posting groups" ON "postingGroupSales"
  FOR UPDATE
  USING (
    has_role('employee') AND
    has_company_permission('accounting_update', "companyId")
  );

CREATE FUNCTION public.create_posting_groups_for_location()
RETURNS TRIGGER AS $$
DECLARE
  part_group RECORD;
  account_defaults RECORD;
BEGIN
  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = new."companyId";

  FOR part_group IN SELECT "id" FROM "itemPostingGroup"
  LOOP
    INSERT INTO "postingGroupInventory" (
      "itemPostingGroupId",
      "locationId",
      "costOfGoodsSoldAccount",
      "inventoryAccount",
      "inventoryInterimAccrualAccount",
      "inventoryReceivedNotInvoicedAccount",
      "inventoryInvoicedNotReceivedAccount",
      "inventoryShippedNotInvoicedAccount",
      "workInProgressAccount",
      "directCostAppliedAccount",
      "overheadCostAppliedAccount",
      "purchaseVarianceAccount",
      "inventoryAdjustmentVarianceAccount",
      "materialVarianceAccount",
      "capacityVarianceAccount",
      "overheadAccount",
      "companyId",
      "updatedBy"
    ) VALUES (
      part_group."id",
      new."id",
      account_defaults."costOfGoodsSoldAccount",
      account_defaults."inventoryAccount",
      account_defaults."inventoryInterimAccrualAccount",
      account_defaults."inventoryReceivedNotInvoicedAccount",
      account_defaults."inventoryInvoicedNotReceivedAccount",
      account_defaults."inventoryShippedNotInvoicedAccount",
      account_defaults."workInProgressAccount",
      account_defaults."directCostAppliedAccount",
      account_defaults."overheadCostAppliedAccount",
      account_defaults."purchaseVarianceAccount",
      account_defaults."inventoryAdjustmentVarianceAccount",
      account_defaults."materialVarianceAccount",
      account_defaults."capacityVarianceAccount",
      account_defaults."overheadAccount",
      new."companyId",
      new."createdBy"
    );
  END LOOP;

  -- insert the null item group
  INSERT INTO "postingGroupInventory" (
    "itemPostingGroupId",
    "locationId",
    "costOfGoodsSoldAccount",
    "inventoryAccount",
    "inventoryInterimAccrualAccount",
    "inventoryReceivedNotInvoicedAccount",
    "inventoryInvoicedNotReceivedAccount",
    "inventoryShippedNotInvoicedAccount",
    "workInProgressAccount",
    "directCostAppliedAccount",
    "overheadCostAppliedAccount",
    "purchaseVarianceAccount",
    "inventoryAdjustmentVarianceAccount",
    "materialVarianceAccount",
    "capacityVarianceAccount",
    "overheadAccount",
    "companyId",
    "updatedBy"
  ) VALUES (
    NULL,
    new."id",
    account_defaults."costOfGoodsSoldAccount",
    account_defaults."inventoryAccount",
    account_defaults."inventoryInterimAccrualAccount",
    account_defaults."inventoryReceivedNotInvoicedAccount",
    account_defaults."inventoryInvoicedNotReceivedAccount",
    account_defaults."inventoryShippedNotInvoicedAccount",
    account_defaults."workInProgressAccount",
    account_defaults."directCostAppliedAccount",
    account_defaults."overheadCostAppliedAccount",
    account_defaults."purchaseVarianceAccount",
    account_defaults."inventoryAdjustmentVarianceAccount",
    account_defaults."materialVarianceAccount",
    account_defaults."capacityVarianceAccount",
    account_defaults."overheadAccount",
    new."companyId",
    new."createdBy"
  );

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_location
  AFTER INSERT on public."location"
  FOR EACH ROW EXECUTE PROCEDURE public.create_posting_groups_for_location();


CREATE FUNCTION public.create_posting_groups_for_part_group()
RETURNS TRIGGER AS $$
DECLARE
  rec RECORD;
  account_defaults RECORD;
BEGIN
  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = new."companyId";

  FOR rec IN SELECT "id" FROM "customerType"
  LOOP
    INSERT INTO "postingGroupSales" (
      "itemPostingGroupId",
      "customerTypeId",
      "receivablesAccount",
      "salesAccount",
      "salesDiscountAccount",
      "salesCreditAccount",
      "salesPrepaymentAccount",
      "salesTaxPayableAccount",
      "companyId",
      "updatedBy"
    ) VALUES (
      new."id",
      rec."id",
      account_defaults."receivablesAccount",
      account_defaults."salesAccount",
      account_defaults."salesDiscountAccount",
      account_defaults."receivablesAccount",
      account_defaults."prepaymentAccount",
      account_defaults."salesTaxPayableAccount",
      new."companyId",
      new."createdBy"
    );
  END LOOP;

  -- insert the null customer type
  INSERT INTO "postingGroupSales" (
    "itemPostingGroupId",
    "customerTypeId",
    "receivablesAccount",
    "salesAccount",
    "salesDiscountAccount",
    "salesCreditAccount",
    "salesPrepaymentAccount",
    "salesTaxPayableAccount",
    "companyId",
    "updatedBy"
  ) VALUES (
    new."id",
    NULL,
    account_defaults."receivablesAccount",
    account_defaults."salesAccount",
    account_defaults."salesDiscountAccount",
    account_defaults."receivablesAccount",
    account_defaults."prepaymentAccount",
    account_defaults."salesTaxPayableAccount",
    new."companyId",
    new."createdBy"
  );

  FOR rec IN SELECT "id" FROM "supplierType"
  LOOP
    INSERT INTO "postingGroupPurchasing" (
      "itemPostingGroupId",
      "supplierTypeId",
      "payablesAccount", 
      "purchaseAccount",
      "purchaseDiscountAccount",
      "purchaseCreditAccount",
      "purchasePrepaymentAccount",
      "purchaseTaxPayableAccount",
      "companyId",
      "updatedBy"
    ) VALUES (
      new."id",
      rec."id",
      account_defaults."payablesAccount",
      account_defaults."purchaseAccount",
      account_defaults."purchaseAccount",
      account_defaults."payablesAccount",
      account_defaults."prepaymentAccount",
      account_defaults."purchaseTaxPayableAccount",
      new."companyId",
      new."createdBy"
    );
  END LOOP;

  -- insert the null supplier type
  INSERT INTO "postingGroupPurchasing" (
    "itemPostingGroupId",
    "supplierTypeId",
    "payablesAccount",
    "purchaseAccount",
    "purchaseDiscountAccount",
    "purchaseCreditAccount",
    "purchasePrepaymentAccount",
    "purchaseTaxPayableAccount",
    "companyId",
    "updatedBy"
  ) VALUES (
    new."id",
    NULL,
    account_defaults."payablesAccount",
    account_defaults."purchaseAccount",
    account_defaults."purchaseAccount",
    account_defaults."payablesAccount",
    account_defaults."prepaymentAccount",
    account_defaults."purchaseTaxPayableAccount",
    new."companyId",
    new."createdBy"
  );

  FOR rec IN SELECT "id" FROM "location"
  LOOP
    INSERT INTO "postingGroupInventory" (
      "itemPostingGroupId",
      "locationId",
      "costOfGoodsSoldAccount",
      "inventoryAccount",
      "inventoryInterimAccrualAccount",
      "inventoryReceivedNotInvoicedAccount",
      "inventoryInvoicedNotReceivedAccount",
      "inventoryShippedNotInvoicedAccount",
      "workInProgressAccount",
      "directCostAppliedAccount",
      "overheadCostAppliedAccount",
      "purchaseVarianceAccount",
      "inventoryAdjustmentVarianceAccount",
      "materialVarianceAccount",
      "capacityVarianceAccount",
      "overheadAccount",
      "companyId",
      "updatedBy"
    ) VALUES (
      new."id",
      rec."id",
      account_defaults."costOfGoodsSoldAccount",
      account_defaults."inventoryAccount",
      account_defaults."inventoryInterimAccrualAccount",
      account_defaults."inventoryReceivedNotInvoicedAccount",
      account_defaults."inventoryInvoicedNotReceivedAccount",
      account_defaults."inventoryShippedNotInvoicedAccount",
      account_defaults."workInProgressAccount",
      account_defaults."directCostAppliedAccount",
      account_defaults."overheadCostAppliedAccount",
      account_defaults."purchaseVarianceAccount",
      account_defaults."inventoryAdjustmentVarianceAccount",
      account_defaults."materialVarianceAccount",
      account_defaults."capacityVarianceAccount",
      account_defaults."overheadAccount",
      new."companyId",
      new."createdBy"
    );
  END LOOP;

  -- insert the null location
  INSERT INTO "postingGroupInventory" (
    "itemPostingGroupId",
    "locationId",
    "costOfGoodsSoldAccount",
    "inventoryAccount",
    "inventoryInterimAccrualAccount",
    "inventoryReceivedNotInvoicedAccount",
    "inventoryInvoicedNotReceivedAccount",
    "inventoryShippedNotInvoicedAccount",
    "workInProgressAccount",
    "directCostAppliedAccount",
    "overheadCostAppliedAccount",
    "purchaseVarianceAccount",
    "inventoryAdjustmentVarianceAccount",
    "materialVarianceAccount",
    "capacityVarianceAccount",
    "overheadAccount",
    "companyId",
    "updatedBy"
  ) VALUES (
    new."id",
    NULL,
    account_defaults."costOfGoodsSoldAccount",
    account_defaults."inventoryAccount",
    account_defaults."inventoryInterimAccrualAccount",
    account_defaults."inventoryReceivedNotInvoicedAccount",
    account_defaults."inventoryInvoicedNotReceivedAccount",
    account_defaults."inventoryShippedNotInvoicedAccount",
    account_defaults."workInProgressAccount",
    account_defaults."directCostAppliedAccount",
    account_defaults."overheadCostAppliedAccount",
    account_defaults."purchaseVarianceAccount",
    account_defaults."inventoryAdjustmentVarianceAccount",
    account_defaults."materialVarianceAccount",
    account_defaults."capacityVarianceAccount",
    account_defaults."overheadAccount",
    new."companyId",
    new."createdBy"
  );

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE TRIGGER create_part_group
  AFTER INSERT on public."itemPostingGroup"
  FOR EACH ROW EXECUTE PROCEDURE public.create_posting_groups_for_part_group();

CREATE FUNCTION public.create_posting_groups_for_customer_type()
RETURNS TRIGGER AS $$
DECLARE
  rec RECORD;
  account_defaults RECORD;
BEGIN
  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = new."companyId";

  FOR rec IN SELECT "id" FROM "itemPostingGroup"
  LOOP
    INSERT INTO "postingGroupSales" (
      "customerTypeId",
      "itemPostingGroupId",
      "receivablesAccount",
      "salesAccount",
      "salesDiscountAccount",
      "salesCreditAccount",
      "salesPrepaymentAccount",
      "salesTaxPayableAccount",
      "companyId",
      "updatedBy"
    ) VALUES (
      new."id",
      rec."id",
      account_defaults."receivablesAccount",
      account_defaults."salesAccount",
      account_defaults."salesDiscountAccount",
      account_defaults."salesAccount",
      account_defaults."prepaymentAccount",
      account_defaults."salesTaxPayableAccount",
      new."companyId",
      new."createdBy"
    );
  END LOOP;

  -- insert the null item group
  INSERT INTO "postingGroupSales" (
    "customerTypeId",
    "itemPostingGroupId",
    "receivablesAccount",
    "salesAccount",
    "salesDiscountAccount",
    "salesCreditAccount",
    "salesPrepaymentAccount",
    "salesTaxPayableAccount",
    "companyId",
    "updatedBy"
  ) VALUES (
    new."id",
    NULL,
    account_defaults."receivablesAccount",
    account_defaults."salesAccount",
    account_defaults."salesDiscountAccount",
    account_defaults."salesAccount",
    account_defaults."prepaymentAccount",
    account_defaults."salesTaxPayableAccount",
    new."companyId",
    new."createdBy"
  );

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_posting_groups_for_customer_type
  AFTER INSERT on public."customerType"
  FOR EACH ROW EXECUTE PROCEDURE public.create_posting_groups_for_customer_type();


CREATE FUNCTION public.create_posting_groups_for_supplier_type()
RETURNS TRIGGER AS $$
DECLARE
  rec RECORD;
  account_defaults RECORD;
BEGIN
  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = new."companyId";

  FOR rec IN SELECT "id" FROM "itemPostingGroup"
  LOOP
    INSERT INTO "postingGroupPurchasing" (
      "supplierTypeId",
      "itemPostingGroupId",
      "payablesAccount",
      "purchaseAccount",
      "purchaseDiscountAccount",
      "purchaseCreditAccount",
      "purchasePrepaymentAccount",
      "purchaseTaxPayableAccount",
      "companyId",
      "updatedBy"
    ) VALUES (
      new."id",
      rec."id",
      account_defaults."payablesAccount",
      account_defaults."purchaseAccount",
      account_defaults."purchaseAccount",
      account_defaults."purchaseAccount",
      account_defaults."prepaymentAccount",
      account_defaults."purchaseTaxPayableAccount",
      new."companyId",
      new."createdBy"
    );
  END LOOP;

  -- insert the null item group
  INSERT INTO "postingGroupPurchasing" (
    "supplierTypeId",
    "itemPostingGroupId",
    "payablesAccount",
    "purchaseAccount",
    "purchaseDiscountAccount",
    "purchaseCreditAccount",
    "purchasePrepaymentAccount",
    "purchaseTaxPayableAccount",
    "companyId",
    "updatedBy"
  ) VALUES (
    new."id",
    NULL,
    account_defaults."payablesAccount",
    account_defaults."purchaseAccount",
    account_defaults."purchaseAccount",
    account_defaults."purchaseAccount",
    account_defaults."prepaymentAccount",
    account_defaults."purchaseTaxPayableAccount",
    new."companyId",
    new."createdBy"
  );

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER create_posting_groups_for_supplier_type
  AFTER INSERT on public."supplierType"
  FOR EACH ROW EXECUTE PROCEDURE public.create_posting_groups_for_supplier_type();
