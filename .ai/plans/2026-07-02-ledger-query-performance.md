# Ledger Query Performance — Audit & Optimization Plan

Date: 2026-07-02
Status: Phases 1-3 implemented on `perf/ledger-queries` (migrations
`20260713224517`, `20260713225803`, `20260713231142`, `20260713232634`,
`20260713233919`, `20260713235406`). Deviations: 2f
(`count: "exact"`) deferred — the journal-entries filters can hit view-only
columns, so a side-count query is fragile, and the new `journalLine_journalId_idx`
makes the view aggregation cheap; 2g dropped — `StockMovementsTable` subscribes to
`itemLedger` realtime, so the publication stays. Phase 3 details + deviations:
`.ai/plans/2026-07-02-ledger-snapshot-delta.md` (the period-close hook for
`snapshotAccountingPeriodBalances` lands with the period-closing branch).
Scope: `itemLedger`, `costLedger`, `journal`/`journalLine` (GL), and the read paths built on them (financial statements, quantity-on-hand, COGS, tie-out). Goal: keep read latency flat as ledgers grow, **without** introducing heavy machinery (no partitioning, no CQRS, no event-sourced projections).

## How the system works today (audit summary)

All three ledgers are **append-only, aggregated-on-read since inception**:

- **GL balances**: every trial balance / balance sheet / income statement render calls
  `accountTreeBalancesByCompany` (`migrations/20260315000001_per-company-balance-rpc.sql:4`),
  which computes `balance` (SUM of all `journalLine` history) and `balanceAtDate`
  (SUM of everything with `journal.postingDate <= to_date` — also since inception).
  There is **no period-balance table**; `accountingPeriod` stores no balances.
- **Quantity on hand**: `get_inventory_quantities` (`20260512130000_inventory-storage-unit-filter.sql:14`)
  makes **three full-history passes** over `itemLedger` per call (on-hand sums,
  storage types, storage units). The old trigger-maintained `itemInventory` rollup was
  dropped (`20250209170952_shipment.sql:391,681`). The `itemStockQuantities`
  materialized view exists (30-min pg_cron refresh) but the hot read paths don't use it.
- **Costs**: Average/Standard read the cached `itemCost.unitCost` (good). FIFO/LIFO read
  open layers via the partial index `costLedger(itemId, remainingQuantity) WHERE > 0` (good),
  but consume layers with one UPDATE per layer (`functions/shared/calculate-cogs.ts:95-101`).

### Verified index inventory (the core problem)

| Table | Has | Missing (hot columns) |
|---|---|---|
| `itemLedger` | PK(id), partial `trackedEntityId`, `(companyId, createdAt DESC, entryNumber DESC)` | **`itemId`, `locationId`, `storageUnitId`, `documentId` — nothing** |
| `journalLine` | `companyId`, `accountId`, `intercompanyPartnerId` | **`journalId` (FK!)**, `documentId`, `documentLineReference` |
| `journal` | `companyId`, `accountingPeriodId`, `postingDate` (single-col), `(status, companyId)` | `(companyId, postingDate)` composite |
| `costLedger` | `itemId`, `companyId`, partial `(itemId, remainingQuantity)` | `supplierId`, `documentId` |
| `supplierLedger` | PK only | everything (`companyId`, `supplierId`) |

Consequences, ranked by severity:

1. **Cross-tenant sequential scans on `itemLedger`.** The `issue` edge function
   (`functions/issue/index.ts:234-252`) and `lib/storage-units.ts:36-70` run
   `SUM(quantity) ... WHERE itemId = ? AND locationId = ?` **per material issued**, with
   no usable index — each is a seq scan of the entire multi-tenant table, inside the
   posting transaction. This is the single worst scaling cliff: MES issue/pick latency
   degrades linearly with *total* ledger size across all companies.
