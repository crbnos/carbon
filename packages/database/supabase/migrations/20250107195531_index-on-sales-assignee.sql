
CREATE INDEX IF NOT EXISTS "salesOrder_assignee_idx" ON "salesOrder" ("assignee");
CREATE INDEX IF NOT EXISTS "quote_assignee_idx" ON "quote" ("assignee");
CREATE INDEX IF NOT EXISTS "salesRfq_assignee_idx" ON "salesRfq" ("assignee");
