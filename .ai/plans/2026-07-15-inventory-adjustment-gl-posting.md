# Inventory Adjustment GL Posting — implementation plan

**Spec:** .ai/specs/2026-07-14-inventory-adjustment-gl-posting.md
**Research:** .ai/research/inventory-adjustment-gl-posting.md
**Branch:** feat/inventory-report

## Progress
- [x] Task 1: Migration — journal document-type enum values + regenerated types
- [x] Task 2: Shared posting core `shared/post-adjustment.ts` (+ pure cost helper with deno test)
- [x] Task 3: New edge function `post-inventory-adjustment` (full adjustment semantics port)
- [x] Task 4: ERP service wrapper delegates to the edge function
- [x] Task 5: MES service wrapper delegates to the edge function
- [x] Task 6: `post-inventory-count` books lines through the shared core
- [x] Task 7: Reconcile service + route (`valuation.reconcile`)
- [x] Task 8: Workbench Reconcile button + tie-out caveat copy
- [x] Task 9: Rules / AGENTS.md / product-docs sync
- [ ] Task 10: End-to-end verification (browser via /test + SQL spot checks)

## Dependencies
- Task 2 needs Task 1 (regenerated enum types).
- Task 3 needs Task 2. Tasks 4 and 5 need Task 3 and are **independent of each other** (parallel OK).
- Task 6 needs Task 2 (independent of Tasks 3–5; parallel OK).
- Task 7 is independent of Tasks 1–6 (parallel OK). Task 8 needs Task 7.
- Task 9 needs Tasks 3–8. Task 10 is last.

---

