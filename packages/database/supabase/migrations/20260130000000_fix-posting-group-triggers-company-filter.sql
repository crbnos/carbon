-- Fix: All posting group triggers were missing companyId filters in their loops,
-- causing cross-company row pollution. When a location was created in Company A,
-- it would create postingGroupInventory rows for itemPostingGroups belonging to
-- Companies B, C, etc. Same issue in all four trigger functions.

-- 1. Fix create_related_records_for_location (location trigger)
CREATE OR REPLACE FUNCTION public.create_related_records_for_location()
RETURNS TRIGGER AS $$
DECLARE
  item_posting_group RECORD;
  account_defaults RECORD;
BEGIN
  -- create itemPlanning records for the new location
  INSERT INTO public."itemPlanning" ("itemId", "locationId", "createdBy", "companyId", "createdAt", "updatedAt")
  SELECT
    i.id AS "itemId",
    new.id AS "locationId",
    i."createdBy",
    i."companyId",
    NOW(),
    NOW()
  FROM public."item" i
  WHERE i."companyId" = new."companyId";

  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = new."companyId";

  FOR item_posting_group IN SELECT "id" FROM "itemPostingGroup" WHERE "companyId" = new."companyId"
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
      item_posting_group."id",
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


-- 2. Fix create_posting_groups_for_item_posting_group (item posting group trigger)
CREATE OR REPLACE FUNCTION public.create_posting_groups_for_item_posting_group()
RETURNS TRIGGER AS $$
DECLARE
  rec RECORD;
  account_defaults RECORD;
BEGIN
  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = new."companyId";

  FOR rec IN SELECT "id" FROM "customerType" WHERE "companyId" = new."companyId"
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

  FOR rec IN SELECT "id" FROM "supplierType" WHERE "companyId" = new."companyId"
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

  FOR rec IN SELECT "id" FROM "location" WHERE "companyId" = new."companyId"
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


-- 3. Fix create_posting_groups_for_customer_type (customer type trigger)
CREATE OR REPLACE FUNCTION public.create_posting_groups_for_customer_type()
RETURNS TRIGGER AS $$
DECLARE
  rec RECORD;
  account_defaults RECORD;
BEGIN
  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = new."companyId";

  FOR rec IN SELECT "id" FROM "itemPostingGroup" WHERE "companyId" = new."companyId"
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


-- 4. Fix create_posting_groups_for_supplier_type (supplier type trigger)
CREATE OR REPLACE FUNCTION public.create_posting_groups_for_supplier_type()
RETURNS TRIGGER AS $$
DECLARE
  rec RECORD;
  account_defaults RECORD;
BEGIN
  SELECT * INTO account_defaults FROM "accountDefault" WHERE "companyId" = new."companyId";

  FOR rec IN SELECT "id" FROM "itemPostingGroup" WHERE "companyId" = new."companyId"
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


-- 5. Truncate all posting group tables and rebuild from scratch

TRUNCATE "postingGroupInventory";
TRUNCATE "postingGroupSales";
TRUNCATE "postingGroupPurchasing";

-- Rebuild postingGroupInventory: (itemPostingGroup × location) within same company
INSERT INTO "postingGroupInventory" (
  "itemPostingGroupId", "locationId",
  "costOfGoodsSoldAccount", "inventoryAccount", "inventoryInterimAccrualAccount",
  "inventoryReceivedNotInvoicedAccount", "inventoryInvoicedNotReceivedAccount",
  "inventoryShippedNotInvoicedAccount", "workInProgressAccount",
  "directCostAppliedAccount", "overheadCostAppliedAccount",
  "purchaseVarianceAccount", "inventoryAdjustmentVarianceAccount",
  "materialVarianceAccount", "capacityVarianceAccount", "overheadAccount",
  "companyId"
)
SELECT
  ipg."id", l."id",
  ad."costOfGoodsSoldAccount", ad."inventoryAccount", ad."inventoryInterimAccrualAccount",
  ad."inventoryReceivedNotInvoicedAccount", ad."inventoryInvoicedNotReceivedAccount",
  ad."inventoryShippedNotInvoicedAccount", ad."workInProgressAccount",
  ad."directCostAppliedAccount", ad."overheadCostAppliedAccount",
  ad."purchaseVarianceAccount", ad."inventoryAdjustmentVarianceAccount",
  ad."materialVarianceAccount", ad."capacityVarianceAccount", ad."overheadAccount",
  ipg."companyId"
