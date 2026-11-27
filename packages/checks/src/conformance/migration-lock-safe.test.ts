// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { migrationLockSafe } from "./migration-lock-safe";

// Any migration after the cutoff.
const FILE = "20261201000000_x.sql";
const scan = (sql: string) => migrationLockSafe.scan(FILE, sql);
const snippets = (sql: string) => scan(sql).map((v) => v.snippet);

// 20261013005642_account-delete-restrict.sql lines 5-11, before efde0fe4ea.
const EFDE_BEFORE = `ALTER TABLE "journalLine" DROP CONSTRAINT IF EXISTS "journalLine_accountId_fkey";
ALTER TABLE "journalLine" ADD CONSTRAINT "journalLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE "purchaseOrderLine" DROP CONSTRAINT IF EXISTS "purchaseOrderLine_accountId_fkey";
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;`;

// The same lines after efde0fe4ea, and its follow-up 20261013005913.
const EFDE_AFTER = `SET lock_timeout = '5s';

ALTER TABLE "journalLine" DROP CONSTRAINT IF EXISTS "journalLine_accountId_fkey";
ALTER TABLE "journalLine" ADD CONSTRAINT "journalLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE "purchaseOrderLine" DROP CONSTRAINT IF EXISTS "purchaseOrderLine_accountId_fkey";
ALTER TABLE "purchaseOrderLine" ADD CONSTRAINT "purchaseOrderLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT
  NOT VALID;

RESET lock_timeout;`;
const EFDE_VALIDATE = `-- Validates the account foreign keys 20261013005642 added NOT VALID. Its own
-- migration, so its own transaction: VALIDATE takes SHARE UPDATE EXCLUSIVE,
-- which lets writes continue while it scans the existing rows.

ALTER TABLE "journalLine" VALIDATE CONSTRAINT "journalLine_accountId_fkey";
ALTER TABLE "purchaseOrderLine" VALIDATE CONSTRAINT "purchaseOrderLine_accountId_fkey";`;

// 20260721162233_gapless-numbering-legal-series.sql lines 315-321, before ddeaab8da5.
const DDEA_BEFORE = `ALTER TABLE "journal" ALTER COLUMN "journalEntryId" DROP NOT NULL;
ALTER TABLE "journal" ADD CONSTRAINT "journal_posted_requires_number"
  CHECK ("status" = 'Draft' OR "journalEntryId" IS NOT NULL);

ALTER TABLE "payment" ALTER COLUMN "paymentId" DROP NOT NULL;
ALTER TABLE "payment" ADD CONSTRAINT "payment_posted_requires_number"
  CHECK ("status" = 'Draft' OR "paymentId" IS NOT NULL);`;

// The same constraint after ddeaab8da5: NOT VALID, validated in the same file.
const DDEA_AFTER = `ALTER TABLE "journal" ALTER COLUMN "journalEntryId" DROP NOT NULL;
ALTER TABLE "journal" ADD CONSTRAINT "journal_posted_requires_number"
  CHECK ("status" = 'Draft' OR "journalEntryId" IS NOT NULL) NOT VALID;
ALTER TABLE "journal" VALIDATE CONSTRAINT "journal_posted_requires_number";`;

// 20260901161207_exchange-rate-positive-constraint.sql lines 19-25, before 7a2220cf4d.
const SEVEN_BEFORE = `ALTER TABLE "quote"
  ADD CONSTRAINT "quote_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR "exchangeRate" > 0);

ALTER TABLE "quoteLinePrice"
  ADD CONSTRAINT "quoteLinePrice_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR "exchangeRate" > 0);`;

// The same constraints after 7a2220cf4d: NOT VALID, and the VALIDATEs at the
// end of the same file.
const SEVEN_AFTER = `ALTER TABLE "quote"
  ADD CONSTRAINT "quote_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN'))
  NOT VALID;

ALTER TABLE "quoteLinePrice"
  ADD CONSTRAINT "quoteLinePrice_exchangeRate_check"
  CHECK ("exchangeRate" IS NULL OR ("exchangeRate" > 0 AND "exchangeRate" <> 'NaN'))
  NOT VALID;

-- Validate separately: no write-blocking lock.
ALTER TABLE "quote" VALIDATE CONSTRAINT "quote_exchangeRate_check";
ALTER TABLE "quoteLinePrice" VALIDATE CONSTRAINT "quoteLinePrice_exchangeRate_check";`;

