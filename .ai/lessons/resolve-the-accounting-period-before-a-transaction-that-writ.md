---
paths: []
triggers: ["getCurrentAccountingPeriod", "getAccountingPeriodForDate", "getNextSequence"]
promoted: null
---
# Resolve the accounting period BEFORE a transaction that writes for N records

**Context:** The batch material pick (`issue` case `trackedEntitiesToBatch`) runs one Kysely transaction and calls the per-member consumption writer once per batch member. Each member's write path reaches `createMaterialWipEntries` → `getCurrentAccountingPeriod`.

**Problem:** `getCurrentAccountingPeriod` READS the period over HTTP (supabase-js) but CREATES a missing one through the transaction handle. Inside one transaction, member 2's read cannot see member 1's uncommitted insert, so both try to create the same month and the `accountingPeriod_company_fy_period_idx` unique index aborts the whole pick. It only fires on the first posting of a month into a fresh database, so it passes every test run but the first — and the rollback makes it look like the pick silently did nothing (HTTP 200, empty body; the real error is only in the edge-runtime log).

**Rule:** Any lazily-created singleton that reads outside the transaction and writes inside it must be resolved BEFORE the transaction opens, once, when a flow writes for N records in one transaction. For the accounting period that is `await getCurrentAccountingPeriod(client, companyId, db, companyToday.toString())` ahead of `db.transaction()`, guarded on `accountingEnabled`.

**Applies to:** `getCurrentAccountingPeriod` / `getAccountingPeriodForDate` in any multi-record edge-function transaction; the same shape applies to `getNextSequence` and any other get-or-create helper straddling the transaction boundary.
