# Phase 3: Snapshot + Delta for Ledger Balances

Date: 2026-07-02
Status: IMPLEMENTED on `perf/ledger-queries` (migrations `20260713232634`,
`20260713233919`, `20260713235406`), with two deviations from the design below:

1. **Inventory watermark is `createdAt < now() - 1 hour`, not `entryNumber`.**
   SERIAL values don't respect commit order, so an entryNumber watermark can
   permanently miss a row that commits after the matview refresh with a lower
   sequence value. `createdAt` is transaction start time, so the 1-hour cutoff
   is race-free as long as no write transaction runs longer than an hour.
2. **New private `itemLedgerSnapshot` matview instead of modifying
   `itemStockQuantities`** — RealtimeDataProvider consumes `itemStockQuantities`
   directly as the UI item-store on-hand total, so its shape and semantics must
   not change. The new matview is REVOKEd from anon/authenticated and only read
   inside the SECURITY DEFINER functions.

What remains for the period-closing branch (workstream A's close hook):
- Call `snapshotAccountingPeriodBalances(companyId, periodId, userId)` inside
  the close transaction.
- Enforce the two invariants (postingDate cannot land in a closed period —
  checked on postingDate, not just accountingPeriodId; periods close in order).
- On reopen: `DELETE FROM "accountingPeriodBalance" WHERE "companyId" = ? AND
  "endingBalanceDate" >= (SELECT "endDate" FROM "accountingPeriod" WHERE "id" = ?)`.

Until snapshots are written, the read path takes the identical full-scan
fallback (verified by equivalence tests) — zero behavior change. Original
design follows.

Prerequisite: the Phase 1/2 migrations (`20260713224517_ledger-performance-indexes.sql`, `20260713225803_ledger-balance-posted-filter.sql`, `20260713231142_inventory-quantities-item-filter.sql`) — the read-path changes below assume the `Draft`-exclusion semantics and the new indexes.
Context: `.ai/plans/2026-07-02-ledger-query-performance.md` (the audit). The problem being solved: every GL balance and every on-hand quantity is a SUM over the full ledger history, so statement/inventory reads degrade linearly with ledger size. The fix is one pattern used twice — **an immutable snapshot plus a small live delta** — with no triggers on the posting path and no dual writes.

---

## Workstream A — GL: `accountingPeriodBalance`

### Design

One row per (leaf account, company, closed period) holding the **cumulative** balance through that period's `endDate` (not the per-period net — so a read needs exactly one snapshot row, not a running sum of them).

Correctness rests on two invariants the period-closing branch must enforce:

1. **Closed periods are immutable** — posting into a closed period is rejected (the ERP-side `getOrCreateAccountingPeriod` already checks this; make sure the edge functions' `getCurrentAccountingPeriod` path can't land in a closed period either).
2. **Periods close in order** — a period cannot be closed while an earlier period for the same company is still open. Without this, a snapshot could be taken while backdated postings are still possible before its `endDate`.

Given those, a snapshot can never drift. If reopen is supported: reopening period N deletes snapshots for **all periods ≥ N** for that company (they're cumulative, so later snapshots embed period N's data). That one DELETE is the entire invalidation story.

### Task A1 — Table migration

`pnpm db:migrate:new accounting-period-balance` (randomize HHMMSS; never `000000`).

```sql
CREATE TABLE "accountingPeriodBalance" (
    "id" TEXT NOT NULL DEFAULT id('apb'),
    "companyId" TEXT NOT NULL,
    "accountingPeriodId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL REFERENCES "account"("id"),
    -- cumulative balance through the period's endDate, Draft journals excluded
    "endingBalance" NUMERIC NOT NULL DEFAULT 0,
    -- denormalized period endDate so reads don't join accountingPeriod
    "endingBalanceDate" DATE NOT NULL,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("accountingPeriodId") REFERENCES "accountingPeriod"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "accountingPeriodBalance_account_period_key"
  ON "accountingPeriodBalance" ("accountId", "accountingPeriodId", "companyId");
-- the read path's lookup: latest snapshot per account at or before a date
CREATE INDEX "accountingPeriodBalance_companyId_date_idx"
  ON "accountingPeriodBalance" ("companyId", "accountId", "endingBalanceDate" DESC);
CREATE INDEX "accountingPeriodBalance_companyId_idx" ON "accountingPeriodBalance" ("companyId");
CREATE INDEX "accountingPeriodBalance_accountingPeriodId_idx" ON "accountingPeriodBalance" ("accountingPeriodId");
CREATE INDEX "accountingPeriodBalance_createdBy_idx" ON "accountingPeriodBalance" ("createdBy");
```

RLS: standard four policies, `accounting_view` for SELECT (match `journal`'s tightened read, not the generic employee-role read), `accounting_create/update/delete` for writes. Bare `NUMERIC` (house rule — no precision spec).

### Task A2 — Snapshot function, called from the close action

Same migration or a sibling. SECURITY DEFINER so the close action (route → Kysely transaction) can call it via `trx` or `client.rpc`:

```sql
CREATE OR REPLACE FUNCTION "snapshotAccountingPeriodBalances" (
  p_company_id TEXT,
  p_period_id TEXT,
  p_user_id TEXT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_end_date DATE;
BEGIN
  SELECT "endDate" INTO v_end_date FROM "accountingPeriod"
  WHERE "id" = p_period_id AND "companyId" = p_company_id;

  INSERT INTO "accountingPeriodBalance"
    ("companyId", "accountingPeriodId", "accountId", "endingBalance", "endingBalanceDate", "createdBy")
  SELECT
    p_company_id, p_period_id, a."id",
    COALESCE(SUM(CASE WHEN j."status" <> 'Draft' AND j."postingDate" <= v_end_date
                      THEN jl."amount" ELSE 0 END), 0),
    v_end_date, p_user_id
  FROM "account" a
  LEFT JOIN "journalLine" jl ON jl."accountId" = a."id" AND jl."companyId" = p_company_id
  LEFT JOIN "journal" j ON j."id" = jl."journalId"
  WHERE a."isGroup" = false AND a."active" = true
    AND a."companyGroupId" = (SELECT "companyGroupId" FROM "company" WHERE "id" = p_company_id)
  GROUP BY a."id"
  ON CONFLICT ("accountId", "accountingPeriodId", "companyId")
  DO UPDATE SET "endingBalance" = EXCLUDED."endingBalance",
                "endingBalanceDate" = EXCLUDED."endingBalanceDate",
                "updatedBy" = p_user_id, "updatedAt" = NOW();
END;
$$;
```

This is the **last** full-history scan a period will ever need — it runs once, at close time, inside the close transaction. Wire it into the period-close action (wherever the close flow sets `closedAt`/`closedBy`/status), in the same Kysely transaction, after the in-order + no-open-drafts checks. If reopen exists, the reopen action runs:
`DELETE FROM "accountingPeriodBalance" WHERE "companyId" = ? AND "endingBalanceDate" >= (SELECT "endDate" FROM "accountingPeriod" WHERE "id" = ?)`.

### Task A3 — Read path: snapshot + delta in `accountTreeBalancesByCompany`

New migration forking the Phase-2 definition (`20260713225803_ledger-balance-posted-filter.sql`). Signature and return type unchanged. Replace `leafBalances` with:

```sql
    "latestSnapshot" AS (
      -- newest snapshot per account (for `balance`, which is unbounded)
      SELECT DISTINCT ON (s."accountId")
        s."accountId", s."endingBalance", s."endingBalanceDate"
      FROM "accountingPeriodBalance" s
      WHERE s."companyId" = p_company_id
      ORDER BY s."accountId", s."endingBalanceDate" DESC
    ),
    "snapshotAtDate" AS (
      -- newest snapshot per account at or before to_date (for balanceAtDate)
      SELECT DISTINCT ON (s."accountId")
        s."accountId", s."endingBalance", s."endingBalanceDate"
      FROM "accountingPeriodBalance" s
      WHERE s."companyId" = p_company_id AND s."endingBalanceDate" <= to_date
      ORDER BY s."accountId", s."endingBalanceDate" DESC
    ),
    "snapshotBeforeFrom" AS (
      -- newest snapshot per account strictly before from_date (for netChange)
      SELECT DISTINCT ON (s."accountId")
        s."accountId", s."endingBalance", s."endingBalanceDate"
      FROM "accountingPeriodBalance" s
      WHERE s."companyId" = p_company_id AND s."endingBalanceDate" < from_date
      ORDER BY s."accountId", s."endingBalanceDate" DESC
    ),
    "leafBalances" AS (
      SELECT
        a."id" AS "accountId",
        COALESCE(ls."endingBalance", 0)
          + COALESCE(SUM(CASE WHEN j."status" <> 'Draft'
                              AND (ls."endingBalanceDate" IS NULL OR j."postingDate" > ls."endingBalanceDate")
                         THEN jl."amount" ELSE 0 END), 0) AS "balance",
        COALESCE(sad."endingBalance", 0)
          + COALESCE(SUM(CASE WHEN j."status" <> 'Draft'
                              AND (sad."endingBalanceDate" IS NULL OR j."postingDate" > sad."endingBalanceDate")
                              AND j."postingDate" <= to_date
                         THEN jl."amount" ELSE 0 END), 0) AS "balanceAtDate",
        -- netChange(from,to) = balanceAtDate(to) − balance just before from_date
        (COALESCE(sad."endingBalance", 0)
          + COALESCE(SUM(CASE WHEN j."status" <> 'Draft'
                              AND (sad."endingBalanceDate" IS NULL OR j."postingDate" > sad."endingBalanceDate")
                              AND j."postingDate" <= to_date
                         THEN jl."amount" ELSE 0 END), 0))
        - (COALESCE(sbf."endingBalance", 0)
          + COALESCE(SUM(CASE WHEN j."status" <> 'Draft'
                              AND (sbf."endingBalanceDate" IS NULL OR j."postingDate" > sbf."endingBalanceDate")
                              AND j."postingDate" < from_date
                         THEN jl."amount" ELSE 0 END), 0)) AS "netChange"
      FROM "account" a
      LEFT JOIN "latestSnapshot" ls ON ls."accountId" = a."id"
      LEFT JOIN "snapshotAtDate" sad ON sad."accountId" = a."id"
      LEFT JOIN "snapshotBeforeFrom" sbf ON sbf."accountId" = a."id"
      LEFT JOIN "journalLine" jl ON jl."accountId" = a."id"
        AND jl."companyId" = p_company_id
        -- delta only: rows can be skipped once they're inside the oldest snapshot needed
        AND ... -- see note below
      LEFT JOIN "journal" j ON j."id" = jl."journalId"
      WHERE a."companyGroupId" = p_company_group_id AND a."isGroup" = false AND a."active" = true
      GROUP BY a."id", ls."endingBalance", ls."endingBalanceDate",
               sad."endingBalance", sad."endingBalanceDate",
               sbf."endingBalance", sbf."endingBalanceDate"
    )
```

Implementation notes the executor must respect:

- **Scope guard**: apply the snapshot path only when `p_company_id IS NOT NULL`. When it's NULL (group-wide, and in `accountTreeBalances` used by the chart of accounts), keep the Phase-2 full-scan body — snapshots are per company. All the hot statement paths (`getFinancialStatementBalances`, `getConsolidatedBalances`, `trialBalance`) pass a company id. Easiest structure: `IF p_company_id IS NULL THEN RETURN QUERY <phase-2 body>; ELSE RETURN QUERY <snapshot body>; END IF;`
- **The join pruning is the whole point**: the `journalLine` join must be restricted so Postgres only reads lines after the oldest snapshot date used by that query, i.e. `j."postingDate" > LEAST(ls/sad/sbf dates)` — in practice, since journalLine has no postingDate, express it via the join to `journal` using the `journal_companyId_postingDate_idx` from Phase 1: pre-filter journals in a CTE (`SELECT id FROM journal WHERE companyId = p_company_id AND postingDate > <min snapshot date> AND status <> 'Draft'`) and join lines through it. If every account's needed snapshot exists, the min snapshot date is the last closed period boundary — the delta is one open period's lines. Verify with `EXPLAIN ANALYZE` that the plan reads the journal date index, not all of `journalLine`.
- **Fallback**: an account with no snapshot rows (new company, never closed a period) gets `endingBalanceDate NULL` and the CASE degrades to the full scan — current behavior, no regression.
- Consider denormalizing `postingDate`/`status` onto `journalLine` ONLY if the journal-id-list join proves awkward in EXPLAIN — it was rejected in the audit as unnecessary; re-justify before doing it.

### Task A4 — Verification

On a seeded DB with history (or a restored backup):

```sql
-- 1. Close a period, snapshot, then compare snapshot+delta vs brute force:
SELECT * FROM "accountTreeBalancesByCompany"('<group>', '<company>', '<from>', '<to>')
EXCEPT
SELECT * FROM <phase-2 full-scan variant with same args>;
-- expected: 0 rows, both directions (run EXCEPT both ways)

-- 2. EXPLAIN ANALYZE the new function's query at a date after the last closed period:
-- expected: journalLine rows read ≈ open-period line count, not total line count.

-- 3. Reopen (if supported) → snapshots for ≥ that period deleted → results still match brute force.
```

Plus `pnpm run generate:types` after migrations, `pnpm exec turbo run typecheck --filter=./apps/erp`, and existing accounting tests.

---

## Workstream B — Inventory: watermarked snapshot for on-hand

### Design

`itemLedger.entryNumber` is a global monotonic SERIAL, so any row not in a materialized snapshot has `entryNumber` greater than the snapshot's per-group max. That makes `matview + delta WHERE entryNumber > watermark` **exact** for immutable rows.

The wrinkle: itemLedger rows are *not* all immutable — `sync_item_ledger_on_tracked_entity_status_change_trigger` (migration `20260420112047`) rewrites `trackedEntityStatus` on existing rows when a tracked entity's status flips, and the status-aware sums (`quantityOnHand` excludes `Rejected`, `quantityOnHold`, `quantityRejected`) depend on it. Snapshotting those rows would serve up-to-30-minute-stale status math, which is not acceptable for on-hand (it could hide a rejection from an issue/pick decision).

So split by mutability:

- **Untracked rows (`trackedEntityId IS NULL`) are append-only and immutable** → snapshot them in the matview with a watermark; live reads add only the delta.
- **Tracked rows (`trackedEntityId IS NOT NULL`) are mutable** → always computed live. They're already the smaller, better-indexed subset (partial `itemLedger_trackedEntityId_idx`, plus the Phase-1 composite indexes), and tracked-entity quantities are inherently bounded by physical serial/batch counts.

### Task B1 — Redefine the matview with scope + watermark

New migration. Current definition: `20260420112047_inventory-quantity-status-aware.sql:359-385`; pg_cron job `refresh-item-stock-quantities` (every 30 min, CONCURRENTLY) stays as is.

```sql
DROP MATERIALIZED VIEW IF EXISTS "itemStockQuantities";
CREATE MATERIALIZED VIEW "itemStockQuantities" AS
SELECT
  "itemId",
  "companyId",
  COALESCE("locationId", '') AS "locationId",
  SUM("quantity") AS "quantityOnHand",          -- untracked rows have no status; plain sum
  MAX("entryNumber") AS "maxEntryNumber",
  -- usage snapshots (informational; see note)
  SUM(CASE WHEN "entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
            AND "createdAt" >= CURRENT_DATE - INTERVAL '30 days' THEN -"quantity" ELSE 0 END) AS "consumed30",
  SUM(CASE WHEN "entryType" IN ('Negative Adjmt.', 'Sale', 'Consumption', 'Assembly Consumption')
            AND "createdAt" >= CURRENT_DATE - INTERVAL '90 days' THEN -"quantity" ELSE 0 END) AS "consumed90"
FROM "itemLedger"
WHERE "trackedEntityId" IS NULL
GROUP BY "itemId", "companyId", COALESCE("locationId", '');
-- recreate the UNIQUE index (needed for REFRESH CONCURRENTLY) + companyId index
```

Check for other consumers of the matview's current columns before changing its shape (as of the audit it was refreshed by cron but not read by the hot RPCs — grep first).

### Task B2 — Snapshot + delta in `get_inventory_quantities`

Fork the latest definition (`20260713231142_inventory-quantities-item-filter.sql` after Phase 2). Replace the `item_ledgers` CTE's on-hand terms with:

```
quantityOnHand  = COALESCE(matview.quantityOnHand, 0)                        -- untracked snapshot
                + SUM(untracked delta rows: trackedEntityId IS NULL
                      AND entryNumber > COALESCE(matview.maxEntryNumber, 0))
                + SUM(tracked rows live, status != 'Rejected')               -- always live
quantityOnHold  = SUM(tracked rows live, status = 'On Hold')                 -- unchanged, tracked-only
quantityRejected= SUM(tracked rows live, status = 'Rejected')                -- unchanged, tracked-only
```

The tracked-rows scan and the untracked delta both filter `companyId + locationId (+ itemId)` — served by the Phase-1 `itemLedger_companyId_locationId_itemId_idx` / `itemLedger_itemId_locationId_idx` indexes; the tracked subset additionally benefits from being small. `usageLast30Days/90Days`: take `consumed30/90` from the matview + the same terms over delta + tracked rows. These are informational metrics; the snapshot's window edge is up to 30 minutes stale (rows aging out of the 30/90-day window between refreshes are still counted) — acceptable, document it in the function header comment.

Apply the same pattern to `get_inventory_value_by_location` (`20260325031223`) and — only if EXPLAIN shows it matters — `get_job_quantity_on_hand`. Do NOT change the `issue`/`storage-units` per-item SUMs in the edge functions: after Phase 1 they're index-only scans and they need exact per-storage-unit math; revisit only with production EXPLAIN evidence.

### Task B3 — Verification

```sql
-- 1. Equivalence, before and after a fresh posting (i.e. with a non-empty delta):
SELECT * FROM get_inventory_quantities('<company>', '<location>')
EXCEPT SELECT * FROM <old definition run side-by-side>;  -- 0 rows, both directions
-- 2. Flip a tracked entity to Rejected → quantityOnHand reflects it IMMEDIATELY (no refresh).
-- 3. EXPLAIN ANALYZE: untracked scan reads only rows above the watermark.
-- 4. REFRESH MATERIALIZED VIEW CONCURRENTLY "itemStockQuantities" still works (unique index present).
```

Browser check per house rule: item detail page and Inventory quantities table show identical numbers before/after, including immediately after posting a receipt (delta path) and after a matview refresh.

---

## Sequencing

1. A1 + A2 land with the period-close feature itself (snapshot written at close).
2. A3 read path next — it's a pure optimization; ship after A4's equivalence proof.
3. B1/B2 are independent of A entirely and can land in a separate PR.
4. Update `.ai/rules/accounting-sync-handlers.md` / `modules/accounting/AGENTS.md` / `inventory-system.md` for the new table, function behavior, and matview shape (keep-sources-in-sync rule).

## Non-goals (carried from the audit)

No partitioning, no trigger-maintained rollups on the insert path (the dropped `itemInventory` cache is the cautionary precedent), no `postingDate` denormalization onto `journalLine` unless A3's EXPLAIN forces the question, no CQRS.
