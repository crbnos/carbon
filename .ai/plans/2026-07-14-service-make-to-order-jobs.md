# Service Make-to-Order Jobs — implementation plan

**Spec:** .ai/specs/2026-07-14-service-make-to-order-jobs.md
**Research:** .ai/research/service-make-to-order-jobs.md
**Branch:** feat/service

## Progress
- [x] Task 1: Migration — restore the Non-Inventory branch in `complete_job_to_inventory` (commit d10c1d12e)
- [x] Task 2: Confirm generated types are unaffected (do NOT regenerate) — verified untouched, no commit needed
- [x] Task 3: Harden `convertSalesOrderLinesToJobs` for service lines (commit 00e75c435; pre-existing TS2589 in part+ delete route proven on clean tree, unrelated)
- [x] Task 4: Fulfillment helper — service job completion advances the sales-order line (commit 501dfd657)
- [x] Task 5: Validation gates — lint 32/32 PASS (13 pre-existing warnings); typecheck erp: only the pre-existing TS2589 (proven on clean tree)
- [x] Task 6: Browser e2e — full service MTO flow, run by Brad 2026-07-14 (fixtures: process `proc_svc_e2e_assembly1`, work center `wc_svc_e2e_bench1` laborRate 50/overhead 10). Results: SO000001 / J000001 — labor+overhead accumulated Dr WIP 0.8333; completion posted exactly Dr COGS 0.8333 / Cr WIP 0.8333; zero itemLedger "Assembly Output" and zero costLedger rows for the job; SO line quantitySent 1 / sentComplete ✓ / sentDate 2026-07-14 (after Task 8 backfill). Findings spawned Tasks 7–9; zero-cost material issue confirmed as inherited behavior (documented in spec changelog).
- [x] Task 7 (e2e finding, commit b68962287): show the "Jobs Required" card for all-service orders
- [x] Task 9 (e2e finding, commit 29648a179): MES IssueMaterialModal — 'Non-Inventory' missing from its TrackingType union sent consumables/services into the Serial/Batch branch (no quantity field, unsubmittable); now routed through the untracked ValidatedForm branch
- [x] Task 8 (e2e finding, commit 6c6565d0c): fulfillment moved INTO `complete_job_to_inventory` — completion is also reachable via the `sync_finish_job_operation` interceptor (auto-complete on last operation Done), which bypassed the route-level hook; the SQL function is the only choke point. TS helper + route hook removed; migration edited in place (never pushed) and re-applied; validation script extended with fulfillment assert (green); Brad's live line backfilled by idempotent re-run (no duplicate journal) — `getSalesOrderStatus` counts Service lines as shipped, so a service-only order confirms straight to "To Invoice" and `SalesOrderSummary`'s status gate `["To Ship and Invoice","To Ship"]` never matches. Fix: also render at "To Invoice" when a line is `salesOrderLineType === "Service" && methodType === "Make to Order"` (physical-order behavior unchanged). File: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderSummary.tsx`. Verify: typecheck erp + Brad's browser session shows the card on SO000001.

## Dependencies
- Task 2 needs Task 1 (migration exists).
- Tasks 3 and 4 are independent of each other and of Task 1 (may run in parallel).
- Task 5 needs Tasks 3–4. Task 6 needs Tasks 1–5 (migration applied locally + code in tree).

## Grounding notes for the executor (verified 2026-07-14 — trust these over older docs)

- The NEWEST `complete_job_to_inventory` definition is in
  `packages/database/supabase/migrations/20260713222236_fix-job-completion-overhead-absorption.sql`
  (637 lines; `DROP FUNCTION IF EXISTS` at line 22, `CREATE OR REPLACE` at line 24). It has NO
  `itemTrackingType` handling — that is the regression being fixed.
- The dropped Non-Inventory branch template is
  `packages/database/supabase/migrations/20260707022142_complete-job-to-inventory-non-inventory.sql`
  (fork of an older baseline; use it as REFERENCE for guard placement only — never copy its body,
  it predates the raw-materials/FG split and overhead absorption).
- `sync_create_item_related_records` (newest: `20260501190700`) inserts `itemCost`,
  `itemReplenishment`, `itemUnitSalePrice`, `itemPlanning` for EVERY item insert, ungated by type —
  so services DO have `itemReplenishment` rows (with NULL lotSize/scrapPercentage). The converter's
  `.single()` succeeds today and its error was never checked; Task 3 is hardening, not a hard-bug fix.
- `getDefaultStorageUnitForJob` (`apps/erp/app/modules/inventory/inventory.service.ts:2679`) is
  null-safe for services (maybeSingle + empty-list fallthrough). Skipping it for services is an
  optimization + intent-clarity change.
- The ERP app's package name is `erp` (`apps/erp/package.json`) — typecheck filter is `--filter=erp`.
- **Do NOT run `pnpm run generate:types` / `db:types` and commit the result**: committed
  `packages/database/src/types.ts` is generated from the CLOUD DB (contains per-company tables);
  local regeneration produces a ~55k-line wrong diff. This migration changes no schema and no RPC
  signature, so no type change is needed.
- Local dev boots with plain `crbn up` (portless `*.dev`). After `crbn reset`, accounting is
  DISABLED (`companySettings.accountingEnabled = false`) — enable it at `/x/settings/accounting`
  before asserting journals.

---

## Task 1: Migration — restore the Non-Inventory branch in `complete_job_to_inventory`

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_service-job-completion-cogs.sql`
  (created via `pnpm db:migrate:new service-job-completion-cogs`; if the generated timestamp ends
  in `000000`, rename the HHMMSS portion to a random value, e.g. `143752`)
