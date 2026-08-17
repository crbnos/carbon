# Intercompany Elimination Scope — Revenue↔COGS + Unrealized Profit in Inventory

> Status: in-progress
> Author: Claude (with Brad)
> Date: 2026-08-17
> Research: `.ai/research/intercompany-eliminations.md`
> Sibling spec (matching/difference/netting/NCI-deferral): `.ai/specs/2026-07-04-intercompany-maturity.md`

## TLDR

Carbon's `generateEliminationEntries` today reverses **only** the intercompany
Receivable/Payable control accounts. That clears the balance sheet but leaves
**intercompany profit in the consolidated income statement** — a company that
"sells" to its sibling shows phantom group revenue and net income (the reported
$100-income bug). This spec extends the elimination engine along the industry
auto/manual gradient with two new elimination **kinds**:

1. **IC revenue ↔ COGS (automatic)** — on a matched intragroup sale, reverse the
   seller's intercompany Revenue and its matching COGS so consolidated revenue
   reflects only third-party sales. Lines are identified by sweeping the
   transaction's `documentId` on the seller's journal (no posting-path change).
2. **Unrealized profit in inventory (guided)** — defer the intragroup margin still
   embedded in the buyer's on-hand IC-sourced inventory (SAP IPI model:
   period-recompute on current on-hand; margin from the seller's `costLedger`;
   item-level IC-sourced-on-hand approximation for v1). Shipped as a
   **reviewable** entry the user confirms, not silent automation.

Every elimination journal gains an `eliminationKind` classifier (SAP posting-level
pattern) so reports and re-runs can target a layer, and elimination becomes a
**period-close checklist task** that reverse-and-regenerates per period.
**Fixed-asset-transfer gain** and **investment/equity + NCI** are explicitly OUT
(manual journal / N/A) — manual everywhere in the market, and NCI is already
deferred by the maturity spec (100%-summation). No `intercompanyTransaction`
schema churn beyond a nullable link; no operating-company GL is ever touched.

## Problem Statement

Concretely, today (`20260817012947_intercompany-elimination-service-role.sql`):

1. **`generateEliminationEntries` eliminates only IC Receivables/Payables.** It
   sweeps journal lines matching the `intercompanyTransaction.sourceJournalLineId`
   control account (`accountId` + `documentId`) and reverses them onto the LCA
   elimination entity. Revenue, COGS, inventory, and assets are never touched.
2. **Consolidated income statement shows intragroup profit.** In the verified
   scenario (Carbon Manufacturing → Carbon Service, $100), consolidated Revenue =
   100 and Net Income = 100 survive after eliminations — profit the group
   "earned" selling to itself. Correct consolidated impact of an at-cost internal
   transfer is $0; of a marked-up transfer, only the externally-realized margin.
3. **No unrealized-profit deferral.** When one company sells inventory to a
   sibling at a markup and the sibling still holds it, the embedded margin
   overstates both consolidated inventory (carried at transfer price) and
   consolidated income. Carbon has no mechanism to defer it.
4. **Elimination journals are unclassified.** Every elimination is
   `sourceType: 'Manual'`, description `IC Elimination: A ↔ B`. There is no way to
   distinguish a balance elimination from a P&L elimination in reports, or to
   re-run one kind without the others.
5. **No period-close integration.** Elimination is a manual route action, not a
   period-close task; re-running appends rather than reverse-and-regenerates.

Grounding (from `.ai/research/intercompany-eliminations.md` §Carbon and the code):
`intercompanyPartnerId` is stamped **only on the receivable/payable control
line**, not on revenue/COGS (`post-sales-invoice/index.ts:456,557,656,831` all
guard `accountId === receivablesAccountId`). Carbon's `costLedger` is per-company
with zero cross-company linkage; an intragroup sale does not move cost between
companies (the buyer re-receives at transfer price). `account` is group-scoped
(`companyGroupId`); `journalLine.amount` is **natural-balance signed**
(`packages/utils/src/accounting.ts` — asset/expense debit = +, liability/equity/
revenue credit = +), so `-amount` correctly reverses any posting.

