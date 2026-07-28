# Audit: accounting transactions for inspections & dispositions

**Date:** 2026-07-25 · **Scope:** inbound-inspection reject, NCR disposition close, batch split, and the receipt posting that feeds them. Read-only trace of three flows against the canonical inventory-adjustment posting path.

## TL;DR

The inspection and disposition flows move inventory **quantity** (`itemLedger`) and tracked-entity **status**, but post **no cost and no GL**. Inventory **value** is booked once — at receipt — at full value *even for `requiresInspection` items whose entities are `On Hold`*, and is **never relieved** when that stock is rejected or scrapped. Result: the Inventory GL account overstates real inventory, cost layers (`costLedger`) never get consumed (FIFO/average drift), and there is no scrap/cost-of-quality expense.

## How Carbon *should* post an inventory movement (reference)

Canonical path: edge fn `packages/database/supabase/functions/post-inventory-adjustment/index.ts` → shared core `functions/shared/post-adjustment.ts::bookAdjustment`. In **one Kysely transaction** per signed movement it writes:

1. **`itemLedger`** — signed quantity (always).
2. **`costLedger`** — relieve layers via `shared/calculate-cogs.ts::calculateCOGS` on a decrease (honors `costingMethod` Standard/Average/FIFO/LIFO, `.forUpdate()` locks layers, decrements `remainingQuantity`); create a new layer at current carrying cost on an increase. Skipped for `Non-Inventory` / qty 0.
3. **`journal` + `journalLine`** (balanced Dr/Cr pair) + **`journalLineDimension`** (Item / ItemPostingGroup / Location tags) — **only when `companySettings.accountingEnabled` and cost ≠ 0**.

**Account resolution** (`shared/get-posting-group.ts`) is flat, one `accountDefault` row per company (posting-group matrix was **dropped** in `20260229000000_drop-posting-groups.sql`):
- Inventory side by `replenishmentSystem`: `finishedGoodsAccount` (Make / Buy and Make) else `rawMaterialsAccount`.
- Offset: `inventoryAdjustmentVarianceAccount` (seeded `5310 "Inventory Adjustment"`, COGS/Expense).
- **No `valueLedger` / `generalLedger` tables** — `costLedger` is the value ledger, `journal`/`journalLine` are the GL. Use `accountId` (not the legacy `accountNumber`).

When accounting is **disabled**, `bookAdjustment` still writes `itemLedger` + `costLedger`, but **no journal** — it fails *closed* (a failed `companySettings` read throws).

## What the audited flows actually do

### 1. Inspection reject — `apps/erp/app/modules/quality/quality.server.ts::dispositionInspection`
- Flips lot tracked entities → `Rejected` (Accept → un-sampled `Available`; Partial → none). No ledger.
- **Only** ledger write (non-tracked `Inventory`, receipt-sourced, not already Failed): one `itemLedger` `Negative Adjmt.`, `documentType "Inbound Inspection"`, `quantity: -lotSize`, `trackedEntityId: null`. **No `costLedger`, no `journal`.**
- Updates `inspection` status + writes `inspectionHistory`.
- Tracked / `Non-Inventory` rejects post **no ledger at all** — only the status flip.

### 2. NCR disposition close — `apps/erp/app/modules/quality/quality-disposition.server.ts::closeIssue`
- **Scrap / Return to Supplier** (tracked): one `itemLedger` `Negative Adjmt.` per linked entity, `documentType "Non-Conformance"`, `quantity: -link.quantity`; then flip entities → `Rejected`. **No cost/GL.**
- **Use As Is / Rework** (tracked): flip entities → `Available`. No ledger.
- **Non-tracked Use As Is / Rework restore** (my recent change, inspection-originated `Inventory` only): one `itemLedger` `Positive Adjmt.` `+quantity`. **No cost/GL.**
- Sets `nonConformance.status = Closed`.

### 3. Batch split — `quality-disposition.server.ts::subdivideBatchEntity` (via `splitIssueItem`)
- Three `itemLedger` `Batch Split` rows that **net to zero** on-hand + `trackedActivity` genealogy. **Correctly** no GL (no value change). Non-tracked quantity split writes **no** `itemLedger` at all.

### 4. Receipt — `packages/database/supabase/functions/post-receipt/index.ts`
- `requiresInspection` has exactly two effects: creates the inspection lot, and sets tracked entities `On Hold`. **Neither gates the posting.** The main receipt loop books the **normal full-value `journal`/`journalLine` + `costLedger` layers + `itemLedger`** for every line regardless of inspection/On-Hold.
- ⇒ At receipt, inspection stock's **value is on the GL** (`get_inventory_quantities` hides the *quantity* as `quantityOnHold`, but the value is booked). A later reject/scrap never reverses it.

