-- One ACTIVE SSO connection per company. This index also lives in the squashed
-- 20260820215433_sso-connection.sql for fresh databases; this migration applies
-- it to databases that ran the pre-squash version of that file (IF NOT EXISTS
-- makes both orders converge). Readers use .maybeSingle() — which errors on two
-- rows — and two concurrent upserts could otherwise both pass the app-side
-- domain check and leave two active rows; with the index the second insert
-- fails loudly instead.
CREATE UNIQUE INDEX IF NOT EXISTS "ssoConnection_companyId_active_key" ON "ssoConnection" ("companyId") WHERE "active" = TRUE;
