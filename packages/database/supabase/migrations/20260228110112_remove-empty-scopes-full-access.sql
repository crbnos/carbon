-- Remove backward-compatibility behavior where empty API key scopes ({})
-- granted full access. Empty scopes now means NO access.

-- ============================================================================
-- Step 1: Update get_api_key_scopes() to return NULL instead of '{}'
-- ============================================================================

CREATE OR REPLACE FUNCTION get_api_key_scopes() RETURNS JSONB
  LANGUAGE "plpgsql" SECURITY DEFINER
  SET search_path = public, extensions
  AS $$
  DECLARE
    scopes JSONB;
    raw_key TEXT;
  BEGIN
    raw_key := (current_setting('request.headers'::text, true))::json ->> 'carbon-key';
    IF raw_key IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT "apiKey"."scopes" INTO scopes
    FROM "apiKey"
    WHERE "keyHash" = encode(digest(raw_key::bytea, 'sha256'::text), 'hex')
      AND ("expiresAt" IS NULL OR "expiresAt" > NOW());

    RETURN scopes;
  END;
$$;

-- ============================================================================
-- Step 2: Update get_companies_with_employee_permission() to deny access
--         when scopes are empty or NULL (instead of granting full access)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_companies_with_employee_permission (permission text) RETURNS text[] LANGUAGE "plpgsql" SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  permission_companies text[];
  api_key_company text;
  employee_companies text[];
  api_key_scopes JSONB;
BEGIN
  api_key_company := get_company_id_from_api_key();

  IF api_key_company IS NOT NULL THEN
    -- Get scopes for this API key
    api_key_scopes := get_api_key_scopes();

    -- NULL or empty scopes = no access
    IF api_key_scopes IS NULL OR api_key_scopes = '{}'::jsonb THEN
      RETURN '{}';
    END IF;

    -- Check if the requested permission exists in scopes
    IF (api_key_scopes ? permission)
       AND api_key_company = ANY(jsonb_to_text_array(api_key_scopes->permission)) THEN
      RETURN ARRAY[api_key_company];
    ELSE
      RETURN '{}';
    END IF;
  END IF;

  -- Normal user permission flow (unchanged)
  SELECT array_agg("companyId"::text)
  INTO employee_companies
  FROM "userToCompany"
  WHERE "userId" = auth.uid()::text AND "role" = 'employee';

  SELECT jsonb_to_text_array(COALESCE(permissions->permission, '[]'))
  INTO permission_companies
  FROM public."userPermission"
  WHERE id::text = auth.uid()::text;

  IF permission_companies IS NOT NULL AND employee_companies IS NOT NULL THEN
    SELECT array_agg(company)
    INTO permission_companies
    FROM unnest(permission_companies) company
    WHERE company = ANY(employee_companies);
  ELSE
    permission_companies := '{}';
  END IF;

  IF permission_companies IS NOT NULL AND '0'::text = ANY(permission_companies) THEN
    SELECT array_agg(id::text)
    INTO permission_companies
    FROM company
    WHERE id::text = ANY(employee_companies);
  END IF;

  RETURN permission_companies;
END;
$$;
