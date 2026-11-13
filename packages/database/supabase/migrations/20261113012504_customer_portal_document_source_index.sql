-- Portal document lookups batch source ids within one company. Keep the
-- source predicate indexed so each page does not scan all company documents.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE INDEX IF NOT EXISTS "document_portal_source_idx"
  ON "document" ("companyId", "sourceDocumentId", "sourceDocument");

RESET statement_timeout;
RESET lock_timeout;
