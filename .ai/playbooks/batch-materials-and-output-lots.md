# Batch Materials & Output Lots

Last tested: 2026-09-16 (feat/batch-materials-and-output-lots — re-verified on a clean `crbn up` stack)
Routes: ERP `/x/resources/processes/$processId` (Produced item rule), `/x/production/batches/$batchId` (Merge output lots); MES `/x/operation/$operationId` (batch materials annotation + Batch Number column)
Edge fns: `issue` (`trackedEntitiesToBatch`, `jobOperationBatchOutput`, `mergeTrackedEntities`), `batch-operations` (`complete` with `trackedEntityId`/`batchNumber` member fields)

## Strategy

Same split as `job-operation-batching.md`: UI (agent-browser) for the process
rule row, the MES annotation, and the completion modal; edge fn `curl` +
SQL for every mutation proof. All logic proofs are DB-level.

## Prerequisites / seeding

On top of the batching playbook's seeding gotchas:
- Produced items and the input item need `itemTrackingType='Batch'`;
  `jobMakeMethod.requiresBatchTracking=true` per member.
- Each member needs a WIP `trackedEntity` (`status='Reserved'`, quantity 0,
  `attributes: {"Job Make Method": <jmmId>, "Job": <jobId>}`) — outputs finalize
  into it, and the shared pick books consumption against it.
- The input lot needs an `itemLedger` `Positive Adjmt.` row (bin resolution).
- **`itemCost` rows are mandatory** for every seeded item when
  `companySettings.accountingEnabled` — `calculateCOGS` throws "no result"
  without them (first observed failure mode).
- enum values: `methodType='Pull from Inventory'`, `operationType='Process'`,
  `processType='Process'`.

## Steps

### 1. producedItem compatibility rule
- SQL: `update process set "batchRules"='{"producedItem":"must"}'`.
- Edge fn `batch-operations` `create` with ops producing DIFFERENT items →
  `These operations can't share a batch — the producedItem must match…`.
- Same produced item → `{success, readableId: BAT…}`.
- UI: `/x/resources/processes/$id` → Compatibility rules card shows a
  "Produced item" row; a stored `must` renders as "Require Match".

### 2. Shared pick (trackedEntitiesToBatch)
- `POST /functions/v1/issue` `{type:"trackedEntitiesToBatch", batchId, itemId,
  children:[{trackedEntityId: <lot>, quantity: <sum>}]}`.
- Verify: `jobMaterial.quantityIssued` per member = its OWN estimated quantity
  (4000/2500 from a 6500 pick); a partial draw creates a split child
  (`Split` activity) consumed by member 1, the remainder consumed whole by
  member 2; each `Consume` activity outputs that member's WIP entity;
  `itemLedger` nets to zero for the lot moves + per-member `Job Consumption`.
- Over-pick → `Pick of N exceeds the batch's remaining requirement of M`.

### 3. Completion with output lots
- Seed a batch-tagged `productionEvent`, then `batch-operations` `complete`
  with member rows carrying `trackedEntityId` (the WIP entity) + `batchNumber`.
- Verify: WIP entities → `Available` with the entered readableId + produced
  quantity; sliced events ∝ operationQuantity; ops Done; batch Completed;
  response carries `outputTrackedEntityIds`.

### 4. Output idempotency
- Re-invoke `issue` `jobOperationBatchOutput` on an Available entity →
  `{success:true, created:false}`, still exactly ONE `Produce` activity.

### 5. Lot merge
- `issue` `{type:"mergeTrackedEntities", trackedEntityIds:[A,B], readableId?}` →
  ONE new entity (Σ quantity, earliest parent expiry; `readableId` inherits the
  FIRST parent's when omitted — the edge fn orders parents by the CALLER's list,
  so `[WIP1,WIP2]` yields WIP1's number and the reverse yields WIP2's),
  `Merge` activity (inputs = parents at their quantities, output = merged),
  net-zero `Batch Merge` ledger rows, parents `Consumed`.
- MES prompt: completing via `/x/batch/$batchId/complete` with ≥2 same-item
  outputs returns `{merge:{count}}` instead of redirecting; the prompt renders
  from `JobOperation` (NOT the completion modal — completing unmounts it).
- The merge action posts `intent=merge` and **no ids**; the route re-derives
  them from the batch's membership. Negative test: post
  `trackedEntityIds=<two unrelated Available same-item lots>` and confirm those
  lots are untouched (before the fix they would have been merged).
- ERP drawer shows "Merge output lots" only for a Completed batch with ≥2
  Available same-item outputs (absent once merged).

### 6. MES batch materials UI
- `/x/operation/$memberOpId` in batch mode: the materials row shows
  `Batch: <summed required>` under required and `Batch: <summed issued>` under
  issued (from `getBatchMaterialTotals`).
- Complete modal (icon button with the package-check icon in Controls — click
  via `document.querySelectorAll('button')` index hunting, aria-labels are
  empty on the icon buttons): table columns Job / Quantity / Scrap /
  **Batch Number** (batch-number inputs pre-filled from each member's WIP
  entity readableId).
- The pick modal's quantity in batch mode defaults to the BATCH remaining
  (6,500), not the member's share — if it shows the member's number the
  `batchRemainingQuantity` wiring has regressed and the pro-rata split will
  under-serve every member.

## Selector Notes
- MES Controls icon buttons have NO aria-labels; the big start/stop is the
  `size-24` button, the complete/ellipsis buttons flank it. Click by index via
  eval, never by ref.
- Login `Continue` is overlay-blocked for `agent-browser click` — use
  `form.requestSubmit(button)` via eval.

## Stack setup (crbn)

```bash
pnpm exec crbn status            # port assignment + container health
pnpm exec crbn up --all          # compose services + both dev servers
pnpm exec crbn reload edge-runtime   # REQUIRED after editing functions/** — see below
```

`crbn up` rewrites `.env.local` with this worktree's own slug URLs
(`https://{erp,mes,api}.<branch-slug>.dev`) — never reuse another worktree's URLs.

**The edge runtime caches compiled isolates.** The functions tree is live-mounted,
so `docker exec <edge> grep …` shows your edit, but the running isolate still
serves the OLD module — a fix appears not to work while the file is provably
correct. `crbn reload edge-runtime` is the fix; allow ~30-60s before the first
call succeeds (an early call returns "An invalid response was received from the
upstream server").

## Seeding gotchas found the hard way

- Seed the jobs at a location that HAS `storageUnit` rows (all bins live at
  Manufacturing Plant `loc_GYZ…`, none at Headquarters) and give the input lot's
  `itemLedger` row a `storageUnitId` — otherwise `get_available_tracked_entities`
  returns nothing and the pick modal says "Batch number is not available".
- That RPC's argument order is `(item, company, location)` — easy to transpose.
- The Scan field takes the entity **id** (what a barcode encodes), not the human
  `readableId`; a valid scan auto-submits the pick.
- Resetting a batch for a re-run must also zero `jobOperation.quantityComplete`,
  or the completion modal pre-fills 0, reads every row as "not in this run", and
  disables submit.

## Common Failures
- `{"message":"no result"}` on the pick → missing `itemCost` row (accounting on).
- `duplicate key … accountingPeriod` on the FIRST pick of a month →
  fixed in code (period pre-resolved before the batch transaction); if seen,
  the edge isolate is stale — `crbn reload edge-runtime`.
- Merged lot comes back with `readableId: null` → stale isolate (the builder
  inherits the first parent's number). Reload and retry.
- `{}` empty response with 200 → look at
  `docker logs carbon-carbon-edge-runtime-1` — the error is server-side.