- Copy from (fork source): `packages/database/supabase/migrations/20260713222236_fix-job-completion-overhead-absorption.sql`
- Copy from (guard reference only): `packages/database/supabase/migrations/20260707022142_complete-job-to-inventory-non-inventory.sql`

**Steps:**

1. Create the file: `pnpm db:migrate:new service-job-completion-cogs`.

2. Extract the fork source body VERBATIM (per the `.ai/lessons.md` function-fork rule — sed, don't retype):
   ```bash
   sed -n '22,637p' packages/database/supabase/migrations/20260713222236_fix-job-completion-overhead-absorption.sql >> packages/database/supabase/migrations/<timestamp>_service-job-completion-cogs.sql
   ```
   This gives you `DROP FUNCTION IF EXISTS complete_job_to_inventory(TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT);`
   followed by the full `CREATE OR REPLACE FUNCTION` — signature, `SECURITY DEFINER`,
   `SET search_path = public` all preserved. Keep them EXACTLY as extracted.

3. Prepend a header comment (above the DROP) explaining:
   - Fork of `20260713222236` (the newest definition).
   - Restores the Non-Inventory branch originally added in `20260707022142` and silently dropped
     when the July-13 migrations forked from the older `20260630092517` baseline.
   - Non-Inventory (Service) completions: WIP discharges to COGS, no inventory artifacts.
   - Inventory items are byte-identical to `20260713222236`.

4. Apply EXACTLY these edits to the extracted body (line references are to the fork source, i.e.
   the extracted text before your edits):

   a. **DECLARE block** (after line 38 `v_item_id TEXT;`): add two declarations:
      ```sql
      v_item_tracking_type "itemTrackingType";
      v_cogs_account TEXT;
      ```

   b. **After the job-details fetch** (after line 92 `WHERE id = p_job_id;` of the first
      `SELECT ... INTO STRICT`): add:
      ```sql
      -- Non-Inventory items (services) never enter inventory
      SELECT "itemTrackingType"
      INTO v_item_tracking_type
      FROM "item"
      WHERE id = v_item_id
        AND "companyId" = p_company_id;
      ```

   c. **Guard the itemLedger block** (lines 113–169: the whole
      `IF v_job_make_method."requiresBatchTracking" THEN ... ELSIF ... ELSE ... END IF;` that
      inserts `'Assembly Output'` rows): wrap it in
      ```sql
      IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' THEN
        <existing batch/serial/else itemLedger block, unchanged>
      END IF;
      ```

   d. **Guard the pickMethod block** (lines 171–201, `-- Update pickMethod defaultStorageUnitId if needed`):
      change its outer condition from
      `IF p_storage_unit_id IS NOT NULL AND p_location_id IS NOT NULL THEN` to
      `IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' AND p_storage_unit_id IS NOT NULL AND p_location_id IS NOT NULL THEN`.

   e. **Extend the accountDefault fetch** (lines 225–228): add `"costOfGoodsSoldAccount"` to the
      SELECT list and `v_cogs_account` to the INTO list:
      ```sql
      SELECT "rawMaterialsAccount", "finishedGoodsAccount", "workInProgressAccount", "laborAbsorptionAccount", "overheadAbsorptionAccount", "costOfGoodsSoldAccount"
      INTO STRICT v_raw_materials_account, v_finished_goods_account, v_wip_account, v_labor_absorption_account, v_overhead_absorption_account, v_cogs_account
      FROM "accountDefault"
      WHERE "companyId" = p_company_id;
      ```

   f. **Override the debit account for Non-Inventory** — immediately AFTER the RM/FG resolution
      SELECT (lines 230–238, the `CASE WHEN i."replenishmentSystem" = 'Buy' ...` block), add:
      ```sql
      -- Non-Inventory (Service): the produced output is never stocked, so completion
      -- relieves WIP straight to Cost of Goods Sold (Epicor "Make Direct" pattern).
      -- >>> REV-REC SEAM (spec .ai/specs/2026-07-04-revenue-recognition.md, issue #1048):
      -- when revenue recognition lands, Percent-of-Completion elements will gate THIS
      -- branch off and post COGS as-incurred in the recognition run instead. <<<
      IF v_item_tracking_type = 'Non-Inventory' THEN
        v_item_inventory_account := v_cogs_account;
        v_item_inventory_description := 'Cost of Goods Sold';
      END IF;
      ```
      (The existing `-- DR Inventory ...` journalLine insert at lines 531–542 then posts
      Dr COGS / Cr WIP for services with NO further changes — the journal insert itself is untouched.)

   g. **Guard the costLedger insert** (lines 561–571, `-- Write costLedger entry for finished good`):
      wrap in `IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' THEN ... END IF;`.

   h. **Guard the itemCost update but KEEP the itemCost read** (lines 573–605): the
      `SELECT "costingMethod", "unitCost", "itemPostingGroupId" INTO ...` (lines 574–578) must stay
      UNGUARDED — `v_item_posting_group_id` feeds the dimension inserts at lines 607–635 and the
      division below it would be reached otherwise. Wrap ONLY from
      `v_new_per_unit_cost := v_accumulated_wip_cost / v_quantity_received_to_inventory;` (line 580)
      through the end of the `ELSIF v_costing_method IN ('FIFO', 'LIFO') ... END IF;` block (line 605) in
      `IF v_item_tracking_type IS DISTINCT FROM 'Non-Inventory' THEN ... END IF;`.
      (This also protects the service path from a divide-by-zero when
      `v_quantity_received_to_inventory` is 0 on a re-completion.)

   i. Make NO other edits. In particular: the job-status UPDATE, backflush PERFORM, the
      production-event catch-up loop (lines 254–466), the WIP-accumulation query, the journal/journalLine
      inserts, and the dimension loop all stay byte-identical.

5. Apply locally: `pnpm db:migrate` (requires the local stack from `crbn up`; if the DB is
   unreachable, STOP and report — do not attempt `db:build`, it does not exist, and never rebuild
   the DB yourself).

**Verify:**
```bash
# 1. Structural check — the new definition has the branch and kept the July-13 logic:
psql "$SUPABASE_DB_URL_LOCAL" -c "SELECT pg_get_functiondef('complete_job_to_inventory(text,numeric,text,text,text,text)'::regprocedure);" | grep -cE "Non-Inventory|costOfGoodsSoldAccount|overheadRate|rawMaterialsAccount"
# Expected: >= 4 lines matched (all four markers present: the new branch AND the preserved
# overhead + RM/FG logic). Get the local DB URL from .env.local (SUPABASE_DB_URL / PORT_DB).

# 2. Idempotency — re-apply the file over the applied state:
psql "$SUPABASE_DB_URL_LOCAL" -v ON_ERROR_STOP=1 -f packages/database/supabase/migrations/<timestamp>_service-job-completion-cogs.sql
# Expected: exit 0 (DROP IF EXISTS + CREATE OR REPLACE is safely re-runnable).

# 3. Rolled-back behavioral validation (the memory-approved pattern: BEGIN/asserts/ROLLBACK as
#    supabase_admin). Write a scratch script .ai/scratch/validate-service-completion.sql that:
#    BEGIN;
#      -- fixture: pick an existing company with accountingEnabled=true (or set it),
#      --   one Non-Inventory item (a Service) + one Inventory 'Make' item (a Part),
#      --   insert a job + jobMakeMethod row for each, insert one posted WIP journalLine
#      --   (accountId = accountDefault."workInProgressAccount", documentId = job id, amount 100);
#      -- run: SELECT complete_job_to_inventory('<service-job>', 1, NULL, NULL, '<companyId>', '<userId>');
#      -- assert (each via SELECT ... ; \gset + \if or just visual DO $$ RAISE EXCEPTION):
#      --   A. journalLine exists: accountId = accountDefault."costOfGoodsSoldAccount",
#      --      amount = 100, documentType 'Job Receipt', documentId = <service-job>;
#      --   B. NO itemLedger row with documentId = <service-job>;
#      --   C. NO costLedger row with documentId = <service-job>;
#      -- run: SELECT complete_job_to_inventory('<part-job>', 1, NULL, '<locationId>', '<companyId>', '<userId>');
#      -- assert: D. journalLine debit hits accountDefault."finishedGoodsAccount" and an
#      --   itemLedger 'Assembly Output' row EXISTS for <part-job>;
#    ROLLBACK;
# Expected: all asserts pass, transaction rolls back leaving no residue.
```

**Out of scope:** Do NOT touch `backflush_job_materials`, `close-job`, `post-shipment`, or any
applied migration file (everything on main is applied — fix forward only). Do NOT add
rev-rec columns/enums (spec OQ-2). If the fork source file's content differs from the line
references above (e.g. the branch has moved on), STOP and report — do not improvise the merge.

---

## Task 2: Confirm generated types are unaffected (do NOT regenerate)

**Depends on:** Task 1
**Files:**
- None modified. (Guard task.)

**Steps:**
1. The migration redefines one SQL function with an UNCHANGED signature and touches no
   table/column/enum, so `packages/database/src/types.ts` needs no change.
2. Per the types-are-cloud-generated rule (grounding notes), do NOT run `pnpm run generate:types`
   and commit its output — it would produce a huge wrong diff from the local DB.

**Verify:**
```bash
git status --porcelain packages/database/src/types.ts
# Expected: empty output (file untouched).
grep -n "complete_job_to_inventory" packages/database/src/types.ts | head -2
# Expected: the existing RPC entry with Args p_job_id/p_quantity_complete/... — unchanged.
```

**Out of scope:** Committing any regenerated types.ts.

---

## Task 3: Harden `convertSalesOrderLinesToJobs` for service lines

**Depends on:** none (parallel with Tasks 1, 4)
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — `convertSalesOrderLinesToJobs`
  (function starts at line 85; the loop body at lines 138–221)

**Steps:**
1. At lines 140–145, change the `itemReplenishment` read from `.single()` to `.maybeSingle()`
   (services get an auto-created row via the item interceptor, but with `.single()` any
   future missing-row case surfaces as an unchecked error object; `.maybeSingle()` states the
   intent and matches `insertJob`'s own read at line ~2673). The existing
   `manufacturing.data?.lotSize ?? 0` / `?.scrapPercentage ?? 0` / `?.leadTime ?? 7` defaults
   already handle NULLs — leave them.
2. Guard the storage-unit resolution (lines 190–195): services are Non-Inventory and never have
   storage units. Replace with:
   ```ts
   const storageUnitId =
     line.salesOrderLineType === "Service"
       ? null
       : await getDefaultStorageUnitForJob(client, line.itemId, locationId!, companyId);
   ```
   (`salesOrderLineType` mirrors the item's type on the `salesOrderLines` view; a Service item's
   line carries `"Service"`.)
3. Make no other changes to the function — the `methodType === "Make to Order"` filter (line 139),
   lot-splitting, priority, `get-method` invocation, and `recalculate` calls are correct for
   services as-is.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0, "Tasks: 1 successful" (or cached equivalents); no new type errors.
```

**Out of scope:** `insertJob` (already uses `maybeSingle`), the per-line `$orderId.$lineId.job.tsx`
route, scrap logic for inventory items, and any UI file.

---

## Task 4: Fulfillment helper — service job completion advances the sales-order line

**Depends on:** none (parallel with Tasks 1, 3)
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — add `advanceServiceLineFulfillment`
- Modify: `apps/erp/app/routes/x+/job+/$jobId.complete.tsx` — call it after the RPC succeeds
- Copy from (precedent for the update shape): `packages/database/supabase/functions/post-shipment/index.ts`
  lines 494–546 (`quantitySent` accumulate → `sentComplete` → `sentDate` only when newly complete)

**Steps:**
1. In `production.service.ts`, add (near `insertJob`, keeping one service file per module):
   ```ts
   /**
    * Services never ship, so job completion is the fulfillment event: advance the
    * linked sales-order line the way post-shipment does for physical lines.
    * Recomputes quantitySent from ALL jobs on the line (idempotent; supports
    * multiple lot-split jobs and repeated completions).
    */
   export async function advanceServiceLineFulfillment(
     client: SupabaseClient<Database>,
     {
       jobId,
       companyId,
       userId
     }: { jobId: string; companyId: string; userId: string }
   ) {
     const job = await client
       .from("job")
       .select("id, itemId, salesOrderLineId, quantityComplete")
       .eq("id", jobId)
       .eq("companyId", companyId)
       .maybeSingle();
     if (job.error || !job.data?.salesOrderLineId || !job.data.itemId) {
       return { data: null, error: job.error };
     }

     const item = await client
       .from("item")
       .select("itemTrackingType")
       .eq("id", job.data.itemId)
       .eq("companyId", companyId)
       .maybeSingle();
     if (item.error || item.data?.itemTrackingType !== "Non-Inventory") {
       return { data: null, error: item.error };
     }

     const [line, jobs] = await Promise.all([
       client
         .from("salesOrderLine")
         .select("id, saleQuantity, quantitySent, sentComplete, sentDate")
         .eq("id", job.data.salesOrderLineId)
         .eq("companyId", companyId)
         .single(),
       client
         .from("job")
         .select("quantityComplete")
         .eq("salesOrderLineId", job.data.salesOrderLineId)
         .eq("companyId", companyId)
     ]);
     if (line.error) return line;
     if (jobs.error) return jobs;

     const quantitySent = (jobs.data ?? []).reduce(
       (sum, j) => sum + (j.quantityComplete ?? 0),
       0
     );
     const saleQuantity = line.data.saleQuantity ?? 0;
     const sentComplete = saleQuantity > 0 && quantitySent >= saleQuantity;

     return client
       .from("salesOrderLine")
       .update({
         quantitySent,
         sentComplete,
         ...(sentComplete && !line.data.sentDate
           ? { sentDate: today(getLocalTimeZone()).toString() }
           : {}),
         updatedBy: userId,
         updatedAt: today(getLocalTimeZone()).toString()
       })
       .eq("id", line.data.id)
       .eq("companyId", companyId)
       .select("id")
       .single();
   }
   ```
   `today`/`getLocalTimeZone` are already imported in `production.service.ts` from
   `@internationalized/date` (used by `insertJob`'s date math via `parseDate`; add
   `today, getLocalTimeZone` to that import if not present).
2. In `$jobId.complete.tsx`, after the successful RPC (line 56, before the success redirect):
   ```ts
   const fulfillment = await advanceServiceLineFulfillment(client, {
     jobId,
     companyId,
     userId
   });
   if (fulfillment.error) {
     throw redirect(
       requestReferrer(request) ?? path.to.job(jobId),
       await flash(
         request,
         error(
           fulfillment.error,
           "Job completed, but failed to update the sales order line"
         )
       )
     );
   }
   ```
   Import `advanceServiceLineFulfillment` from `~/modules/production`.
3. Confirm the export flows through the module barrel (`apps/erp/app/modules/production/index.ts`
   re-exports `./production.service` — verify, add if missing).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0; no new type errors.
grep -n "advanceServiceLineFulfillment" apps/erp/app/routes/x+/job+/\$jobId.complete.tsx apps/erp/app/modules/production/production.service.ts
# Expected: definition in production.service.ts + one call site in the route.
```

**Out of scope:** Do NOT write `job.quantityShipped` (the route's comment at lines 36–41 explains
why — it zeroes the shipment builder for physical jobs). Do NOT touch `post-shipment`. Do NOT
advance fulfillment for Inventory items (shipments own that).

---

## Task 5: Validation gates — lint + scoped typecheck

**Depends on:** Tasks 3, 4
**Files:** none (gate)

**Steps:**
1. Run the repo lint and the scoped typecheck.

**Verify:**
```bash
pnpm run lint
# Expected: exits 0 (Biome; no new errors — warnings pre-existing on the branch are acceptable).
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0.
```

**Out of scope:** whole-repo typecheck (OOMs — never run `tsc --noEmit` at the root),
`pnpm run build`, unit-test suites (no unit-testable surface changed; the SQL behavior is
covered by Task 1's rolled-back validation and Task 6's e2e).

---

## Task 6: Browser e2e — full service MTO flow with GL/psql assertions

**Depends on:** Tasks 1–5 (migration applied locally, code in tree)
**Files:** none (verification; playbook may be cached to `.ai/playbooks/` by /test)

**Steps:**
1. Ensure the local stack is up: `crbn up` (plain, portless — the app lands on `erp.<worktree>.dev`).
   If the stack cannot boot, the task is BLOCKED, not done — report it.
2. Enable accounting for the dev company if disabled: log in (use the `/auth` skill), visit
   `/x/settings/accounting`, toggle accounting on. (Fresh/reset stacks seed it off; without it no
   journals post and every GL assert fails vacuously.)
3. Invoke the `/test` skill with this scenario (it uses agent-browser; RVF forms submit via
   `requestSubmit`, blur react-aria number fields to commit values):
   a. Create a work center with `laborRate > 0` (or reuse an existing one that has a rate).
   b. Create a new **Service** item with Replenishment = **Make** (verify the form shows
      `defaultMethodType` locked to Make to Order). On its Details page add one BOM routing
      operation using that work center.
   c. Create a sales order for any customer; add a line with type **Service** selecting the new
      item; verify the line's Method shows **Make to Order** and save.
   d. On the order summary, click **Create Jobs** (or use the line-detail "Make to Order" button);
      verify a job is created and linked to the line without an error toast.
   e. Open the job, release it, and record a production event (labor time) against its operation
      so the job accumulates WIP cost.
   f. Complete the job (quantity = the line quantity).
   g. Verify in the UI: the job shows Completed; the sales order line shows fulfilled/delivered
      state; the sales order is not blocked from invoicing.
4. Assert the GL + ledger state via psql (get the DB URL/port from `.env.local`):
   ```sql
   -- the job id:
   SELECT id FROM "job" WHERE "jobId" = '<readable job id from UI>';
   -- A. WIP accumulated from the labor event (Dr WIP, documentId = job id):
   SELECT COUNT(*) FROM "journalLine" WHERE "documentId" = '<job id>' AND amount > 0 AND description LIKE 'WIP%';
   -- Expected: >= 1
   -- B. Completion posted Dr COGS / Cr WIP and NOT Finished Goods:
   SELECT jl.description, jl.amount FROM "journalLine" jl WHERE jl."documentId" = '<job id>' AND jl."documentType" = 'Job Receipt';
   -- Expected: exactly two rows — 'Cost of Goods Sold' (+N) and 'WIP Account' (−N); NO 'Finished Goods Account' row.
   -- C. No inventory artifacts:
   SELECT COUNT(*) FROM "itemLedger" WHERE "documentId" = '<job id>';   -- Expected: 0
   SELECT COUNT(*) FROM "costLedger" WHERE "documentId" = '<job id>';   -- Expected: 0
   -- D. Line fulfillment advanced:
   SELECT "quantitySent", "sentComplete", "sentDate" FROM "salesOrderLine" WHERE id = '<line id>';
   -- Expected: quantitySent = completed qty, sentComplete = true, sentDate = today.
   ```
5. **Regression guard (Parts still post to Finished Goods):** complete a Make-to-Order **Part**
   job (create a minimal Part + SO line + job the same way, or reuse an existing draft job in the
   seed data), then:
   ```sql
   SELECT jl.description FROM "journalLine" jl WHERE jl."documentId" = '<part job id>' AND jl."documentType" = 'Job Receipt';
   -- Expected: 'Finished Goods Account' (+) and 'WIP Account' (−).
   SELECT COUNT(*) FROM "itemLedger" WHERE "documentId" = '<part job id>' AND "entryType" = 'Assembly Output';
   -- Expected: 1 (or the tracked-entity count for batch/serial items).
   ```
6. Capture screenshots of: the service line's Jobs card, the completed job, the fulfilled SO line
   (for the PR per the surface-designs-with-screenshots convention).

**Verify:**
```bash
# The /test run's transcript + the psql outputs above ARE the verification.
# Expected: every assert in steps 4–5 matches; screenshots saved.
```

**Out of scope:** invoicing/AR assertions beyond "not blocked" (revenue posting is unchanged),
MES flows, performance, and any cleanup migration for pre-fix phantom FG rows (documented
limitation in the spec).
