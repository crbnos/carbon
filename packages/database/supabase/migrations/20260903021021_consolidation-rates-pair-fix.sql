-- Currency & exchange rate refactor, follow-up to part 3: "getConsolidationRates"
-- (20260713225803) still read the dropped "exchangeRateHistory" table and
-- COALESCEd every rate to 1. Re-pointed at the global "exchangeRate" store as
-- explicit target-per-source pair ratios. The target currency becomes a real
-- parameter — the old shape implied a target it never named, which is the
-- root defect this refactor exists to remove.
-- Spec: .ai/specs/2026-09-02-currency-exchange-rate-refactor.md

-- CREATE OR REPLACE with a new parameter would create an overload (the
-- attach_event_trigger trap); drop the old signature first.
DROP FUNCTION IF EXISTS "getConsolidationRates"(TEXT, TEXT, DATE, DATE);

CREATE OR REPLACE FUNCTION "getConsolidationRates" (
  p_company_group_id TEXT,
  p_company_id TEXT,
  p_target_currency TEXT,
  p_period_end DATE,
  p_period_start DATE DEFAULT NULL
)
RETURNS TABLE (
  "sourceCurrency" TEXT,
  "closingRate" NUMERIC,
  "averageRate" NUMERIC,
  "historicalRate" NUMERIC
)
LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_source_currency TEXT;
  v_source_close NUMERIC;
  v_target_close NUMERIC;
  v_closing_rate NUMERIC;
  v_average_rate NUMERIC;
  v_historical_rate NUMERIC;
BEGIN
  SELECT "baseCurrencyCode" INTO v_source_currency
  FROM "company" WHERE "id" = p_company_id;

  IF v_source_currency = p_target_currency THEN
    RETURN QUERY SELECT v_source_currency, 1::NUMERIC, 1::NUMERIC, 1::NUMERIC;
    RETURN;
  END IF;

  -- Closing rate: each side's latest global rate on or before period end; a
  -- period predating the store's earliest row falls back to that side's
  -- earliest rate (never to 1).
  SELECT "rate" INTO v_source_close FROM "exchangeRate"
  WHERE "currencyCode" = v_source_currency AND "effectiveDate" <= p_period_end
  ORDER BY "effectiveDate" DESC LIMIT 1;
  IF v_source_close IS NULL THEN
    SELECT "rate" INTO v_source_close FROM "exchangeRate"
    WHERE "currencyCode" = v_source_currency
    ORDER BY "effectiveDate" ASC LIMIT 1;
  END IF;

  SELECT "rate" INTO v_target_close FROM "exchangeRate"
  WHERE "currencyCode" = p_target_currency AND "effectiveDate" <= p_period_end
  ORDER BY "effectiveDate" DESC LIMIT 1;
  IF v_target_close IS NULL THEN
    SELECT "rate" INTO v_target_close FROM "exchangeRate"
    WHERE "currencyCode" = p_target_currency
    ORDER BY "effectiveDate" ASC LIMIT 1;
  END IF;

  IF v_source_close IS NULL OR v_target_close IS NULL THEN
    RAISE EXCEPTION 'No exchange rate available to translate % to %',
      v_source_currency, p_target_currency;
  END IF;

  v_closing_rate := v_target_close / v_source_close;

  -- Average rate: mean of the daily pair ratios over the period, where both
  -- currencies have a rate on the same date; falls back to the closing rate.
  SELECT AVG(t."rate" / s."rate") INTO v_average_rate
  FROM "exchangeRate" s
  JOIN "exchangeRate" t ON t."effectiveDate" = s."effectiveDate"
  WHERE s."currencyCode" = v_source_currency
    AND t."currencyCode" = p_target_currency
    AND s."effectiveDate" >= COALESCE(p_period_start, p_period_end - INTERVAL '1 year')
    AND s."effectiveDate" <= p_period_end;

  -- Historical rate: from currency table (manually set for equity, IAS 21).
  -- Its anchor is BY CONVENTION target-per-source against the group's
  -- presentation currency — every consolidated report passes the ROOT
  -- company's base as p_target_currency, and the edit form documents the
  -- convention. It is NOT re-anchored per target: a manual equity rate is a
  -- stated historical fact, not a derivable ratio. Consolidating to any other
  -- target is a consolidation-feature follow-up (tracked in the spec), not a
  -- silent conversion this function should invent.
  SELECT "historicalExchangeRate" INTO v_historical_rate
  FROM "currency"
  WHERE "code" = v_source_currency
    AND "companyGroupId" = p_company_group_id;

  v_average_rate := COALESCE(v_average_rate, v_closing_rate);
  v_historical_rate := COALESCE(v_historical_rate, v_closing_rate);

  RETURN QUERY
  SELECT v_source_currency, v_closing_rate, v_average_rate, v_historical_rate;
END;
$$;
