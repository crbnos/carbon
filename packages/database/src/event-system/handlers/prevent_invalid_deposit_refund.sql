CREATE OR REPLACE FUNCTION public.prevent_invalid_deposit_refund(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_company text := p_new->>'companyId';
  v_id text := p_new->>'id';
  v_sources text[];
  v_order_supplier text;
  v_has_legacy boolean;
BEGIN
  -- An approved force delete (`decideDocumentForceDelete`) unapplies posted
  -- advance applications and removes posted advances inside its own
  -- transaction; it books the reversing journals itself.
  IF p_operation = 'DELETE' AND current_setting('app.force_delete', true) = 'on' THEN
    RETURN;
  END IF;
  IF p_table = 'invoiceSettlement'
    AND (EXISTS (SELECT 1 FROM "company" WHERE "id" = p_old->>'companyId')
      OR EXISTS (SELECT 1 FROM "company" WHERE "id" = p_new->>'companyId'))
    AND (num_nonnulls(p_old->>'targetPaymentId', p_new->>'targetPaymentId') > 0
      OR EXISTS (SELECT 1 FROM "payment" source
        WHERE ((source."id" = p_old->>'sourcePaymentId' AND source."companyId" = p_old->>'companyId')
          OR (source."id" = p_new->>'sourcePaymentId' AND source."companyId" = p_new->>'companyId'))
          AND num_nonnulls(source."purchaseOrderId", source."salesOrderId", source."rentalAgreementId", source."customerContractId") > 0)) THEN
    -- Reparenting must not modify either posted parent's financial history.
    PERFORM 1 FROM "payment"
      WHERE ("id" = p_old->>'paymentId' AND "companyId" = p_old->>'companyId')
        OR ("id" = p_new->>'paymentId' AND "companyId" = p_new->>'companyId')
      ORDER BY "id" FOR UPDATE;
    IF EXISTS (SELECT 1 FROM "payment" WHERE "status" = 'Posted' AND
      (("id" = p_old->>'paymentId' AND "companyId" = p_old->>'companyId')
        OR ("id" = p_new->>'paymentId' AND "companyId" = p_new->>'companyId'))) THEN
      RAISE EXCEPTION 'Posted advance applications cannot be changed';
    END IF;
  END IF;
  IF p_table = 'payment' AND p_operation = 'DELETE'
    AND p_old->>'status' = 'Posted'
    AND num_nonnulls(p_old->>'purchaseOrderId', p_old->>'salesOrderId',
      p_old->>'rentalAgreementId', p_old->>'customerContractId') > 0
    AND EXISTS (SELECT 1 FROM "company" WHERE "id" = p_old->>'companyId') THEN
    RAISE EXCEPTION 'Posted advances and refunds must be voided, not deleted';
  END IF;
  IF p_operation = 'DELETE' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM "company" WHERE "id" = v_company) THEN RETURN; END IF;

  IF p_table = 'payment' THEN
    IF p_new->>'purchaseOrderId' IS NOT NULL AND p_new->>'status' = 'Posted' THEN
      SELECT "supplierId" INTO v_order_supplier FROM "purchaseOrder"
      WHERE "id" = p_new->>'purchaseOrderId' AND "companyId" = v_company FOR SHARE;
      IF v_order_supplier IS DISTINCT FROM p_new->>'supplierId' THEN
        RAISE EXCEPTION 'Supplier prepayment must match its purchase order supplier';
      END IF;
    END IF;
    IF p_operation = 'UPDATE'
      AND num_nonnulls(p_old->>'purchaseOrderId', p_old->>'salesOrderId',
        p_old->>'rentalAgreementId', p_old->>'customerContractId') > 0
      AND ((p_old->>'status' = 'Posted' AND p_new->>'status' NOT IN ('Posted', 'Voided'))
        OR (p_old->>'status' = 'Voided' AND p_new->>'status' <> 'Voided')) THEN
      RAISE EXCEPTION 'Posted advances and refunds cannot return to Draft or be reposted after voiding';
    END IF;
    IF p_new->>'status' = 'Posted' AND p_old->>'status' IS DISTINCT FROM 'Posted'
      AND ((p_new->>'customerId' IS NOT NULL AND p_new->>'paymentType' = 'Disbursement')
        OR (p_new->>'supplierId' IS NOT NULL AND p_new->>'paymentType' = 'Receipt'))
      AND num_nonnulls(p_new->>'purchaseOrderId', p_new->>'salesOrderId',
        p_new->>'rentalAgreementId', p_new->>'customerContractId') > 0
      AND (SELECT coalesce(sum(s."sourceAmount"), 0) FROM "invoiceSettlement" s
        WHERE s."paymentId" = v_id AND s."companyId" = v_company
          AND s."targetPaymentId" IS NOT NULL) <> (p_new->>'totalAmount')::numeric THEN
      RAISE EXCEPTION 'Deposit refund must allocate its full principal to original advances';
    END IF;
    -- A posted advance's identity determines both its journal and its funding scope.
    IF p_operation = 'UPDATE' AND p_old->>'status' = 'Posted'
      AND num_nonnulls(p_old->>'purchaseOrderId', p_old->>'salesOrderId',
        p_old->>'rentalAgreementId', p_old->>'customerContractId') > 0
      AND (p_new->>'companyId', p_new->>'customerId', p_new->>'supplierId',
        p_new->>'currencyCode', p_new->>'paymentType', p_new->>'totalAmount',
        p_new->>'exchangeRate', p_new->>'purchaseOrderId', p_new->>'salesOrderId',
        p_new->>'rentalAgreementId', p_new->>'customerContractId')
        IS DISTINCT FROM
        (p_old->>'companyId', p_old->>'customerId', p_old->>'supplierId',
        p_old->>'currencyCode', p_old->>'paymentType', p_old->>'totalAmount',
        p_old->>'exchangeRate', p_old->>'purchaseOrderId', p_old->>'salesOrderId',
        p_old->>'rentalAgreementId', p_old->>'customerContractId') THEN
      RAISE EXCEPTION 'Posted advance identity cannot be changed';
    END IF;
    SELECT array_agg(DISTINCT source."id") INTO v_sources
    FROM "invoiceSettlement" s
    JOIN "payment" source ON source."id" = coalesce(s."targetPaymentId", s."sourcePaymentId")
      AND source."companyId" = s."companyId"
    WHERE s."companyId" = v_company
      AND num_nonnulls(source."purchaseOrderId", source."salesOrderId", source."rentalAgreementId", source."customerContractId") > 0
      AND (source."id" = v_id OR (p_new->>'status' = 'Posted'
        AND p_old->>'status' IS DISTINCT FROM 'Posted' AND s."paymentId" = v_id));
  ELSE
    IF p_new->>'targetPaymentId' IS NULL AND NOT EXISTS (
      SELECT 1 FROM "payment" WHERE "id" = p_new->>'sourcePaymentId' AND "companyId" = v_company
      AND num_nonnulls("purchaseOrderId", "salesOrderId", "rentalAgreementId", "customerContractId") > 0
    ) THEN RETURN; END IF;
    -- Match the posting lock order: applying payment, then its funding sources.
    PERFORM 1 FROM "payment" WHERE "id" = p_new->>'paymentId'
      AND "companyId" = v_company FOR UPDATE;
    v_sources := ARRAY[coalesce(p_new->>'targetPaymentId', p_new->>'sourcePaymentId')];
  END IF;
  IF p_table = 'payment' AND p_old->>'status' = 'Posted' AND p_new->>'status' = 'Voided'
    AND EXISTS (SELECT 1 FROM "invoiceSettlement" s
      JOIN "payment" applying ON applying."id" = s."paymentId" AND applying."companyId" = s."companyId"
      WHERE s."companyId" = v_company AND s."sourcePaymentId" = v_id
        AND s."paymentId" <> v_id AND applying."status" = 'Posted') THEN
    RAISE EXCEPTION 'Cannot void an advance while posted payments consume it';
  END IF;
  IF p_table = 'payment' AND p_new->>'customerId' IS NOT NULL AND p_new->>'paymentType' = 'Receipt'
    AND p_old->>'status' IS DISTINCT FROM p_new->>'status'
    AND (p_old->>'status' = 'Posted' OR p_new->>'status' = 'Posted')
    AND num_nonnulls(p_new->>'salesOrderId', p_new->>'rentalAgreementId', p_new->>'customerContractId') > 0 THEN
    v_sources := array_append(coalesce(v_sources, ARRAY[]::text[]), v_id);
  END IF;
  -- Historical customer refunds have no source applications. Lock the whole
  -- document's advances so their remaining pool cannot be spent concurrently.
  IF p_table = 'payment' AND p_new->>'customerId' IS NOT NULL
    AND p_new->>'paymentType' = 'Disbursement'
    AND p_old->>'status' IS DISTINCT FROM p_new->>'status'
    AND (p_old->>'status' = 'Posted' OR p_new->>'status' = 'Posted')
    AND num_nonnulls(p_new->>'salesOrderId', p_new->>'rentalAgreementId', p_new->>'customerContractId') > 0
    AND NOT EXISTS (SELECT 1 FROM "invoiceSettlement" WHERE "companyId" = v_company
      AND "paymentId" = v_id AND "targetPaymentId" IS NOT NULL) THEN
    SELECT array_agg(DISTINCT source."id") INTO v_sources FROM "payment" source
    WHERE source."companyId" = v_company AND source."customerId" = p_new->>'customerId'
      AND source."currencyCode" = p_new->>'currencyCode' AND source."paymentType" = 'Receipt'
      AND source.status = 'Posted'
      AND (source."salesOrderId", source."rentalAgreementId", source."customerContractId")
        IS NOT DISTINCT FROM (p_new->>'salesOrderId', p_new->>'rentalAgreementId', p_new->>'customerContractId');
  END IF;
  IF v_sources IS NULL THEN RETURN; END IF;

  v_has_legacy := false;
  IF p_table = 'invoiceSettlement' OR p_old->>'status' IS DISTINCT FROM p_new->>'status' THEN
    SELECT EXISTS (
      SELECT 1 FROM "payment" wanted JOIN "payment" refund ON
        (refund."customerId", refund."currencyCode", refund."salesOrderId", refund."rentalAgreementId", refund."customerContractId")
          IS NOT DISTINCT FROM (wanted."customerId", wanted."currencyCode", wanted."salesOrderId", wanted."rentalAgreementId", wanted."customerContractId")
      JOIN "company" legacy_company ON legacy_company.id = v_company
      JOIN "currency" legacy_currency ON legacy_currency."companyGroupId" = legacy_company."companyGroupId" AND legacy_currency.code = refund."currencyCode"
      WHERE wanted."companyId" = v_company AND wanted."id" = ANY(v_sources)
        AND refund."companyId" = v_company AND refund."customerId" IS NOT NULL
        AND refund.status = 'Posted' AND refund."paymentType" = 'Disbursement'
        AND num_nonnulls(refund."salesOrderId", refund."rentalAgreementId", refund."customerContractId") > 0
        AND NOT EXISTS (SELECT 1 FROM "invoiceSettlement" s WHERE s."companyId" = v_company
          AND s."paymentId" = refund.id AND s."targetPaymentId" IS NOT NULL)
        AND refund."totalAmount" > coalesce((SELECT sum(coalesce(s."sourceAmount",
          round((s."appliedAmount" - s."fxGainLossAmount") * refund."exchangeRate", legacy_currency."decimalPlaces")))
          FROM "invoiceSettlement" s WHERE s."companyId" = v_company AND s."paymentId" = refund.id AND s."sourcePaymentId" IS NULL), 0)
    ) INTO v_has_legacy;
  END IF;
  IF v_has_legacy THEN
  IF p_table = 'payment' AND p_old->>'status' = 'Posted' AND p_new->>'status' = 'Voided'
    AND p_old->>'paymentType' = 'Receipt' THEN
    RAISE EXCEPTION 'Void or reconcile historical deposit refunds before voiding this advance';
  END IF;

  PERFORM 1 FROM "payment" source
    WHERE source."companyId" = v_company AND source."paymentType" = 'Receipt'
      AND source.status = 'Posted' AND source."customerId" IS NOT NULL
      AND EXISTS (SELECT 1 FROM "payment" wanted WHERE wanted."companyId" = v_company
        AND wanted."id" = ANY(v_sources)
        AND (source."customerId", source."currencyCode", source."salesOrderId", source."rentalAgreementId", source."customerContractId")
          IS NOT DISTINCT FROM (wanted."customerId", wanted."currencyCode", wanted."salesOrderId", wanted."rentalAgreementId", wanted."customerContractId"))
    ORDER BY source."id" FOR UPDATE;

  IF EXISTS (
    WITH affected AS (
      SELECT DISTINCT source."customerId", source."currencyCode", source."salesOrderId", source."rentalAgreementId", source."customerContractId"
      FROM "payment" source WHERE source."companyId" = v_company AND source."id" = ANY(v_sources)
        AND source."customerId" IS NOT NULL
        AND num_nonnulls(source."salesOrderId", source."rentalAgreementId", source."customerContractId") > 0
    ), payments AS (
      SELECT p.*, jsonb_build_array(p."customerId", p."currencyCode", p."salesOrderId", p."rentalAgreementId", p."customerContractId") AS scope,
        CASE WHEN p_table = 'payment' AND p."id" = v_id THEN p_new->>'status' ELSE p."status"::text END AS effective_status
      FROM "payment" p JOIN affected a ON
        (p."customerId", p."currencyCode", p."salesOrderId", p."rentalAgreementId", p."customerContractId")
          IS NOT DISTINCT FROM (a."customerId", a."currencyCode", a."salesOrderId", a."rentalAgreementId", a."customerContractId")
      WHERE p."companyId" = v_company
    ), settlements AS (
      SELECT to_jsonb(s) AS data FROM "invoiceSettlement" s
      WHERE s."companyId" = v_company AND NOT (p_table = 'invoiceSettlement' AND s."id" = v_id)
        AND (s."paymentId" IN (SELECT id FROM payments) OR s."sourcePaymentId" IN (SELECT id FROM payments))
      UNION ALL SELECT p_new WHERE p_table = 'invoiceSettlement'
    ), legacy AS (
      SELECT p.*, p."totalAmount" - coalesce((SELECT sum(coalesce((s.data->>'sourceAmount')::numeric,
        round(((s.data->>'appliedAmount')::numeric - coalesce((s.data->>'fxGainLossAmount')::numeric, 0)) * p."exchangeRate", currency."decimalPlaces")))
        FROM settlements s WHERE s.data->>'paymentId' = p."id" AND s.data->>'sourcePaymentId' IS NULL), 0) AS principal,
        (SELECT -sum(line."amount") FROM "journalLine" line JOIN "journal" j ON j."id" = line."journalId" AND j."companyId" = line."companyId"
          WHERE line."companyId" = v_company AND line."documentId" = p."id" AND line."documentType" = 'Payment'
            AND line.description = 'Customer Deposit' AND j."sourceType" = 'Payment'
            AND j.status IN ('Posted', 'Provisional', 'Superseded')) AS carrying
      FROM payments p JOIN "company" company ON company.id = v_company
      JOIN "currency" currency ON currency."companyGroupId" = company."companyGroupId" AND currency.code = p."currencyCode"
      WHERE p.effective_status = 'Posted' AND p."paymentType" = 'Disbursement'
        AND NOT EXISTS (SELECT 1 FROM settlements s WHERE s.data->>'paymentId' = p."id" AND s.data->>'targetPaymentId' IS NOT NULL)
    ), pools AS (
      SELECT scope, sum("totalAmount") AS principal, sum(accounting_round_internal("totalAmount" / "exchangeRate")) AS carrying
      FROM payments WHERE effective_status = 'Posted' AND "paymentType" = 'Receipt' GROUP BY scope
    ), reserved AS (
      SELECT scope, sum(principal) AS principal, sum(carrying) AS carrying, count(*) AS refund_count,
        bool_or(principal < 0 OR (principal > 0 AND (carrying IS NULL OR carrying < 0))) AS invalid
      FROM legacy WHERE principal <> 0 GROUP BY scope
    ), consumed AS (
      SELECT funding.scope,
        sum(coalesce((s.data->>'sourceAmount')::numeric,
          round((s.data->>'appliedAmount')::numeric * funding."exchangeRate", currency."decimalPlaces"))) AS principal,
        sum((s.data->>'appliedAmount')::numeric + coalesce((s.data->>'fxGainLossAmount')::numeric, 0)) AS carrying
      FROM settlements s JOIN payments funding ON funding."id" = coalesce(s.data->>'sourcePaymentId', s.data->>'paymentId')
      JOIN "payment" applying ON applying."id" = s.data->>'paymentId' AND applying."companyId" = v_company
      JOIN "company" company ON company.id = v_company
      JOIN "currency" currency ON currency."companyGroupId" = company."companyGroupId" AND currency.code = funding."currencyCode"
      WHERE funding."paymentType" = 'Receipt'
        AND (CASE WHEN p_table = 'payment' AND applying."id" = v_id THEN p_new->>'status' ELSE applying.status::text END) = 'Posted'
      GROUP BY funding.scope
    ), source_lines AS (
      SELECT source.id, source.scope, line."accountId", line.amount
      FROM payments source JOIN "journalLine" line ON line."documentId" = source.id AND line."companyId" = v_company
      JOIN "journal" journal ON journal.id = line."journalId" AND journal."companyId" = v_company
      WHERE source.effective_status = 'Posted' AND source."paymentType" = 'Receipt'
        AND line."documentType" = 'Payment' AND line.description = 'Customer Deposit'
        AND journal."sourceType" = 'Payment' AND journal.status IN ('Posted', 'Provisional', 'Superseded')
    ), used_by_source AS (
      SELECT funding.id,
        sum(coalesce((s.data->>'sourceAmount')::numeric, round((s.data->>'appliedAmount')::numeric * funding."exchangeRate", currency."decimalPlaces"))) AS principal,
        sum((s.data->>'appliedAmount')::numeric + coalesce((s.data->>'fxGainLossAmount')::numeric, 0)) AS carrying
      FROM settlements s JOIN payments funding ON funding.id = coalesce(s.data->>'sourcePaymentId', s.data->>'paymentId')
      JOIN "payment" applying ON applying.id = s.data->>'paymentId' AND applying."companyId" = v_company
      JOIN "company" company ON company.id = v_company
      JOIN "currency" currency ON currency."companyGroupId" = company."companyGroupId" AND currency.code = funding."currencyCode"
      WHERE funding."paymentType" = 'Receipt'
        AND (CASE WHEN p_table = 'payment' AND applying.id = v_id THEN p_new->>'status' ELSE applying.status::text END) = 'Posted'
      GROUP BY funding.id
    ), source_remaining AS (
      SELECT source.*, source."totalAmount" - coalesce(used.principal, 0) AS principal,
        accounting_round_internal(source."totalAmount" / source."exchangeRate") - coalesce(used.carrying, 0) AS carrying
      FROM payments source LEFT JOIN used_by_source used ON used.id = source.id
      WHERE source.effective_status = 'Posted' AND source."paymentType" = 'Receipt'
    ), ordered_sources AS (
      SELECT source.*, coalesce(sum(principal) OVER (PARTITION BY scope ORDER BY coalesce("postingDate", "paymentDate"), id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS previous_principal
      FROM source_remaining source WHERE principal > 0
    ), inferred AS (
      SELECT source.scope, least(source.principal, greatest(reserved.principal - source.previous_principal, 0)) AS principal,
        CASE WHEN reserved.principal - source.previous_principal >= source.principal THEN source.carrying
          ELSE least(accounting_round_internal(greatest(reserved.principal - source.previous_principal, 0) / source."exchangeRate"), source.carrying) END AS carrying
      FROM ordered_sources source JOIN reserved ON reserved.scope = source.scope
    ), inferred_totals AS (
      SELECT scope, sum(carrying) AS carrying FROM inferred WHERE principal > 0 GROUP BY scope
    ), account_pools AS (
      SELECT scope, "accountId", sum(amount) AS carrying FROM source_lines GROUP BY scope, "accountId"
    ), account_reserved AS (
      SELECT refund.scope, line."accountId", -sum(line.amount) AS carrying
      FROM legacy refund JOIN "journalLine" line ON line."documentId" = refund.id AND line."companyId" = v_company
      JOIN "journal" journal ON journal.id = line."journalId" AND journal."companyId" = v_company
      WHERE refund.principal > 0 AND line."documentType" = 'Payment' AND line.description = 'Customer Deposit'
        AND journal."sourceType" = 'Payment' AND journal.status IN ('Posted', 'Provisional', 'Superseded')
      GROUP BY refund.scope, line."accountId"
    ), account_consumed AS (
      SELECT source.scope, source."accountId",
        sum((s.data->>'appliedAmount')::numeric + coalesce((s.data->>'fxGainLossAmount')::numeric, 0)) AS carrying
      FROM settlements s JOIN source_lines source ON source.id = s.data->>'sourcePaymentId'
      JOIN "payment" applying ON applying.id = s.data->>'paymentId' AND applying."companyId" = v_company
      WHERE (CASE WHEN p_table = 'payment' AND applying.id = v_id THEN p_new->>'status' ELSE applying.status::text END) = 'Posted'
      GROUP BY source.scope, source."accountId"
    )
    SELECT 1 FROM reserved r LEFT JOIN pools p ON p.scope = r.scope LEFT JOIN consumed c ON c.scope = r.scope
    WHERE r.invalid OR r.principal + coalesce(c.principal, 0) > coalesce(p.principal, 0)
      OR r.carrying + coalesce(c.carrying, 0) > coalesce(p.carrying, 0)
      OR (r.principal + coalesce(c.principal, 0) = coalesce(p.principal, 0)
        AND r.carrying + coalesce(c.carrying, 0) <> coalesce(p.carrying, 0))
    UNION ALL
    SELECT 1 FROM reserved r LEFT JOIN inferred_totals inferred ON inferred.scope = r.scope
      -- Each historical partial refund rounded independently at the internal scale.
      WHERE abs(r.carrying - coalesce(inferred.carrying, 0)) > 0.000001 * r.refund_count
    UNION ALL
    SELECT 1 FROM account_reserved r LEFT JOIN account_pools p ON p.scope = r.scope AND p."accountId" = r."accountId"
      LEFT JOIN account_consumed c ON c.scope = r.scope AND c."accountId" = r."accountId"
    WHERE r.carrying + coalesce(c.carrying, 0) > coalesce(p.carrying, 0)
  ) THEN
    RAISE EXCEPTION 'Historical deposit refunds exceed the remaining advance principal or carrying balance; reconcile this document';
  END IF;
  END IF;

  PERFORM 1 FROM "payment" WHERE "id" = ANY(v_sources)
    AND "companyId" = v_company ORDER BY "id" FOR UPDATE;

  IF EXISTS (
    WITH candidates AS (
      SELECT to_jsonb(s) AS data FROM "invoiceSettlement" s
      WHERE s."companyId" = v_company AND s."targetPaymentId" = ANY(v_sources)
        AND NOT (p_table = 'invoiceSettlement' AND s."id" = v_id)
      UNION ALL SELECT p_new WHERE p_table = 'invoiceSettlement' AND p_new->>'targetPaymentId' IS NOT NULL
    ), payments AS (
      SELECT c.data AS s,
        CASE WHEN p_table = 'payment' AND a."id" = v_id THEN p_new ELSE to_jsonb(a) END AS a,
        CASE WHEN p_table = 'payment' AND source."id" = v_id THEN p_new ELSE to_jsonb(source) END AS source,
        currency."decimalPlaces" AS decimals
      FROM candidates c
      LEFT JOIN "payment" a ON a."id" = c.data->>'paymentId' AND a."companyId" = v_company
      LEFT JOIN "payment" source ON source."id" = c.data->>'targetPaymentId' AND source."companyId" = v_company
      JOIN "company" company ON company."id" = v_company
      LEFT JOIN "currency" currency ON currency."code" = source."currencyCode"
        AND currency."companyGroupId" = company."companyGroupId"
    )
    SELECT 1 FROM payments
    WHERE a->>'status' IS DISTINCT FROM 'Voided'
      AND (p_table = 'invoiceSettlement' OR a->>'id' = v_id OR a->>'status' = 'Posted')
      AND (a IS NULL OR source IS NULL
      OR source->>'status' <> 'Posted'
      OR a->>'currencyCode' IS DISTINCT FROM source->>'currencyCode'
      OR a->>'customerId' IS DISTINCT FROM source->>'customerId'
      OR a->>'supplierId' IS DISTINCT FROM source->>'supplierId'
      OR NOT ((a->>'customerId' IS NOT NULL AND a->>'paymentType' = 'Disbursement' AND source->>'paymentType' = 'Receipt')
        OR (a->>'supplierId' IS NOT NULL AND a->>'paymentType' = 'Receipt' AND source->>'paymentType' = 'Disbursement'))
      OR num_nonnulls(source->>'purchaseOrderId', source->>'salesOrderId', source->>'rentalAgreementId', source->>'customerContractId') <> 1
      OR (a->>'purchaseOrderId', a->>'salesOrderId', a->>'rentalAgreementId', a->>'customerContractId')
        IS DISTINCT FROM (source->>'purchaseOrderId', source->>'salesOrderId', source->>'rentalAgreementId', source->>'customerContractId')
      OR (s->>'sourceExchangeRate')::numeric IS DISTINCT FROM (source->>'exchangeRate')::numeric
      OR (s->>'sourceAmount')::numeric IS NULL OR (s->>'sourceAmount')::numeric <= 0
      OR (s->>'appliedAmount')::numeric < 0 OR decimals IS NULL
      OR (s->>'sourceAmount')::numeric <> round((s->>'sourceAmount')::numeric, decimals))
  ) THEN
    RAISE EXCEPTION 'Deposit refund must match its posted advance party, currency and document';
  END IF;

  IF EXISTS (
    WITH settlements AS (
      SELECT to_jsonb(s) AS data FROM "invoiceSettlement" s
      WHERE s."companyId" = v_company
        AND coalesce(s."sourcePaymentId", s."paymentId") = ANY(v_sources)
        AND NOT (p_table = 'invoiceSettlement' AND s."id" = v_id)
      UNION ALL SELECT p_new WHERE p_table = 'invoiceSettlement'
    ), consumed AS (
      SELECT coalesce(s.data->>'sourcePaymentId', s.data->>'paymentId') AS source_id,
        sum(coalesce((s.data->>'sourceAmount')::numeric,
          round((s.data->>'appliedAmount')::numeric * funding."exchangeRate", currency."decimalPlaces"))) AS principal,
        sum((s.data->>'appliedAmount')::numeric + CASE WHEN funding."customerId" IS NOT NULL THEN 1 ELSE -1 END
          * coalesce((s.data->>'fxGainLossAmount')::numeric, 0)) AS carrying_base
      FROM settlements s JOIN "payment" a ON a."id" = s.data->>'paymentId' AND a."companyId" = v_company
      JOIN "payment" funding ON funding."id" = coalesce(s.data->>'sourcePaymentId', s.data->>'paymentId') AND funding."companyId" = v_company
      JOIN "company" company ON company."id" = v_company
      JOIN "currency" currency ON currency."code" = funding."currencyCode" AND currency."companyGroupId" = company."companyGroupId"
      WHERE (CASE WHEN p_table = 'payment' AND a."id" = v_id THEN p_new->>'status' ELSE a."status"::text END) = 'Posted'
      GROUP BY coalesce(s.data->>'sourcePaymentId', s.data->>'paymentId')
    )
    SELECT 1 FROM consumed c JOIN "payment" source ON source."id" = c.source_id AND source."companyId" = v_company
    WHERE c.principal > source."totalAmount"
      OR c.carrying_base > accounting_round_internal(source."totalAmount" / source."exchangeRate")
      OR (c.principal = source."totalAmount" AND c.carrying_base <> accounting_round_internal(source."totalAmount" / source."exchangeRate"))
  ) THEN
    RAISE EXCEPTION 'Deposit refund exceeds remaining advance principal or carrying balance';
  END IF;
END;
$function$;
