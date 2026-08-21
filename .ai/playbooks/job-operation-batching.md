# Job Operation Batching

Last tested: 2026-08-21 (feat/job-operation-batching-v2)
Routes: ERP `/x/resources/processes`, `/x/schedule/operations`; MES `/x/operation/$operationId` (batch mode; `/x/batch/$batchId` redirects here)
Edge fn: `batch-operations` (create/add/remove/update/dissolve/complete)

## Strategy

Two verification paths — use both:
- **UI (agent-browser)** for the process flag, the operations-board composition
  (select checkboxes, BAT card collapse, material chips + facets), and the MES
  batch page render.
- **Edge fn (direct `curl` with the service-role key)** for all mutation/completion
  logic. @dnd-kit drag is unreliable to automate; the edge fn is the exact call the
  board/MES routes make, so invoking it + asserting DB state is the reliable proof.

## Prerequisites / seeding

Needs a batchable process, a location, and jobs whose operations sit on that process
with BOM lines carrying material substances (for the facet-filter test). No fixtures
ship with substances, so seed them. Seed with `SET LOCAL session_replication_role =
replica` to bypass event interceptors. Gotchas learned:
- `public.job` required cols: `jobId, itemId, unitOfMeasureCode, locationId, companyId,
  createdBy` — NOT `schedule`/`command` (those are on `cron.job`; an unqualified
  information_schema query matches the wrong table).
- `materialSubstance` needs a `code` (NOT NULL).
- `jobOperationDependency` has NO `id` column (PK is operationId+dependsOnId+jobId+companyId).
- `jobMaterial` needs `description` (NOT NULL).
- Material property chain: `jobMaterial.itemId → item → material` (material.id =
  item.readableId) → `materialSubstanceId`. Set the substance on the `material` row.
- Set job.status in ('Ready','In Progress','Paused') and jobOperation.status in
  ('Todo','Ready','Waiting') or the RPC won't list them.

Full seed/cleanup SQL pattern is in the run log `.ai/runs/2026-08-21-job-operation-batching.md`.

## Steps

### 1. Process Batchable flag (UI)
- `/x/resources/processes` → confirm the **Batchable** column header renders.
- Click a process → the form drawer has a **"Batchable"** switch. Toggle it, then
  `requestSubmit` the drawer form (button "Save").
- Verify DB: `select batchable from process where id=...` → `t`.

### 2. Batch composition on the operations board (UI — redesigned 2026-08-21)
- `/x/schedule/operations` → batchable, unstarted operations show a checkbox on
  hover (top-right, before the grip). Checking one pins the process; a floating
  bar appears ("N selected · Create batch · Clear").
- "Create batch" submits to `batching.update` (intent=create) → the members
  collapse into one `BAT` card in the batch's work-center column (member rows,
  hover X to remove a member, menu: Open in MES / Dissolve batch).
- Dragging the BAT card to another work-center column reassigns the batch work
  center. A Completing batch card is read-only (yellow badge + MES retry link).
- Click **Filter** → material facets (Substance/Grade/Dimension/Form/Finish)
  appear when the board's ops have those properties; selecting one narrows the
  cards. Material chips render on cards (display-settings "Material" toggle).

### 3. Candidate RPC guard (SQL)
- `select ... from get_batchable_operations(location_id, process_id)` returns the
  unstarted/unbatched ops with a `materials` JSONB (substanceName etc.).
- Insert a `productionEvent` on one candidate → it disappears from the RPC result
  (the `NOT EXISTS productionEvent` guard). The edge fn also rejects create on it
  ("... has already started").

### 4. Membership lifecycle (edge fn)
`POST {API}/functions/v1/batch-operations` with `Authorization: Bearer {SERVICE_ROLE}`
+ `apikey` header. Types:
- `create` → `{success, id, readableId:"BAT00000N"}`, tags members, writes workCenterId.
- `add` / `remove` (remove untags; removing last member dissolves).
- `update` (workCenterId) → written to every member op.
- `dissolve` → batch row deleted, members untagged.
- Gate rejections: already-batched ("... is already in a batch"), started
  ("... has already started").

### 5. Completion — proportional slicing (edge fn + SQL)
- Insert a batch-tagged `productionEvent` (start/end window) on the first member op.
- `complete` with `members:[{jobOperationId,quantity}]`. Verify:
  - per-member sliced events: `round(extract(epoch from endTime-startTime))` ∝
    operationQuantity, summing to the recorded span (e.g. 4200s, qty 5/20/10 →
    600/2400/1200s);
  - `productionQuantity` Production rows = entered quantities;
  - member ops → `Done`; downstream deps → `Ready`; batch → `Completed`.

