-- Clear the sub-minor-unit carrying residual left on legacy posted payments.
--
-- Before 20260908021155_accounting_posting_corrections, a payment recorded in
-- currency units (956.66) was applied at the invoice's internal-scale total
-- (956.656), with no `sourceAmount` and no FX. The payment is used up in
-- document units (956.656 rounds to 956.66) but keeps 0.004 of base, a state
-- `remainingFundingSources` (packages/utils/src/payment-funding.ts) refuses:
-- every Draft payment for that party fails to load ("Invalid remaining
-- funding balance"), and posting a new one for them fails the same way.
--
-- The repair writes each such row in the shape `allocatePaymentFunding`
-- writes today for the same payment and invoice: `sourceAmount` is the
-- principal in document units, and the payment's final application carries
-- the residual as `fxGainLossAmount`, so the payment releases exactly its
-- base total. A payment qualifies only when the repair can change nothing
-- else:
--   * Posted, a customer receipt or a supplier disbursement (the funding the
--     readers compute);
--   * no Payment journal line, so no ledger amount depends on the rows;
--   * every settlement it owns is legacy (no `sourceAmount`, no
--     `sourcePaymentId`, no memo), targets an invoice at the payment's own
--     rate, and no other payment draws on it;
--   * its total is already at currency precision and it is used up in
--     document units, with a base residual under one minor unit.
-- With equal rates, `sourceAmount` equals the principal the invoice readers
-- already derive from `appliedAmount`, so invoice balances are unchanged
-- (the salesInvoices / purchaseInvoices views now read the cents principal,
-- so a fully paid invoice stops reading as Partially Paid).

DO $legacy_payment_funding_residual$
DECLARE
  repaired INTEGER;
  unbalanced TEXT;
BEGIN
  CREATE TEMP TABLE legacy_funding_repair ON COMMIT DROP AS
  WITH candidate AS (
    SELECT
      p."id",
      p."companyId",
      p."totalAmount",
      p."exchangeRate",
      c."decimalPlaces" AS decimals,
      CASE WHEN p."paymentType" = 'Receipt' THEN 1 ELSE -1 END AS fx_sign
    FROM "payment" p
    JOIN "company" co ON co."id" = p."companyId"
    JOIN "currency" c ON c."code" = p."currencyCode"
      AND c."companyGroupId" = co."companyGroupId"
    WHERE p."status" = 'Posted'
      AND (
        (p."paymentType" = 'Receipt' AND p."customerId" IS NOT NULL)
        OR (p."paymentType" = 'Disbursement' AND p."supplierId" IS NOT NULL)
      )
      AND p."totalAmount" = round(p."totalAmount", c."decimalPlaces")
      AND NOT EXISTS (
        SELECT 1 FROM "journalLine" jl
        WHERE jl."companyId" = p."companyId"
          AND jl."documentType" = 'Payment'
          AND jl."documentId" = p."id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "invoiceSettlement" s
        WHERE s."companyId" = p."companyId" AND s."sourcePaymentId" = p."id"
      )
      AND EXISTS (
        SELECT 1 FROM "invoiceSettlement" s
        WHERE s."companyId" = p."companyId" AND s."paymentId" = p."id"
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "invoiceSettlement" s
        LEFT JOIN "salesInvoice" si ON si."id" = s."targetSalesInvoiceId"
          AND si."companyId" = s."companyId"
        LEFT JOIN "purchaseInvoice" pi ON pi."id" = s."targetPurchaseInvoiceId"
          AND pi."companyId" = s."companyId"
        WHERE s."companyId" = p."companyId"
          AND s."paymentId" = p."id"
          AND (
            s."sourceAmount" IS NOT NULL
            OR s."sourcePaymentId" IS NOT NULL
            OR s."memoId" IS NOT NULL
            OR COALESCE(
              CASE WHEN p."paymentType" = 'Receipt'
                THEN si."exchangeRate" ELSE pi."exchangeRate" END,
              -1
            ) <> p."exchangeRate"
          )
      )
  ), used AS (
    SELECT
      cand.*,
      SUM(round(s."appliedAmount" * cand."exchangeRate", cand.decimals)) AS document_used,
      SUM(s."appliedAmount" + cand.fx_sign * s."fxGainLossAmount") AS base_used,
      (array_agg(s."id" ORDER BY s."appliedDate" DESC, s."id" DESC))[1] AS last_settlement_id
    FROM candidate cand
    JOIN "invoiceSettlement" s ON s."companyId" = cand."companyId"
      AND s."paymentId" = cand."id"
    GROUP BY cand."id", cand."companyId", cand."totalAmount",
      cand."exchangeRate", cand.decimals, cand.fx_sign
  )
  SELECT
    u."id",
    u."companyId",
    u."exchangeRate",
    u.decimals,
    u.fx_sign,
    u.last_settlement_id,
    accounting_round_internal(u."totalAmount" / u."exchangeRate") - u.base_used AS residual
  FROM used u
  WHERE round(u."totalAmount" - u.document_used, u.decimals) = 0
    AND accounting_round_internal(
      accounting_round_internal(u."totalAmount" / u."exchangeRate") - u.base_used
    ) <> 0
    AND abs(accounting_round_internal(u."totalAmount" / u."exchangeRate") - u.base_used)
      < power(10::NUMERIC, -u.decimals);

  UPDATE "invoiceSettlement" s
  SET
    "sourceAmount" = round(s."appliedAmount" * r."exchangeRate", r.decimals),
    "fxGainLossAmount" = s."fxGainLossAmount"
      + CASE WHEN s."id" = r.last_settlement_id THEN r.fx_sign * r.residual ELSE 0 END
  FROM legacy_funding_repair r
  WHERE s."companyId" = r."companyId"
    AND s."paymentId" = r."id";

  SELECT count(*) INTO repaired FROM legacy_funding_repair;

  -- Every repaired payment must now read as exhausted in both units.
  SELECT string_agg(p."id", ', ') INTO unbalanced
  FROM legacy_funding_repair r
  JOIN "payment" p ON p."id" = r."id" AND p."companyId" = r."companyId"
  CROSS JOIN LATERAL (
    SELECT
      SUM(s."sourceAmount") AS document_used,
      SUM(s."appliedAmount" + r.fx_sign * s."fxGainLossAmount") AS base_used
    FROM "invoiceSettlement" s
    WHERE s."companyId" = r."companyId" AND s."paymentId" = r."id"
  ) after
  WHERE round(p."totalAmount" - after.document_used, r.decimals) <> 0
    OR accounting_round_internal(
      accounting_round_internal(p."totalAmount" / p."exchangeRate") - after.base_used
    ) <> 0;

  IF unbalanced IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy funding repair left payments unbalanced: %', unbalanced;
  END IF;

  RAISE NOTICE 'Cleared the legacy funding residual on % payment(s)', repaired;
  DROP TABLE legacy_funding_repair;
END;
$legacy_payment_funding_residual$;