FROM "itemPostingGroup" ipg
CROSS JOIN "location" l
JOIN "accountDefault" ad ON ad."companyId" = ipg."companyId"
WHERE l."companyId" = ipg."companyId";

-- Rebuild postingGroupInventory: (itemPostingGroup × NULL location)
INSERT INTO "postingGroupInventory" (
  "itemPostingGroupId", "locationId",
  "costOfGoodsSoldAccount", "inventoryAccount", "inventoryInterimAccrualAccount",
  "inventoryReceivedNotInvoicedAccount", "inventoryInvoicedNotReceivedAccount",
  "inventoryShippedNotInvoicedAccount", "workInProgressAccount",
  "directCostAppliedAccount", "overheadCostAppliedAccount",
  "purchaseVarianceAccount", "inventoryAdjustmentVarianceAccount",
  "materialVarianceAccount", "capacityVarianceAccount", "overheadAccount",
  "companyId"
)
SELECT
  ipg."id", NULL,
  ad."costOfGoodsSoldAccount", ad."inventoryAccount", ad."inventoryInterimAccrualAccount",
  ad."inventoryReceivedNotInvoicedAccount", ad."inventoryInvoicedNotReceivedAccount",
  ad."inventoryShippedNotInvoicedAccount", ad."workInProgressAccount",
  ad."directCostAppliedAccount", ad."overheadCostAppliedAccount",
  ad."purchaseVarianceAccount", ad."inventoryAdjustmentVarianceAccount",
  ad."materialVarianceAccount", ad."capacityVarianceAccount", ad."overheadAccount",
  ipg."companyId"
FROM "itemPostingGroup" ipg
JOIN "accountDefault" ad ON ad."companyId" = ipg."companyId";

-- Rebuild postingGroupInventory: (NULL itemPostingGroup × location)
INSERT INTO "postingGroupInventory" (
  "itemPostingGroupId", "locationId",
  "costOfGoodsSoldAccount", "inventoryAccount", "inventoryInterimAccrualAccount",
  "inventoryReceivedNotInvoicedAccount", "inventoryInvoicedNotReceivedAccount",
  "inventoryShippedNotInvoicedAccount", "workInProgressAccount",
  "directCostAppliedAccount", "overheadCostAppliedAccount",
  "purchaseVarianceAccount", "inventoryAdjustmentVarianceAccount",
  "materialVarianceAccount", "capacityVarianceAccount", "overheadAccount",
  "companyId"
)
SELECT
  NULL, l."id",
  ad."costOfGoodsSoldAccount", ad."inventoryAccount", ad."inventoryInterimAccrualAccount",
  ad."inventoryReceivedNotInvoicedAccount", ad."inventoryInvoicedNotReceivedAccount",
  ad."inventoryShippedNotInvoicedAccount", ad."workInProgressAccount",
  ad."directCostAppliedAccount", ad."overheadCostAppliedAccount",
  ad."purchaseVarianceAccount", ad."inventoryAdjustmentVarianceAccount",
  ad."materialVarianceAccount", ad."capacityVarianceAccount", ad."overheadAccount",
  l."companyId"
FROM "location" l
JOIN "accountDefault" ad ON ad."companyId" = l."companyId";

-- Rebuild postingGroupSales: (itemPostingGroup × customerType) within same company
INSERT INTO "postingGroupSales" (
  "itemPostingGroupId", "customerTypeId",
  "receivablesAccount", "salesAccount", "salesDiscountAccount",
  "salesCreditAccount", "salesPrepaymentAccount", "salesTaxPayableAccount",
  "companyId"
)
SELECT
  ipg."id", ct."id",
  ad."receivablesAccount", ad."salesAccount", ad."salesDiscountAccount",
  ad."receivablesAccount", ad."prepaymentAccount", ad."salesTaxPayableAccount",
  ipg."companyId"