## Task 1: Migration — journal document-type enum values + regenerated types

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_inventory-adjustment-gl-posting.sql` (via CLI)
- Modify: `packages/database/src/types.ts`, `packages/database/supabase/functions/lib/types.ts` — regenerated only, never hand-edited

**Steps:**
1. `pnpm db:migrate:new inventory-adjustment-gl-posting` (never hand-pick the timestamp; HHMMSS must not be `000000`).
2. File contents, exactly:
   ```sql
   -- Inventory adjustments and inventory counts now post GL journals
   -- (spec: .ai/specs/2026-07-14-inventory-adjustment-gl-posting.md).
   -- journalEntrySourceType already contains 'Inventory Adjustment' (20260402000000).
   ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Inventory Adjustment';
   ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Inventory Count';
   ```
3. `pnpm db:migrate` (applies to the local DB and regenerates types + swagger).
4. If step 3 did not regenerate types (no new migrations detected), run `pnpm run generate:types` explicitly.

**Verify:**
```bash
grep -n "Inventory Adjustment" packages/database/src/types.ts | head -3
# Expected: at least one hit inside the journalLineDocumentType enum union
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: 1 successful, 0 errors
```

**Out of scope:** no new tables, no RLS, no changes to `journalEntrySourceType` (value already exists).

---

## Task 2: Shared posting core `shared/post-adjustment.ts`

**Depends on:** Task 1
**Files:**
- Create: `packages/database/supabase/functions/shared/post-adjustment.ts`
- Create: `packages/database/supabase/functions/shared/post-adjustment.test.ts`
- Copy from (precedent): `packages/database/supabase/functions/post-shipment/index.ts:1140-1205` (COGS consumption + costLedger row + journal insert), `packages/database/supabase/functions/shared/calculate-cogs.ts` (layer filters), `packages/database/supabase/functions/issue/resolve-tracked-entity-bin.test.ts` (deno test shape)

**Steps:**
1. Export a pure function (unit-testable, no I/O):
   ```ts
   export function computeCurrentUnitCost(
     itemCost: { costingMethod: "Standard" | "Average" | "FIFO" | "LIFO"; unitCost: number | null; standardCost: number | null },
     openLayers: Array<{ quantity: number; remainingQuantity: number; cost: number; appliedChildCost: number }>
   ): number
   ```
   - `Standard` → `standardCost ?? 0`; `Average` → `unitCost ?? 0`.
   - `FIFO`/`LIFO` → `Σ(remainingQuantity × (cost + appliedChildCost) / quantity) / Σ remainingQuantity` over layers with `remainingQuantity > 0`; when there are no open layers (or Σ remaining is 0) fall back to `unitCost ?? 0`. Guard `quantity > 0` per layer (skip zero-quantity layers).
2. Export the booking function. It writes ONE movement (item ledger + optional cost layers + optional journal) inside the caller's transaction and returns what it wrote:
   ```ts
   import type { Transaction } from "kysely";
   import { DB } from "../lib/database.ts";

   export interface BookAdjustmentArgs {
     ledger: {
       postingDate: string;                       // yyyy-MM-dd (today)
       itemId: string;
       quantity: number;                          // SIGNED delta: >0 Positive Adjmt., <0 Negative Adjmt.
       locationId: string | null;
       storageUnitId: string | null;
       trackedEntityId: string | null;
       entryType: "Positive Adjmt." | "Negative Adjmt.";
       documentType?: "Inventory Count" | null;   // itemLedgerDocumentType enum — manual adjustments stay NULL
                                                  // (byte-identical ledger rows; 'Inventory Adjustment' exists only
                                                  // on journalLineDocumentType)
       documentId?: string | null;                // count id for counts; null for manual (backfilled with the ledger id)
       correctionOfItemLedgerId?: string | null;
       comment?: string | null;
       companyId: string;
       createdBy: string;
     };
     item: { itemTrackingType: string | null; replenishmentSystem: "Buy" | "Make" | "Buy and Make" | null };
     itemCost: { costingMethod: "Standard" | "Average" | "FIFO" | "LIFO"; unitCost: number | null; standardCost: number | null };
     accounting: {
       accountingPeriodId: string;
       accountDefaults: { rawMaterialsAccount: string; finishedGoodsAccount: string; inventoryAdjustmentVarianceAccount: string };
       description: string;                       // journal description, e.g. `Inventory Count IC-000042`
       userId: string;
     } | null;                                    // null ⇒ accountingEnabled=false: ledger + layers only
     skipValuation?: boolean;                     // true for storage-unit-transfer legs: ledger row ONLY
   }
   export async function bookAdjustment(trx: Transaction<DB>, args: BookAdjustmentArgs):
     Promise<{ itemLedgerId: string; journalId: string | null; cost: number }>
   ```
   Behavior, in order:
   a. Insert the `itemLedger` row (all `ledger` fields verbatim), `returning(["id"])`.
   b. If `skipValuation` or `item.itemTrackingType === "Non-Inventory"` → return `{ itemLedgerId, journalId: null, cost: 0 }` (no layers, no journal).
   c. **Cost layers (always, even when `accounting` is null — the post-receipt precedent):**
      - `quantity < 0`: `const cogs = await calculateCOGS(trx, { itemId, quantity: Math.abs(quantity), companyId })` (import from `../shared/calculate-cogs.ts`), then insert the consumption `costLedger` row exactly like `post-shipment/index.ts:1163-1180`: `{ itemLedgerType: ledger.entryType, costLedgerType: "Direct Cost", adjustment: false, documentType: ledger.documentType ?? null, documentId, itemId, quantity: -abs, cost: -cogs.totalCost, remainingQuantity: 0, companyId }` (NOTE: `costPostedToGL` was dropped from `costLedger` — do not set it). `cost = cogs.totalCost`.
      - `quantity > 0`: query open layers with the SAME filters `calculateCOGS` uses (`remainingQuantity > 0`, `adjustment = false`, `appliesToCostLedgerId is null`, `documentType` null-or-not-`'Purchase Order'`) plus, per layer, the applied-children sum (`SUM(cost)` of rows whose `appliesToCostLedgerId` = layer id) — then `unitCost = computeCurrentUnitCost(itemCost, layers)`; insert a NEW layer: `{ itemLedgerType: ledger.entryType, costLedgerType: "Direct Cost", adjustment: false, documentType: ledger.documentType ?? null, documentId, itemId, quantity: abs, cost: abs × unitCost, remainingQuantity: abs, companyId }`. `cost = abs × unitCost`.
   d. **Journal** — only when `accounting !== null` AND `cost > 0` (a zero-value movement posts no journal):
      - `const journalEntryId = await getNextSequence(trx, "journalEntry", companyId)` (import from `./get-next-sequence.ts`).
      - Insert `journal` exactly like `post-shipment/index.ts:1184-1200`: `{ journalEntryId, accountingPeriodId, description, postingDate: ledger.postingDate, companyId, sourceType: "Inventory Adjustment", status: "Posted", postedAt: new Date().toISOString(), postedBy: accounting.userId, createdBy: accounting.userId }`, returning `id`.
      - Resolve the inventory side with `resolveInventoryAccount(item.replenishmentSystem, accounting.accountDefaults)` (import from `./get-posting-group.ts`).
      - Insert two `journalLine` rows sharing one `journalLineReference` (use `nanoid` exactly as `post-receipt/index.ts` imports it), both with `documentType: ledger.documentType ?? "Inventory Adjustment"`, `documentId` (the count id, else the new itemLedger id), `quantity: Math.abs(ledger.quantity)`, `companyId`, and amounts via the `debit`/`credit` helpers from `../lib/utils.ts`:
        - `quantity > 0` (gain): inventory account `debit("asset", cost)` with the resolved account description; 5310 (`inventoryAdjustmentVarianceAccount`) `credit("expense", cost)` with description `"Inventory Adjustment"`.
        - `quantity < 0` (loss): 5310 `debit("expense", cost)`; inventory account `credit("asset", cost)`.
      - `accountId` column, never account number (lesson: control accounts resolve by id).
   e. Return `{ itemLedgerId, journalId, cost }`.
3. `post-adjustment.test.ts`: deno tests for `computeCurrentUnitCost` only (shape copied from `issue/resolve-tracked-entity-bin.test.ts`): Standard, Average, FIFO weighted-average with applied children (layers 60 rem @ base $10 qty 100 + child $55 ⇒ effective (60×10.55)/60 = 10.55), no-open-layers fallback, zero-quantity-layer skip.

**Verify:**
```bash
cd packages/database/supabase/functions && deno check shared/post-adjustment.ts && deno test shared/post-adjustment.test.ts
# Expected: check passes; test output ends with "ok" and 0 failed
```

**Out of scope:** tracked-entity mutations (each caller owns them); no HTTP handling; do not modify `calculate-cogs.ts`.
If `deno` is unavailable on this machine, STOP and report — do not skip the check.

---

## Task 3: New edge function `post-inventory-adjustment`

**Depends on:** Task 2
**Files:**
- Create: `packages/database/supabase/functions/post-inventory-adjustment/index.ts`
- Modify: `packages/database/supabase/config.toml` — add function entry
- Copy from (precedent): `packages/database/supabase/functions/post-inventory-count/index.ts` (skeleton, error contract, FOR-UPDATE txn style), `apps/erp/app/modules/inventory/inventory.service.ts:1442-1834` (the semantics being ported, verbatim behavior)

**Steps:**
1. Skeleton per `.ai/rules/workflow-edge-function.md`: CORS OPTIONS short-circuit, module-scope `getConnectionPool(1)` + `getDatabaseClient`, try/catch returning `{ message }` with status 400 for business-validation failures and 500 otherwise (copy the error-contract comment block from `post-inventory-count/index.ts:219-246` so `getEdgeFunctionErrorMessage` keeps working).
2. Payload validator (zod):
   ```ts
   const payloadValidator = z.object({
     adjustmentType: z.enum(["Positive Adjmt.", "Negative Adjmt.", "Set Quantity"]),
     itemId: z.string(),
     locationId: z.string(),
     storageUnitId: z.string().optional().nullable(),
     trackedEntityId: z.string().optional().nullable(),
     quantity: z.number(),
     readableId: z.string().optional().nullable(),
     originalStorageUnitId: z.string().optional().nullable(),
     expirationDate: z.string().optional().nullable(),
     comment: z.string().optional().nullable(),
     companyId: z.string(),
     userId: z.string()
   });
   ```
3. `requirePermissions(req, companyId, userId, { update: "inventory" })`.
4. Preloads (supabase client, before the transaction): `get_item_quantities_by_tracking_id` RPC (`{ item_id, company_id, location_id }`), `item` (`itemTrackingType, replenishmentSystem, readableIdWithRevision`), `itemCost` (`costingMethod, unitCost, standardCost`), `companySettings.accountingEnabled`, `getDefaultPostingGroup(client, companyId)` (only when accounting enabled), `itemShelfLife` (`mode, days`), and — when accounting enabled — `getCurrentAccountingPeriod` with the same arguments `post-inventory-count`/`post-shipment` pass it.
5. Inside one `db.transaction()`, port `insertManualInventoryAdjustment` (`inventory.service.ts:1442-1834`) **verbatim in behavior**, replacing every `client.from("itemLedger").insert(...)` with `bookAdjustment(trx, ...)` and every trackedEntity read/write with `trx` equivalents:
   - **Storage-unit transfer** (trackedEntityId + originalStorageUnitId ≠ storageUnitId, lines 1537-1606): optional `readableId` update; expiry override; then TWO `bookAdjustment` calls with `skipValuation: true` — negative `-currentQuantityOnHand` at `originalStorageUnitId`, positive `+currentQuantityOnHand` at `storageUnitId`.
   - **Set Quantity** (lines 1608-1633): delta = `quantity - currentQuantityOnHand`; >0 ⇒ Positive, <0 ⇒ Negative (absolute delta), =0 ⇒ apply readableId/expiry updates only and respond `{ success: true, itemLedger: null }`.
   - **Negative resolution** (lines 1643-1742): keep the three branches and these EXACT error strings (routes string-match them): `"Serial number not found"`, `"Insufficient quantity for negative adjustment"`, `"Multiple tracked entities in this storage unit — select a specific row to adjust"`. Tracked-entity quantity decrements stay as in the source (now via `trx`).
   - **Plain negative guard** (lines 1745-1752) and **tracked entity update/create** (lines 1754-1831) including: the `"Inventory Adjustment"` attributes stamp + `expiryOverrides` blob exactly as lines 1783-1804; new-entity expiry fallback from `itemShelfLife` `Fixed Duration` (lines 1473-1490); existing-entity expiry override replicating `updateTrackedEntityExpiry` semantics — locate that function in `inventory.service.ts` (grep `export async function updateTrackedEntityExpiry`) and reproduce its writes (update `expirationDate`, append to `attributes.expiryOverrides` with `{previous, next, reason, source: "Inventory Adjustment", userId, at}`).
   - **Final movement**: `bookAdjustment` with signed quantity, `documentType: null` (manual ledger rows keep today's NULL documentType; the JOURNAL lines get 'Inventory Adjustment' from the core), `documentId: null` (core backfills the ledger id), `accounting` context when enabled (`description: "Inventory Adjustment"` + `— ${comment}` when present).
6. Response: 200 `{ success: true, itemLedger: { id } }` (or `itemLedger: null` on the no-op path).
7. `config.toml`, after the `[functions.post-inventory-count]` block:
   ```toml
   [functions.post-inventory-adjustment]
   enabled = true
   verify_jwt = true
   entrypoint = "./functions/post-inventory-adjustment/index.ts"
   ```

**Verify:**
```bash
cd packages/database/supabase/functions && deno check post-inventory-adjustment/index.ts
# Expected: no errors
grep -A2 "post-inventory-adjustment" packages/database/supabase/config.toml
# Expected: enabled = true, verify_jwt = true
```

**Out of scope:** do not modify `post-inventory-count` here (Task 6); do not touch the ERP/MES services yet (Tasks 4–5).
If `get_item_quantities_by_tracking_id` cannot be invoked with the service-role client from the edge runtime, STOP and report — do not substitute a different quantity source.

---

## Task 4: ERP service wrapper delegates to the edge function

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — replace the body of `insertManualInventoryAdjustment` (lines 1442-1834) with an invoke; keep the exported signature IDENTICAL
- Copy from (precedent): the invoke + error-extraction pattern used by the inventory-count post route — grep `getEdgeFunctionErrorMessage` under `apps/erp/app/` and reuse that helper

**Steps:**
1. New body: map `createdBy` → `userId`, pass all validator fields + `companyId` in `body`, then
   `const result = await client.functions.invoke("post-inventory-adjustment", { body })`.
2. Return contract must stay drop-in for the caller (`routes/x+/inventory+/quantities+/$itemId.adjustment.tsx:106-118` compares `itemLedger.error === "<message>"` — the old service returned bare-STRING errors from its validation branches):
   - success → `{ data: result.data?.itemLedger ?? null, error: null }`
   - failure → `{ data: null, error: <string message> }` where the message is extracted from the response body via `getEdgeFunctionErrorMessage` (`apps/erp/app/utils/error.ts`), falling back to "Failed to create manual inventory adjustment".
3. Delete the now-dead local helpers (`resolveExpirationForNewEntity`, `applyExpirationOverride`) — but do NOT delete `updateTrackedEntityExpiry` (it has other callers).
4. Leave `inventoryAdjustmentValidator` in `inventory.models.ts` untouched (the form contract is unchanged).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 1 successful, 0 errors
grep -c "itemLedger" apps/erp/app/modules/inventory/inventory.service.ts
# Expected: fewer hits than before in the 1442-region (no direct itemLedger insert remains in insertManualInventoryAdjustment)
```

