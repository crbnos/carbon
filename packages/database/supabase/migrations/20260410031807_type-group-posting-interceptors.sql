-- =============================================================================
-- Convert customerType/supplierType group and posting group triggers to
-- event system interceptors.
--
-- Converts 6 legacy triggers:
--   - create/update customer type group
--   - create posting groups for customer type
--   - create/update supplier type group
--   - create posting groups for supplier type
--
-- Neither customerType nor supplierType was previously on the event system.
-- =============================================================================


-- =============================================================================
-- PART 1: Create Interceptor Functions
-- =============================================================================

-- 1. customerType AFTER INSERT -> creates group + membership (AFTER interceptor)
CREATE OR REPLACE FUNCTION sync_create_customer_type_group(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "group" ("id", "name", "isCustomerTypeGroup", "companyId")
  VALUES (
    p_new->>'id',
    p_new->>'name',
    TRUE,
    p_new->>'companyId'
  );

  INSERT INTO "membership" ("groupId", "memberGroupId")
  VALUES (
    '11111111-1111-'
      || substring((p_new->>'companyId')::text, 1, 4) || '-'
      || substring((p_new->>'companyId')::text, 5, 4) || '-'
      || substring((p_new->>'companyId')::text, 9, 12),
    p_new->>'id'
  );
END;
$$;


-- 2. customerType AFTER UPDATE -> updates group name (BEFORE interceptor)
CREATE OR REPLACE FUNCTION sync_update_customer_type_group_name(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  UPDATE "group"
  SET "name" = p_new->>'name'
  WHERE "id" = p_new->>'id'
    AND "isCustomerTypeGroup" = TRUE;
END;
$$;


-- 3. customerType AFTER INSERT -> creates posting group sales rows (AFTER interceptor)
CREATE OR REPLACE FUNCTION sync_create_posting_groups_for_customer_type(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  account_defaults RECORD;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  SELECT * INTO account_defaults
  FROM "accountDefault"
  WHERE "companyId" = p_new->>'companyId';

  FOR rec IN SELECT "id" FROM "itemPostingGroup" WHERE "companyId" = p_new->>'companyId'
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
      p_new->>'id',
      rec."id",
      account_defaults."receivablesAccount",
      account_defaults."salesAccount",
      account_defaults."salesDiscountAccount",
      account_defaults."salesAccount",
      account_defaults."prepaymentAccount",
      account_defaults."salesTaxPayableAccount",
      p_new->>'companyId',
      p_new->>'createdBy'
    );
  END LOOP;

  -- Insert the null item posting group row
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
    p_new->>'id',
    NULL,
    account_defaults."receivablesAccount",
    account_defaults."salesAccount",
    account_defaults."salesDiscountAccount",
    account_defaults."salesAccount",
    account_defaults."prepaymentAccount",
    account_defaults."salesTaxPayableAccount",
    p_new->>'companyId',
    p_new->>'createdBy'
  );
END;
$$;


-- 4. supplierType AFTER INSERT -> creates group + membership (AFTER interceptor)
CREATE OR REPLACE FUNCTION sync_create_supplier_type_group(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "group" ("id", "name", "isSupplierTypeGroup", "companyId")
  VALUES (
    p_new->>'id',
    p_new->>'name',
    TRUE,
    p_new->>'companyId'
  );

  INSERT INTO "membership" ("groupId", "memberGroupId")
  VALUES (
    '22222222-2222-'
      || substring((p_new->>'companyId')::text, 1, 4) || '-'
      || substring((p_new->>'companyId')::text, 5, 4) || '-'
      || substring((p_new->>'companyId')::text, 9, 12),
    p_new->>'id'
  );
END;
$$;


-- 5. supplierType AFTER UPDATE -> updates group name (BEFORE interceptor)
CREATE OR REPLACE FUNCTION sync_update_supplier_type_group_name(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  UPDATE "group"
  SET "name" = p_new->>'name'
  WHERE "id" = p_new->>'id'
    AND "isSupplierTypeGroup" = TRUE;
END;
$$;


-- 6. supplierType AFTER INSERT -> creates posting group purchasing rows (AFTER interceptor)
CREATE OR REPLACE FUNCTION sync_create_posting_groups_for_supplier_type(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  account_defaults RECORD;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  SELECT * INTO account_defaults
  FROM "accountDefault"
  WHERE "companyId" = p_new->>'companyId';

  FOR rec IN SELECT "id" FROM "itemPostingGroup" WHERE "companyId" = p_new->>'companyId'
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
      p_new->>'id',
      rec."id",
      account_defaults."payablesAccount",
      account_defaults."purchaseAccount",
      account_defaults."purchaseAccount",
      account_defaults."purchaseAccount",
      account_defaults."prepaymentAccount",
      account_defaults."purchaseTaxPayableAccount",
      p_new->>'companyId',
      p_new->>'createdBy'
    );
  END LOOP;

  -- Insert the null item posting group row
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
    p_new->>'id',
    NULL,
    account_defaults."payablesAccount",
    account_defaults."purchaseAccount",
    account_defaults."purchaseAccount",
    account_defaults."purchaseAccount",
    account_defaults."prepaymentAccount",
    account_defaults."purchaseTaxPayableAccount",
    p_new->>'companyId',
    p_new->>'createdBy'
  );
END;
$$;


-- =============================================================================
-- PART 2: Drop Legacy Triggers
-- =============================================================================

DROP TRIGGER IF EXISTS create_customer_type_group ON "customerType";
DROP TRIGGER IF EXISTS update_customer_type_group ON "customerType";
DROP TRIGGER IF EXISTS create_posting_groups_for_customer_type ON "customerType";
DROP TRIGGER IF EXISTS create_supplier_type_group ON "supplierType";
DROP TRIGGER IF EXISTS update_supplier_type_group ON "supplierType";
DROP TRIGGER IF EXISTS create_posting_groups_for_supplier_type ON "supplierType";


-- =============================================================================
-- PART 3: Attach Event Triggers
-- =============================================================================

-- customerType: UPDATE name -> BEFORE, INSERT group+posting -> AFTER
SELECT attach_event_trigger(
  'customerType',
  ARRAY['sync_update_customer_type_group_name']::TEXT[],
  ARRAY['sync_create_customer_type_group', 'sync_create_posting_groups_for_customer_type']::TEXT[]
);

-- supplierType: UPDATE name -> BEFORE, INSERT group+posting -> AFTER
SELECT attach_event_trigger(
  'supplierType',
  ARRAY['sync_update_supplier_type_group_name']::TEXT[],
  ARRAY['sync_create_supplier_type_group', 'sync_create_posting_groups_for_supplier_type']::TEXT[]
);
