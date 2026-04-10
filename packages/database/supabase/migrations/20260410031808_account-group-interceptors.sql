-- =============================================================================
-- Convert customerAccount/supplierAccount group membership triggers to
-- event system interceptors.
--
-- Converts 2 legacy AFTER INSERT triggers into interceptor functions.
-- Neither table was previously on the event system.
-- =============================================================================


-- =============================================================================
-- PART 1: Create Interceptor Functions
-- =============================================================================

-- 1. customerAccount AFTER INSERT -> adds membership to customer group (AFTER interceptor)
CREATE OR REPLACE FUNCTION sync_add_customer_account_to_group(
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

  INSERT INTO "membership" ("groupId", "memberUserId")
  VALUES (
    p_new->>'customerId',
    p_new->>'id'
  );
END;
$$;


-- 2. supplierAccount AFTER INSERT -> adds membership to supplier group (AFTER interceptor)
CREATE OR REPLACE FUNCTION sync_add_supplier_account_to_group(
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

  INSERT INTO "membership" ("groupId", "memberUserId")
  VALUES (
    p_new->>'supplierId',
    p_new->>'id'
  );
END;
$$;


-- =============================================================================
-- PART 2: Drop Legacy Triggers
-- =============================================================================

DROP TRIGGER IF EXISTS create_customer_account_group ON "customerAccount";
DROP TRIGGER IF EXISTS create_supplier_account_group ON "supplierAccount";


-- =============================================================================
-- PART 3: Attach Event Triggers
-- =============================================================================

-- customerAccount: no BEFORE interceptors, INSERT -> AFTER interceptor
SELECT attach_event_trigger(
  'customerAccount',
  ARRAY[]::TEXT[],
  ARRAY['sync_add_customer_account_to_group']::TEXT[]
);

-- supplierAccount: no BEFORE interceptors, INSERT -> AFTER interceptor
SELECT attach_event_trigger(
  'supplierAccount',
  ARRAY[]::TEXT[],
  ARRAY['sync_add_supplier_account_to_group']::TEXT[]
);
