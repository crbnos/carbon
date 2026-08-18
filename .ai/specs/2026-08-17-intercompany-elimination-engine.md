# Intercompany Elimination Engine — Structured Capture (not GL reconstruction)

> Status: implemented — applied to the live dev DB, RPC verified to run; pending a
> data-driven edge-function/browser retest with a real intercompany scenario
> Author: Claude (with Brad)
> Date: 2026-08-17
> Research: `.ai/research/intercompany-eliminations.md`
> Plan: `.ai/plans/2026-08-17-intercompany-elimination-engine.md`
> Supersedes: `2026-08-17-intercompany-elimination-scope.md` (deleted — described the
> heuristic reconstruction approach this replaces)
> Sibling (matching maturity / tolerance / FX / netting / NCI-deferral):
> `2026-07-04-intercompany-maturity.md` (separate, unshipped; owns matching brittleness)

> **This is the single, canonical spec for this branch's intercompany elimination
> work.** The branch's earlier commits (consolidated-reporting fixes, elimination-
> entity sequence seeding, intercompany-partner repair, the consolidated account
> drill-down) are the supporting fixes that made this engine observable and
> postable; they are retained as sound and summarised in the changelog.

## As-built (delta from the proposal above)

- **One migration, edited in place — no new migrations.** The whole engine (the
  `eliminationKind` enum + `journal.eliminationKind` column + `intercompanyTransaction.amount`
  widen, the `intercompanyEliminationRole` enum, the `intercompanyEliminationLine`
  table + RLS, and the capture-driven `generateEliminationEntries`) lives in
  `20260817122328_intercompany-revenue-cogs-elimination.sql`. The heuristic v2
  `20260817150538_...from-shipment.sql` is deleted. (Branch SQL is unmerged and the
  DB is reset for retests, so editing in place is correct — not fix-forward.)
- **Balanced partial realization.** Revenue and COGS reversal are scaled by the
  same buyer-on-hand weighted fraction as the writedown, so the IC Revenue journal
  balances at any realization level. Fixed-asset buyers and fully-held inventory
  give fraction 1 → exact full elimination (the retest case). Partially-resold
  inventory is the item-level approximation the spec already scopes.
- **Manual path captures too.** `createIntercompanyTransaction` writes a `Control`
  capture line so a matched manual pair eliminates like an invoice-posted one.
- **Regenerate is a button.** `generateEliminationEntries` takes `p_regenerate`;
  the workbench exposes "Regenerate" alongside "Generate Eliminations".
- **Verification:** erp typecheck 0 errors; 123 accounting unit tests pass (3
  pre-existing period-close mock failures are unrelated). DB apply, types regen,
  edge-function runtime, and the browser retest wait on Brad (no DB rebuild here).

## TLDR

`generateEliminationEntries` today reverse-engineers each intragroup trade from the
GL at consolidation time — it sweeps journal lines by **account class** and walks
the **document graph** (invoice → sales order → shipment) to guess what was
revenue, what was COGS, and which account holds the unrealized margin. That
reconstruction is fragile by construction: every new transaction shape breaks a
heuristic (COGS at shipment, COGS split across absorption/variance accounts,
**buyer capitalizing a fixed asset instead of inventory** → the margin written
down against the wrong account → negative Finished Goods). This spec replaces the
reconstruction with **structured capture**: when each side of an intercompany
trade posts — where the edge function *knows exactly* what every line is — it
records role-classified references to the actual journal lines plus the traded
item, quantity, and the account the buyer capitalized to. The elimination then
reverses precisely those captured lines and writes down precisely the account the
buyer holds, with no account-class guessing and no document-graph walking. The
**balance elimination** (IC Receivable/Payable) is already data-driven and is
kept. This is the "transaction-time intercompany capture" the research names as
the enterprise systems' core advantage over the QuickBooks/Xero tier.

## Problem Statement

`generateEliminationEntries` (`20260817122328`, `20260817150538`) does three things
per matched company pair:

