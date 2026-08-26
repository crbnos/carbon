# Plan — Intercompany Elimination Engine (structured capture)

> Spec: `.ai/specs/2026-08-17-intercompany-elimination-engine.md`
> Branch: `fix-elimination-journal-sequence`
> Approach: capture role-tagged elimination lines at posting time; rewrite the
> elimination RPC to read them; keep the balance elimination; retire the heuristic
> revenue/COGS/unrealized-profit reconstruction. **No backfill.**

## Grounding (current code — verified)

- **IC transaction rows** are created only by `post-sales-invoice` (seller) and
  `post-purchase-invoice` (buyer), each in the same Kysely transaction as its
  journal lines, with `documentType='Invoice'`, `documentId`=invoiceId,
  `sourceJournalLineId`=the IC **control** line (receivable/payable), `status='Unmatched'`.
  `matchIntercompanyTransactions` pairs seller↔buyer by `LEAST/GREATEST(company)` + amount.
  So **each trade has two IC-txn rows**; a matched pair spans both.
- `post-shipment` posts SO-based seller COGS (one `costOfGoodsSoldAccount` expense
  leg + one inventory-relief asset leg via `calculateCOGS`; **no** absorption/variance
  legs) and creates **no** IC txn.
- `post-receipt` posts the buyer capitalization debit (`resolveInventoryAccount` →
  Finished Goods / Raw Materials, or `workInProgressAccount`/`indirectCostAccount`,
  or `fixedAssetClass.assetAccountId` for FA lines) and creates **no** IC txn.
- Newest `generateEliminationEntries`:
  `20260817150538_intercompany-revenue-cogs-from-shipment.sql`. Newest
  `matchIntercompanyTransactions`: `20260816154722`. `findLowestCommonParent`:
  original `20260403120000` (unchanged). `eliminationKind` enum + `journal.eliminationKind`:
  `20260817122328`.
- Service: `accounting.ee.service.ts` — `createIntercompanyTransaction` (:4573),
  `runIntercompanyMatching` (:4653), `generateEliminations` (:4662),
  `getIntercompanyTransactions` (:4550). Routes: `x+/accounting+/intercompany*.tsx`
  (`eliminate.tsx` uses `bypassRls:true` service role).
- In each edge fn, after the `journalLine … .returning(["id"])` insert,
  `journalLineResults[i].id` is 1:1 index-aligned with `journalLineInserts[i]`
  (which holds `accountId`, `amount`, `quantity`); `itemId` is in the parallel
  `journalLineDimensionsMeta[i]`. This is the FK handle for capture rows (same
  index-alignment pattern the existing `journalLineDimension` insert uses).

## Capture data model

`intercompanyEliminationLine` (child of `intercompanyTransaction`):

| col | type | notes |
|---|---|---|
| `id` | TEXT `id('icel')` | |
| `companyId` | TEXT NOT NULL | the company that POSTED the line (seller or buyer) |
| `intercompanyTransactionId` | TEXT NOT NULL | FK → `intercompanyTransaction("id")` (single-col PK) ON DELETE CASCADE |
| `role` | `intercompanyEliminationRole` | `Control` / `Revenue` / `COGS` / `Capitalization` |
| `journalLineId` | TEXT NOT NULL | the actual posted line (FK → `journalLine("id")`) |
| `accountId` | TEXT NOT NULL | captured for fast elimination reads |
| `amount` | NUMERIC NOT NULL | posted natural-balance-signed amount |
| `itemId` | TEXT | COGS / Capitalization rows |
| `quantity` | NUMERIC | Capitalization (for on-hand realization) |
| audit | | `createdBy/At`, `updatedBy/At` (per conventions) |

Composite PK `("id","companyId")`, `companyId` FK → `company` CASCADE, indexes on
`companyId`, `intercompanyTransactionId`, `createdBy`. Four RLS policies
(`accounting_*`). Enum via `CREATE TYPE`.

## Phases

### Phases 1+2 — DONE, consolidated into ONE existing migration (no new files)
The branch's elimination SQL is unmerged and the DB is reset for retests, so
(per Brad) edit in place — do **not** stack a new migration. The whole engine now
lives in **`20260817122328_intercompany-revenue-cogs-elimination.sql`**: the
`eliminationKind` enum + `journal.eliminationKind` column + `intercompanyTransaction.amount`
widen (kept) **plus** the new `intercompanyEliminationRole` enum, the
`intercompanyEliminationLine` table (+RLS/indexes), and the capture-driven
`generateEliminationEntries` (+`p_regenerate`). `20260817150538_...from-shipment.sql`
(the heuristic v2) is **deleted**; no separate capture-table migration.
`accounting.models.ts` gains `intercompanyEliminationRoles`.