**Out of scope:** route files, forms, MES.

---

## Task 5: MES service wrapper delegates to the edge function

**Depends on:** Task 3 (independent of Task 4)
**Files:**
- Modify: `apps/mes/app/services/inventory.service.ts` — `insertManualInventoryAdjustment` (line 439) and nothing else

**Steps:**
1. Replace the direct `itemLedger` insert with an invoke of `post-inventory-adjustment`. Map the MES validator (line 36: `itemId, locationId, storageUnitId?, entryType, quantity`) to the payload: `adjustmentType: entryType`, quantity as-is (positive; the edge function owns sign normalization and the insufficient-quantity guard), `companyId`, `userId: createdBy`.
2. Same return-contract mapping as Task 4 (the MES route `x+/adjustment.tsx:32-43` string-matches the insufficient-quantity message).

**Verify:**
```bash
sed -n 's/.*"name": "\(.*\)".*/\1/p' apps/mes/package.json | head -1   # confirm the package name first
pnpm exec turbo run typecheck --filter=<that name>
# Expected: 1 successful, 0 errors
```

**Out of scope:** MES routes/components (`AdjustInventory.tsx` unchanged).

---

## Task 6: `post-inventory-count` books lines through the shared core

**Depends on:** Task 2 (independent of Tasks 3–5)
**Files:**
- Modify: `packages/database/supabase/functions/post-inventory-count/index.ts` — per-line loop (lines 144-190) + preloads + header comment

