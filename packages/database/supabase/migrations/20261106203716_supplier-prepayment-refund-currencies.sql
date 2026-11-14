-- Return one row per purchase order instead of transferring every advance and
-- application to the payment form. SECURITY INVOKER retains the caller's RLS.
CREATE OR REPLACE FUNCTION public.get_supplier_prepayment_refund_currencies(_company_id text)
RETURNS TABLE("purchaseOrderId" text, "refundableCurrencyCodes" text[])
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'extensions'
AS $function$
  WITH advances AS (
    SELECT p.id, p."purchaseOrderId", p."currencyCode", p."totalAmount", p."exchangeRate", currency."decimalPlaces"
    FROM "payment" p
    JOIN "company" company ON company.id = p."companyId"
    JOIN "currency" currency ON currency."companyGroupId" = company."companyGroupId"
      AND currency.code = p."currencyCode"
    WHERE p."companyId" = _company_id AND p.status = 'Posted'
      AND p."paymentType" = 'Disbursement' AND p."purchaseOrderId" IS NOT NULL
  ), consumed AS (
    SELECT source.id,
      sum(coalesce(s."sourceAmount", round(s."appliedAmount" * source."exchangeRate", source."decimalPlaces"))) AS principal,
      bool_or(s."sourcePaymentId" IS NOT NULL AND s."sourceAmount" IS NULL) AS missing_principal
    FROM advances source
    JOIN "invoiceSettlement" s ON coalesce(s."sourcePaymentId", s."paymentId") = source.id
      AND s."companyId" = _company_id
    JOIN "payment" applying ON applying.id = s."paymentId" AND applying."companyId" = s."companyId"
      AND applying.status = 'Posted'
    GROUP BY source.id
  )
  SELECT source."purchaseOrderId",
    coalesce(array_agg(DISTINCT source."currencyCode" ORDER BY source."currencyCode") FILTER (
      WHERE round(source."totalAmount" - coalesce(consumed.principal, 0), source."decimalPlaces") > 0
        AND NOT coalesce(consumed.missing_principal, false)
    ), ARRAY[]::text[]) AS "refundableCurrencyCodes"
  FROM advances source LEFT JOIN consumed ON consumed.id = source.id
  GROUP BY source."purchaseOrderId";
$function$;