FROM "itemPostingGroup" ipg
CROSS JOIN "customerType" ct
JOIN "accountDefault" ad ON ad."companyId" = ipg."companyId"
WHERE ct."companyId" = ipg."companyId";

-- Rebuild postingGroupSales: (itemPostingGroup × NULL customerType)
INSERT INTO "postingGroupSales" (
  "itemPostingGroupId", "customerTypeId",
  "receivablesAccount", "salesAccount", "salesDiscountAccount",
  "salesCreditAccount", "salesPrepaymentAccount", "salesTaxPayableAccount",
  "companyId"
)
SELECT
  ipg."id", NULL,
  ad."receivablesAccount", ad."salesAccount", ad."salesDiscountAccount",
  ad."receivablesAccount", ad."prepaymentAccount", ad."salesTaxPayableAccount",
  ipg."companyId"
FROM "itemPostingGroup" ipg
JOIN "accountDefault" ad ON ad."companyId" = ipg."companyId";

-- Rebuild postingGroupSales: (NULL itemPostingGroup × customerType)
INSERT INTO "postingGroupSales" (
  "itemPostingGroupId", "customerTypeId",
  "receivablesAccount", "salesAccount", "salesDiscountAccount",
  "salesCreditAccount", "salesPrepaymentAccount", "salesTaxPayableAccount",
  "companyId"
)
SELECT
  NULL, ct."id",
  ad."receivablesAccount", ad."salesAccount", ad."salesDiscountAccount",
  ad."receivablesAccount", ad."prepaymentAccount", ad."salesTaxPayableAccount",
  ct."companyId"
FROM "customerType" ct
JOIN "accountDefault" ad ON ad."companyId" = ct."companyId";

-- Rebuild postingGroupPurchasing: (itemPostingGroup × supplierType) within same company
INSERT INTO "postingGroupPurchasing" (
  "itemPostingGroupId", "supplierTypeId",
  "payablesAccount", "purchaseAccount", "purchaseDiscountAccount",
  "purchaseCreditAccount", "purchasePrepaymentAccount", "purchaseTaxPayableAccount",
  "companyId"
)
SELECT
  ipg."id", st."id",
  ad."payablesAccount", ad."purchaseAccount", ad."purchaseAccount",
  ad."payablesAccount", ad."prepaymentAccount", ad."purchaseTaxPayableAccount",
  ipg."companyId"
FROM "itemPostingGroup" ipg
CROSS JOIN "supplierType" st
JOIN "accountDefault" ad ON ad."companyId" = ipg."companyId"
WHERE st."companyId" = ipg."companyId";

-- Rebuild postingGroupPurchasing: (itemPostingGroup × NULL supplierType)
INSERT INTO "postingGroupPurchasing" (
  "itemPostingGroupId", "supplierTypeId",
  "payablesAccount", "purchaseAccount", "purchaseDiscountAccount",
  "purchaseCreditAccount", "purchasePrepaymentAccount", "purchaseTaxPayableAccount",
  "companyId"
)
SELECT
  ipg."id", NULL,
  ad."payablesAccount", ad."purchaseAccount", ad."purchaseAccount",
  ad."payablesAccount", ad."prepaymentAccount", ad."purchaseTaxPayableAccount",
  ipg."companyId"
FROM "itemPostingGroup" ipg
JOIN "accountDefault" ad ON ad."companyId" = ipg."companyId";

-- Rebuild postingGroupPurchasing: (NULL itemPostingGroup × supplierType)
INSERT INTO "postingGroupPurchasing" (
  "itemPostingGroupId", "supplierTypeId",
  "payablesAccount", "purchaseAccount", "purchaseDiscountAccount",
  "purchaseCreditAccount", "purchasePrepaymentAccount", "purchaseTaxPayableAccount",
  "companyId"
)
SELECT
  NULL, st."id",
  ad."payablesAccount", ad."purchaseAccount", ad."purchaseAccount",
  ad."payablesAccount", ad."prepaymentAccount", ad."purchaseTaxPayableAccount",
  st."companyId"
FROM "supplierType" st
JOIN "accountDefault" ad ON ad."companyId" = st."companyId";