1. **Balance elimination** — reverse the reciprocal IC Receivable/Payable control
   lines. This is **sound**: it references the matched pair's actual
   `sourceJournalLineId` and reverses the real posted amounts. **Keep it.**
2. **Revenue/COGS elimination** — reverse the intragroup sale's P&L. Currently:
   find Revenue-class lines on the invoice document, Expense-class lines on the
   invoice *and* the shipment(s) linked via the sales order, sum them, reverse.
3. **Unrealized-profit writedown** — write the buyer's inventory down to group
   cost. Currently: pick the **seller's** inventory-relief line (`class='Asset'`,
   `amount<0`) and credit it by the margin.

Parts 2 and 3 are **GL reconstruction**, and it fails predictably:

- **SO-based sales** post COGS at *shipment*, not the invoice → needed a
  document-graph patch (`20260817150538`).
- **COGS splits** across `Cost of Goods Sold – Direct` + `Labor & Machine
  Absorption` variance → needed "sum all Expense-class lines" patch.
- **Buyer capitalizes a fixed asset** (verified in the retest: seller sold
  manufactured inventory for 100 at group cost 30.28; buyer posted `Dr Machinery
  & Equipment 100`). The writedown credited the **seller's Finished Goods** (which
  the seller's own postings net to zero) → consolidated **Finished Goods = −69.72
  (negative)**, and the buyer's Machinery stayed overstated at 100 instead of
  30.28.

Each fix is a heuristic on the previous heuristic. Because the elimination
reconstructs the trade from its GL *output*, it cannot be made robust — the space
of transaction shapes is open-ended (direct vs SO, inventory vs fixed-asset buyer,
multi-line, multi-account, partial invoicing, drop-ship, services). The research
(`.ai/research/intercompany-eliminations.md` §3, §5) is explicit: enterprise
systems **capture intercompany economics when the transaction posts** (trading
partner + role-classified accounts), and reconstructing at close is exactly what
QuickBooks/Xero-tier tools do and pay add-ons to fix.

## Proposed Solution

Capture the trade's economics as **structured, role-classified data** at posting
time, and make elimination a pure read over those records.

### 1. Capture table — `intercompanyEliminationLine`