// 20260714012050_job-operation-batching.sql lines 52-62 and 83-95, before
// b52644969b (column lists cut).
const B526_BEFORE = `CREATE TABLE "jobOperationBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    CONSTRAINT "jobOperationBatch_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "jobOperationBatch_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobOperationBatch_processId_fkey" FOREIGN KEY ("processId")
      REFERENCES "process"("id"),
    CONSTRAINT "jobOperationBatch_workCenterId_fkey" FOREIGN KEY ("workCenterId")
      REFERENCES "workCenter"("id") ON DELETE SET NULL,
    CONSTRAINT "jobOperationBatch_locationId_fkey" FOREIGN KEY ("locationId")
      REFERENCES "location"("id"),
    CONSTRAINT "jobOperationBatch_readableId_unique" UNIQUE ("readableId", "companyId")
);

-- 3. Membership — one nullable FK on jobOperation
ALTER TABLE "jobOperation" ADD COLUMN "jobOperationBatchId" TEXT;
ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_jobOperationBatchId_fkey"
  FOREIGN KEY ("jobOperationBatchId", "companyId")
  REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL;
CREATE INDEX "jobOperation_jobOperationBatchId_idx"
  ON "jobOperation" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

-- 4. Batch-tagged timers (while running; slices keep the tag for auditability)
ALTER TABLE "productionEvent" ADD COLUMN "jobOperationBatchId" TEXT;
ALTER TABLE "productionEvent" ADD CONSTRAINT "productionEvent_jobOperationBatchId_fkey"
  FOREIGN KEY ("jobOperationBatchId", "companyId")
  REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL;`;

// The same lines after b52644969b: the new table's FKs are validated in the
// file (it is empty); the live tables' FKs are NOT VALID, validated in
// 20260714012100_batching-fk-validate.sql.
const B526_AFTER = `CREATE TABLE "jobOperationBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    CONSTRAINT "jobOperationBatch_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "jobOperationBatch_readableId_unique" UNIQUE ("readableId", "companyId")
);

ALTER TABLE "process"
  ADD CONSTRAINT "process_id_companyId_key" UNIQUE ("id", "companyId");

ALTER TABLE "jobOperationBatch" ADD CONSTRAINT "jobOperationBatch_processId_fkey"
  FOREIGN KEY ("processId", "companyId")
  REFERENCES "process"("id", "companyId") NOT VALID;
ALTER TABLE "jobOperationBatch" VALIDATE CONSTRAINT "jobOperationBatch_processId_fkey";

ALTER TABLE "jobOperation" ADD COLUMN "jobOperationBatchId" TEXT;
ALTER TABLE "jobOperation" ADD CONSTRAINT "jobOperation_jobOperationBatchId_fkey"
  FOREIGN KEY ("jobOperationBatchId", "companyId")
  REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL ("jobOperationBatchId") NOT VALID;
CREATE INDEX "jobOperation_jobOperationBatchId_idx"
  ON "jobOperation" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

ALTER TABLE "productionEvent" ADD COLUMN "jobOperationBatchId" TEXT;
ALTER TABLE "productionEvent" ADD CONSTRAINT "productionEvent_jobOperationBatchId_fkey"
  FOREIGN KEY ("jobOperationBatchId", "companyId")
  REFERENCES "jobOperationBatch"("id", "companyId") ON DELETE SET NULL ("jobOperationBatchId") NOT VALID;`;

// 20261112183310_customer-portal-query-and-idempotency.sql lines 1-6, before dab1966019.
const DAB1_BEFORE = `-- Match the portal's customer history and staff review queries, and make
-- repeated submission keys reject a different request body.
ALTER TABLE "salesOrderLine"
  ADD CONSTRAINT "salesOrderLine_portalLateReason_check"
    CHECK ("portalLateReason" IS NULL OR "portalLateReason" IN
      ('Production', 'Supplier', 'Export licence', 'Your change'));`;

