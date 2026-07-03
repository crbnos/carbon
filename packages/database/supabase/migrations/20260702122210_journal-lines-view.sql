-- Line-level general ledger view for account drill-down (Account Ledger drawer).
-- Joins journalLine to its journal header so lines can be filtered/sorted by
-- postingDate and displayed with entry id, status, and source type.
-- SECURITY_INVOKER so journalLine/journal RLS applies to the querying user.
-- Intentionally no status filter: balance RPCs (accountTreeBalancesByCompany)
-- include Draft journals, and the drill-down must tie out with them.

DROP VIEW IF EXISTS "journalLines";

CREATE VIEW "journalLines" WITH(SECURITY_INVOKER=true) AS
SELECT
  jl.*,
  j."postingDate",
  j."journalEntryId",
  j."status",
  j."sourceType",
  j."description" AS "journalDescription"
FROM "journalLine" jl
JOIN "journal" j ON j."id" = jl."journalId";