A child of `intercompanyTransaction` recording, per side of the trade, the
role-classified journal lines the elimination will act on. Written by the posting
edge functions (which know each line's role exactly), never inferred later.

```sql
CREATE TYPE "intercompanyEliminationRole" AS ENUM (
  'Control',        -- IC Receivable / IC Payable (the balance elimination)
  'Revenue',        -- seller intragroup revenue
  'COGS',           -- seller cost of the goods (Direct + absorption/variance)
  'Capitalization'  -- buyer's asset the profit is embedded in (inventory OR fixed asset)
);

CREATE TABLE "intercompanyEliminationLine" (
  "id" TEXT NOT NULL DEFAULT id('icel'),
  "companyId" TEXT NOT NULL,                       -- the company that posted the line
  "intercompanyTransactionId" TEXT NOT NULL,
  "role" "intercompanyEliminationRole" NOT NULL,
  "journalLineId" TEXT NOT NULL,                   -- the ACTUAL posted line (source of truth)
  "accountId" TEXT NOT NULL,                       -- captured for fast elimination reads
  "amount" NUMERIC NOT NULL,                       -- the posted (natural-balance-signed) amount
  "itemId" TEXT,                                   -- Capitalization/COGS rows: the traded item
  "quantity" NUMERIC,                              -- traded quantity (for on-hand realization)

  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "intercompanyEliminationLine_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "intercompanyEliminationLine_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "intercompanyEliminationLine_ictId_fkey"
    FOREIGN KEY ("intercompanyTransactionId") REFERENCES "intercompanyTransaction"("id") ON DELETE CASCADE
);

CREATE INDEX "intercompanyEliminationLine_companyId_idx" ON "intercompanyEliminationLine"("companyId");
CREATE INDEX "intercompanyEliminationLine_ictId_idx" ON "intercompanyEliminationLine"("intercompanyTransactionId");
CREATE INDEX "intercompanyEliminationLine_createdBy_idx" ON "intercompanyEliminationLine"("createdBy");
-- RLS: gated read for group employees; writes by accounting_create/update/delete
-- (standard four policies; SELECT via get_companies_with_employee_role()).
```

Why line-level (not columns/arrays on `intercompanyTransaction`): a document can
trade several items, the buyer can capitalize different items to different
accounts (inventory vs fixed asset), and on-hand realization is **per item**.
Roles + a real `journalLineId` per row make the elimination exact and auditable —
each elimination line traces to the operating line it reverses.

### 2. Capture points (posting edge functions)

`intercompanyTransaction` rows already exist; the edge functions additionally
write `intercompanyEliminationLine` rows when `isIntercompany`:

- **`post-sales-invoice`** (seller): one `Control` row (the IC Receivable line —
  already the `sourceJournalLineId`) + one `Revenue` row per revenue line. For the
  seller's **COGS**, capture from the linked shipment(s): if COGS posted on the
  invoice (direct sale) capture those lines; otherwise resolve the shipment(s) via
  `salesInvoiceLine.salesOrderId → shipment.sourceDocumentId` and capture their
  COGS/absorption lines as `COGS` rows. This is the *same* lookup the current RPC
  does — but performed **once, at posting**, and stored, instead of on every
  elimination run.
- **`post-shipment`** (seller, SO-based): when it posts COGS for an intercompany
  sales order, it may capture the `COGS` rows directly (the IC transaction is
  created later at invoice; the invoice-time capture links them). Design decision
  below (OQ-2) picks invoice-time lookup vs shipment-time write.
- **`post-purchase-invoice`** / **`post-receipt`** (buyer): one `Control` row (IC
  Payable) + one `Capitalization` row per received item, capturing the account the
  buyer **actually debited** (inventory, WIP, or a **fixed-asset** account) with
  `itemId` + `quantity`. The capitalization is on the receipt (`Dr inventory/asset`);
  resolve it via `purchaseInvoiceLine → PO → receipt` (mirror of the seller lookup).

Role classification is exact here because the edge function is the code that
*chose* each account.

### 3. Elimination = pure read over captured lines

`generateEliminationEntries` reads `intercompanyEliminationLine` for the matched
pair and posts, on the LCA elimination entity:

- **`IC Balance`** journal — reverse every `Control` line (`-amount`, same
  account). *(Unchanged behavior; already sound.)*
- **`IC Revenue`** journal — reverse every `Revenue` and `COGS` line (`-amount`,
  same account). Margin `M = Σ Revenue − Σ COGS` (in absolute terms).
- **Unrealized-profit writedown** (same `IC Revenue` journal) — for each buyer
  `Capitalization` row, credit **that row's account** (inventory OR fixed asset)
  by `M_item × onHandFraction(itemId, buyerCompany)`. Writing down the *buyer's
  captured account* is what fixes the negative-Finished-Goods bug: the profit is
  removed from wherever the buyer actually holds it.

`onHandFraction` = `LEAST(buyer on-hand of item, traded quantity) / traded
quantity` from the buyer's `itemLedger` (item-level approximation, per the prior
resolution). For a fixed-asset capitalization there is no `itemLedger` on-hand;
the asset is "held" until disposed, so fraction = 1 until the fixed asset leaves
the group (realization via depreciation is a later phase — see Non-Goals).

No account-class guessing, no document-graph walking at elimination time.

### 4. Reverse-and-regenerate (re-runnability)