**Steps:**
1. Extend the preloads: the existing `item` query (line 99) additionally selects `replenishmentSystem`; add `itemCost` rows for the counted item ids; add `companySettings.accountingEnabled`; when enabled, `getDefaultPostingGroup` + `getCurrentAccountingPeriod` (same call shape as `post-shipment`).
2. In the transaction loop, replace the raw `trx.insertInto("itemLedger")` (lines 147-171) with `bookAdjustment(trx, ...)`:
   - `ledger`: same fields as today plus `documentType: "Inventory Count"`, `documentId: inventoryCountId`, `correctionOfItemLedgerId: line.postedItemLedgerId ?? null`, signed `quantity: delta`.
   - `accounting`: the preloaded context with `description: \`Inventory Count ${inventoryCount.data.inventoryCountId}\``, or `null` when accounting is disabled.
   - Keep the trackedEntity delta-apply (lines 175-182) and the `postedItemLedgerId` bookkeeping (lines 184-189, now using the returned `itemLedgerId`) EXACTLY as they are.
3. Update the header comment (lines 38-46): counts now maintain cost layers and post journals; remove the "no GL journal lines" sentence. Rectify semantics are unchanged (incremental delta, `correctionOfItemLedgerId` link, valued at posting-time cost).

**Verify:**
```bash
cd packages/database/supabase/functions && deno check post-inventory-count/index.ts
# Expected: no errors
grep -n "no GL journal lines" packages/database/supabase/functions/post-inventory-count/index.ts
# Expected: no matches
```

