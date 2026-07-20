# Inventory Valuation Completeness — Standard Costing, Revaluation, LCNRV, Adjustment GL, Overhead Absorption, Landed Cost

> Status: in-progress
> Author: Claude (with Brad Barbin)
> Date: 2026-07-04
> Tracking issue: [crbnos/carbon#1040](https://github.com/crbnos/carbon/issues/1040)
> Parent: `.ai/specs/2026-07-03-public-company-readiness.md` (finding **GAP-3** — the manufacturing credibility core) · meta spec [#1060](https://github.com/crbnos/carbon/issues/1060)
> Research: `.ai/research/public-company-compliance.md` (§5 — ASC 330 absorption costing + LCNRV; IAS 2 reversal is book-dependent)
> Companions: `.ai/specs/2026-07-02-period-closing.md` (close-checklist registration surface) · `.ai/specs/2026-07-04-multi-book.md` (IAS 2 reversal consumer, parallel workstream #1052)

## TLDR

Carbon's costing engine has the skeleton of a real manufacturing valuation system — cost layers with `remainingQuantity` (`20260504000000_cost-layers.sql`), a `costLedgerType` enum that has carried `'Revaluation'` since 2023, and a chart reset (`20260315000000`) that seeded six variance accounts — but most of it is dead schema. This spec activates it in six build steps: (1) **standard costing wired end-to-end** (`standardCost` input path + actual-vs-standard variance posting at receipt and production + BOM roll-up), (2) an **inventory revaluation document** that writes cost layers up/down and posts `Revaluation` cost-ledger rows + GL, (3) an **LCNRV write-down run** with NRV auto-proposed from recent selling prices, posting through the revaluation machinery (US GAAP no-reversal in PRIMARY; IAS 2 reversal ships later as a multi-book adjustment generator), (4) **GL posting for manual quantity adjustments** (today itemLedger-only — inventory silently diverges from the GL), (5) **overhead absorption to GL** at `workCenter.overheadRate` with period variance to `overheadVarianceAccount`, and (6) a **landed cost document** allocating freight/duty/brokerage/insurance onto received layers with a GR/IR-style clearing account. Periodic pieces (LCNRV run, overhead variance) register as close-checklist tasks per the period-closing spec. Together these close GAP-3: every inventory balance-sheet movement gets a subledger row and a journal, which is the difference between "has inventory" and "passes an inventory audit".

## Problem Statement

Verified current state (all paths absolute from repo root):

1. **Standard costing is enum-only.** `itemCost.standardCost` exists (`NUMERIC(15,5) DEFAULT 0`, `20230330024716_parts.sql:352`) and `calculate-cogs.ts:38-45` costs Standard items at it — but the validator field is commented out (`apps/erp/app/modules/items/items.models.ts:512`), the UI has no input, and nothing else writes it. **Every Standard-method item ships and consumes at $0.**
2. **No variance posting except invoice-vs-receipt PPV.** `post-purchase-invoice/index.ts:972-1009` posts invoice-cost-minus-receipt-cost to `purchaseVarianceAccount` — the only live variance. `materialVarianceAccount` (5220), `laborAndMachineVarianceAccount` (5230), `overheadVarianceAccount` (5240), `lotSizeVarianceAccount` (5250), `subcontractingVarianceAccount` (5260) were all seeded NOT NULL by the chart reset and have **zero writers**.
3. **`'Revaluation'` costLedgerType is dead** (`20230705033432_ledgers.sql:159`) — no revaluation document, no way to change the carrying cost of on-hand inventory with a GL trail.
4. **No LCNRV.** ASC 330 requires lower-of-cost-or-NRV measurement; there is no write-down machinery, no NRV data path, no E&O rollforward for auditors.
5. **Quantity adjustments never touch the GL.** `insertManualInventoryAdjustment` (`apps/erp/app/modules/inventory/inventory.service.ts:1417`) writes `itemLedger` rows only — `inventoryAdjustmentVarianceAccount` (5310) has no writer, so every cycle count silently breaks the inventory-account-to-subledger tie.
6. **Overhead absorption stops at labor.** `post-production-event/index.ts:110-126` absorbs `durationHours × labor/machine rate` (Dr WIP / Cr `laborAbsorptionAccount` 5060); `workCenter.overheadRate` (GENERATED AS `quotingRate - laborRate`, `20240819115702:58`) is used for quoting only. Produced items exclude overhead — a direct ASC 330 absorption-costing violation.
7. **No landed cost.** Freight/duty/brokerage hit expense when the vendor bill posts; received layers carry PO price only, understating inventory and mistiming COGS.

## Resolved Questions (answered before writing, 2026-07-04)

- [x] **NRV source for the LCNRV run?** — *(Brad)* **Proposed automatically from recent selling prices less costs to complete/sell** — the run queries posted sales invoice prices per item over a configurable lookback (defined in §3 below), applies a costs-to-complete/sell deduction, and proposes a write-down per line; every line is **editable before posting**.
- [x] **LCNRV reversal?** — Write-downs post in-period; **US GAAP no-reversal in PRIMARY** (write-down establishes a new cost basis, layers physically written down). **IAS 2 reversal ships later** as an adjustment-book delta generator on top of the multi-book spec (#1052 / `.ai/specs/2026-07-04-multi-book.md`) — GL-only deltas in the IFRS book, PRIMARY layers untouched.
- [x] **PPV vs standard variance?** — Both live. Invoice-vs-receipt PPV (`post-purchase-invoice`) stays exactly as-is; the **receipt-time standard-vs-actual variance is its own journal line**, posted at receipt for Standard-method items.
- [x] **Close-checklist registration?** — LCNRV run and overhead-variance true-up register `periodCloseTaskDefinition` rows per the period-closing spec's registration rule (its 2026-07-04 changelog names later close tasks as registrants, not retrofitters).

## Proposed Solution

Build order matches dependency order: standard cost feeds revaluation math; revaluation machinery is reused by LCNRV; adjustment GL and overhead are independent posting extensions; landed cost is the largest new document and lands last.

### 1. Standard costing wired end-to-end

**Input path.** Uncomment and wire `standardCost` in `itemCostValidator` (`items.models.ts:512`); add the field to `ItemCostingForm.tsx` (shown only when `costingMethod = 'Standard'`); add a `standardCost` column to the item CSV importer mapping (per `.ai/rules/csv-import-system.md`). Changes are audit-logged via the existing `itemCost` audit coverage.

**Standard-change revaluation guard.** Saving a new `standardCost` for an item with on-hand quantity auto-generates a **Draft inventory revaluation document** (§2) revaluing on-hand layers from old to new standard — the user posts or discards it. This is the BC "revalue on standard change" behavior and prevents the classic drift where the GL carries old-standard inventory forever.

**Variance at receipt (purchase).** In `post-receipt`, when the item's `costingMethod = 'Standard'`: inventory debits at **standard**, GR/IR credits at **actual PO cost**, and the difference posts to `purchaseVarianceAccount` as a separate journal line labeled `Standard Cost Variance` (distinct `description` from the invoice-time `Purchase Price Variance` line, same account — see Design Decisions). The cost layer is written at standard (layers must carry the standard basis so consumption is variance-free).

**Variance at production (job close).** `close-job` computes, for Standard-method output: standard cost of quantity produced (from the item's rolled-up standard) vs actual WIP accumulated (material consumption + labor absorption + overhead absorption). The residual clears WIP and splits by cost element: material delta → `materialVarianceAccount` (5220), labor/machine delta → `laborAndMachineVarianceAccount` (5230), overhead delta → `overheadVarianceAccount` (5240). `lotSizeVarianceAccount`/`subcontractingVarianceAccount` stay dormant in v1 (decision below).

**Standard cost roll-up from BOM.** New `type: "standardCostRollup"` in the `recalculate` edge function + Inngest task (dispatch precedent: `packages/jobs/src/inngest/functions/tasks/recalculate.ts:17-52`), walking `get_method_tree` bottom-up: purchased leaves contribute `standardCost` (or `unitCost` for non-Standard components), operations contribute `laborRate`/`machineRate` × standard hours + `overheadRate` × standard hours. Writes a proposed standard per item; applying it goes through the input path above (and therefore the revaluation guard). Triggered on demand from the costing UI ("Roll up standard cost") — never automatic.

### 2. Inventory revaluation document

A first-class posted document (`inventoryRevaluation`, prefix `ivr`) that changes the unit cost of on-hand inventory:

- Lines select item + location (optionally a specific cost layer for FIFO/LIFO items); show current carrying unit cost and quantity; user enters `newUnitCost`.
- Posting, per line: writes `costLedger` rows with `costLedgerType = 'Revaluation'`, `adjustment = true`, `cost = (newUnitCost − currentUnitCost) × revaluedQuantity`, linked to the target layer via new column `appliesToCostLedgerId`; updates `itemCost.unitCost` for Average items; for Standard items only reachable via the standard-change guard (§1).
- Layer effective unit cost becomes `(layer.cost + Σ applied Revaluation rows) / layer.quantity`; `calculate-cogs.ts` FIFO/LIFO branch is taught to include applied rows (one extra query keyed by `appliesToCostLedgerId`). Only **remaining** quantity is revalued — consumed quantity's delta is out of scope for a plain revaluation (unlike landed cost, §6, where the consumed share hits COGS).
- GL: `Dr/Cr inventoryAccount` vs a **new dedicated `inventoryRevaluationAccount`** (seeded `5320 Inventory Revaluation & Write-Downs` under the `inventory-adjustments` group) — *not* `inventoryAdjustmentVarianceAccount`. Justification in Design Decisions: auditors and the E&O rollforward (§7) need price effects (revaluation, LCNRV) separable from quantity effects (cycle counts, 5310); commingling them makes the LCNRV disclosure unbuildable.
- Status Draft → Posted; posted docs immutable per the period-closing branch's immutability convention; posting respects period state (operational source).

### 3. LCNRV write-down run

A periodic run (close-checklist task, default cadence: every period, skippable-with-reason as a Warning except at fiscal-year-end where it is required) that generates a pre-populated revaluation document of `type = 'LCNRV'`:

**NRV proposal query** (per item with on-hand quantity):

1. `estimatedSellingPrice` = quantity-weighted average `unitPrice` of **posted sales invoice lines** for the item within the lookback window (`companySettings.nrvLookbackDays`, default **90**);
2. fallback: weighted average open **sales order line** price in the same window;
3. fallback: item list/unit sale price; if none exists the line is flagged `No NRV basis` and excluded unless manually priced.
4. `NRV = estimatedSellingPrice × (1 − costsToCompleteAndSellPct)` — run-level percentage input, default from `companySettings.nrvCostToSellPct` (default 0), **editable per line** along with the proposed NRV itself.

Query sketch (Kysely in `proposeLcnrvRun`; simplified SQL):

```sql
WITH recent_sales AS (
  SELECT sil."itemId",
         SUM(sil."quantity" * sil."unitPrice") / NULLIF(SUM(sil."quantity"), 0) AS "avgPrice"
  FROM "salesInvoiceLine" sil
  JOIN "salesInvoice" si ON si."id" = sil."invoiceId" AND si."companyId" = sil."companyId"
  WHERE si."status" NOT IN ('Draft', 'Voided')
    AND si."postingDate" >= CURRENT_DATE - (:lookbackDays || ' days')::interval
    AND sil."companyId" = :companyId
  GROUP BY sil."itemId"
),
carrying AS (
  SELECT cl."itemId", cl."id" AS "costLedgerId", cl."remainingQuantity",
         (cl."cost" + COALESCE(adj."applied", 0)) / NULLIF(cl."quantity", 0) AS "unitCost"
  FROM "costLedger" cl
  LEFT JOIN LATERAL (
    SELECT SUM("cost") AS "applied" FROM "costLedger" a
    WHERE a."appliesToCostLedgerId" = cl."id"
  ) adj ON TRUE
  WHERE cl."remainingQuantity" > 0 AND cl."companyId" = :companyId
)
SELECT c.*, rs."avgPrice" * (1 - :costToSellPct) AS "proposedNrv"
FROM carrying c
LEFT JOIN recent_sales rs ON rs."itemId" = c."itemId"
WHERE rs."avgPrice" * (1 - :costToSellPct) < c."unitCost";
-- Average-method items (no layers): compare itemCost.unitCost against proposedNrv instead.
```

Fallbacks 2–3 fill `avgPrice` when `recent_sales` has no row (open sales-order weighted average, then list price), recording which source won in `nrvSource`.

Lines are proposed only where `NRV < carrying unit cost` (item level — the ASC 330-permitted unit of account). Posting writes layers **down to NRV** through the §2 machinery (`Dr 5320 / Cr inventoryAccount`), establishing a new cost basis: subsequent COGS automatically reflects the written-down cost, and no-reversal falls out structurally — the PRIMARY book has nothing to reverse against. IAS 2 books later get reversal-up-to-original-cost as generated adjustment-book deltas (multi-book spec), reading the write-down history this run leaves behind.

### 4. Quantity-adjustment GL posting

> **Superseded/expanded 2026-07-14** by
> `.ai/specs/2026-07-14-inventory-adjustment-gl-posting.md`: posting is unified
> into a `post-inventory-adjustment` edge function (Kysely transaction) used by
> ERP + MES + `post-inventory-count` — not a service-level leg as sketched
> below. Accounts and valuation rules below still hold.

`insertManualInventoryAdjustment` gains a posting leg (service-level, so the MCP path is covered too, per the document-approvals spec's lesson that route-level gates are bypassable):

- **Negative adjustment**: consume layers via `calculateCOGS` → `Dr inventoryAdjustmentVarianceAccount (5310) / Cr inventoryAccount` at consumed-layer cost; costLedger rows decrement `remainingQuantity` as usual.
- **Positive adjustment**: create a layer at the item's current unit cost (standard for Standard items) → `Dr inventoryAccount / Cr 5310`.
- Journal `sourceType`/`documentType` reuse the existing `'Inventory Adjustment'`-family enums (add values only if missing); posting is skipped when `accountingEnabled = false`, matching every other poster.

### 5. Overhead absorption to GL

Extend `post-production-event`: alongside the existing labor line, compute `overheadCost = durationHours × workCenter.overheadRate` and post `Dr workInProgressAccount / Cr overheadAbsorptionAccount` (new accountDefault column, seeded `5070 Overhead Absorption` beside 5060). The event's `postedToGL` idempotency flag (`20260504000000:28`) and the existing reversal/repost logic cover the new line for free. Job receipt/close cost of output now includes absorbed overhead, so produced layers carry full absorption cost (ASC 330).

**Period variance true-up** (close-checklist task, Auto-computed + proposed JE): under/over-absorption = actual indirect spend in the overhead cost pool vs period credits to 5070; the proposed journal posts `Dr overheadVarianceAccount (5240) / Cr overheadAbsorptionAccount (5070)` (or reversed) to true absorption up to actual. v1 defines the pool as the accounts mapped to `indirectCostAccount` + maintenance; pool configuration UI is a fast-follow.

### 6. Landed cost

New document set: `landedCost` (header: supplier, currency, status, reference), `landedCostLine` (charge type: `Freight | Duty | Brokerage | Insurance | Other`, amount), `landedCostAllocation` (charge line → target receipt line/cost layer, allocated amount, basis snapshot). Allocation bases: **value** (default), **quantity**, **weight** (disabled when any target item lacks weight data). Targets are posted receipt lines (their layers found via `costLedger` document linkage).

Posting, per allocation:
- **Capitalized share** (layer remaining fraction): `costLedger` row `costLedgerType = 'Indirect Cost'`, `appliesToCostLedgerId = layer`, raising effective layer cost (§2 mechanics) → `Dr inventoryAccount`.
- **Consumed share** (already-shipped fraction): posts straight to `Dr costOfGoodsSoldAccount` — landed cost on sold units belongs in COGS now, not smeared over remaining units.
- Credit side: **new `landedCostClearingAccount`** (seeded `2126 Landed Cost Clearing`, sibling of GR/IR 2125). The freight vendor's purchase invoice adds a `Landed Cost` line type referencing the document and posts `Dr 2126 / Cr AP`, clearing GR/IR-style; the clearing account's open balance is reconcilable per document.
- For Standard-method items, the capitalized share posts to `purchaseVarianceAccount` instead of the layer (standard basis must not drift from actual charges — standard cost roll-up is where freight standards belong).

### 7. E&O reserve reporting hooks

`getInventoryWriteDownRollforward(client, companyId, fiscalYear)` in `inventory.service.ts` (surfaced under Accounting reports): per period — opening written-down carrying delta, + write-downs posted (LCNRV `Revaluation` rows), − relief through consumption (written-down layers consumed, from `appliesToCostLedgerId` joins), closing. This is the disclosure rollforward auditors request first; CSV export rides the standard table-export convention.

### 8. Close-checklist registration

Two `periodCloseTaskDefinition` registrations (per the period-closing spec's registration rule): **LCNRV run** (Manual + deep link to the run UI; Warning severity, Blocker on the last period of a fiscal year) and **Overhead variance true-up** (Auto check "5070 residual within tolerance" + Action link to the proposed JE). Registration happens in the same migration that creates each feature.

### Build order and PR slicing

| PR | Contents | Depends on |
|----|----------|------------|
| 1 | `appliesToCostLedgerId` + `calculate-cogs` applied-rows math (superset, behavior-neutral until a writer exists) + unit tests | — |
| 2 | Standard cost input path (validator, form, CSV) + receipt-time standard variance + BOM roll-up (`standardCostRollup` recalculate case) | period close #1031 landed (post-* surface) |
| 3 | Inventory revaluation document + `post-inventory-revaluation` + standard-change guard + new 5320 account/column | PR 1, 2 |
| 4 | Quantity-adjustment GL leg in `insertManualInventoryAdjustment` | PR 1 |
| 5 | Overhead absorption in `post-production-event` + 5070 account/column + job-close three-way variance split | PR 2 |
| 6 | LCNRV run (proposal query, wizard, posting via PR 3 machinery) + close-checklist registrations + rollforward report | PR 3, 5 |
| 7 | Landed cost documents + `post-landed-cost` + purchase-invoice `Landed Cost` line type + 2126 account/column | PR 1 |

Each PR is independently shippable and verification-gated (`.ai/skills/check-and-commit/SKILL.md`); posting-function changes ship as coordinated PRs per the FX-spec precedent.

## Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Multi-tenancy (heuristic 1) | All new tables (`inventoryRevaluation(Line)`, `landedCost(Line/Allocation)`): `companyId`, composite PK `("id","companyId")`, `id('prefix')`, audit columns, `customFields` | House convention (template + `packages/database/AGENTS.md`); `costLedger` keeps its legacy single-column `xid()` PK — extending it is additive columns only |
| 2 | Service shape (heuristic 2) | Revaluation/LCNRV services in `inventory.service.ts` + `inventory.models.ts`; landed cost in `purchasing`'s service (document is supplier-facing); posting logic in edge functions (`post-*` family) | One service/models file per module; posting stays in Deno functions with the shared `calculate-cogs`/`get-posting-group` helpers |
| 3 | RLS (heuristic 3) | Four named policies per new table; SELECT `get_companies_with_employee_role()`, writes `get_companies_with_employee_permission('inventory_*')` (revaluation/LCNRV) and `'purchasing_*'` (landed cost) | Exact package convention; costLedger stays accounting_view-read-only |
| 4 | Permissions (heuristic 4) | Posting a revaluation/LCNRV requires `inventory_update` **and** the poster runs under period-state checks; no new permission actions | Follows the branch precedent of reusing existing tiers (period-closing: reopen = `delete: accounting`) |
| 5 | Forms (heuristic 5) | `ValidatedForm` + zod validators (`inventoryRevaluationValidator`, `landedCostValidator`, run-parameter validator); standardCost joins `itemCostValidator` | Standard form system; the commented-out validator line is the activation point |
| 6 | Module layout (heuristic 6) | Revaluation UI under `modules/inventory/ui/Revaluations/`; landed cost under `modules/purchasing/ui/LandedCosts/`; rollforward report under accounting reports | Matches existing feature-folder layout |
| 7 | Backward compatibility (heuristic 7) | Everything additive: new enum values via `ADD VALUE IF NOT EXISTS`, new nullable-then-backfilled accountDefault columns, `appliesToCostLedgerId` nullable; `calculate-cogs` change is a superset (no applied rows ⇒ identical result); posting legs no-op when `accountingEnabled = false` | No frozen surface touched; Standard items that cost $0 today start costing at standard only once a standardCost is entered |
| 8 | Revaluation contra account | **Dedicated `inventoryRevaluationAccount` (5320)**, not `inventoryAdjustmentVarianceAccount` (5310) | 5310 measures *quantity* variances (cycle counts, §4); revaluation/LCNRV are *price* remeasurements. Separating them is what makes the E&O rollforward and the LCNRV disclosure derivable from the GL; the by-id accountDefault pattern (post-`20260315000000`) makes a new column cheap |
| 9 | LCNRV method: direct write-down, not reserve | Layers physically written to NRV via `Revaluation` rows; seeded `1240 Inventory Reserves` stays available for manual entries but automation never posts to it | ASC 330: write-down establishes a new cost basis — direct method makes no-reversal structural and makes later COGS self-correct; a reserve account would need contra-tracking on every consumption. IAS 2 reversals live in adjustment books (GL deltas), so PRIMARY layer integrity is never bent for IFRS |
| 10 | Receipt-time standard variance account | `purchaseVarianceAccount` (5210), separate journal line/description from invoice-time PPV | Same economic family (purchase price vs standard); line-level `description` + `documentType` keep the two analyzable separately without a seventh variance account; matches BC (one PPV account, two posting moments) |
| 11 | Layer adjustments via `appliesToCostLedgerId`, not in-place cost mutation | Posted `costLedger.cost` is never rewritten; adjustments are child rows; effective cost is computed | Auditability — mutating posted rows violates the branch's immutability direction; `remainingQuantity` remains the only mutable column (already the consumption precedent) |
| 12 | Lot-size + subcontracting variances dormant in v1 | 5250/5260 keep zero writers; job-close residual splits three ways (material/labor/overhead) | The three-way split covers the audit requirement (absorption completeness); finer splits need setup-time standards and subcontract-PO linkage that don't exist yet — deferring is scope discipline, not a gap |
| 13 | Landed cost on Standard items → PPV | Capitalized share posts to 5210 instead of the layer | Standard basis must stay the standard; charging actuals into a standard layer reintroduces the drift standard costing exists to eliminate |
| 14 | NRV proposal is data, not doctrine | Auto-proposal (sales-invoice lookback − cost-to-sell %) is a starting point; every line editable pre-posting; overrides audit-logged with the proposed-vs-posted delta retained on the line | Brad's resolution; auditors test management's NRV judgment — the system must show both the mechanical estimate and the human override |

## Data Model Changes

```sql
-- 1) costLedger: adjustment linkage (additive)
ALTER TABLE "costLedger"
  ADD COLUMN IF NOT EXISTS "appliesToCostLedgerId" TEXT REFERENCES "costLedger"("id");
CREATE INDEX "costLedger_appliesTo_idx" ON "costLedger" ("appliesToCostLedgerId")
  WHERE "appliesToCostLedgerId" IS NOT NULL;

-- 2) accountDefault: three new columns (by account id, post-20260315 pattern)
ALTER TABLE "accountDefault"
  ADD COLUMN "inventoryRevaluationAccount" TEXT REFERENCES "account"("id"),
  ADD COLUMN "overheadAbsorptionAccount"  TEXT REFERENCES "account"("id"),
  ADD COLUMN "landedCostClearingAccount"  TEXT REFERENCES "account"("id");
-- Seed per companyGroup: 5320 Inventory Revaluation & Write-Downs (inventory-adjustments),
-- 5070 Overhead Absorption (cogs, beside 5060), 2126 Landed Cost Clearing (current-liabilities);
-- backfill accountDefault, then SET NOT NULL (reset-chart-of-accounts precedent).

-- 3) Inventory revaluation document
CREATE TYPE "inventoryRevaluationType" AS ENUM ('Revaluation', 'LCNRV');
CREATE TABLE "inventoryRevaluation" (
    "id" TEXT NOT NULL DEFAULT id('ivr'),
    "revaluationId" TEXT NOT NULL,               -- readable sequence
    "type" "inventoryRevaluationType" NOT NULL DEFAULT 'Revaluation',
    "status" TEXT NOT NULL DEFAULT 'Draft',      -- Draft | Posted
    "locationId" TEXT,
    "postingDate" DATE,
    "nrvLookbackDays" INTEGER,                   -- LCNRV runs: snapshot of parameters
    "nrvCostToSellPct" NUMERIC,
    "postedBy" TEXT REFERENCES "user"("id"),
    "postedAt" TIMESTAMP WITH TIME ZONE,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "inventoryRevaluation_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "inventoryRevaluation_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "inventoryRevaluationLine" (
    "id" TEXT NOT NULL DEFAULT id('ivrl'),
    "revaluationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "costLedgerId" TEXT,                          -- specific layer (FIFO/LIFO); NULL = all layers
    "quantity" NUMERIC NOT NULL,                  -- remaining quantity revalued (snapshot)
    "currentUnitCost" NUMERIC NOT NULL,
    "newUnitCost" NUMERIC NOT NULL,
    "proposedNrv" NUMERIC,                        -- LCNRV: mechanical proposal (kept for audit)
    "nrvSource" TEXT,                             -- 'salesInvoice' | 'salesOrder' | 'listPrice' | 'manual'
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "inventoryRevaluationLine_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "inventoryRevaluationLine_revaluation_fkey" FOREIGN KEY ("revaluationId", "companyId")
      REFERENCES "inventoryRevaluation"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "inventoryRevaluationLine_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- RLS: 4 named policies each; SELECT get_companies_with_employee_role(),
-- writes get_companies_with_employee_permission('inventory_*')::text[]

-- 4) Landed cost documents (same conventions; abbreviated)
CREATE TYPE "landedCostChargeType" AS ENUM ('Freight','Duty','Brokerage','Insurance','Other');
CREATE TYPE "landedCostAllocationBasis" AS ENUM ('Value','Quantity','Weight');
CREATE TABLE "landedCost" (
    "id" TEXT NOT NULL DEFAULT id('lc'),
    "landedCostId" TEXT NOT NULL,                 -- readable sequence
    "supplierId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "exchangeRate" NUMERIC NOT NULL DEFAULT 1,    -- FX helpers from #1030, never hand-rolled
    "status" TEXT NOT NULL DEFAULT 'Draft',       -- Draft | Posted
    "postingDate" DATE,
    "supplierReference" TEXT,
    "postedBy" TEXT REFERENCES "user"("id"),
    "postedAt" TIMESTAMP WITH TIME ZONE,
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "landedCost_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "landedCost_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "landedCostLine" (
    "id" TEXT NOT NULL DEFAULT id('lcl'),
    "landedCostId" TEXT NOT NULL,
    "chargeType" "landedCostChargeType" NOT NULL,
    "amount" NUMERIC NOT NULL,
    "allocationBasis" "landedCostAllocationBasis" NOT NULL DEFAULT 'Value',
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "landedCostLine_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "landedCostLine_landedCost_fkey" FOREIGN KEY ("landedCostId", "companyId")
      REFERENCES "landedCost"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "landedCostLine_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "landedCostAllocation" (
    "id" TEXT NOT NULL DEFAULT id('lca'),
    "landedCostLineId" TEXT NOT NULL,
    "receiptLineId" TEXT NOT NULL,
    "costLedgerId" TEXT,                          -- target layer
    "allocatedAmount" NUMERIC NOT NULL,           -- capitalized + expensed
    "capitalizedAmount" NUMERIC NOT NULL,         -- remaining-fraction share → inventory/layer
    "expensedAmount" NUMERIC NOT NULL,            -- consumed-fraction share → COGS
    "basisSnapshot" JSONB,                        -- value/qty/weight inputs at allocation time
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "landedCostAllocation_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "landedCostAllocation_line_fkey" FOREIGN KEY ("landedCostLineId", "companyId")
      REFERENCES "landedCostLine"("id", "companyId") ON DELETE CASCADE,
    CONSTRAINT "landedCostAllocation_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- RLS on all three: 4 named policies, purchasing_* permission family

-- 5) companySettings: "nrvLookbackDays" INTEGER NOT NULL DEFAULT 90,
--    "nrvCostToSellPct" NUMERIC NOT NULL DEFAULT 0

-- 6) Enum values (ADD VALUE IF NOT EXISTS): journalEntrySourceType/journalLineDocumentType
--    + itemLedgerDocumentType gain 'Inventory Revaluation' and 'Landed Cost';
--    purchaseInvoiceLineType gains 'Landed Cost'

-- 7) Close-checklist: INSERT INTO "periodCloseTaskDefinition" for 'LCNRV run'
--    and 'Overhead variance true-up' (period-closing spec registration rule)
```

Run `pnpm run generate:types` after migrations, before typechecking.

## API / Service Changes

- `items.models.ts`: `standardCost` re-enters `itemCostValidator`; costing route action persists it and triggers the standard-change revaluation guard.
- `recalculate` edge function: new `standardCostRollup` case; Inngest `recalculateFunction` passthrough.
- `post-receipt`: Standard-method branch (inventory at standard, delta to 5210); landed-cost-aware layer linkage unchanged.
- `close-job`: three-way variance split posting; clears WIP for Standard output.
- `post-production-event`: overhead absorption line; reversal path covers it via existing per-account negation.
- New edge function `post-inventory-revaluation` (shared by revaluation + LCNRV): validates period state, writes `Revaluation` cost-ledger rows + journal in one Kysely transaction (pattern: `post-production-event`'s `db.transaction()` + `getNextSequence` + `getCurrentAccountingPeriod`).
- New edge function `post-landed-cost`; `post-purchase-invoice` learns the `Landed Cost` line type (Dr 2126 / Cr AP).
- `inventory.service.ts`: `getInventoryRevaluations`, `insertInventoryRevaluation`, `proposeLcnrvRun` (the NRV query, §3), `getInventoryWriteDownRollforward`; `insertManualInventoryAdjustment` gains the GL leg (§4).
- `purchasing` service: `getLandedCosts`, `upsertLandedCost`, `allocateLandedCost` (basis math server-side).
- `calculate-cogs.ts`: FIFO/LIFO layer cost includes applied adjustment rows.

## UI Changes

- Item costing form: `standardCost` input (Standard method only) + "Roll up standard cost" action.
- Inventory → Revaluations: index table + document editor (lines grid with current/new cost, extended delta); LCNRV run wizard (parameters → proposed lines with NRV source badges, per-line edit, post).
- Purchasing → Landed Costs: document editor with allocation panel (pick receipts, choose basis, preview per-line capitalized/expensed split).
- Accounting reports: Inventory Write-Down Rollforward (CSV export).
- Close drawer: the two new tasks render via the period-closing checklist UI automatically.

## Acceptance Criteria

- [ ] **Standard receipt variance (numeric).** Item STD-100, `standardCost = $10.00`, PO at $11.00, receive 100: journal is Dr Inventory $1,000.00, Dr Purchase Price Variance (line "Standard Cost Variance") $100.00, Cr GR/IR $1,100.00; the cost layer carries `cost = 1000, quantity = 100`. Invoice later arrives at $11.20: existing PPV logic posts Dr GR/IR $1,100.00, Dr PPV $20.00, Cr AP $1,120.00 — unchanged.
- [ ] **Production variance (numeric).** Job produces 10 × STD-200 (rolled-up standard $50.00 = $30 material + $15 labor + $5 overhead); actual WIP accumulates $540.00 ($325 material, $155 labor, $60 overhead). Job close posts Dr Material Usage Variance $25.00, Dr Labor & Machine Variance $5.00, Dr Overhead Variance $10.00, Cr WIP $40.00; output layer = 10 × $50 = $500.00; WIP nets to zero for the job.
- [ ] **Standard-change guard.** Editing `standardCost` $10 → $9.50 with 40 on hand generates a Draft revaluation; posting it writes a `Revaluation` cost-ledger row of −$20.00 and Dr 5320 $20.00 / Cr Inventory $20.00.
- [ ] **LCNRV (numeric).** Item with layers 60 @ $21.00 and 40 @ $18.50 (carrying $2,000.00); posted sales invoices in the 90-day lookback average $19.00; cost-to-sell 5% ⇒ proposed NRV $18.05. Run proposes write-downs 60 × $2.95 = $177.00 and 40 × $0.45 = $18.00; posting yields Dr 5320 $195.00 / Cr Inventory $195.00, both layers' effective unit cost = $18.05, and a subsequent shipment of 10 relieves COGS at $180.50. No reversal path exists in PRIMARY; the write-down rows carry `proposedNrv`/`nrvSource` for the multi-book generator.
- [ ] **NRV editability.** A proposed line can be edited (NRV and quantity) before posting; the posted line retains both `proposedNrv` and the posted `newUnitCost`; the override appears in the audit log.
- [ ] **Quantity adjustment GL (numeric).** Negative adjustment of 10 units consuming a $7.00 FIFO layer posts Dr Inventory Adjustment (5310) $70.00 / Cr Inventory $70.00; positive adjustment of 5 at unit cost $7.00 posts the mirror. With `accountingEnabled = false`, itemLedger behavior is byte-identical to today and no journal is written.
- [ ] **Overhead absorption (numeric).** A 2.0h production event at `workCenter.overheadRate = $15.00/h` posts Dr WIP $30.00 / Cr Overhead Absorption (5070) $30.00 in the same journal as the labor line; editing the event reverses and reposts both lines. Period true-up: absorbed $12,000 vs actual pool $13,000 proposes Dr Overhead Variance $1,000.00 / Cr 5070 $1,000.00.
- [ ] **Landed cost (numeric).** Freight bill $150.00 allocated by value over receipt lines valued $1,000 (200 units @ $5.00, 50 already consumed) and $500 (fully on hand): allocations $100/$50. Posting: Dr Inventory $75.00 + $50.00, Dr COGS $25.00, Cr Landed Cost Clearing (2126) $150.00; remaining 150 units of layer A now consume at (150 × $5 + $75)/150 = $5.50. Freight vendor invoice posts Dr 2126 $150.00 / Cr AP $150.00; 2126 nets to zero for the document.
- [ ] **Rollforward.** After the LCNRV example plus the 10-unit shipment, the write-down rollforward shows additions $195.00 and relief $29.50 (10 × $2.95) in the correct periods, and exports to CSV.
- [ ] **Close integration.** Both task definitions appear in the next opened period's checklist; LCNRV is a Blocker on the fiscal year's final period and a skippable Warning otherwise.
- [ ] All postings balance (Σ = 0 per journal), respect Locked/Closed period rules, and `pnpm exec turbo run typecheck --filter=...` passes for touched packages after `pnpm run generate:types`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `calculate-cogs` change touches every FIFO/LIFO consumption path | High | Superset semantics (no applied rows ⇒ old result); unit tests over layer math incl. applied rows; ship first, alone |
| Standard cutover on items with existing average-cost history | Med | Standard takes effect only via explicit entry; the revaluation guard posts the transition delta so the GL never jumps silently |
| NRV proposal quality on low-volume items | Med | Fallback chain + `No NRV basis` flag + mandatory human review before posting (decision 14) |
| Overhead pool definition too coarse in v1 | Med | True-up is a *proposed* JE a human posts; pool config UI fast-follows |
| Landed cost across currencies | Med | Charges convert at document `exchangeRate` via the FX-normalization helpers (#1030) — never a hand-rolled operator |
| Variance-split logic in `close-job` misclassifies elements | Med | Cost elements tagged at absorption time (material/labor/overhead journal lines are already distinct accounts); residual-only fallback to 5220 with a warning |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

- [x] NRV source — **auto-proposed from recent selling prices less costs to complete/sell, editable per line** (Brad, 2026-07-04; query defined in §3).
- [x] LCNRV reversal — **US GAAP no-reversal in PRIMARY; IAS 2 reversal later via multi-book adjustment generator** (`.ai/specs/2026-07-04-multi-book.md`).
- [x] PPV vs standard variance — **both; invoice-vs-receipt PPV unchanged; receipt-time standard variance is its own line**.
- [x] Revaluation contra account — **dedicated 5320** (decision 8; `inventoryAdjustmentVarianceAccount` reserved for quantity effects).
- [x] Periodic pieces on the close checklist — **yes, both registered** per the period-closing registration rule.

No new blocking questions surfaced while writing; judgment calls (direct write-down vs reserve, dormant 5250/5260, landed-cost-on-standard → PPV, overhead pool v1 definition) are baked as Design Decisions 9, 12, 13 and the overhead-pool risk row, and are revisitable without schema churn.

## Changelog

- 2026-07-14: §4 (quantity-adjustment GL) superseded/expanded by
  `.ai/specs/2026-07-14-inventory-adjustment-gl-posting.md` — unified
  `post-inventory-adjustment` edge function (Brad's decision), count/Rectify
  posting, and a tie-out Reconcile action (draft adjusting journal); accounts
  (5310) and valuation rules unchanged.
- 2026-07-04: Created — readiness finding GAP-3, tracking issue crbnos/carbon#1040. Grounded in code exploration (`itemCost`/cost layers/`calculate-cogs`, `post-receipt`/`post-purchase-invoice`/`post-production-event`/`close-job` posting paths, `20260315000000` chart reset) and `.ai/research/public-company-compliance.md` (ASC 330 / IAS 2). NRV auto-proposal + per-book reversal split resolved by Brad pre-writing.