Because the balance and revenue eliminations are period-scoped and the capture
lines are the source of truth, re-running elimination must be idempotent:
**reverse the prior period's elimination journals (post reversing entries, per the
immutability rule — never delete posted lines) and regenerate** from the current
capture + on-hand. Resets an `Eliminated` pair to re-eliminable. This is what lets
a correction (or a fixed heuristic) re-flow without manual DB surgery — the gap the
retest hit.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Architecture | Structured capture at posting time; elimination is a pure read | Reconstruction from GL output is open-endedly fragile (retest bugs); research §3/§5 consensus |
| 2 | Keep balance elimination | Yes, unchanged | Already reverses actual control lines via matched pair; sound |
| 3 | Capture grain | Line-level child table `intercompanyEliminationLine` (role-tagged) | Multi-item, per-item on-hand, buyer accounts differ; arrays on the txn can't express it |
| 4 | Role classification | At posting time (the edge function that chose the account) | Exact, not inferred; kills account-class heuristics |
| 5 | Writedown target | The **buyer's** `Capitalization` account (whatever it is) | Fixes negative Finished Goods; correct economically (asset at group cost) |
| 6 | Fixed-asset **buyer** | In scope — write down the fixed-asset account like any capitalization | Falls out of the capture model; the retest case; economically correct |
| 7 | Fixed-asset **seller disposal** (gain + depreciation catch-up) | Still deferred (manual) | Multi-year deferred-gain sub-ledger; unchanged from prior scope |
| 8 | On-hand realization | Item-level fraction from buyer `itemLedger`; fixed assets fraction = 1 until disposed | Prior resolution; SAP IPI style; lot-level FIFO deferred |
| 9 | Re-runnability | Reverse-and-regenerate (reversing journals, not deletes) | Immutability rule; lets corrections re-flow; the retest gap |
| 10 | Matching brittleness (shipping/FX/rounding) | **Out of scope here** — owned by `2026-07-04-intercompany-maturity.md` (tolerance + document-currency matching) | Separable concern; this spec assumes a matched pair exists |
| 11 | Multi-tenancy | `intercompanyEliminationLine` = `id('icel')` + `companyId` + composite PK + four RLS policies | conventions-database.md |
| 12 | Control-account resolution | By id / captured `journalLineId` — never account number/name | `.ai/lessons.md` |

## Data Model Changes

- New enum `intercompanyEliminationRole` and table `intercompanyEliminationLine`
  (above).
- No change to `intercompanyTransaction` structure beyond the child FK; `amount`
  stays the match key (owned by the maturity spec).
- `journal.eliminationKind` (`20260817122328`) is kept as the classifier
  (`'IC Balance' | 'IC Revenue'`).

## API / Service Changes

- **Edge functions** (`post-sales-invoice`, `post-shipment`,
  `post-purchase-invoice`, `post-receipt`): on the intercompany path, insert
  `intercompanyEliminationLine` rows for the roles each posts. These already
  compute the accounts/amounts (revenue, COGS, inventory, IC control) — the change
  is persisting the role-tagged line refs, not new arithmetic.
- **`generateEliminationEntries`** (migration, `CREATE OR REPLACE`): rewritten to
  read `intercompanyEliminationLine` and post the reversals + writedown; add
  reverse-and-regenerate. Drops the account-class sweeps and the invoice→SO→shipment
  traversal from the elimination path.
- **`accounting.ee.service.ts`**: read helpers for the capture lines (for the
  workbench / audit), plus the reverse-and-regenerate wrapper.

## UI Changes

- The intercompany workbench shows, per matched pair, the captured elimination
  lines by role (Control / Revenue / COGS / Capitalization) and the resulting
  elimination journal(s) — so a reviewer can trace a consolidated 0 to the exact
  operating lines that produced it. Complements the consolidated account
  drill-down (already shows elimination entries via the service-role read).
- No operating-company UI change.

## Acceptance Criteria

