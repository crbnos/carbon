-- =============================================================================
-- Convert legacy customer and supplier triggers to event system interceptors.
--
-- Customer:
--   AFTER INSERT -> after_sync_functions:
--     sync_create_customer_entries (customerPayment + customerShipping)
--     sync_create_customer_org_group (group + optional membership)
--   AFTER UPDATE -> sync_functions (BEFORE):
--     sync_update_customer_type_group (membership upsert/delete + group name)
--
-- Supplier:
--   AFTER INSERT -> after_sync_functions:
--     sync_create_supplier_entries (supplierPayment + supplierShipping)
--     sync_create_supplier_org_group (group + optional membership)
--   AFTER UPDATE -> sync_functions (BEFORE):
--     sync_update_supplier_type_group (membership upsert/delete + group name)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Customer interceptor functions
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_create_customer_entries(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "customerPayment"("customerId", "invoiceCustomerId", "companyId")
  VALUES (p_new->>'id', p_new->>'id', p_new->>'companyId');

  INSERT INTO "customerShipping"("customerId", "shippingCustomerId", "companyId")
  VALUES (p_new->>'id', p_new->>'id', p_new->>'companyId');
END;
$$;

CREATE OR REPLACE FUNCTION sync_create_customer_org_group(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "group" ("id", "name", "isCustomerOrgGroup", "companyId")
  VALUES (p_new->>'id', p_new->>'name', TRUE, p_new->>'companyId');

  IF p_new->>'customerTypeId' IS NOT NULL THEN
    INSERT INTO "membership"("groupId", "memberGroupId")
    VALUES (p_new->>'customerTypeId', p_new->>'id');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sync_update_customer_type_group(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  IF p_old->>'customerTypeId' IS NOT NULL THEN
    IF p_new->>'customerTypeId' IS NOT NULL THEN
      UPDATE "membership" SET "groupId" = p_new->>'customerTypeId'
      WHERE "groupId" = p_old->>'customerTypeId' AND "memberGroupId" = p_new->>'id';
    ELSE
      DELETE FROM "membership"
      WHERE "groupId" = p_old->>'customerTypeId' AND "memberGroupId" = p_new->>'id';
    END IF;
  ELSE
    IF p_new->>'customerTypeId' IS NOT NULL THEN
      INSERT INTO "membership" ("groupId", "memberGroupId")
      VALUES (p_new->>'customerTypeId', p_new->>'id');
    END IF;
  END IF;

  UPDATE "group" SET "name" = p_new->>'name'
  WHERE "id" = p_new->>'id' AND "isCustomerOrgGroup" = TRUE;
END;
$$;


-- -----------------------------------------------------------------------------
-- Supplier interceptor functions
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_create_supplier_entries(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "supplierPayment"("supplierId", "invoiceSupplierId", "companyId")
  VALUES (p_new->>'id', p_new->>'id', p_new->>'companyId');

  INSERT INTO "supplierShipping"("supplierId", "shippingSupplierId", "companyId")
  VALUES (p_new->>'id', p_new->>'id', p_new->>'companyId');
END;
$$;

CREATE OR REPLACE FUNCTION sync_create_supplier_org_group(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "group" ("id", "name", "isSupplierOrgGroup", "companyId")
  VALUES (p_new->>'id', p_new->>'name', TRUE, p_new->>'companyId');

  IF p_new->>'supplierTypeId' IS NOT NULL THEN
    INSERT INTO "membership"("groupId", "memberGroupId")
    VALUES (p_new->>'supplierTypeId', p_new->>'id');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sync_update_supplier_type_group(
  p_table TEXT,
  p_operation TEXT,
  p_new JSONB,
  p_old JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_operation != 'UPDATE' THEN RETURN; END IF;

  IF p_old->>'supplierTypeId' IS NOT NULL THEN
    IF p_new->>'supplierTypeId' IS NOT NULL THEN
      UPDATE "membership" SET "groupId" = p_new->>'supplierTypeId'
      WHERE "groupId" = p_old->>'supplierTypeId' AND "memberGroupId" = p_new->>'id';
    ELSE
      DELETE FROM "membership"
      WHERE "groupId" = p_old->>'supplierTypeId' AND "memberGroupId" = p_new->>'id';
    END IF;
  ELSE
    IF p_new->>'supplierTypeId' IS NOT NULL THEN
      INSERT INTO "membership" ("groupId", "memberGroupId")
      VALUES (p_new->>'supplierTypeId', p_new->>'id');
    END IF;
  END IF;

  UPDATE "group" SET "name" = p_new->>'name'
  WHERE "id" = p_new->>'id' AND "isSupplierOrgGroup" = TRUE;
END;
$$;


-- -----------------------------------------------------------------------------
-- Drop legacy triggers
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS create_customer_entries ON "customer";
DROP TRIGGER IF EXISTS create_customer_org_group ON "customer";
DROP TRIGGER IF EXISTS create_customer_group ON "customer";

DROP TRIGGER IF EXISTS create_supplier_entries ON "supplier";
DROP TRIGGER IF EXISTS create_supplier_org_group ON "supplier";
DROP TRIGGER IF EXISTS create_supplier_group ON "supplier";


-- -----------------------------------------------------------------------------
-- Attach event triggers with interceptor arrays
-- -----------------------------------------------------------------------------

SELECT attach_event_trigger('customer',
  ARRAY['sync_update_customer_type_group']::TEXT[],
  ARRAY['sync_create_customer_entries', 'sync_create_customer_org_group']::TEXT[]
);

SELECT attach_event_trigger('supplier',
  ARRAY['sync_update_supplier_type_group']::TEXT[],
  ARRAY['sync_create_supplier_entries', 'sync_create_supplier_org_group']::TEXT[]
);