The RPC keeps the permission check, pair loop
(`LEAST/GREATEST`), LCA→elimination-entity resolution, and period get-or-create
**verbatim** (they're sound). Replace the two elimination bodies:

- **IC Balance journal** — reverse every `role='Control'` capture line across both
  IC txns of the pair (`-amount`, same account). Replaces the `controlLines` CTE.
  Fail loudly if zero Control lines (same guard intent as today).
- **IC Revenue journal** — per pair (one journal):
  - Reverse every `role='Revenue'` and `role='COGS'` capture line (`-amount`, same account).
  - `M = Σ|Revenue| − Σ|COGS|` (margin).
  - For each `role='Capitalization'` buyer line: credit **its** `accountId` by
    `M_share × onHandFraction`. `onHandFraction` = `LEAST(onhand, quantity)/quantity`
    from the buyer's `itemLedger` sum for `itemId`; `itemId IS NULL` (FA) → fraction 1.
    Split `M` across capitalization lines proportional to their `amount` when several.
  - Skip the writedown (keep balance + P&L) when no Capitalization line resolves; never guess.
- Set `eliminationKind` on each journal; retire the pair's IC txns to `Eliminated`.
- **`p_regenerate BOOLEAN DEFAULT false`**: when true, first post reversing journals
  for every existing `eliminationKind IS NOT NULL` journal on the group's
  elimination entities and flip those IC txns `Eliminated → Matched` (immutability:
  reverse, never delete), then run the normal pass. Satisfies re-runnability without
  touching the common path.

Retire the account-class sweeps and the invoice→SO→shipment traversal from the RPC
(they move to capture). No fallback to the old logic (OQ-5).

### Phase 3 — Capture at posting (two invoice edge functions)
**`post-sales-invoice`** — inside the existing transaction, after
`journalLineResults` and the `intercompanyTransaction` insert, when
`isIntercompany && icJournalLineId` (capture the just-created seller txn id — insert
it with `.returning(["id"])`):
- `Control`: the receivable line (`icReceivableIdx` → `journalLineResults`).
- `Revenue`: each line pushed as revenue (`accountId === salesAccount`).
- `COGS` (direct sale): the `costOfGoodsSoldAccount` line (+ itemId/qty from meta).
- `COGS` (SO-based): one deterministic query — shipments where
  `sourceDocument='Sales Order' AND sourceDocumentId IN (this invoice's line salesOrderIds)
  AND companyId=seller`, then their `journalLine`s on `costOfGoodsSoldAccount`
  (already posted at shipment); capture those `journalLineId`s (+ itemId/qty).

**`post-purchase-invoice`** — inside the transaction, after `journalLineResults` and
the `intercompanyTransaction` insert, when `isIntercompany && icJournalLineId`:
- `Control`: the payable line (`icPayableIdx` → `journalLineResults`).
- `Capitalization` (not-yet-received / FA-at-invoice): the inventory/WIP/asset debit
  pushed inline (account + itemId/assetId + qty).
- `Capitalization` (already-received): the receipt's capitalization `journalLine`
  (the DR line whose account ≠ `goodsReceivedNotInvoicedAccount`), found from the
  receipt records the GR/IR-reversal path already resolves in scope.

Track roles via a small parallel `captureMeta` array pushed alongside
`journalLineInserts` (index-aligned), so capture reads `journalLineResults[i].id`
without re-deriving by class — the edge fn *knows* each line's role.

`post-shipment` / `post-receipt`: **no change** (invoices look their lines up).

### Phase 4 — Service + UI
- `accounting.ee.service.ts`: `getIntercompanyEliminationLines(client, companyGroupId, txnIds?)`
  read helper (join to show roles/amounts). Extend `generateEliminations` to pass
  `p_regenerate` (add an optional arg + a "Regenerate" action variant on the route).
- Workbench: extend `getIntercompanyTransactions` row / add a getter surfacing
  `eliminationKind` + the pair's captured lines by role, and render them (a
  per-pair expando or a detail column in `IntercompanyTransactionTable`), so a
  reviewer can trace a consolidated 0 to the operating lines. Surface `eliminationKind`
  in the consolidated `AccountLedgerLine`/drawer (add the column to `getAccountLedger`
  select + `AccountLedgerDrawer`).