- [ ] The retest scenario (seller manufactures inventory, sells for 100 at group
  cost 30.28; **buyer capitalizes `Machinery & Equipment` 100**) after Match +
  Generate Eliminations: consolidated **Machinery & Equipment = 30.28** (group
  cost), **Finished Goods = 0** (no negative), **Sales/COGS = 0**, IC
  Receivable/Payable = 0, and consolidated net income excludes the intragroup
  profit (only real production variances remain).
- [ ] An inventory-to-inventory intragroup sale (buyer holds it as inventory) nets
  to 0 across every consolidated account.
- [ ] Selling the buyer's on-hand externally next period and re-running reduces the
  deferred writedown proportionally (realization).
- [ ] SO-based, direct-invoice, and multi-account-COGS sales all eliminate
  correctly **without** any account-class sweep or document-graph walk in the
  elimination RPC (the capture carries it).
- [ ] Re-running `generateEliminations` after a correction reverses the prior
  elimination journals (via reversing entries) and regenerates — idempotent, no
  posted-line deletes, no manual DB surgery.
- [ ] Every elimination journal line traces to a captured `intercompanyEliminationLine`
  (auditable), and each carries a non-null `eliminationKind`.
- [ ] Scoped `erp` typecheck + accounting tests green; edge-function change verified
  by an intercompany posting exercising each capture path.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Edge-function change to production posting paths | High | Capture is additive (insert rows), never alters the existing GL postings; behind `isIntercompany`; per-function verified |
| No backfill: pairs posted before capture existed have no lines | Low (accepted) | **Decided: no backfill** — the engine is capture-only from day one. Trades posted before this ship don't gain new-engine eliminations; already-generated heuristic journals stay as posted history. Acceptable because the retest group is reset before verification, so all its trades post through the capture path |
| Buyer capitalization not resolvable (drop-ship, service, no receipt) | Med | Capture what exists; if no `Capitalization` row, skip the writedown (balance + P&L still eliminate); log the gap, don't guess |
| Fixed-asset writedown vs the deferred seller-disposal case | Low | Buyer-capitalizes is a *purchase* capitalization (in scope); seller *disposing* a fixed asset stays deferred — distinct paths |
| Reverse-and-regenerate double-posting | Med | Reversing journals keyed to the prior elimination journal id; regenerate only after reversal committed; period lock respected |

## Resolved Decisions (was Open Questions)

Resolved with Brad 2026-08-17.

- [x] **OQ-1 — Capture grain.** ✅ **Line-level child table
  `intercompanyEliminationLine`** (Decision 3) — only it expresses per-item buyer
  accounts + on-hand. The whole engine reads from this shape.
- [x] **OQ-2 — COGS capture point for SO-based sales.** ✅ **Invoice-time lookup** —
  the IC transaction is created at the invoice, so capture is single-sited and
  there's no "orphan shipment rows" lifecycle.
- [x] **OQ-3 — Fixed-asset *buyer* capitalization in scope?** ✅ **Yes**
  (Decisions 5/6) — the retest bug; write the buyer's asset to group cost. The
  still-deferred case is the *seller* disposing a fixed asset (gain + multi-year
  depreciation catch-up).
- [x] **OQ-4 — Backfill existing eliminated pairs.** ❌ **No backfill** — the engine
  is capture-only from day one. Trades posted before this ships don't gain
  new-engine eliminations; already-generated heuristic journals stay as posted
  history. The retest group is reset before verification, so its trades all post
  through the capture path.
- [x] **OQ-5 — Retire the heuristic RPC or keep as fallback?** ✅ **Retire it** — a
  guessing fallback is the thing we're removing; if capture is missing for a pair,
  skip that layer explicitly and surface it, don't silently reconstruct. No two
  code paths that can disagree.

## Changelog

- 2026-08-17: Created. Replaces the heuristic reconstruction approach
  (`2026-08-17-intercompany-elimination-scope.md`, deleted) after the retest
  exposed its open-ended fragility (buyer-capitalizes-fixed-asset → negative
  Finished Goods). Design: structured role-tagged capture at posting time
  (`intercompanyEliminationLine`), elimination as a pure read, reverse-and-
  regenerate. Balance elimination + `eliminationKind` + the reporting/RLS/drill-down
  fixes are retained (sound). Matching brittleness stays with the maturity spec.
