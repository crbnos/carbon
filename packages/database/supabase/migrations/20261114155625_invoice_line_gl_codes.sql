-- SPDX-License-Identifier: AGPL-3.0-only
-- Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
-- including ports, remain AGPLv3; serving them over a network requires releasing their source.

-- A user with invoicing access can see the account numbers assigned to that
-- company's invoice lines without needing chart-of-accounts access.
CREATE OR REPLACE FUNCTION public.get_invoice_line_gl_codes(
  company_id text,
  invoice_type text,
  invoice_ids text[]
)
RETURNS TABLE(id text, "glCodes" text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  PERFORM assert_company_access(company_id, 'invoicing_view');
  IF invoice_type IS NULL OR invoice_type NOT IN ('sales', 'purchase') THEN
    RAISE EXCEPTION 'Invalid invoice type';
  END IF;

  RETURN QUERY
  WITH invoice_lines AS (
    SELECT line."invoiceId", line."accountId"
    FROM "salesInvoiceLine" line
    WHERE invoice_type = 'sales'
      AND line."companyId" = company_id
      AND line."invoiceId" = ANY(invoice_ids)
    UNION ALL
    SELECT line."invoiceId", line."accountId"
    FROM "purchaseInvoiceLine" line
    WHERE invoice_type = 'purchase'
      AND line."companyId" = company_id
      AND line."invoiceId" = ANY(invoice_ids)
  )
  SELECT line."invoiceId", string_agg(DISTINCT account.number, ', ' ORDER BY account.number)
  FROM invoice_lines line
  JOIN account ON account.id = line."accountId"
  JOIN company ON company.id = company_id
    AND company."companyGroupId" = account."companyGroupId"
  WHERE account.number IS NOT NULL
  GROUP BY line."invoiceId";
END;
$function$;
