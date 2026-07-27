# Job Operation Batching

Last tested: 2026-07-08
Routes: /x/resources/processes/new, /x/schedule/batching, /x/schedule/operations
MES (untested here): /x/batch/$batchId

## Prerequisites
- A **batchable process** (`process.batchable = true`).
- For the board to show candidates: **released jobs (Ready/In Progress/Paused)**
  with unstarted operations on that process, ideally with material BOM lines
  (form/substance/grade/dimension/finish) for the facet filters. A fresh company
  has 0 jobs — the board renders but candidates are empty.

## Steps

### 1. Process Batchable flag (PASS)
- Navigate `/x/resources/processes/new`.
- Fill "Process Name". The **"Batchable"** switch renders right after
  "Complete all quantities on barcode scan" (`aria-label="Batchable"`, hidden
  input `name=batchable`).
- Toggle it on → `requestSubmit` the form whose button reads "Save".
- Verify: redirect to `/x/resources/processes`; the list shows a **"Batchable"**
  column (between "Complete All" and "Active"); DB `process.batchable = t`.

### 2. Batching board (PASS)
- Nav: on `/x/schedule/operations`, the view dropdown (button "Work Centers")
  includes a **"Batching"** entry under the Operations group.
- Navigate `/x/schedule/batching`. Empty state: "Pick a batchable process to
  plan batches".
- Click the process picker (placeholder "Select a batchable process") → it lists
  only batchable+active processes. Select one → URL gets `?process=<id>`, board
  shows two panes: left = candidate operations (or "No unbatched operations
  match"), right = Active batch lanes + a dashed "Drag here to start a new batch"
  drop zone.

### 3. Batch CRUD via the edge fn (PASS — DB-verified)
- Each drag POSTs a **single** id to `path.to.scheduleBatchingUpdate`:
  candidate→"New batch" = `intent=create`; candidate→lane = `intent=add`;
  member→candidates = `intent=remove`; lane dissolve = `intent=dissolve`; lane
  work-center change = `intent=update` (propagates to member ops).
- Verified by POSTing each intent (carries auth cookies) and checking the DB:
  create → `BAT000001` Active w/ members; add → +1; gate rejects an
  already-batched op (200 with error flash, no new batch); remove → -1; dissolve
  → batch deleted + members untagged. `BAT` sequence increments across creates.
- Drag gesture itself (@dnd-kit) not automated — POST the action to verify logic.

### 4. Schedule badge/menu (data path PASS)
- `get_active_job_operations_by_location` returns `processBatchable`,
  `jobOperationBatchId`, `batchReadableId` per op. The board threads these; the
  ItemCard renders a `BAT######` badge when batched, and the "..." menu offers
  "Batch planning" (unbatched batchable) / "Remove from batch" (batched).
- NOTE: ops only appear on the operations board when they have a **work center**
  (columns = work centers). A company with no work centers shows no cards.

### MES batch view + complete (PASS)
- Auth: MES login only sends magic links (no dev bypass) — establish the ERP
  session first (bypass), the cookie is shared across `*.<infix>.dev`; then hit
  `https://mes.<infix>.dev/x/batch/<id>` directly.
- Batch view renders member table + status Badge + Start/Complete; Start →
  batch-tagged Machine event (button flips to Stop); Stop → event ends. Complete
  Batch form pre-fills each member's `operationQuantity`; submit →
  `batch.$batchId.complete` → single `invoke("batch-operations", { complete })`.
  The edge fn runs the **two-phase** completion: Phase 1 (one txn, `FOR UPDATE`)
  slices events ∝ quantity (verified 12s:50s = 5:20), records `productionQuantity`,
  flips `Active → Completing`; Phase 2 (idempotent) issues each member's BOM,
  finishes members, posts GL per event, flips `Completing → Completed`.
- **Resume**: if Phase 2 fails (e.g. GL/accounting not configured), the batch
  stays `Completing` — the page shows a yellow Badge and the button relabels
  "Retry Completion"; re-submitting resumes without double issue/GL. The Start/End
  timer is hidden once the batch leaves `Active`.

## Selector Notes
- Carbon custom table has no native `<th>`; read column headers from body text
  or `[role=columnheader]`. Row edit links may not be `<a>` — verify in DB when
  UI selectors fail.
- Radix dropdowns need a **real** `agent-browser click @ref` (an eval `.click()`
  often won't open them). Snapshot after clicking to read `menuitemradio`s.
- react-aria switches: read `[role=switch]` `aria-checked` + the hidden
  `input[name=...]`.

## Common Failures
- **Vite "Cannot find module '~/modules/.../Batching'" HMR overlay** blocking the
  whole app: a newly-created directory-barrel `index.ts` can be cached as a
  resolution miss by Vite's SSR module runner. Fix: import the concrete files
  (`.../Batching/BatchingBoard`, `.../Batching/types`) from the route instead of
  the directory barrel. (Fixed in this branch.)
- Empty board = no released jobs with ops on the process (not a bug).
- **`422 "Expected array, received string"`** on a single-op drag: a form array
  field must use `zfd.repeatable(z.array(...))` / `zfd.repeatableOfType(...)`, NOT
  `z.array(...)` — RVF only coerces a repeated field to an array when ≥2 values
  are present, so a single submitted id fails. (Fixed in this branch.)
- **Completion form submits 0 quantities**: two traps — (a) `(targetQuantity ??
  operationQuantity)` returns 0 when `targetQuantity` is 0 (not null); pre-fill on
  `operationQuantity` per spec. (b) react-aria `Number` + RVF nested-array
  defaults (`members[i].quantity`) don't bind reliably — use `NumberControlled`
  with local state. (Both fixed in this branch.)

## Seeding test data (no work-center / job flow needed)
A fresh company has 0 jobs. To get candidates, insert raw rows with triggers
disabled (`SET LOCAL session_replication_role = replica;` inside a txn — the app's
make-method interceptors expect app-managed state like `jobMakeMethod.version`):
`item` (Part + Material), `material` (id = material item's `readableId`, with
substance/form/grade), `job` (status Ready, at the location), `jobMakeMethod`,
`jobOperation` (process = the batchable process, status Ready, `operationQuantity`),
`jobMaterial` (link op→material via `jobOperationId`). Verify with
`SELECT * FROM get_batchable_operations(loc, proc)`. Gotcha: `information_schema`
`table_name='job'` also matches **`cron.job`** (pg_cron) — filter
`table_schema='public'` when reading required columns.