### 6. Resume (edge fn) — the key new behavior
- Simulate a stuck Phase-1: set batch `status='Completing'`, insert per-member
  `productionQuantity` + sliced `productionEvent`(postedToGL=false).
- `complete` with a CHANGED quantity → rejected: "Quantities were already recorded
  for this batch (opId: N produced / M scrap). Retry with the recorded values...".
- `complete` with the SAME quantities → succeeds (resume), reuses the same event ids,
  NO duplicated productionQuantity/events, members Done, batch Completed.
- `complete` again on the Completed batch → "This batch has already been completed".

### 7. MES batch mode — the operation view IS the batch UI
- Establish the MES session first: open `{MES_URL}/x` (cookie is shared across the
  `*.dev` parent domain once ERP is authed; hitting the raw 127.0.0.1 URL breaks it).
- `{MES_URL}/x/batch/{batchId}` **redirects** to the first member's operation
  (`/x/operation/{firstMemberOpId}`). Legacy links still land somewhere useful.
- On that operation page, batch mode is on while the batch is `Active`/`Completing`:
  a **batch chip** (`BAT… · N jobs`, yellow `Completing` badge) in the info bar lists
  members as links; the Start/Stop timer is shared (its `productionEvent` is tagged
  `jobOperationBatchId`); "Log Completed" becomes **Complete Batch**, opening a modal
  with per-member quantity/scrap rows.
- DB-level checks (the harness can't reliably click the nested Radix tooltip buttons,
  and its sandbox blocks programmatic `fetch` — use `requestSubmit` on an injected
  form, or SQL, for the completion):
  - Start form carries `input[name=jobOperationBatchId]`; starting a timer inserts an
    open `productionEvent` with that batch id. Opening a DIFFERENT member's page shows
    the same timer (its Start form reads `action=End` with the open event's id).
  - Stopping closes the event with `postedToGL=false` and **no** journalLine — cost is
    deferred to completion (`event.tsx` skips `post-production-event` for batch events).
  - Completing (POST to `/x/batch/{batchId}/complete`) slices the aggregate events per
    member ∝ operationQuantity (largest-remainder), records `productionQuantity`, flips
    members `Done` + batch `Completed`. Reload the op page → chip gone (plain view).

## Selector Notes
- Process form Batchable field: `switch "Batchable"`.
- Board select checkbox: `checkbox "Select for batch"` on hover of a batchable card.
- Board filter: button "Filter" → material facet options by name.

## Common Failures
- Edge fn intermittently returns `{"error":"worker did not respond in time"}` /
  HTTP 000 on a cold edge-runtime — transient; retry.
- MES page 404 / redirect to `127.0.0.1:.../login` → MES session not established;
  open `{MES_URL}/x` first (never the raw IP).
- Candidate shows "No material properties" → that op has no `jobMaterial` line, or the
  linked `material` row has no `materialSubstanceId`.

### 8. UX round additions (2026-08-21)
- Selection bar chips: select 2+ ops with setup times → green `Setup <sum> → <max>`
  chip; select ops with due dates ≥7 days apart → amber `Due dates span N days`.
- Cross-column banner: 2+ eligible same-process ops in DIFFERENT work-center
  columns → floating top banner `Batch N × <process> across K work centers`;
  click selects the group.
- Completion exclusion: in the Complete Batch modal, the X toggle per row marks
  "Not in this run" → on submit that op detaches (jobOperationBatchId NULL,
  status unchanged, no productionQuantity) while the rest complete. Verify via
  SQL. All-excluded is rejected by the edge fn; an included row at 0 shows an
  amber warning.
- Load sheet: `GET {ERP_URL}/file/batch/{batchId}.pdf` → 200 `application/pdf`
  (menu: batch card "Print load list", MES batch chip menu, batches drawer).
- Jobs table: a job with an op in an Active/Completing batch shows a `BAT…`
  badge in the Batches column; job detail routing row and the MES job DAG node
  show the same badge/chip.
- Batches page: `/x/production/batches` (nav Production → Batches) lists
  batches with status filter + member count/qty; row click opens the member
  drawer with Print load list + View on schedule board.
