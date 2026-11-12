SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE INDEX IF NOT EXISTS "shipment_portal_page_idx"
  ON "shipment" ("companyId", "customerId", "createdAt" DESC, "id");

RESET statement_timeout;
RESET lock_timeout;
