-- Invoice viewers can export the names on their invoices without being able
-- to read customer records. Return only names reached through these invoices.
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
  PERFORM assert_company_access(company_id, 'invoicing_view');

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