// dab1966019's 20261112194844_add_customer_portal_late_reason_check.sql.
const DAB1_AFTER = `-- Enforce new values immediately without scanning the existing sales order lines
-- while holding an ACCESS EXCLUSIVE lock. Validation follows in its own
-- migration, after this transaction releases the table lock.
SET lock_timeout = '5s';
DO $migration$
BEGIN
  -- A development database may have applied the earlier draft of the PR,
  -- which already added the validated constraint in a prior migration.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."salesOrderLine"'::regclass
      AND conname = 'salesOrderLine_portalLateReason_check'
  ) THEN
    EXECUTE $sql$
      ALTER TABLE "salesOrderLine"
        ADD CONSTRAINT "salesOrderLine_portalLateReason_check"
          CHECK ("portalLateReason" IS NULL OR "portalLateReason" IN
            ('Production', 'Supplier', 'Export licence', 'Your change')) NOT VALID
    $sql$;
  END IF;
END
$migration$;
RESET lock_timeout;`;

// 20260827112750_prevent-item-delete-with-inventory.sql lines 58-68, before b2e62f8c00.
const B2E6_BEFORE = `ALTER TABLE "itemLedger"
  DROP CONSTRAINT "itemLedger_itemId_fkey";

ALTER TABLE "itemLedger"
  ADD CONSTRAINT "itemLedger_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE
    NOT VALID;

ALTER TABLE "itemLedger"
  VALIDATE CONSTRAINT "itemLedger_itemId_fkey";`;

// After b2e62f8c00: the VALIDATE moved to 20260827115500_validate-item-ledger-item-fk.sql.
const B2E6_AFTER = `ALTER TABLE "itemLedger"
  DROP CONSTRAINT "itemLedger_itemId_fkey";

ALTER TABLE "itemLedger"
  ADD CONSTRAINT "itemLedger_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE
    NOT VALID;`;
const B2E6_VALIDATE = `ALTER TABLE "itemLedger"
  VALIDATE CONSTRAINT "itemLedger_itemId_fkey";`;

// 20261027162653_contact-email-index-and-orphans.sql lines 1-4, before 86bd0af78d.
const EIGHT6_BEFORE = `-- Contact email is not unique. 20260112120041 meant to drop the index, but it
-- named it unquoted, Postgres folded the name to lower case and \`IF EXISTS\`
-- found nothing, so a second contact with one email was still refused.
DROP INDEX IF EXISTS "contact_email_companyId_unique_idx";`;

const EIGHT6_AFTER = `-- Contact email is not unique. 20260112120041 meant to drop the index, but it
-- named it unquoted, Postgres folded the name to lower case and \`IF EXISTS\`
-- found nothing, so a second contact with one email was still refused.
SET lock_timeout = '5s';
DROP INDEX IF EXISTS "contact_email_companyId_unique_idx";
RESET lock_timeout;`;

// 20261103033413_drop-redundant-indexes.sql lines 10-14, before 90634155b3.
const NINE0_BEFORE = `-- Each dropped index costs a write on every insert and update of its table
-- and serves no query its covering index cannot.

DROP INDEX IF EXISTS "public"."account_number_idx"; -- covered by account_number_key on account
DROP INDEX IF EXISTS "public"."accountingCutoverIgnoredInvoice_companyId_idx"; -- covered by accountingCutoverIgnoredInvoice_companyId_invoiceId_key on accountingCutoverIgnoredInvoice`;

const NINE0_AFTER = `-- Each dropped index costs a write on every insert and update of its table
-- and serves no query its covering index cannot.

SET lock_timeout = '5s';

DROP INDEX IF EXISTS "public"."account_number_idx"; -- covered by account_number_key on account
DROP INDEX IF EXISTS "public"."accountingCutoverIgnoredInvoice_companyId_idx"; -- covered by accountingCutoverIgnoredInvoice_companyId_invoiceId_key on accountingCutoverIgnoredInvoice

RESET lock_timeout;`;