### 5. `itemLedger` is quantity-only
No `cost`/`value`/`amount` column; its only triggers denormalize `trackedEntityStatus`. An `itemLedger` insert has **no GL fan-out** — cost/GL are always separate writes. Confirmed: zero `journalLine` / `costLedger` / `post-inventory-adjustment` / `accountingEnabled` references anywhere in the quality module or inspection/issue routes.

## The gaps

| # | Gap | Consequence |
|---|-----|-------------|
| G1 | Reject of non-tracked `Inventory` removes on-hand qty but **not value/cost** | Inventory GL overstated by the lot's cost; cost layers not relieved |
| G2 | Reject of **tracked** stock changes status only — value stays in Inventory GL through the MRB hold and beyond | Rejected value commingled with good stock; relieved only if Scrap disposition eventually posts (it doesn't today) |
| G3 | Disposition **Scrap / Return** posts qty-only | No cost relief, **no scrap/write-off expense** — cost of quality invisible; GL overstated |
| G4 | Disposition **Use As Is / Rework** restore posts qty-only | If reject ever writes off value (post-fix), a kept lot's value isn't restored → understated |
| G5 | No `accountingEnabled` gate / accounting-period awareness in these flows | Even correct-intent postings would ignore locked periods |
| G6 | **NCR reopen** (Closed→Registered) doesn't reverse anything | Once GL is added, reopen must reverse the journals or be blocked |
| G7 | **Xero landmine** — `packages/ee/src/accounting/providers/xero/entities/inventory-adjustment.ts` sweeps **every** `itemLedger` row with `entryType ∈ {Positive/Negative Adjmt.}` (ignores `documentType`) and recomputes value from `itemCost.unitCost` | These NCR/inspection rows could push Xero ManualJournals with **no matching local GL** if adjustment sync is enqueued (currently disabled + push-only + backfill-only, so latent, not live) |

## Account infrastructure (what exists to post against)

- Flat `accountDefault` (PK `companyId`, one row/company). Relevant columns: `rawMaterialsAccount`, `finishedGoodsAccount`, `workInProgressAccount`, `costOfGoodsSoldAccount`, `goodsReceivedNotInvoicedAccount`, **`inventoryAdjustmentVarianceAccount`**, `materialVarianceAccount`, and the other variance/absorption accounts. Editable at `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx`; seeded in `functions/lib/seed.data.ts`.
- **No dedicated scrap / write-off / adjustment-expense inventory account exists.** Closest reusable = `inventoryAdjustmentVarianceAccount` (5310, already the offset for physical-count adjustments). (`customerWriteOffAccount`=bad debt, `supplierWriteOffAccount`=vendor write-off *income*, fixed-asset `writeDownAccount` — none fit inventory scrap.)
- **Production scrap has no scrap-specific GL today:** scrapped-unit cost is absorbed into good-unit cost at `complete_job_to_inventory`; residual WIP at `close-job` sweeps to `materialVarianceAccount`; scrapping a tracked material (`functions/issue/index.ts::scrapTrackedEntity`) posts Dr `workInProgressAccount` / Cr `rawMaterials|finishedGoods` (treated as consumption into WIP), not an expense. `scrapReasons` are quantity labels with no account link.

## Files

- Reference: `functions/post-inventory-adjustment/index.ts`, `functions/shared/post-adjustment.ts`, `functions/shared/calculate-cogs.ts`, `functions/shared/get-posting-group.ts`.
- Gap sites: `apps/erp/app/modules/quality/quality.server.ts` (`dispositionInspection`), `apps/erp/app/modules/quality/quality-disposition.server.ts` (`closeIssue`, `subdivideBatchEntity`, `splitIssueItem`), `apps/erp/app/routes/x+/inspection+/$id.reject.tsx`, `apps/erp/app/routes/x+/issue+/$id.close.tsx`.
- Receipt: `functions/post-receipt/index.ts`.
- Accounts: `packages/database/src/types.ts` (`accountDefault`), `apps/erp/app/modules/accounting/accounting.models.ts`, `functions/lib/seed.data.ts`.
- Xero: `packages/ee/src/accounting/providers/xero/entities/inventory-adjustment.ts`.

→ Plan: `.ai/plans/2026-07-25-inspection-disposition-gl-posting.md`