### Phase 5 — Types + verify
`pnpm run generate:types` → scoped typechecks (`@carbon/database`, `@carbon/erp`
via turbo filter) → `pnpm --filter @carbon/erp test -- --testPathPattern=accounting`.
Fix hits. Edge-function runtime + browser verification and DB apply wait on the user
(can't rebuild DB or boot the stack here). Note in the PR what's proven vs pending.

### Phase 6 — Consolidate specs + plans
Per the user's instruction: merge this branch's specs into **one** spec and its
plans into **one** plan, dropping stale/superseded content, so the branch carries a
single coherent spec + plan. (`2026-07-04-intercompany-maturity.md` is prior art for
a different, unshipped feature — keep it separate unless it's this branch's work; it
is not. Fold together only the elimination-scope lineage that belongs to this branch.)

## Risks / watch-items
- **Big edge functions.** Capture blocks are additive and gated on `isIntercompany`;
  never alter existing GL postings. Add after the IC-txn insert.
- **Already-received buyer capitalization lookup.** Use the receipt data already in
  scope in the GR/IR-reversal path; if it can't be resolved, skip capitalization
  capture (balance + P&L still eliminate) and let the RPC skip the writedown.
- **`intercompanyTransaction` single-col PK** — capture FK is single-column
  (`intercompanyTransactionId` → `intercompanyTransaction("id")`), not composite.
- **Regenerate double-post** — reverse existing eliminations before regenerating;
  reversing entries (not deletes) respect immutability.
- Two committed migrations (`122328`, `150538`) still reference the deleted scope
  spec in comments; they're on `main`/pushed — leave them (fix-forward rule); the
  new spec supersedes.
```

## Progress
- [x] Phases 1+2 — capture table + capture-driven RPC, consolidated into `20260817122328` (150538 deleted)
- [x] Phase 3 — edge-function capture (`post-sales-invoice`, `post-purchase-invoice`)
- [x] Phase 4 — service (`generateEliminations(regenerate)`, `getIntercompanyEliminationLines`, manual-path Control capture) + workbench "Regenerate" button
- [x] Phase 5 — verify: erp typecheck **0 errors**, **123 accounting tests pass** (3 pre-existing period-close mock failures, unrelated). ⏳ DB apply + `generate:types` + edge-function runtime + browser retest wait on Brad (no DB rebuild / Docker here).
- [x] Phase 6 — this branch carries a single spec + single plan (scope spec deleted; maturity spec is separate/on-main)

## Applied + verified on the live dev DB (this session)
- **Overload bug caught on the reset and fixed in the migration.** Adding the
  `p_regenerate DEFAULT` param makes `CREATE OR REPLACE` build a SIBLING of the
  2-arg `generateEliminationEntries` from the earlier (on-`main`) `20260817012947`,
  so even a fresh reset left TWO overloads and a 2-arg call was ambiguous.
  `20260817122328` now `DROP FUNCTION IF EXISTS "generateEliminationEntries"(TEXT, TEXT)`
  before the `CREATE OR REPLACE`, so exactly one function survives a fresh reset.
- After the reset: `pnpm db:migrate` (schema up to date), applied the DROP to the
  live DB, regenerated types. Exactly one 3-arg function remains.
- `erp` typecheck **0 errors** against the regenerated types; RPC smoke-tested via
  psql: 2-arg call (default) → `0`, `p_regenerate=true` → `0`, non-employee → refused
  — all resolving unambiguously to the single 3-arg function.

## Deterministic proof without manual data entry
- `packages/database/supabase/tests/intercompany-elimination.test.sql` seeds trades
  at the journal+capture level, runs the RPC, and asserts the consolidated result
  in a rolled-back transaction. Run:
  `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/intercompany-elimination.test.sql`
- 6 scenarios PASS: fixed-asset buyer, inventory fully held, partial realization,
  transaction-dated posting, regenerate idempotency, multi-trade-per-pair.
- It caught a real bug — **pair-level margin aggregation mis-allocated the writedown**
  across capitalization accounts. Fixed to **per-trade** allocation (link seller↔buyer
  via `targetJournalLineId` from matching). Net income was always right; per-account
  asset allocation now is too.

## Outcome / hand-off
- **Data-driven retest (Brad):** with a two-company intercompany scenario, post the
  seller invoice + buyer receipt/invoice (edge functions now write capture), Run
  Matching, Generate Eliminations, and check the consolidated scenario (Machinery &
  Equipment = group cost, Finished Goods = 0, Sales/COGS = 0, IC Receivable/Payable = 0).
- **After a correction:** use **Regenerate** (reverses existing eliminations via reversing entries, re-derives from current capture + on-hand).
- **Deferred nicety:** per-pair captured-line detail in the workbench UI (`getIntercompanyEliminationLines` is wired for it); needs browser verification.