describe("migration-lock-safe: a CHECK or FOREIGN KEY on a live table", () => {
  it("flags the account foreign keys from before efde0fe4ea", () => {
    const found = scan(EFDE_BEFORE);
    expect(found.map((v) => [v.line, v.snippet])).toEqual([
      [2, 'ADD CONSTRAINT "journalLine_accountId_fkey" FOREIGN KEY'],
      [6, 'ADD CONSTRAINT "purchaseOrderLine_accountId_fkey" FOREIGN KEY']
    ]);
    expect(found[0]?.message).toContain(
      'Add it NOT VALID here, and VALIDATE CONSTRAINT "journalLine_accountId_fkey" in a later migration'
    );
  });

  it("passes the efde0fe4ea fix and its validate migration", () => {
    expect(scan(EFDE_AFTER)).toEqual([]);
    expect(scan(EFDE_VALIDATE)).toEqual([]);
  });

  it("flags the posted-requires-number CHECKs from before ddeaab8da5", () => {
    expect(snippets(DDEA_BEFORE)).toEqual([
      'ADD CONSTRAINT "journal_posted_requires_number" CHECK',
      'ADD CONSTRAINT "payment_posted_requires_number" CHECK'
    ]);
  });

  it("flags the exchange-rate CHECKs from before 7a2220cf4d", () => {
    expect(snippets(SEVEN_BEFORE)).toEqual([
      'ADD CONSTRAINT "quote_exchangeRate_check" CHECK',
      'ADD CONSTRAINT "quoteLinePrice_exchangeRate_check" CHECK'
    ]);
  });

  it("flags the live-table foreign keys from before b52644969b, not the new table's", () => {
    expect(snippets(B526_BEFORE)).toEqual([
      'ADD CONSTRAINT "jobOperation_jobOperationBatchId_fkey" FOREIGN KEY',
      'ADD CONSTRAINT "productionEvent_jobOperationBatchId_fkey" FOREIGN KEY'
    ]);
  });

  it("passes the b52644969b fix: the table it creates may validate in the file", () => {
    expect(scan(B526_AFTER)).toEqual([]);
  });

  it("flags the portal late-reason CHECK from before dab1966019", () => {
    expect(snippets(DAB1_BEFORE)).toEqual([
      'ADD CONSTRAINT "salesOrderLine_portalLateReason_check" CHECK'
    ]);
  });

  it("passes the dab1966019 fix", () => {
    expect(scan(DAB1_AFTER)).toEqual([]);
  });

  it("flags an unnamed ADD CHECK and an ADD in a DO block", () => {
    expect(
      snippets(`ALTER TABLE "item" ADD CHECK ("x" > 0);
DO $$ BEGIN
  ALTER TABLE "customerTax" ADD CONSTRAINT "customerTax_taxCodeId_fkey"
    FOREIGN KEY ("taxCodeId", "companyId") REFERENCES "taxCode"("id", "companyId")
    ON DELETE SET NULL ("taxCodeId");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
    ).toEqual([
      "ADD CHECK",
      'ADD CONSTRAINT "customerTax_taxCodeId_fkey" FOREIGN KEY'
    ]);
  });

  it("reads each action of a multi-action ALTER TABLE", () => {
    expect(
      snippets(`ALTER TABLE "item"
  ADD CONSTRAINT "a_check" CHECK ("x" IN (1, 2)) NOT VALID,
  ADD CONSTRAINT "b_check" CHECK ("y" > 0);`)
    ).toEqual(['ADD CONSTRAINT "b_check" CHECK']);
  });

  it("passes UNIQUE, an inline column constraint, and a function body", () => {
    expect(
      scan(`ALTER TABLE "process" ADD CONSTRAINT "process_id_companyId_key" UNIQUE ("id", "companyId");
ALTER TABLE "item" ADD COLUMN IF NOT EXISTS "unitId" TEXT REFERENCES "unit"("id") ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE "item" ADD CONSTRAINT "x_check" CHECK (true);
END;
$$;
-- ALTER TABLE "item" ADD CONSTRAINT "y_check" CHECK (true);`)
    ).toEqual([]);
  });

  it("passes a table the file creates, quoted or not", () => {
    expect(
      scan(`CREATE TABLE IF NOT EXISTS public."taxCode" ("id" TEXT);
ALTER TABLE "taxCode" ADD CONSTRAINT "taxCode_rate_check" CHECK ("rate" >= 0);
ALTER TABLE "taxCode" VALIDATE CONSTRAINT "taxCode_rate_check";`)
    ).toEqual([]);
  });
});

describe("migration-lock-safe: VALIDATE CONSTRAINT in the file that added it", () => {
  it("flags the itemLedger VALIDATE from before b2e62f8c00", () => {
    const found = scan(B2E6_BEFORE);
    expect(found.map((v) => [v.line, v.snippet])).toEqual([
      [10, 'VALIDATE CONSTRAINT "itemLedger_itemId_fkey"']
    ]);
    expect(found[0]?.message).toContain(
      "Move the VALIDATE to a later migration"
    );
  });

  it("passes the b2e62f8c00 fix and its validate migration", () => {
    expect(scan(B2E6_AFTER)).toEqual([]);
    expect(scan(B2E6_VALIDATE)).toEqual([]);
  });

  it("flags the same-file VALIDATEs the ddeaab8da5 and 7a2220cf4d fixes left", () => {
    expect(snippets(DDEA_AFTER)).toEqual([
      'VALIDATE CONSTRAINT "journal_posted_requires_number"'
    ]);
    expect(snippets(SEVEN_AFTER)).toEqual([
      'VALIDATE CONSTRAINT "quote_exchangeRate_check"',
      'VALIDATE CONSTRAINT "quoteLinePrice_exchangeRate_check"'
    ]);
  });

  it("passes a VALIDATE after a COMMIT ends the ADD's transaction", () => {
    expect(
      scan(`ALTER TABLE "item" ADD CONSTRAINT "x_check" CHECK ("x" > 0) NOT VALID;
COMMIT;
ALTER TABLE "item" VALIDATE CONSTRAINT "x_check";`)
    ).toEqual([]);
  });

  it("matches the constraint on its table", () => {
    expect(
      scan(`ALTER TABLE "item" ADD CONSTRAINT "x_check" CHECK ("x" > 0) NOT VALID;
ALTER TABLE "part" VALIDATE CONSTRAINT "x_check";`)
    ).toEqual([]);
  });
});

describe("migration-lock-safe: DROP INDEX with no lock_timeout", () => {
  it("flags the contact email index drop from before 86bd0af78d", () => {
    const found = scan(EIGHT6_BEFORE);
    expect(found.map((v) => [v.line, v.snippet])).toEqual([
      [4, 'DROP INDEX IF EXISTS "contact_email_companyId_unique_idx"']
    ]);
    expect(found[0]?.message).toContain("SET lock_timeout = '5s';");
  });

  it("passes the 86bd0af78d fix", () => {
    expect(scan(EIGHT6_AFTER)).toEqual([]);
  });

  it("flags the redundant-index drops from before 90634155b3", () => {
    expect(snippets(NINE0_BEFORE)).toEqual([
      'DROP INDEX IF EXISTS "public"."account_number_idx"',
      'DROP INDEX IF EXISTS "public"."accountingCutoverIgnoredInvoice_companyId_idx"'
    ]);
  });

  it("passes the 90634155b3 fix", () => {
    expect(scan(NINE0_AFTER)).toEqual([]);
  });

  it("flags a drop after RESET, or under a timeout turned off", () => {
    expect(
      snippets(`SET lock_timeout = '5s';
ALTER TABLE "item" ADD COLUMN IF NOT EXISTS "x" TEXT;
RESET lock_timeout;
DROP INDEX IF EXISTS "a_idx";
SET lock_timeout = 0;
DROP INDEX IF EXISTS "b_idx";
SET lock_timeout TO DEFAULT;
DROP INDEX IF EXISTS "c_idx";`)
    ).toEqual([
      'DROP INDEX IF EXISTS "a_idx"',
      'DROP INDEX IF EXISTS "b_idx"',
      'DROP INDEX IF EXISTS "c_idx"'
    ]);
  });

  it("passes SET LOCAL and set_config, and does not check CREATE INDEX", () => {
    expect(
      scan(`SET LOCAL lock_timeout = '3s';
DROP INDEX IF EXISTS "a_idx";
CREATE INDEX IF NOT EXISTS "b_idx" ON "item" ("x");`)
    ).toEqual([]);
    expect(
      scan(`SELECT set_config('lock_timeout', '5s', true);
DROP INDEX IF EXISTS "a_idx";`)
    ).toEqual([]);
  });
});

describe("migration-lock-safe: cutoff", () => {
  it("skips applied migrations", () => {
    expect(
      migrationLockSafe.scan(
        "20261124175920_mixed-completion-handler.sql",
        EIGHT6_BEFORE
      )
    ).toEqual([]);
    expect(
      migrationLockSafe.scan(
        "packages/database/supabase/migrations/20261124175921_x.sql",
        EIGHT6_BEFORE
      )
    ).toHaveLength(1);
  });
});
