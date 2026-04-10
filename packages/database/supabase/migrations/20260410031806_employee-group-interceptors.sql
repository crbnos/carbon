-- =============================================================================
-- Convert employee/employeeType/user group triggers to event system interceptors
--
-- Converts 6 legacy AFTER INSERT/UPDATE triggers into interceptor functions
-- that work with the event system's attach_event_trigger() pattern.
--
-- Tables affected: employeeType, user, employee
-- employeeType and user are newly attached to the event system.
-- employee was already on the event system (for search indexing).
-- =============================================================================


-- =============================================================================
-- PART 1: Create Interceptor Functions
-- =============================================================================

-- 1. employeeType AFTER INSERT -> creates group + membership (AFTER interceptor)
CREATE OR REPLACE FUNCTION sync_create_employee_type_group(
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

  INSERT INTO "group" ("id", "name", "isEmployeeTypeGroup", "companyId")
  VALUES (
    p_new->>'id',
    p_new->>'name',
    TRUE,
    p_new->>'companyId'
  );

  INSERT INTO "membership" ("groupId", "memberGroupId")
  VALUES (
    '00000000-0000-'
      || substring((p_new->>'companyId')::text, 1, 4) || '-'
      || substring((p_new->>'companyId')::text, 5, 4) || '-'
      || substring((p_new->>'companyId')::text, 9, 12),
    p_new->>'id'
  );
END;
$$;


-- 2. employeeType AFTER UPDATE -> updates group name (BEFORE interceptor)
CREATE OR REPLACE FUNCTION sync_update_employee_type_group(
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
    AND "isEmployeeTypeGroup" = TRUE;
END;
$$;


-- 3. user AFTER INSERT -> creates identity group + membership (AFTER interceptor)
CREATE OR REPLACE FUNCTION sync_create_user_identity_group(
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

  INSERT INTO "group" ("id", "name", "isIdentityGroup")
  VALUES (
    p_new->>'id',
    p_new->>'fullName',
    TRUE
  );

  INSERT INTO "membership" ("groupId", "memberUserId")
  VALUES (
    p_new->>'id',
    p_new->>'id'
  );
END;
$$;


-- 4. user AFTER UPDATE -> updates identity group name (BEFORE interceptor)
CREATE OR REPLACE FUNCTION sync_update_user_identity_group(
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
  SET "name" = p_new->>'fullName'
  WHERE "id" = p_new->>'id'
    AND "isIdentityGroup" = TRUE;
END;
$$;


-- 5. employee AFTER INSERT -> adds membership to type group (AFTER interceptor)
CREATE OR REPLACE FUNCTION sync_add_employee_to_type_group(
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
    p_new->>'employeeTypeId',
    p_new->>'id'
  );
END;
$$;


-- 6. employee AFTER UPDATE -> updates membership group (BEFORE interceptor)
CREATE OR REPLACE FUNCTION sync_update_employee_type_membership(
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

  UPDATE "membership"
  SET "groupId" = p_new->>'employeeTypeId'
  WHERE "groupId" = p_old->>'employeeTypeId'
    AND "memberUserId" = p_new->>'id';
END;
$$;


-- =============================================================================
-- PART 2: Drop Legacy Triggers
-- =============================================================================

DROP TRIGGER IF EXISTS create_employee_type_group ON "employeeType";
DROP TRIGGER IF EXISTS update_employee_type_group ON "employeeType";
DROP TRIGGER IF EXISTS create_user_identity_group ON "user";
DROP TRIGGER IF EXISTS update_user_identity_group ON "user";
DROP TRIGGER IF EXISTS add_employee_to_employee_type_group ON "employee";
DROP TRIGGER IF EXISTS update_employee_to_employee_type_group ON "employee";


-- =============================================================================
-- PART 3: Attach Event Triggers
-- =============================================================================

-- employeeType: UPDATE -> BEFORE interceptor, INSERT -> AFTER interceptor
SELECT attach_event_trigger(
  'employeeType',
  ARRAY['sync_update_employee_type_group']::TEXT[],
  ARRAY['sync_create_employee_type_group']::TEXT[]
);

-- user: Both INSERT and UPDATE need AFTER interceptors.
-- INSERT -> creates identity group (FK back-reference).
-- UPDATE -> reads fullName which is a GENERATED ALWAYS column (NULL in BEFORE triggers).
-- NOTE: user table has NO companyId column, so we cannot use attach_event_trigger()
-- (dispatch_event_batch would fail with "column companyId does not exist").
-- Manually create only the AFTER ROW trigger — no BEFORE interceptors needed.
DROP TRIGGER IF EXISTS "trg_event_sync_user" ON "user";
DROP TRIGGER IF EXISTS "trg_event_after_sync_user" ON "user";
CREATE TRIGGER "trg_event_after_sync_user"
AFTER INSERT OR UPDATE OR DELETE ON "user"
FOR EACH ROW
EXECUTE FUNCTION public.dispatch_event_after_interceptors('sync_create_user_identity_group', 'sync_update_user_identity_group');

-- employee: UPDATE -> BEFORE interceptor, INSERT -> AFTER interceptor
-- employee was already on event system; re-attaching adds the sync interceptors
SELECT attach_event_trigger(
  'employee',
  ARRAY['sync_update_employee_type_membership']::TEXT[],
  ARRAY['sync_add_employee_to_type_group']::TEXT[]
);