2. **`journalLine.journalId` unindexed** — hits the `journalEntries` view
   (`20260402000000_journal-entries.sql:136`, group-join per journal), journal→line
   cascade deletes, void/reverse reads in `post-memo`/`post-payment`, and the per-row
   Draft-check RLS on journalLine UPDATE/DELETE.
3. **Statements re-scan everything, twice per company.** `getConsolidatedBalances`
   (`accounting.service.ts:1329`) runs `getFinancialStatementBalances` *and*
   `translateCompanyBalances` per company — each a full `journalLine` scan → **2 scans × N
   companies per render**. Also `accountTreeBalancesByCompany` has no `journal.status`
   filter, so Draft journals leak into statements (correctness, and it forecloses a
   `status='Posted'` partial-index strategy).
4. **Single-item reads pay whole-location cost.** `getItemQuantities`
   (`items.service.ts:740`) runs the full `get_inventory_quantities` RPC (3 ledger passes
   + PO/SO/job CTEs for every item at the location) and then filters to one `itemId` in
   PostgREST. Item detail pages get slower with every ledger row anywhere at the location.
5. **AR/AP tie-out** sums the full control-account history per call plus a correlated
   `invoiceSettlement` subquery per invoice (`20260630104012_tie-out-aging-from-view-total.sql`).
6. Smaller: `update-purchased-prices` fetches 12 months of `costLedger` with `select("*")`
   and no pagination — silently capped at PostgREST's 1000 rows (**correctness bug**, will
   skew average costs for high-volume items); `getItemCostHistory` has no LIMIT;
   inventory/journal list pages use `count: "exact"` over aggregating views; `itemLedger`
   is in the realtime publication (WAL fan-out per posting).

What's already good and should be left alone: bulk array inserts for all ledger writes;
keyset pagination in `getItemLedgerActivity`; cached `itemCost` for Average/Standard;
the FIFO partial index; `getNextSequence`'s per-company lock (correct serialization
for journal numbering).

---

## The plan

Three phases, ordered by impact-per-complexity. Phase 1 is pure SQL (one migration).
Phase 2 is small, local query-shape fixes. Phase 3 is the one structural pattern that
keeps things flat forever — **snapshot + delta** — applied identically to GL and inventory.
Explicit non-goals at the end.

### Phase 1 — Indexes (one migration, zero code changes, biggest win)

One idempotent migration (guard everything with `IF NOT EXISTS`; per repo lesson, the
deploy runner retries files over partial state):

```sql
-- itemLedger: per-item and per-location aggregation paths
CREATE INDEX IF NOT EXISTS "itemLedger_itemId_locationId_idx"
  ON "itemLedger" ("itemId", "locationId") INCLUDE ("storageUnitId", "quantity", "trackedEntityStatus");
CREATE INDEX IF NOT EXISTS "itemLedger_companyId_locationId_itemId_idx"
  ON "itemLedger" ("companyId", "locationId", "itemId");
CREATE INDEX IF NOT EXISTS "itemLedger_documentId_idx"
  ON "itemLedger" ("documentId") WHERE "documentId" IS NOT NULL;

-- journalLine: FK join path + document lookups
CREATE INDEX IF NOT EXISTS "journalLine_journalId_idx" ON "journalLine" ("journalId");
CREATE INDEX IF NOT EXISTS "journalLine_documentId_idx"
  ON "journalLine" ("documentId") WHERE "documentId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "journalLine_documentLineReference_idx"
  ON "journalLine" ("documentLineReference") WHERE "documentLineReference" IS NOT NULL;

-- journal: company-scoped date filters (tie-out, statements)
CREATE INDEX IF NOT EXISTS "journal_companyId_postingDate_idx"
  ON "journal" ("companyId", "postingDate");

-- costLedger / supplierLedger: unindexed FKs
CREATE INDEX IF NOT EXISTS "costLedger_supplierId_idx"
  ON "costLedger" ("supplierId") WHERE "supplierId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "supplierLedger_companyId_supplierId_idx"
  ON "supplierLedger" ("companyId", "supplierId");
```

