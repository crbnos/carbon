-- The trial balance's Debits and Credits columns: the gross debits and the
-- gross credits each posting account took in a date range, so the report ties
-- to the General Ledger line by line. accountTreeBalancesByCompany returns only
-- the net change, which hides every account that took both.
--
-- journalLine."amount" is natural-signed (positive on the account's normal
-- side), so a line is a debit when its debit-signed value is positive: the
-- same per-line rule the General Ledger report uses (toDisplayDebit).
CREATE OR REPLACE FUNCTION "accountActivityByCompany" (
  p_company_group_id TEXT,
  p_company_id TEXT,
  from_date DATE,
  to_date DATE
)
RETURNS TABLE (
  "accountId" TEXT,
  "debits" NUMERIC,
  "credits" NUMERIC
) LANGUAGE "plpgsql" SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'accountActivityByCompany requires p_company_id';
  END IF;

  RETURN QUERY
    WITH "signedLines" AS (
      SELECT
        jl."accountId" AS "lineAccountId",
        CASE
          WHEN a."class" IN ('Asset', 'Expense') THEN jl."amount"
          ELSE -jl."amount"
        END AS "debitSigned"
      FROM "journal" j
      INNER JOIN "journalLine" jl ON jl."journalId" = j."id"
      INNER JOIN "account" a ON a."id" = jl."accountId"
      WHERE j."companyId" = p_company_id
        AND jl."companyId" = p_company_id
        AND a."companyGroupId" = p_company_group_id
        AND j."status" IN ('Posted', 'Reversed')
        AND j."postingDate" >= from_date
        AND j."postingDate" <= to_date
    )
    SELECT
      s."lineAccountId",
      COALESCE(SUM(GREATEST(s."debitSigned", 0)), 0)::NUMERIC,
      COALESCE(SUM(GREATEST(-s."debitSigned", 0)), 0)::NUMERIC
    FROM "signedLines" s
    GROUP BY s."lineAccountId";
END;
$$;
