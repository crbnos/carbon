-- Trigram indexes for the list searches that filter with `ilike '%text%'`.
--
-- A btree index cannot serve a leading `%`, so each search read every row of
-- the company. Measured on 42,000 rows of one company, a 3-letter search that
-- matches 43 rows (first page / count):
--   item.readableId              19.8 / 19.0 -> 0.06 / 0.04 ms (price list base catalog)
--   item.name                    37.0 / 36.4 -> 0.06 / 0.04 ms (price list base catalog)
--   job.jobId (jobs view)        19.6 / 19.1 -> 0.45 / 0.28 ms
--   customer.name                15.5 / 14.5 -> 0.04 / 0.03 ms
--   supplier.name                14.0 / 14.2 -> 0.04 / 0.03 ms
--   methodOperation.description  17.6 / 17.7 -> 0.05 / 0.03 ms
--   payment.paymentId            15.9 / 16.9 -> 0.06 / 0.07 ms
--   memo.memoId                  14.8 / 15.0 -> 0.03 / 0.03 ms
-- Each index is 2-5 MB per 42,000 rows.
--
-- Not indexed: jobOperation.description (the search is scoped to one job) and
-- supplierPart.supplierPartId (an exact match within one supplier). The item
-- lists (parts, materials, ...) search through DISTINCT ON views that no
-- item index can serve. purchaseInvoice.invoiceId and salesInvoice.invoiceId
-- (14.7 and 15.9 ms -> 0.05 ms) wait for #2109, which replaces that search with
-- a `searchText` filter no column index serves.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "item_readableId_trgm_idx" ON "item" USING GIN ("readableId" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "item_name_trgm_idx" ON "item" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "job_jobId_trgm_idx" ON "job" USING GIN ("jobId" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "customer_name_trgm_idx" ON "customer" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "supplier_name_trgm_idx" ON "supplier" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "methodOperation_description_trgm_idx" ON "methodOperation" USING GIN ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "payment_paymentId_trgm_idx" ON "payment" USING GIN ("paymentId" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "memo_memoId_trgm_idx" ON "memo" USING GIN ("memoId" gin_trgm_ops);
