-- SPDX-License-Identifier: AGPL-3.0-only
-- Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
-- including ports, remain AGPLv3; serving them over a network requires releasing their source.

-- Detail rows for the unapplied payment balances in AR/AP aging.
-- Match the as-of settlement and sign rules in get_ar_aging/get_ap_aging.
CREATE FUNCTION public.get_aging_unapplied_payments(
  _company_id text,
  _as_of_date date,
  _side text
)
RETURNS TABLE(
  "partyId" text,
  "documentId" text,
  "documentNumber" text,
  "documentType" text,
  "transactionDate" date,
  "originalInBase" numeric,
  "openInBase" numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $function$
  WITH funding_consumed AS (
    SELECT COALESCE(s."sourcePaymentId", s."paymentId") AS source_payment_id,
      SUM(s."appliedAmount" + CASE WHEN applying."paymentType" = 'Receipt'
        THEN s."fxGainLossAmount" ELSE -s."fxGainLossAmount" END) AS source_base_amount
    FROM "invoiceSettlement" s
    JOIN "payment" applying ON applying."id" = s."paymentId"
      AND applying."companyId" = s."companyId"
    WHERE s."companyId" = _company_id
      AND s."paymentId" IS NOT NULL
      AND applying."status" = 'Posted'
      AND applying."postingDate" <= _as_of_date
    GROUP BY COALESCE(s."sourcePaymentId", s."paymentId")
  ), payment_balances AS (
    SELECT
      CASE WHEN _side = 'ar' THEN p."customerId" ELSE p."supplierId" END AS party_id,
      p."id", p."paymentId", p."paymentType", p."paymentDate",
      accounting_round_internal(p."totalAmount" / p."exchangeRate") AS original_base,
      accounting_round_internal(p."totalAmount" / p."exchangeRate")
        - COALESCE(c.source_base_amount, 0) AS open_base
    FROM "payment" p
    LEFT JOIN funding_consumed c ON c.source_payment_id = p."id"
    WHERE p."companyId" = _company_id
      AND p."status" = 'Posted'
      AND p."postingDate" <= _as_of_date
      AND (
        (_side = 'ar' AND p."customerId" IS NOT NULL
          AND p."salesOrderId" IS NULL AND p."rentalAgreementId" IS NULL)
        OR (_side = 'ap' AND p."supplierId" IS NOT NULL)
      )
  )
  SELECT b.party_id, b."id", b."paymentId", b."paymentType"::text,
    b."paymentDate",
    (CASE WHEN (_side = 'ar' AND b."paymentType" = 'Receipt')
      OR (_side = 'ap' AND b."paymentType" = 'Disbursement')
      THEN -1 ELSE 1 END) * b.original_base,
    (CASE WHEN (_side = 'ar' AND b."paymentType" = 'Receipt')
      OR (_side = 'ap' AND b."paymentType" = 'Disbursement')
      THEN -1 ELSE 1 END) * b.open_base
  FROM payment_balances b
  WHERE b.open_base <> 0
  ORDER BY 1, 5, 2;
$function$;