Notes:
- The `INCLUDE` on the first index makes the per-item SUMs in `issue`,
  `storage-units.ts`, and `get_item_quantities_by_tracking_id` index-only scans —
  they never touch the heap even as the table grows.
- The `(companyId, locationId, itemId)` index serves `get_inventory_quantities`,
  `get_inventory_value_by_location`, `get_job_quantity_on_hand`, and the matview refresh.
- Directly fixes finding #1 and #2 with zero application changes. This alone converts
  MES issue/pick posting from O(total ledger) to O(rows for that item).
- Run `pnpm run generate:types` after (no type changes expected, but per workflow).

### Phase 2 — Query-shape fixes (small, local diffs)

2a. **Add `journal.status = 'Posted'` to balance RPCs.**
`accountTreeBalancesByCompany`, `accountTreeBalances`, and (transitively) `trialBalance` /
`translateTrialBalance` should exclude Draft/Reversed journals. Correctness fix first,
performance enabler second. Redefine via the fork-latest-version + `DROP IF EXISTS`
convention.

2b. **Stop double-scanning in `getConsolidatedBalances`** (`accounting.service.ts:1329`).
`translateCompanyBalances` re-runs the same underlying `accountTreeBalancesByCompany`
scan that `getFinancialStatementBalances` just did for the same company/dates. Change
`translateTrialBalance` to accept the already-computed balances (or compute translation
in TS from the one RPC result + rate lookup). Halves statement cost in consolidated mode.

2c. **Single-item variant for quantities.** Add an optional `item_id` parameter to
`get_inventory_quantities` (default NULL = current behavior) and pass it from
`getItemQuantities` (`items.service.ts:740`). All three `itemLedger` CTEs and the
PO/SO/job CTEs then filter to one item, using the new `(itemId, locationId)` index.
~10-line SQL change, one TS call-site change.

2d. **Fix `update-purchased-prices` 1000-row truncation** (`functions/update-purchased-prices/index.ts:239-246`).
Replace the `select("*")` + JS aggregation with a single SQL aggregate
(`SUM(cost)/SUM(quantity)` grouped by item, 12-month bound). Fixes the silent cap and
removes the transfer of a year of rows per invoice post.

2e. **Bound `getItemCostHistory`** (`items.service.ts:477`) with a LIMIT (e.g. 200) or
keyset pagination like `getItemLedgerActivity`.

2f. **Drop `count: "exact"` where it hurts**: `getJournalEntries` (aggregating view) and
`getInventoryItems` should use `count: "estimated"` or a separate cheap count query
(the pattern `getInventoryItemsCount` already uses).

2g. **Take `itemLedger` out of the realtime publication** unless something actually
subscribes to it (`20260624153001:35-45` added it for the stock-movements view; verify
a subscriber exists — if the UI only revalidates on navigation, this is pure WAL cost
on every posting).

### Phase 3 — Snapshot + delta (the structural answer, one pattern used twice)

The reason everything degrades with growth is "SUM since inception." The lowest-complexity
durable fix is a **watermarked snapshot + tiny delta scan**, exploiting the fact that both
ledgers are append-only and monotonic (`entryNumber` SERIAL on `itemLedger`;
`postingDate`/period on GL). No triggers on the hot insert path, no dual-write logic —
snapshots are built out-of-band and reads self-correct via the delta.

**3a. GL: `accountingPeriodBalance` table.**

```
accountingPeriodBalance (
  accountId, companyId, accountingPeriodId,
  endingBalance NUMERIC(19,4),
  endingBalanceAtDate DATE,          -- period endDate
  PK (accountId, companyId, accountingPeriodId)
)
```

- Written when a period is **closed** (extend the existing close flow), and backfillable
  by a one-shot statement per period: `INSERT ... SELECT accountId, SUM(amount) FROM
  journalLine JOIN journal ... WHERE postingDate <= period.endDate` (cumulative, not
  per-period net — so a read needs exactly one snapshot row).
