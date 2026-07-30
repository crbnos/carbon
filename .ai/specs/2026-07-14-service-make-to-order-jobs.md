# Service Make-to-Order Jobs

> Status: implemented (on feat/service; move to implemented/ after merge)
> Author: Claude (with Brad Barbin)
> Date: 2026-07-14
> Branch: feat/service
> Research: `.ai/research/service-make-to-order-jobs.md`
> Related: `.ai/specs/2026-07-04-revenue-recognition.md` (issue #1048 — the incoming rev-rec workstream this spec leaves seams for), `.ai/specs/2026-07-13-raw-materials-finished-goods-accounts.md` (the account split whose latest `complete_job_to_inventory` this spec forks)

## TLDR

Let a **Service** item (now a first-class item type, `itemTrackingType = 'Non-Inventory'`) be sold Make-to-Order on a sales order line and produced by a job — with accounting that reflects that a service is never stocked and never shipped from inventory. Adopting the Epicor "Make Direct" pattern from research, a service job accumulates labor + overhead (+ any consumed materials) as **WIP exactly like a physical job** (already true — `issue` and `post-production-event` post to `workInProgressAccount` keyed by `documentId = jobId`, with no item-type branch), but on **job completion** its cost posts **`Dr costOfGoodsSoldAccount` / `Cr workInProgressAccount` directly — no Finished-Goods leg, no `itemLedger`/`costLedger`, no on-hand quantity** — and the linked sales-order line is marked **fulfilled by completion**, not by a shipment. **This COGS diversion applies only to Non-Inventory items (Services); every inventory-tracked item — including a `Make` Part — still completes to the Finished Goods account exactly as it does today.** The change is strictly additive to a new branch; the inventory path is byte-identical to the current definition. The core accounting change is a one-function migration that **restores a Non-Inventory branch to `complete_job_to_inventory`** that previously existed (`20260707022142`) but was silently dropped when the July‑13 raw-materials/FG and overhead migrations forked from an older baseline — so today a service job completion wrongly posts `Dr Finished Goods / Cr WIP` and creates phantom finished-goods inventory. The sales/methodType side already mostly works (a `Make` service defaults to `defaultMethodType = 'Make to Order'`, auto-gets a `makeMethod`, and the Jobs card renders); the remaining plumbing is making the job-*creation* body service-aware (it currently `.single()`s `itemReplenishment`, which services lack). GL accounts resolve from the existing **company-level `accountDefault`** (no per-item accounts); revenue posts on the sales invoice as today. **No new tables, columns, or enums** — the spec is a completion-posting fix + fulfillment hook + job-creation hardening, deliberately leaving revenue-recognition schema to spec #1048 and only preserving the seams it needs (the WIP-by-`jobId` subledger and a single interceptable COGS-at-completion branch).

## Problem Statement

A Service is now a first-class item type on `feat/service` (`serviceReplenishmentSystems = ['Buy','Make']`, `itemTrackingType = 'Non-Inventory'`, auto-created `makeMethod`, BOM+routing UI). Selling one Make-to-Order and producing it is *partially* wired but broken in three places:

1. **Job creation breaks for services.** `convertSalesOrderLinesToJobs` (`apps/erp/app/modules/production/production.service.ts:139`) filters correctly on `methodType === "Make to Order"` (no item-type exclusion), and a `Make` service line inherits that methodType from `item.defaultMethodType`. But the loop body is inventory-shaped: it does `.single()` on `itemReplenishment` (`production.service.ts:140-145`) — a row `upsertService` never creates — and resolves a storage unit / scrap %, all inventory concepts. So the bulk "Create Jobs" affordance (`SalesOrderSummary.tsx:126-167`, gated on `hasMakeItems`) picks up a service line and then errors or misbehaves.

2. **Service job completion posts the wrong journal (latent regression).** A Non-Inventory branch for `complete_job_to_inventory` existed in `20260707022142_complete-job-to-inventory-non-inventory.sql` — it posted `Dr costOfGoodsSoldAccount / Cr workInProgressAccount` and suppressed the `itemLedger` "Assembly Output" row, `pickMethod` update, `costLedger` "Output" layer, and `itemCost` update for Non-Inventory items. The two 2026-07-13 migrations (`…190909` raw-materials/FG split, `…222236` overhead-absorption fix) each `CREATE OR REPLACE`d `complete_job_to_inventory` **forked from the older `20260630092517` baseline** and silently dropped that branch. The current newest definition (`20260713222236`) has **zero** `Non-Inventory`/`itemTrackingType` references (verified by grep) — so a service job completion unconditionally debits Finished Goods and writes a phantom `itemLedger` "Assembly Output" row + `costLedger` "Output" layer + `itemCost` update. This misstates the balance sheet (WIP relieved into FG for a good that will never exist) and leaves orphan finished-goods on-hand.

3. **Nothing marks a service SO line fulfilled.** `post-shipment` already excludes Non-Inventory from COGS (`post-shipment/index.ts:423`) and treats `salesOrderLineType === "Service"` as always-shipped for SO-status rollup (`:805-810`) — good, services don't block order completion and don't post shipment COGS. But since a service never enters the shipment builder, **no path advances the service SO line's own `quantitySent`/`sentComplete`/`sentDate`**, so the line never shows a truthful "delivered" state.

What already works and must be preserved: WIP accumulation for a service job (`issue/index.ts:386-412` material → WIP; `post-production-event/index.ts:250-301` labor/machine/overhead → WIP), all keyed by `documentId = jobId` with no item-type branch; `close-job` (`close-job/index.ts:115-140`) sweeping residual WIP to `materialVarianceAccount`; the `get-method` `itemToJob` copy that builds the job's operations/materials from the service's make method (no item-type filter).

## Proposed Solution

Reuse Carbon's existing job/WIP machinery minus the inventory legs — Epicor "Make Direct" (research §Recommended Approach). Four surfaces change; none introduces a new table, column, or enum.

### 1. Accounting — restore the Non-Inventory branch in `complete_job_to_inventory` (the core change)

One forward migration redefines `complete_job_to_inventory`, **forked from the newest definition (`20260713222236`)** per the function-redefinition lesson (`DROP FUNCTION IF EXISTS` first, signature and all July‑13 overhead/RM logic preserved), re-adding the Non-Inventory branch from `20260707022142`:

- Resolve `v_cogs_account := accountDefault."costOfGoodsSoldAccount"` alongside the existing RM/FG resolution.
- When `item."itemTrackingType" = 'Non-Inventory'`:
  - Post `Dr v_cogs_account / Cr workInProgressAccount` for `v_accumulated_wip_cost` (the same accumulated-WIP amount the FG path uses; `documentType 'Job Receipt'`, `documentLineReference = job:<id>`), **instead of** `Dr inventory / Cr WIP`.
  - **Suppress** the `itemLedger` "Assembly Output" insert, the `pickMethod` update, the `costLedger` "Output" layer insert, and the `itemCost` update (all guarded `IF item."itemTrackingType" IS DISTINCT FROM 'Non-Inventory'`) — a service creates no on-hand quantity and no cost layer.
- Inventory items are byte-identical to `20260713222236` (RM/FG CASE on `replenishmentSystem`, overhead absorption, itemLedger/costLedger unchanged).

**Completion posting by item classification** (the only classifier is `itemTrackingType`, then `replenishmentSystem` for the inventory split — no per-item accounts, no matrix config):

| Item at completion | `itemTrackingType` | Debit | Credit | itemLedger / costLedger / itemCost |
|---|---|---|---|---|
| `Make` Part / Material / Tool (stocked) | Inventory / Serial / Batch | **Finished Goods** (`finishedGoodsAccount`) | WIP | written (unchanged) |
| `Buy` inventory item completed from a job (rare) | Inventory / Serial / Batch | Raw Materials (`rawMaterialsAccount`) | WIP | written (unchanged) |
| **Service** (or any Non-Inventory item) | **Non-Inventory** | **COGS** (`costOfGoodsSoldAccount`) | WIP | **suppressed** |

So a finished good that is a Part **always** posts to the Finished Goods account — the service COGS branch is entered *only* when the item is Non-Inventory, which a Part never is. The service divergence cannot touch the Part/inventory path.

This is a **correctness fix, not flag-gated** — the prior (correct) behavior is being restored for *all* Non-Inventory job completions (services today; any future Non-Inventory make). `close-job`'s residual-WIP → `materialVarianceAccount` sweep is item-type-agnostic and needs no change (it becomes a near-no-op once completion relieves WIP; a service job with over/under-absorbed labor still sweeps the remainder to variance — research Pattern 5, "no standard-cost production variance for services; sweep residual WIP").

**Accounts (resolved OQ‑1):** revenue and COGS resolve from **company-level `accountDefault`** — `salesAccount` (revenue, on the sales invoice, unchanged) and `costOfGoodsSoldAccount` (COGS, at completion). No per-item accounts (posting groups are dropped; nothing on `item` carries accounts). A service carries **no inventory/asset account** because it is Non-Inventory. This matches the just-approved raw-materials/FG spec and the no-matrix-config rule.

### 2. Fulfillment — job completion advances the sales-order line (resolved OQ‑3)

On successful completion of a service job (`job."salesOrderLineId"` set AND the job's item is `Non-Inventory`), advance the linked `salesOrderLine`'s fulfillment to mirror what `post-shipment` does for a physical line (`post-shipment/index.ts:494-546`): `quantitySent` (recomputed from ALL jobs on the line — idempotent, lot-split safe), `sentComplete = quantitySent >= saleQuantity`, `sentDate = today` on first completion. **Implemented inside `complete_job_to_inventory` itself (revised 2026-07-14 during e2e):** the original design put this in TypeScript in the `$jobId.complete.tsx` action, but completion has multiple entry points — the ERP route AND the `sync_finish_job_operation` DB interceptor that auto-completes the job when its last operation finishes — so the SQL function is the only choke point that covers every path. The block runs before the accounting-enabled / zero-WIP early returns. Fulfillment = work done; invoicing follows as today. (The SO-status rollup already treats service lines as shipped, so this write is about the line's own truthful delivered state and UI, not unblocking order completion.)

### 3. Sales / job creation — make the job-creation body service-aware

- `convertSalesOrderLinesToJobs` (`production.service.ts:139`) and the per-line `salesOrderLineToJob` path: read `itemReplenishment` with `.maybeSingle()` (not `.single()`) and default absent values (`lotSize = null`, `scrapPercentage = 0`, `leadTime = 7`) — `insertJob` already uses `maybeSingle` (`production.service.ts:2673`), so the fix is the bulk converter matching it. Skip storage-unit resolution for Non-Inventory items (`getDefaultStorageUnitForJob` returns null for a service anyway; guard to avoid a needless query). No scrap for services.
- No change to the methodType/UI side: a `Make` service already defaults `defaultMethodType = 'Make to Order'` (`ServiceForm.tsx:76-77`), the Jobs card already renders when `line.methodType === 'Make to Order'` (`$orderId.$lineId.details.tsx:216`), and `SalesOrderSummary`'s "Create Jobs" already includes service lines. The `get-method` `itemToJob` copy already builds the job from the service's make method (operations → labor WIP, materials → material WIP).

**In-house vs subcontracted falls out of `replenishmentSystem` for free** (research §6): a **`Make` service** = in-house labor job (WIP from operations); a **`Buy` service** = subcontracted/purchased, `defaultMethodType = 'Purchase to Order'`, invoiced via a PO/vendor bill with no job. A `Make` service that has an *outside operation* is the in-house-job-with-subcontracted-step case — one WIP path, two cost sources — already supported (outside operations post to WIP). No new branch needed.

### 4. Revenue-recognition seams (resolved OQ‑2 — seams only, no new schema)

Spec #1048 already owns the rev-rec schema (`item.revenueRecognitionMethod`, `accountDefault.deferredRevenueAccount`/`contractAssetAccount`, `revenueArrangement`/`revenueElement`/`revenueRecognitionSchedule`) and its cost-to-cost POC reads **job WIP debit inflows by `documentId = jobId`** over an EAC from `jobMaterial`/`jobOperation`. This spec therefore adds **no** rev-rec schema (avoiding a migration collision) and instead guarantees the two seams #1048 needs:

- **Seam A — POC cost basis, already free.** A service job's WIP accumulates by `documentId = jobId` (unchanged), so a service MTO line is a first-class POC cost basis the moment #1048 lands. Its EAC inputs already exist (`jobOperation` setup/labor/machine times × `laborRate`/`machineRate` + `overheadRate`; `jobMaterial.estimatedQuantity × unitCost`), surfaced today by `JobEstimatesVsActuals.tsx`.
- **Seam B — one interceptable COGS-at-completion branch.** The Non-Inventory `Dr COGS / Cr WIP` post lives in a single branch of `complete_job_to_inventory`. #1048's resolved OQ‑N1 (post COGS **as-incurred** in the recognition run and **skip COGS at completion/shipment for POC elements**) extends exactly this branch with one guard — `AND NOT (revenueRecognitionEnabled AND element.method = 'Percent of Completion' for this salesOrderLineId)`. v1 always posts COGS at completion (rev-rec off, the only state today); #1048 adds the guard additively, no restructuring. This is documented in the migration as the extension point.

### Design Decisions

| # | Heuristic | Decision | Rationale |
|---|-----------|----------|-----------|
| 1 | Multi-tenancy | **No new tables/columns/enums.** All touched tables (`job`, `salesOrderLine`, `journalLine`) are already `companyId`-scoped composite-PK tables. The migration only redefines a function. | Minimal footprint; the feature is a posting fix + hooks, not new entities. |
| 2 | Service shape | New/changed logic in **`production.service.ts`** (`convertSalesOrderLinesToJobs` service-awareness; a fulfillment helper), `(client, …) → {data, error}`, never throws. Accounting change is the `complete_job_to_inventory` SQL function. | One `{module}.service.ts` per module; production owns jobs + fulfillment-from-completion. |
| 3 | RLS | No new tables; existing `job`/`salesOrderLine`/`journalLine` policies apply. Completion runs service-role in the RPC (as today). | No surface added. |
| 4 | Permissions | Job creation `create: "production"` (unchanged); completion `update: "production"` (unchanged); the SO-line fulfillment advance happens inside the completion action under production perms. | Matches existing job/completion routes. |
| 5 | Forms | No new forms. The service line already uses `ValidatedForm` + `salesOrderLineValidator`; methodType wiring is existing. | Nothing to add. |
| 6 | Module layout | production (`production.service.ts`), accounting (SQL migration under `packages/database/supabase/migrations/`); items/sales unchanged except the converter fix. No new module. | House layout. |
| 7 | Backward compatibility | The `complete_job_to_inventory` change **restores** the prior Non-Inventory behavior (regression fix) — inventory-item completions are byte-identical to `20260713222236`; only Non-Inventory completions change (and their current behavior is buggy). Historical journals untouched. Not flag-gated. Rev-rec stays additive via Seam B. | A correctness fix that narrows to the buggy branch; no frozen inventory-item posting surface changes. |

## Data Model Changes

**One migration** (`pnpm db:migrate:new service-make-to-order-completion`, randomized HHMMSS per the timestamp lesson), redefining a single function. **No table/column/enum changes**, so `pnpm run generate:types` is a no-op for TS types (the RPC signature is preserved) — run it anyway to confirm no diff.

```sql
-- Fork complete_job_to_inventory from the NEWEST definition (20260713222236),
-- preserving its full signature + all overhead/RM-FG logic, and re-add the
-- Non-Inventory branch dropped when the July-13 migrations forked from an older
-- baseline (template: 20260707022142_complete-job-to-inventory-non-inventory.sql).
DROP FUNCTION IF EXISTS complete_job_to_inventory(TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION complete_job_to_inventory(
  p_job_id TEXT, p_quantity_complete NUMERIC, p_storage_unit_id TEXT,
  p_location_id TEXT, p_company_id TEXT, p_user_id TEXT
) RETURNS ... AS $$
DECLARE
  -- ...existing declares from 20260713222236...
  v_cogs_account TEXT;                 -- re-added: accountDefault."costOfGoodsSoldAccount"
BEGIN
  -- ...existing item/accountDefault fetch (add costOfGoodsSoldAccount to the select)...

  IF v_item_tracking_type = 'Non-Inventory' THEN
    -- Service / Non-Inventory: relieve WIP straight to COGS, no inventory leg.
    -- Dr costOfGoodsSoldAccount / Cr workInProgressAccount  (v_accumulated_wip_cost)
    -- documentType 'Job Receipt', documentLineReference 'job:'||p_job_id
    -- >>> REV-REC SEAM B: a future revenue-recognition build gates THIS post off
    -- for Percent-of-Completion elements (COGS then posts as-incurred in the
    -- recognition run). v1 always posts here. <<<
    -- NO itemLedger 'Assembly Output', NO pickMethod update,
    -- NO costLedger 'Output' layer, NO itemCost update.
  ELSE
    -- Inventory: unchanged from 20260713222236 (RM/FG CASE on replenishmentSystem,
    -- overhead absorption, itemLedger 'Assembly Output', costLedger 'Output', itemCost).
  END IF;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;
```

No views select the changed function's output columns; nothing to redefine. (Verify at implementation; DROP/recreate with `SELECT *` if any view is found to depend on a touched column — none expected.)

## API / Service Changes

`apps/erp/app/modules/production/production.service.ts`:

- **`convertSalesOrderLinesToJobs`** — `itemReplenishment` via `.maybeSingle()` + defaults (`lotSize: null`, `scrapPercentage: 0`, `leadTime: 7`); skip storage-unit resolution when the item is `Non-Inventory`. (The per-line `insertJob` path already uses `maybeSingle` — align the bulk converter.)
- **No new TypeScript fulfillment helper.** (An `advanceServiceLineFulfillment` route hook was originally specified here, implemented, then removed during e2e — see §Fulfillment and Changelog.) Fulfillment lives ONLY inside `complete_job_to_inventory`'s Non-Inventory branch: it recomputes `quantitySent` from ALL non-cancelled jobs on the line (idempotent, lot-split safe), sets `sentComplete`/`sentDate`, and runs before the accounting-enabled / zero-WIP early returns, so every completion entry point (the ERP route AND the `sync_finish_job_operation` interceptor) crosses the single SQL path. Do not add an app-level fulfillment hook — it would double-write `quantitySent`.

Callers/hooks:
- **`apps/erp/app/routes/x+/job+/$jobId.complete.tsx`** — unchanged behavior; carries a comment pointing at the SQL fulfillment path.
- **`complete_job_to_inventory`** (SQL) — Non-Inventory branch (§Data Model), including the SO-line fulfillment.

Unchanged and relied upon: `issue` / `post-production-event` (WIP by `documentId = jobId`), `close-job` (residual WIP → `materialVarianceAccount`), `post-shipment` (Non-Inventory COGS exclusion + service-line always-shipped rollup), `get-method` `itemToJob` (make-method copy), `post-sales-invoice` (revenue `Dr AR / Cr salesAccount`).

## UI Changes

Minimal — the surfaces already render; the fixes make them function:

- **Sales order line detail** (`$orderId.$lineId.details.tsx`): the "Jobs / Make to Order" card already renders for `methodType === 'Make to Order'`; no change. A `Make` service line reaches it.
- **Sales order summary** (`SalesOrderSummary.tsx`): "Create Jobs" already includes service lines; the converter fix makes it succeed.
- **Job page**: a service job shows operations (labor) and materials from the make method; completion marks the job Completed. Consider showing "Completed" rather than a `0/n` shipped count for a Non-Inventory job (cosmetic; `SalesOrderJobItem` shows shipped/quantity — a completed service job has `quantityShipped = 0` by design). Optional polish, not required for correctness.
- Flash messages on job creation/completion per `.ai/rules/flash-system.md` (existing).

## Acceptance Criteria

- [ ] A `Make` service item created via `ServiceForm` has `replenishmentSystem = 'Make'`, `defaultMethodType = 'Make to Order'`, `itemTrackingType = 'Non-Inventory'`, and an auto-created `makeMethod`; adding a routing operation + BOM material to it persists.
- [ ] Adding that service to a sales order line seeds `methodType = 'Make to Order'`; the line-detail "Jobs / Make to Order" card renders, and the order-summary "Create Jobs" affordance appears.
- [ ] Clicking "Create Jobs" (bulk) and per-line "Make to Order" both create a job for the service line **without erroring** on the missing `itemReplenishment` row; the job's operations/materials are copied from the service's make method.
- [ ] Reporting a production event (labor) and issuing a material against the service job posts `Dr workInProgressAccount / Cr laborAbsorptionAccount` (labor) and `Dr workInProgressAccount / Cr <inventory>` (material), both with `documentId = jobId`.
- [ ] **Completing the service job posts exactly `Dr costOfGoodsSoldAccount / Cr workInProgressAccount` for the accumulated WIP, and creates NO `itemLedger` "Assembly Output" row, NO `costLedger` "Output" layer, and NO `itemCost` update** (verify by query). A `Make` **inventory** (Part) job completion is unchanged: `Dr finishedGoodsAccount / Cr WIP` + itemLedger/costLedger as before.
- [ ] Completing the service job advances the linked sales-order line: `quantitySent` increases by the completed quantity, `sentComplete` flips true when fully completed, `sentDate` set — with no shipment record created and no inventory relieved.
- [ ] `post-shipment` is never invoked for the service line (no shipment builder entry), and the sales order can still reach its completed/invoiceable status (service line counts as shipped in the rollup).
- [ ] Invoicing the service order line posts revenue `Dr receivablesAccount / Cr salesAccount` on the sales invoice as today, with no COGS on the invoice (COGS already posted at completion).
- [ ] `close-job` on the completed service job finds ~zero residual WIP and posts nothing; a service job closed with un-relieved WIP (e.g. over-absorbed labor) sweeps the remainder to `materialVarianceAccount`.
- [ ] A `Buy` service line defaults to `Purchase to Order`, shows **no** Jobs card, and is unaffected by this spec.
- [ ] The migration applies idempotently twice and passes a rolled-back psql validation: `complete_job_to_inventory` references `costOfGoodsSoldAccount` and branches on `itemTrackingType = 'Non-Inventory'`; inventory-item completion output is EXCEPT-equivalent to `20260713222236`.
- [ ] `pnpm run generate:types` produces no type diff; scoped `typecheck` (erp) and `pnpm run lint` pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| The migration forks `complete_job_to_inventory` from the wrong (older) baseline again, re-dropping July‑13 overhead/RM logic | High | Fork explicitly from `20260713222236`; rolled-back psql validation asserts inventory-item output is EXCEPT-equivalent to the current definition; only the Non-Inventory branch differs. |
| Between migration and edge-function/app rollout, in-flight Non-Inventory completions post the old (buggy) way | Low | Function-only change; the RPC is redefined atomically. No edge-function rollout coupling. Inngest/route retries self-heal. |
| Existing service jobs completed BEFORE this fix left phantom FG `itemLedger`/`costLedger` rows | Med | Documented limitation; a one-off cleanup/reclass is out of scope (mirrors the raw-materials/FG spec's pre-split-stock caveat). Note in release notes. |
| Partial completion of a service job posts all accumulated WIP-to-date at the first completion (no per-unit cost layer for Non-Inventory) | Med | Acceptable v1 (services are typically completed whole); document. If per-completion cost splitting is needed, revisit with the inventory-valuation workstream. |
| Fulfillment advance (TS) succeeds/fails independently of the completion RPC | Low | Call it immediately after RPC success in the same action; idempotent (re-running clamps at `saleQuantity`). |
| Rev-rec (#1048) later needs COGS-at-completion suppressed for POC service elements | Low (by design) | Seam B: the single Non-Inventory COGS branch is the documented extension point; #1048 adds one guard, no restructuring. |

## Open Questions

> Resolved before writing (Step 5 / Step 7). All boxes checked — audit trail below.

- [x] **OQ‑1: Where do service revenue/COGS accounts resolve — per-item accounts (research rec) or company-level `accountDefault`?** — **Answer (Brad, 2026-07-14):** Company-level `accountDefault` (`salesAccount` for revenue, `costOfGoodsSoldAccount` for COGS); no per-item accounts. Carbon has no per-item account fields (posting groups dropped), and the just-approved raw-materials/FG spec + the no-matrix-config rule both point to company defaults. Supersedes the research summary's "service item carries a revenue + COGS account" phrasing (Carbon-consistent implementation of the same intent).
- [x] **OQ‑2: How much revenue-recognition scaffolding to pre-build now (rev-rec "coming very soon")?** — **Answer (Brad, 2026-07-14):** Seams only, no new schema. Spec #1048 owns the rev-rec tables/columns; adding them here risks a migration collision. Preserve the two seams #1048 needs: the WIP-by-`documentId=jobId` subledger (already free) and a single interceptable COGS-at-completion branch (Seam B).
- [x] **OQ‑3: How does a service SO line show fulfilled with no shipment?** — **Answer (Brad, 2026-07-14):** Job completion advances the SO line (`quantitySent`/`sentComplete`/`sentDate`), mirroring how a shipment advances a physical line. Fulfillment = work done; invoicing follows as today.
- [x] **Accepted from research (pre-resolved by "go with the recommendations"):** service job accumulates WIP like a physical job (2); fulfillment by completion not goods issue (3); WIP→COGS directly at completion, no FG leg, no inventory account on the service (4); revenue on the sales invoice, v1 timing = completion/on-invoice (5); residual WIP swept to variance at close (6); one WIP path, two cost sources — `Make` service = in-house job, `Buy` service = subcontracted PO (7).

## Changelog

- 2026-07-14 (e2e revisions): (1) Fulfillment moved from the TS completion route into `complete_job_to_inventory` — the `sync_finish_job_operation` interceptor auto-completes jobs at the DB level, bypassing any app-level hook (commit 6c6565d0c). (2) "Jobs Required" card now also renders at status "To Invoice" when a Make-to-Order Service line exists — `getSalesOrderStatus` counts Service lines as shipped, so an all-service order skips the "To Ship" states the card gated on (commit b68962287). (3) Confirmed inherited zero-cost edge during e2e: issuing an item with no cost layers/unit cost posts no Job Consumption journal and no costLedger (`issue/index.ts` `if (cost <= 0) continue`) — pre-existing, applies to physical jobs equally, documented not changed.
- 2026-07-14: Created. Grounded in `.ai/research/service-make-to-order-jobs.md` (Epicor Make Direct), the in-flight revenue-recognition spec (`2026-07-04`, issue #1048), and codebase tracing of the live posting path (`complete_job_to_inventory` newest def `20260713222236`; dropped Non-Inventory branch `20260707022142`; WIP accumulation `issue`/`post-production-event`; `close-job` variance sweep; `post-shipment` Non-Inventory/service handling; `convertSalesOrderLinesToJobs` converter; service item wiring `serviceReplenishmentSystems`/`ServiceForm`/`20260707022141`). Three grounding-surfaced questions (OQ‑1 accounts, OQ‑2 rev-rec stubs, OQ‑3 fulfillment) resolved with Brad before writing.