**Out of scope:** `plan-post.ts` (snapshot-delta reconciliation math is untouched); `rectifyInventoryCount` in the ERP service (already correct — it posts nothing).

---

## Task 7: Reconcile service + route

**Depends on:** none (parallel with Tasks 1–6)
**Files:**
- Modify: `apps/erp/app/modules/inventory/inventory.service.ts` — add `createInventoryReconciliationJournal`
- Create: `apps/erp/app/routes/x+/inventory+/valuation.reconcile.tsx` (action only)
- Modify: `apps/erp/app/utils/path.ts` — add `inventoryValuationReconcile`
- Copy from (precedent): `createIntercompanyTransaction` (`apps/erp/app/modules/accounting/accounting.service.ts:2967-3028`) for the journal + paired-line insert; `getInventoryValuationTieOut` (`inventory.service.ts:342`) for the variance rows

**Steps:**
1. Service function:
   ```ts
   export async function createInventoryReconciliationJournal(
     client: SupabaseClient<Database>,
     companyId: string,
     args: { asOfDate: string; userId: string }
   )
   ```
   - Call `getInventoryValuationTieOut(client, companyId, args.asOfDate)`; keep rows with `Math.abs(variance) > 0.005`. If none → return `{ data: null, error: { message: "Nothing to reconcile — variance is zero" } }`.
   - `getNextSequence(client, "journalEntry", companyId)` (same import `createIntercompanyTransaction` uses).
   - Insert ONE `journal`: `{ journalEntryId, description: \`Inventory subledger reconciliation as of ${asOfDate}\`, postingDate: <today>, sourceType: "Manual", status: "Draft", companyId, createdBy: userId }`.
   - Per variance row insert a `journalLine` pair sharing a `crypto.randomUUID()` reference (variance = subledger − GL, so this brings GL up to the subledger):
     - inventory account (`row.accountId`): `amount: +variance`
     - `accountDefault.inventoryAdjustmentVarianceAccount` (fetch by id from `accountDefault`): `amount: -variance`
     (positive amount on an Asset = debit, negative on an Expense = credit — the `journalEntries` view derives debit/credit from class + sign; the raw amounts sum to 0.)
   - Return `{ data: { journalId }, error: null }`.
