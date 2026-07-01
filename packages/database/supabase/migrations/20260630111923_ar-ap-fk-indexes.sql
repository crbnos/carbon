-- ============================================================
-- Index every foreign key on the AR/AP payment tables.
--
-- The base tables (20260628143012_ar-ap-payments,
-- 20260628171834_credit-applications-via-payment) indexed companyId, the
-- party/status/date columns, and the invoiceSettlement source/target FKs, but
-- left the remaining FK columns (account, journal, currency, audit/user refs)
-- unindexed. Carbon's convention is to index companyId AND every FK; this
-- backfills the gap. Nullable FKs use a partial index (matching the existing
-- `... WHERE "col" IS NOT NULL` style); NOT NULL FKs are plain.
-- ============================================================

-- payment
CREATE INDEX IF NOT EXISTS "payment_currencyCode_idx" ON "payment" ("currencyCode");
CREATE INDEX IF NOT EXISTS "payment_bankAccount_idx" ON "payment" ("bankAccount");
CREATE INDEX IF NOT EXISTS "payment_journalId_idx" ON "payment" ("journalId") WHERE "journalId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "payment_createdBy_idx" ON "payment" ("createdBy");
CREATE INDEX IF NOT EXISTS "payment_updatedBy_idx" ON "payment" ("updatedBy") WHERE "updatedBy" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "payment_postedBy_idx" ON "payment" ("postedBy") WHERE "postedBy" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "payment_voidedBy_idx" ON "payment" ("voidedBy") WHERE "voidedBy" IS NOT NULL;

-- memo
CREATE INDEX IF NOT EXISTS "memo_currencyCode_idx" ON "memo" ("currencyCode");
CREATE INDEX IF NOT EXISTS "memo_reasonAccount_idx" ON "memo" ("reasonAccount") WHERE "reasonAccount" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "memo_journalId_idx" ON "memo" ("journalId") WHERE "journalId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "memo_createdBy_idx" ON "memo" ("createdBy");
CREATE INDEX IF NOT EXISTS "memo_updatedBy_idx" ON "memo" ("updatedBy") WHERE "updatedBy" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "memo_postedBy_idx" ON "memo" ("postedBy") WHERE "postedBy" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "memo_voidedBy_idx" ON "memo" ("voidedBy") WHERE "voidedBy" IS NOT NULL;

-- invoiceSettlement (paymentId / memoId / target* / appliedViaPaymentId already indexed)
CREATE INDEX IF NOT EXISTS "invoiceSettlement_createdBy_idx" ON "invoiceSettlement" ("createdBy");

-- accountDefault FK columns added by the AR/AP migration (one row per company, so
-- these are convention/consistency indexes — negligible runtime impact).
CREATE INDEX IF NOT EXISTS "accountDefault_customerWriteOffAccount_idx" ON "accountDefault" ("customerWriteOffAccount");
CREATE INDEX IF NOT EXISTS "accountDefault_supplierWriteOffAccount_idx" ON "accountDefault" ("supplierWriteOffAccount") WHERE "supplierWriteOffAccount" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "accountDefault_realizedExchangeGainAccount_idx" ON "accountDefault" ("realizedExchangeGainAccount");
CREATE INDEX IF NOT EXISTS "accountDefault_realizedExchangeLossAccount_idx" ON "accountDefault" ("realizedExchangeLossAccount");
