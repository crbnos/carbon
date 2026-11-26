-- SPDX-License-Identifier: AGPL-3.0-only
-- Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
-- including ports, remain AGPLv3; serving them over a network requires releasing their source.

-- Page permissions: a module key passes only with a module grant, so these two
-- invoice lookups refused a person with invoice page grants alone. They now
-- check the invoice page they read.

-- Forked from 20261105215541_sales-invoice-customer-name-lookup.sql
CREATE OR REPLACE FUNCTION public.get_sales_invoice_customer_names(
  company_id text,
  invoice_ids text[]
)
RETURNS TABLE(id text, "customerName" text, "invoiceCustomerName" text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
BEGIN
  PERFORM assert_company_access(company_id, 'invoicing.salesInvoices_view');

  RETURN QUERY
  SELECT si.id, c.name, ic.name
  FROM "salesInvoice" si
  LEFT JOIN customer c ON c.id = si."customerId"
    AND c."companyId" = si."companyId"
  LEFT JOIN customer ic ON ic.id = si."invoiceCustomerId"
    AND ic."companyId" = si."companyId"
  WHERE si."companyId" = company_id
    AND si.id = ANY(invoice_ids);
END;
$function$;

-- Forked from 20261114155625_invoice_line_gl_codes.sql
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
  IF invoice_type IS NULL OR invoice_type NOT IN ('sales', 'purchase') THEN
    RAISE EXCEPTION 'Invalid invoice type';
  END IF;
  PERFORM assert_company_access(
    company_id,
    CASE invoice_type
      WHEN 'purchase' THEN 'invoicing.purchaseInvoices_view'
      ELSE 'invoicing.salesInvoices_view'
    END
  );

  RETURN QUERY
  WITH invoice_lines AS (
    SELECT line."invoiceId",
      COALESCE(line."accountId", CASE
        WHEN line."invoiceLineType" <> 'Comment'
          AND line."customerContractLineId" IS NULL
          AND line."rentalAgreementId" IS NULL
          AND line."serviceJobId" IS NULL
          AND line."serviceStartDate" IS NULL
          AND line."serviceEndDate" IS NULL
        THEN defaults."salesAccount"
      END) AS "accountId"
    FROM "salesInvoiceLine" line
    LEFT JOIN "accountDefault" defaults ON defaults."companyId" = line."companyId"
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
