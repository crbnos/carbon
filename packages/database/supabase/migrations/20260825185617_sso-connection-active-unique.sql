-- One ACTIVE SSO connection per company. This index also lives in the squashed
-- 20260820215433_sso-connection.sql for fresh databases; this migration applies
-- it to databases that ran the pre-squash version of that file (IF NOT EXISTS
-- makes both orders converge). Readers use .maybeSingle() — which errors on two
-- rows — and two concurrent upserts could otherwise both pass the app-side
-- domain check and leave two active rows; with the index the second insert
-- fails loudly instead.

-- A pre-squash database may already hold the duplicates the index exists to
-- prevent; the CREATE INDEX would then abort the whole migration. Keep the
-- newest active row per company and deactivate the rest first. Deactivate, not
-- delete: the row still names its GoTrue provider, so an admin can see and
-- clean up the losing connection instead of it silently vanishing.
UPDATE "ssoConnection" sc
SET "active" = FALSE
WHERE sc."active" = TRUE
  AND EXISTS (
    SELECT 1 FROM "ssoConnection" newer
    WHERE newer."companyId" = sc."companyId"
      AND newer."active" = TRUE
      AND (newer."createdAt", newer."id") > (sc."createdAt", sc."id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "ssoConnection_companyId_active_key" ON "ssoConnection" ("companyId") WHERE "active" = TRUE;