- Read path: `accountTreeBalancesByCompany` becomes
  `snapshot.endingBalance + SUM(journalLine since snapshot date)` — pick the latest
  closed-period snapshot ≤ `to_date`, scan only open-period lines. Falls back to the
  current full scan when no snapshot exists (new companies work unchanged).
- Because closed periods are immutable (posting into a closed period is already
  disallowed), the snapshot can never drift; there is no invalidation problem. If a
  reopen feature ever lands, "delete snapshots ≥ reopened period" is the entire
  invalidation story.
- This makes trial balance / balance sheet / income statement / tie-out GL-side cost
  proportional to **one open period's lines**, forever.

**3b. Inventory: watermark the existing `itemStockQuantities` matview.**

- Add `MAX("entryNumber") AS "maxEntryNumber"` per group (or a single global watermark
  row) to the matview definition (`20260420112047:359-385`). Refresh cadence unchanged.
- Change the `item_ledgers` CTE in `get_inventory_quantities` (and
  `get_inventory_value_by_location`) to:
  `matview quantities + SUM(itemLedger WHERE entryNumber > watermark)` — exact,
  real-time correct, and the live scan is only the last ≤30 minutes of postings.
- The 30/90-day usage columns in `get_inventory_quantities` are already date-bounded;
  they ride on the Phase 1 indexes and can stay live.
- This reuses infrastructure that already exists (matview + pg_cron) rather than
  resurrecting the dropped trigger-maintained `itemInventory` cache — no write-path
  contention, no trigger complexity, and correctness doesn't depend on the refresh
  succeeding (a stale matview just means a slightly bigger delta scan).

**3c. (Optional, only if tie-out/aging pages are measurably slow after 3a):** replace the
per-invoice correlated `invoiceSettlement` subqueries in `get_ar_tie_out`/`get_ap_tie_out`
with a pre-aggregated `LEFT JOIN (SELECT invoiceId, SUM(...) GROUP BY invoiceId)`.

### Explicit non-goals (rejected for complexity)

- **Table partitioning** — operational burden, complicates RLS/FKs/PostgREST; snapshot+delta
  removes the need.
- **Trigger-maintained balance/quantity rollups on the insert path** — the project already
  tried and removed this (`itemInventory`); it adds write contention and drift risk.
- **Denormalizing `postingDate`/`status` onto `journalLine`** — helps, but Phase 3a makes
  the full-history scan disappear anyway, so the dual-write isn't worth it.
- **Composite `(id, companyId)` PK retrofit on ledger tables** — repo-standard elsewhere,
  but a disruptive rewrite of FKs for no read-path benefit here.
- **CQRS / event projections / read replicas** — out of proportion to the problem.

## Sequencing & verification

| Order | Item | Risk | Verification |
|---|---|---|---|
| 1 | Phase 1 migration | none (additive) | `EXPLAIN ANALYZE` the issue-path SUM and `journalEntries` view before/after on a seeded DB; confirm index-only scan on `itemLedger_itemId_locationId_idx` |
| 2 | 2d (correctness) + 2a (correctness) | low | unit-compare weighted avg vs full-history SQL; trial balance excludes a Draft journal fixture |
| 3 | 2b, 2c, 2e, 2f, 2g | low | statement pages return identical numbers; item detail loader issues single-item RPC |
| 4 | 3a GL snapshots | medium | snapshot+delta trial balance === full-scan trial balance on seeded history; close/backfill idempotent |
| 5 | 3b matview watermark | medium | `get_inventory_quantities` delta result === current full-scan result, before and after a fresh posting |

Rules to follow while implementing: `.ai/rules/workflow-database-migration.md`,
`.ai/rules/database-migration-patterns.md` (view/function redefinition),
migrations idempotent, randomized HHMMSS in filenames, `pnpm run generate:types`
after any schema change, and function redefinitions forked from the latest version.