2. Route `valuation.reconcile.tsx`: `assertIsPost`; `requirePermissions(request, { create: "accounting" })`; read `asOfDate` from formData (default today); call the service; on error `return data({}, await flash(request, error(...)))`; on success `throw redirect(<journals list>, await flash(request, success("Draft reconciliation journal created")))`. Find the journals-list helper with `grep -n "journal" apps/erp/app/utils/path.ts` — use the helper that maps to `routes/x+/accounting+/journals.tsx`.
3. `path.ts`: `inventoryValuationReconcile: ${x}/inventory/valuation/reconcile` next to the existing `inventoryValuation` entry.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 1 successful, 0 errors
```

**Out of scope:** no changes to `getInventoryValuationTieOut`, the valuation RPC, or the journals UI. The journal is Draft — never auto-post it.

---

## Task 8: Workbench Reconcile button + tie-out caveat copy

**Depends on:** Task 7
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Valuation/InventoryValuationWorkbench.tsx` — tie-out Popover (lines ~446-545)
- Copy from (precedent): this file's own Popover + any `fetcher.Form` submit button in `apps/erp/app/modules/invoicing/ui/Workbench/ARAPWorkbench.tsx`

**Steps:**
1. Inside the tie-out `PopoverContent`, after the totals row, add a `fetcher.Form` (`method="post"`, `action={path.to.inventoryValuationReconcile}`) with a hidden `asOfDate` input (the current filter value) and a `Button` labeled `t\`Reconcile\``, `isLoading` off the fetcher. Render only when `hasVariance && permissions.can("create", "accounting")` (`usePermissions`).
2. Remove the caveat string `"Manual quantity adjustments don't post to the GL yet, so a nonzero variance is expected if you cycle count."` entirely — NO replacement text (Brad, 2026-07-15); the popover shows only the Reconcile button when `hasVariance`.
3. All new strings through Lingui (`useLingui`/`<Trans>`); `/translate` fills catalogs at commit time via check-and-commit.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 1 successful, 0 errors
grep -n "don't post to the GL yet" apps/erp/app/modules/inventory/ui/Valuation/InventoryValuationWorkbench.tsx
# Expected: no matches
```

**Out of scope:** no layout redesign of the popover; no changes to the table or filters.

---

## Task 9: Rules / AGENTS.md / product-docs sync

**Depends on:** Tasks 3–8
**Files:**
- Modify: `.ai/rules/inventory-system.md` — `insertManualInventoryAdjustment` bullet: now a wrapper over the `post-inventory-adjustment` edge function; adjustments/counts maintain cost layers and post journals (5310 vs RM/FG); note the Reconcile action
- Modify: `apps/erp/app/modules/inventory/AGENTS.md` — same one-line update in Key Service Functions + Safety (still: never INSERT itemLedger directly)
- Modify: `docs/` — inventory adjustments + valuation report pages via the `carbon-docs` skill (ground every claim in the merged code)

**Steps:**
1. Update the two rule/AGENTS files with the new posting path (keep edits surgical — only lines that are now stale).
2. Invoke the `carbon-docs` skill for the docs site: adjustments now post journals; valuation tie-out Reconcile action. If the docs app fails to build for unrelated reasons, STOP and report.

**Verify:**
```bash
grep -n "post-inventory-adjustment" .ai/rules/inventory-system.md apps/erp/app/modules/inventory/AGENTS.md
# Expected: at least one hit in each file
```

**Out of scope:** root AGENTS.md Task Router (no new subsystem file).

---

## Task 10: End-to-end verification (browser via /test + SQL spot checks)

**Depends on:** Tasks 1–8 (Task 9 may run in parallel)
**Files:** none (verification only)

**Steps:**
1. Prerequisites: local stack running (`crbn up`, plain portless form); accounting enabled for the dev company (toggle at `/x/settings/accounting` — a fresh `crbn reset` seeds it off).
2. Invoke the `/test` skill with these scenarios (it handles `/auth` login):
   a. ERP → Inventory → Quantities → adjust an untracked Buy item −N and +N; expect success toasts.
   b. ERP → Accounting → Journals: two new Posted journals with source "Inventory Adjustment" — loss = Dr Inventory Adjustment / Cr Raw Materials, gain mirrored.
   c. ERP → Inventory → Valuation: tie-out variance for Raw Materials still $0.00 after both adjustments; old caveat copy gone.
   d. Inventory Count: create, count one line with a variance, post; journal appears with the count's readable id in the description. Rectify → change the count → re-post; second linked movement appears in the count's movements list.
   e. Storage-unit transfer: move a tracked batch between two bins from the quantities page; expect the ledger pair in the item's movements, NO new journal (Journals list count unchanged), and tie-out variance unchanged.
   f. MES (`https://<worktree>.mes.dev`): shop-floor adjustment posts the same journal shape.
   g. Tie-out Reconcile: only if a nonzero variance exists (e.g. seeded pre-feature adjustment) — button creates a Draft journal and redirects to Journals; tie-out unchanged until that journal is posted.
3. SQL spot checks against the local DB (connection string from `.env.local`):
   ```sql
   -- balanced journals, layer integrity for the adjusted item
   SELECT "journalId", SUM("amount") FROM "journalLine" WHERE "documentType" = 'Inventory Adjustment' GROUP BY "journalId";
   -- Expected: every SUM = 0
   SELECT "remainingQuantity" >= 0 FROM "costLedger" WHERE "itemId" = '<adjusted item>' ORDER BY "createdAt" DESC LIMIT 5;
   -- Expected: all true
   ```
4. Check off the Progress list in this plan file; record evidence (screenshots from /test) in `.ai/runs/`.

**Verify:**
```bash
# /test run completes with all scenarios PASS; the two SQL checks return expected values.
```

**Out of scope:** performance load-testing the count post; period-close concurrency testing (covered by the existing `FOR SHARE` guard migration).
