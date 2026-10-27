-- Contact email is not unique. 20260112120041 meant to drop the index, but it
-- named it unquoted, Postgres folded the name to lower case and `IF EXISTS`
-- found nothing, so a second contact with one email was still refused.
SET lock_timeout = '5s';
DROP INDEX IF EXISTS "contact_email_companyId_unique_idx";
RESET lock_timeout;