## Proposed Solution

Extend `generateEliminationEntries` (and its wrapper `generateEliminations`) from a
single balance-wash into a **multi-kind elimination engine**, and add a small
`unrealizedProfitElimination` guided sub-ledger for inventory. Nothing posts to
operating companies; all entries land on the LCA elimination entity, exactly as
today.

### 1. Elimination kind classifier (foundation)

Add `eliminationKind` (enum) to the `journal` rows produced by elimination and to
`intercompanyTransaction` so a transaction's elimination can be traced and re-run
per kind:

- `journal.eliminationKind`: `'IC Balance' | 'IC Revenue' | 'IC Unrealized Profit'`
  (nullable; NULL for all non-elimination journals). This is Carbon's
  posting-level/document-type analog (SAP), and lets the consolidated reports
  and the intercompany workbench show which layer produced an entry.
- The existing AR/AP wash becomes `eliminationKind = 'IC Balance'`.

### 2. IC Revenue ↔ COGS elimination (automatic)

When `generateEliminationEntries` processes a matched pair, in addition to the
existing balance wash it emits a **revenue elimination journal**
(`eliminationKind = 'IC Revenue'`) on the elimination entity:

- **Line identification (infer from document, Q2).** For the seller side
  (`sourceCompanyId`, `documentId` from the `intercompanyTransaction`), sweep the
  seller's `journalLine`s for that `documentId` and select:
  - **Revenue lines** — `account.class = 'Revenue'` (the seller's Sales line(s)).
  - **COGS line** — the line posted to the seller's `accountDefault.cogsAccount`
    (the `costLedger`-driven "Direct Cost" line), resolved **by id** per the
    control-account-by-id lesson.
- **Entry.** Reverse both with `-amount` onto the elimination entity, so consolidated
  revenue and COGS both drop by the intragroup gross-up (Entry I, research Case 2):
  - `Dr IC Revenue` (reverse the seller's `Cr Revenue`)
  - `Cr COGS` (reverse the seller's `Dr COGS`)
  The **net income effect of this journal = the seller's gross profit** (revenue −
  COGS), which is exactly the intragroup profit removed from consolidated income
  when the goods have been realized externally. The residual unrealized portion
  (goods still on hand at the buyer) is deferred by §3, so the two together never
  double-count.
- **One-sided (research §5).** Only the seller's lines are reversed — the buyer's
  COGS/inventory is not IC-tagged and is handled via §3. This matches SAP's
  one-sided revenue elimination.
- **Scope guard.** Only fires when the seller's document actually posted a
  Revenue line (skips pure balance transfers / the fixed-asset degenerate case,
  which stays a balance-only elimination).

### 3. Unrealized profit in inventory (guided)

A new `unrealizedProfitElimination` record per (company group, item, period) that
defers the intragroup margin embedded in the **buyer's on-hand IC-sourced
inventory**, recomputed each period (SAP IPI, Q3):

- **Margin (Q3a — seller `costLedger`).** For an IC-sold item, group cost = the
  seller's `costLedger` cost for the units sold; margin rate = (transfer price −
  group cost) ÷ transfer price. Read-time; no new persistent cost structure.
- **IC-sourced on-hand (Q3b — item-level approximation).** The buyer's remaining
  on-hand quantity of items purchased from the IC supplier (the sibling company's
  IC supplier record), from the buyer's `itemLedger`/on-hand. v1 approximates at
  item level (buyer on-hand of IC-supplier items), not lot-level FIFO tracing.
- **Deferred amount** = margin rate × (buyer IC-sourced on-hand qty × transfer
  unit price). Recomputed each period on current on-hand; as inventory sells
  externally, on-hand drops and the deferral shrinks (auto-realization).
- **Entry (guided).** On the elimination entity, `eliminationKind =
  'IC Unrealized Profit'`:
  - `Dr COGS` (raise consolidated COGS → remove the profit)
  - `Cr Inventory` (write the buyer's inventory down to group cost)
  Prior-period deferral is carried and the delta posted (research Case 3 Entry
  G/\*G). Because it is **guided**, the workbench surfaces the computed margin +
  on-hand and the user confirms before the journal posts.
- **Realization** is implicit in the period-recompute: no explicit trigger table;
  when the buyer's IC-sourced on-hand reaches zero, the deferral is zero and the
  prior deferral has fully realized into income.

### 4. Period-close integration + re-run semantics

- Register a `periodCloseTaskDefinition` "Generate intercompany eliminations"
  (Auto where possible, else Manual gate), tied to the elimination entity's
  `accountingPeriod`, mirroring the maturity spec's close integration and
  NetSuite/SAP.
- **Reverse-and-regenerate on re-run.** Re-running elimination for a period first
  reverses the prior elimination journals for that period+kind (or deletes the
  not-yet-consumed draft), then regenerates — so re-matching after a correction is
  safe and idempotent (NetSuite semantics). Balance and revenue eliminations are
  period-scoped and regenerable; the unrealized-profit deferral carries its prior
  balance and posts the delta.

### 5. Out of scope (explicit, not silently ignored)

- **Fixed-asset transfer gain + depreciation catch-up** — manual journal only.
  Documented as a future phase; no edge-function interception, no deferred-gain
  sub-ledger. (Manual in NetSuite/D365; multi-year carryforward.)
- **Investment-in-subsidiary / equity elimination + NCI** — N/A. Carbon companies
  form a `parentCompanyId` tree with no investment-in-subsidiary accounts, and NCI
  is already deferred by the maturity spec (100%-summation). No `ownershipPercent`,
  no NCI equity accounts, no goodwill.
- **Multi-currency CTA-E plug** — reserve the concept; no-op for single-currency
  groups (Carbon's common case). The maturity spec owns FX-difference plugging via
  `intercompanyDifferenceAccount`; this spec composes with it when present but does
  not require it.
- **Upstream/downstream NCI split** — moot while ownership is 100%. A `direction`
  is derivable from the pair (seller vs buyer) if NCI is ever built; not stored now.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | v1 scope | Revenue↔COGS (auto) + unrealized inventory (guided); FA + investment/NCI out | Q1; fixes the real correctness bug + the manufacturing differentiator; FA/NCI manual everywhere |
| 2 | Identify revenue/COGS lines | Infer from `intercompanyTransaction.documentId` sweep at elimination time | Q2; reuses the proven control-line document-sweep; no posting-path change; works on already-posted invoices |
| 3 | Revenue elimination sidedness | One-sided (seller's Revenue + COGS only) | Research §5 (SAP); buyer COGS/inventory not IC-tagged, handled by unrealized-profit layer |
| 4 | Unrealized-profit cost basis | Seller `costLedger` at elimination time | Q3a; no new cost infrastructure; SAP IPI "actual group cost" |
| 5 | Unrealized-profit realization | Period-recompute on current IC-sourced on-hand | Q3b; SAP IPI; auto-realizes as inventory sells; no trigger table |
| 6 | IC-sourced on-hand precision | Item-level approximation (buyer on-hand of IC-supplier items) for v1 | Q3b; lot-level FIFO tracing deferred; adequate for SMB manufacturing |
| 7 | Unrealized-profit automation level | Guided/reviewable (user confirms) | Highest review risk elimination; every platform treats it as top-side; matches SAP/NetSuite posture |
| 8 | Elimination classifier | `journal.eliminationKind` enum (nullable) | SAP posting-level/document-type pattern; enables per-kind reports + re-run |
| 9 | Re-run semantics | Reverse-and-regenerate per period+kind | NetSuite; idempotent re-match after corrections |
| 10 | Close integration | `periodCloseTaskDefinition` per elimination-entity period | Maturity spec + NetSuite/SAP period-close task |
| 11 | Where entries post | LCA elimination entity only, never operating GL | Carbon precedent; single-economic-entity; audit trail |
| 12 | Control-account resolution | By id (`accountDefault.*Account`), never number/name | `.ai/lessons.md` — number/name are user-editable |
| 13 | Fixed-asset / investment / NCI | Out (manual / N/A) | Q1 + maturity spec SD-5.5; manual in NetSuite/D365 |
| 14 | Multi-tenancy (new table) | `unrealizedProfitElimination`: `id('upe')` + `companyId` (elim entity) + composite PK | conventions-database.md |
| 15 | Service shape | New fns take `client` first, return `{data,error}` | conventions-services.md |

## Data Model Changes

### 1. `eliminationKind` enum + `journal.eliminationKind`

```sql
CREATE TYPE "eliminationKind" AS ENUM (
  'IC Balance', 'IC Revenue', 'IC Unrealized Profit'
);

ALTER TABLE "journal"
  ADD COLUMN "eliminationKind" "eliminationKind";  -- NULL for non-elimination journals

COMMENT ON COLUMN "journal"."eliminationKind" IS
  'Classifies an elimination journal by the intercompany layer it removes (SAP posting-level analog); NULL for ordinary journals';
```

`intercompanyTransaction` gains a nullable link to the unrealized-profit record
(the balance/revenue eliminations already set `eliminationJournalId`):

```sql
-- amount is currently NUMERIC(19,4) — widen to bare NUMERIC per the numeric-precision
-- convention while touching this table (grounded gap from research).
ALTER TABLE "intercompanyTransaction" ALTER COLUMN "amount" TYPE NUMERIC;
```

### 2. `unrealizedProfitElimination` (new table)

Per (elimination entity, company group, item, period) deferred-profit record. It
is company-scoped to the **elimination entity** (where the journal posts), with
the group and item as business columns.

```sql
CREATE TABLE "unrealizedProfitElimination" (
    "id" TEXT NOT NULL DEFAULT id('upe'),
    "companyId" TEXT NOT NULL,                    -- the elimination entity
    "companyGroupId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sellerCompanyId" TEXT NOT NULL,              -- who booked the intragroup margin
    "buyerCompanyId" TEXT NOT NULL,               -- who still holds the inventory
    "accountingPeriodId" TEXT NOT NULL,

    "onHandQuantity" NUMERIC NOT NULL,            -- buyer IC-sourced on-hand (item-level approx)
    "transferUnitPrice" NUMERIC NOT NULL,
    "groupUnitCost" NUMERIC NOT NULL,             -- from seller costLedger
    "marginRate" NUMERIC NOT NULL,                -- (transfer - cost) / transfer
    "deferredAmount" NUMERIC NOT NULL,            -- margin still embedded in on-hand
    "priorDeferredAmount" NUMERIC NOT NULL DEFAULT 0,
    "journalId" TEXT,                             -- the posted guided elimination journal
    "status" TEXT NOT NULL DEFAULT 'Draft',       -- Draft -> Posted (guided confirm)

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,

    CONSTRAINT "unrealizedProfitElimination_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "unrealizedProfitElimination_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "unrealizedProfitElimination_status_check"
      CHECK ("status" IN ('Draft','Posted'))
);

CREATE INDEX "unrealizedProfitElimination_companyId_idx" ON "unrealizedProfitElimination" ("companyId");
CREATE INDEX "unrealizedProfitElimination_companyGroupId_idx" ON "unrealizedProfitElimination" ("companyGroupId");
CREATE INDEX "unrealizedProfitElimination_createdBy_idx" ON "unrealizedProfitElimination" ("createdBy");
CREATE INDEX "unrealizedProfitElimination_accountingPeriodId_idx" ON "unrealizedProfitElimination" ("accountingPeriodId");

ALTER TABLE "public"."unrealizedProfitElimination" ENABLE ROW LEVEL SECURITY;
-- SELECT: any employee of the group (elimination entities are read via the
-- consolidation service-role path in reports; direct reads gated on accounting_view).
CREATE POLICY "SELECT" ON "public"."unrealizedProfitElimination"
FOR SELECT USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));
CREATE POLICY "INSERT" ON "public"."unrealizedProfitElimination"
FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[]));
CREATE POLICY "UPDATE" ON "public"."unrealizedProfitElimination"
FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[]));
CREATE POLICY "DELETE" ON "public"."unrealizedProfitElimination"
FOR DELETE USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[]));
```

> Note: because no user is a member of the synthetic elimination entity, direct
> RLS reads of this table (and the elimination journals) return nothing for the
> operating user — the consolidation reports read it via the service-role
> elimination path (the pattern introduced in the consolidated-reporting fixes:
> `getConsolidatedPeriodSeries(..., eliminationClient)`). The workbench UI loader
> uses the same privileged read for the elimination entity.

### 3. `accountDefault.intercompanyRevenueAccount` / `intercompanyCogsAccount`?

**Not added** (Decision 2 = infer from document). The revenue and COGS lines
reversed are the seller's actual posted accounts (`account.class = 'Revenue'` and
`accountDefault.cogsAccount`), so no new control accounts are needed. This keeps
the seller's standalone P&L clean and avoids a posting-path change.

## API / Service Changes

### RPC (migration)

- **`generateEliminationEntries(p_company_group_id, p_user_id)`** — extend
  (`CREATE OR REPLACE`, fork from `20260817012947`, DROP-safe): after the existing
  `'IC Balance'` wash, for each matched pair whose seller document posted a Revenue
  line, emit a second journal `eliminationKind = 'IC Revenue'` reversing the
  seller's Revenue + COGS lines (swept by `documentId`). Stamp `eliminationKind`
  on all elimination journals. Add reverse-and-regenerate: before generating,
  reverse/delete this period's prior elimination journals of the kinds being
  regenerated for the pair.
- **`computeUnrealizedProfitEliminations(p_company_group_id, p_period_id)`** —
  new: for each item sold intragroup and still on-hand at a buyer, compute margin
  (seller `costLedger`) × IC-sourced on-hand (buyer `itemLedger`) and upsert
  `unrealizedProfitElimination` Draft rows for the elimination entity + period.
- **`postUnrealizedProfitElimination(p_id, p_user_id)`** — new: post the guided
  `'IC Unrealized Profit'` journal (Dr COGS / Cr Inventory for the period delta),
  set the row `Posted`, link `journalId`.

### Service (`accounting.ee.service.ts`)

- Extend `generateEliminations` wrapper (unchanged signature).
- Add `getUnrealizedProfitEliminations(client, companyGroupId, periodId)`,
  `computeUnrealizedProfitEliminations(...)`, `postUnrealizedProfitElimination(...)`
  — all `client`-first, `{data,error}`, service-role for the elimination-entity
  reads/writes (route authorizes `create/update: accounting`, `bypassRls`).

## UI Changes

- **Intercompany workbench** (`/x/accounting/intercompany`) gains an **Unrealized
  Profit** tab: the computed `unrealizedProfitElimination` rows for the current
  period (item, seller→buyer, on-hand, margin, deferred amount), each with a
  **Post** action (guided confirm). A **Recompute** button runs
  `computeUnrealizedProfitEliminations`.
- Elimination journals in the account ledger / consolidated reports show their
  `eliminationKind` (a small badge), so a reviewer can see which layer produced an
  entry.
- No operating-company UI changes.

## Acceptance Criteria

- [ ] After matching + generating eliminations for the verified scenario
  (Manufacturing → Service $100 with a Revenue line), the **consolidated income
  statement** (`companies=all`) shows the intragroup Revenue and Net Income
  **eliminated** (0 for a fully-unsold/at-transfer case; only externally-realized
  margin remains) — not the phantom $100.
- [ ] The consolidated **balance sheet** still balances (root = 0) after the new
  revenue elimination (Net Income equity line reflects the eliminated profit).
- [ ] Every elimination journal carries a non-null `eliminationKind`; the balance
  wash is `'IC Balance'`, the P&L reversal is `'IC Revenue'`.
- [ ] An intragroup **inventory** sale where the buyer still holds all units
  produces a Draft `unrealizedProfitElimination` with `deferredAmount = margin`;
  posting it books `Dr COGS / Cr Inventory` on the elimination entity and the
  consolidated inventory drops to group cost.
- [ ] Selling that inventory externally next period and recomputing reduces
  `deferredAmount` proportionally (realization), and the delta posts.
- [ ] Re-running `generateEliminations` for a period is idempotent (reverse-and-
  regenerate; no duplicate journals).
- [ ] The period-close checklist shows a "Generate intercompany eliminations"
  task for a group with matched IC transactions.
- [ ] No journal posts to an operating company; `NUMERIC(19,4)` on
  `intercompanyTransaction.amount` is widened to bare `NUMERIC`.
- [ ] Types regenerated; scoped `erp` typecheck passes; accounting tests green
  (no new failures vs the pre-existing period-close mock gaps).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| COGS line mis-identified on the seller document | Med | Resolve by `accountDefault.cogsAccount` id + `costLedger` linkage; skip (balance-only) when absent; guided review for the inventory layer |
| IC-sourced on-hand approximation over/understates deferral | Med | Item-level approximation documented; guided confirm; lot-level tracing is a named future phase |
| Reverse-and-regenerate deletes a consumed journal | Med | Only reverse this-period, not-yet-locked elimination journals; refuse if the elimination period is Locked/Closed (existing guard) |
| Elimination entity invisible to RLS breaks the new reads | Low | Reuse the service-role elimination read path already added to consolidation |
| Double-counting revenue elimination vs unrealized-profit deferral | Med | Revenue elim removes the gross-up at transfer price; deferral removes only unsold margin; acceptance test asserts consolidated income ties |

## Open Questions

> Audit trail of the pre-writing interview (all resolved before this spec was written).

- [x] **v1 scope boundary** — **Answer:** Revenue↔COGS (auto) + unrealized inventory (guided) in scope; fixed-asset gain + investment/NCI out (manual/N/A). (Brad, recommendation accepted.)
- [x] **How revenue/COGS lines are identified** — **Answer:** (a) infer from the `intercompanyTransaction.documentId` document sweep at elimination time; no posting-path change. (Brad.)
- [x] **Unrealized-profit cost basis** — **Answer:** compute margin from the seller's `costLedger` at elimination time; no group cost layer. (Brad.)
- [x] **Unrealized-profit realization granularity** — **Answer:** period-recompute on current IC-sourced on-hand (SAP IPI); item-level approximation of IC-sourced on-hand for v1 (no lot-level FIFO tracing). (Brad.)
- [x] **Period-close integration + classifier** — **Answer (autonomous, codebase precedent + research):** register a `periodCloseTaskDefinition`; reverse-and-regenerate on re-run; add `journal.eliminationKind` classifier. Confirmed in scope by the acceptance of the phased design.
- [x] **Fixed-asset / investment / NCI** — **Answer:** out of scope (manual journal / N/A); NCI already deferred by `2026-07-04-intercompany-maturity.md` SD-5.5 (100%-summation).

## Changelog

- 2026-08-17: Created — resolutions from the pre-writing interview baked in
  (scope = revenue↔COGS auto + unrealized inventory guided; infer lines from
  document; seller-costLedger margin; period-recompute item-level on-hand;
  eliminationKind classifier; close-task + reverse-and-regenerate). Grounded in
  `.ai/research/intercompany-eliminations.md`, `20260817012947_intercompany-
  elimination-service-role.sql`, `2026-07-04-intercompany-maturity.md` (matching/
  difference/netting/NCI-deferral sibling), and the consolidated-reporting fixes
  (service-role elimination read path).
