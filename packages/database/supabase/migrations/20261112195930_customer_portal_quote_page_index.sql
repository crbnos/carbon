-- Each index has its own migration so the table's write lock ends as soon
-- as the build commits. Keep the index usable by prepared status queries.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE INDEX IF NOT EXISTS "quote_portal_page_idx"
  ON "quote" ("companyId", "customerId", "createdAt" DESC, "id");

RESET statement_timeout;
RESET lock_timeout;