- 2026-08-17: Open questions resolved with Brad (OQ-1 child table, OQ-2 invoice-time
  capture, OQ-3 fixed-asset buyer in scope, OQ-4 **no backfill**, OQ-5 retire the
  heuristic RPC).
- 2026-08-17: Implemented. Consolidated the engine into a single edited-in-place
  migration (`20260817122328`; `20260817150538` deleted). Capture added to
  `post-sales-invoice` (Control/Revenue/direct-COGS + SO-based COGS via the
  shipment lookup), `post-purchase-invoice` (Control + Capitalization from inline
  asset debits and linked receipts), and `createIntercompanyTransaction` (Control).
  `generateEliminationEntries` rewritten capture-driven with a balanced weighted
  on-hand fraction and `p_regenerate`; service `generateEliminations(regenerate)`
  + read helper `getIntercompanyEliminationLines`; workbench "Regenerate" button.
  Verified: erp typecheck 0 errors, 123 accounting tests pass. Pending Brad: DB
  apply + types regen + edge-function/browser retest. Deferred nicety: per-pair
  captured-line detail in the workbench UI (read helper is in place for it).

- 2026-08-17: Audit fix — **elimination date window.** The consolidated balance
  sheet showed Inter-Company Payables/Receivables = 100 (un-eliminated) while the
  drill-down netted to 0. Cause: `generateEliminationEntries` dated the elimination
  journal with `company_today(elimination_entity)`, but the synthetic elimination
  entity has no location so `company_today` falls back to UTC and sat a day ahead
  (Aug 18) of the operating companies (Aug 17) at an evening-Pacific boundary — so
  the adjustment landed outside the balance sheet's "as of today" window. Fixed:
  date each elimination to the MAX posting date of the transactions it eliminates
  (and reversals to their original journal's date). Also caught + fixed the
  overload trap (added-`DEFAULT` sibling; `DROP FUNCTION IF EXISTS ...(TEXT,TEXT)`).

- 2026-08-17: **Deterministic test harness** added at
  `packages/database/supabase/tests/intercompany-elimination.test.sql` — seeds
  intercompany trades at the journal+capture level, runs `generateEliminationEntries`,
  and ASSERTS the consolidated result in a rolled-back transaction (no UI data entry).
  Run: `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f packages/database/supabase/tests/intercompany-elimination.test.sql`.
  It found — and now guards — a real bug: the elimination aggregated margin at the
  **company-pair** level and split the writedown proportionally by capitalized
  value, mis-allocating across capitalization accounts when a pair had multiple
  trades with different margins (net income stayed correct; per-account asset
  allocation drifted). Fixed by allocating **per trade** — each seller transaction
  is linked to its matched buyer transaction via `targetJournalLineId` (set by
  matching), so each buyer capitalization is written down by ITS OWN trade's margin.
  Covered scenarios: fixed-asset buyer, inventory fully held, partial realization,
  transaction-dated posting, regenerate idempotency, and multi-trade-per-pair.

## This branch's supporting fixes (retained, not superseded)

These shipped earlier on the branch and remain correct; they are the substrate the
engine posts onto and is observed through:

- **Consolidated reporting** — `translatedNetChange` / Net Income injection so the
  consolidated income statement and balance sheet tie out across companies.
- **Elimination-entity sequences** — `seed-company` + a backfill so the synthetic
  elimination entities have `journalEntry` sequences (the original "Sequence not
  found" failure).
- **Intercompany-partner repair** — sibling companies resolve each other as
  supplier/customer for matching.
- **Consolidated account drill-down** — `getConsolidatedAccountLedger` reads the
  elimination entities via service role (scoped to the group) so elimination
  journal lines appear when drilling `?companies=all`.
