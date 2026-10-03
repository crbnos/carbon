CREATE OR REPLACE FUNCTION public.populate_company_search_index(p_company_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_table_name TEXT := 'searchIndex_' || p_company_id;
BEGIN
  -- Populate employees
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "link", "tags", "metadata", "searchVector")
    SELECT
      ''employee'',
      e.id,
      COALESCE(u."fullName", ''''),
      ''/x/person/'' || e.id,
      ARRAY_REMOVE(ARRAY[et.name], NULL),
      jsonb_build_object(''active'', e.active),
      to_tsvector(''english'', COALESCE(u."fullName", '''') || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[et.name], NULL), '' ''), ''''))
    FROM "employee" e
    INNER JOIN "user" u ON u.id = e.id
    LEFT JOIN "employeeType" et ON et.id = e."employeeTypeId"
    WHERE e."companyId" = $1 AND e.active = true
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;

  -- Populate customers (join customerTax for taxId)
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "link", "tags", "metadata", "searchVector")
    SELECT
      ''customer'',
      c.id,
      c.name,
      ''/x/customer/'' || c.id,
      ARRAY_REMOVE(ARRAY[ct.name, cs.name], NULL),
      jsonb_build_object(''taxId'', ctx."taxId"),
      to_tsvector(''english'', c.name || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[ct.name, cs.name], NULL), '' ''), ''''))
    FROM "customer" c
    LEFT JOIN "customerTax" ctx ON ctx."customerId" = c.id
    LEFT JOIN "customerType" ct ON ct.id = c."customerTypeId"
    LEFT JOIN "customerStatus" cs ON cs.id = c."customerStatusId"
    WHERE c."companyId" = $1
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;

  -- Populate suppliers (join supplierTax for taxId)
  EXECUTE format('
    INSERT INTO %I ("entityType", "entityId", "title", "link", "tags", "metadata", "searchVector")
    SELECT
      ''supplier'',
      s.id,
      s.name,
      ''/x/supplier/'' || s.id,
      ARRAY_REMOVE(ARRAY[st.name, s."supplierStatus"::TEXT], NULL),
      jsonb_build_object(''taxId'', stx."taxId"),
      to_tsvector(''english'', s.name || '' '' || COALESCE(array_to_string(ARRAY_REMOVE(ARRAY[st.name, s."supplierStatus"::TEXT], NULL), '' ''), ''''))
    FROM "supplier" s
    LEFT JOIN "supplierTax" stx ON stx."supplierId" = s.id
    LEFT JOIN "supplierType" st ON st.id = s."supplierTypeId"
    WHERE s."companyId" = $1
    ON CONFLICT ("entityType", "entityId") DO UPDATE SET
      "title" = EXCLUDED."title",
      "tags" = EXCLUDED."tags",
      "metadata" = EXCLUDED."metadata",
      "searchVector" = EXCLUDED."searchVector",
      "updatedAt" = NOW()
  ', v_table_name) USING p_company_id;
END;
$function$;
