# MES Serial Selector Picker (scan/select unit on a later operation)

Last tested: 2026-08-04
App: MES
Route: /x/operation/:operationId  (standard `Process` operation view, not Assembly/Inspection)

Verifies the serial picker (`SerialSelectorModal`, driven by `useOperation`) prompts
once on arrival, stays dismissed across loader revalidations, and re-opens only on
the completion edge or via the Scan button.

## Prerequisites
- A **Make** item with `itemTrackingType = 'Serial'`.
- An `itemSerialSequence` row for that item — **without it the job's tracked entity
  stays a single quantity-N seed and never splits into N quantity-1 serial units**
  (`assignJobSerialNumbers` in `production.service.ts` skips the
  `assign-serial-numbers` edge function when no sequence exists).
- Its method has ≥2 operations with a **non-Assembly, non-Inspection** process
  (processType `Process`), so the standard operation view renders.
- A **released** job (release is what writes `jobOperationDependency`, which is how
  the loader decides `isFirstOperation`).

## Fast seed (dev DB)
```sql
update item set "itemTrackingType"='Serial' where "readableId"='FG-1';
insert into "itemSerialSequence" ("companyId","itemId",prefix,next,size,step,"createdBy")
values ('<companyId>','<itemId>','FG1-',1,4,1,'<userId>');
```
Then ERP UI: `/x/job/new` → item, quantity 3 → Save → **Release** → `Release Job`.
Find the non-first op:
```sql
select jo.id, jo.status,
  (select count(*) from "jobOperationDependency" d where d."operationId"=jo.id) as prior_deps
from "jobOperation" jo where jo."jobId"='<jobId>' order by prior_deps;
```
`prior_deps = 1` is the target (later operation).

## Steps
### 1. Login
MES shares ERP cookies, but opening a deep MES link while unauthenticated bounces to
an internal `127.0.0.1:<port>/login` where the dev bypass does **not** apply (it mails a
magic link). Log in on `ERP_URL/login` first, then open `MES_URL/x` once, then the
operation URL.

### 2. Arrival — open `/x/operation/<laterOpId>`
Expect exactly 1 `[role=dialog]` ("Select Serial Number"), and **no** `?trackedEntityId`
in the URL (only the first operation gets one seeded by the loader).

### 3. Dismiss + churn (the regression)
`Escape`, then force loader revalidations — a `job` row UPDATE fires the realtime
subscription in `useOperation`, which calls `revalidator.revalidate()`:
```sql
update job set "updatedAt"=now() where id='<jobId>';
```
Expect `document.querySelectorAll('[role=dialog]').length === 0` after each. Repeat 3–4×.

### 4. Scan button re-opens
Click the `Scan` button in the Serial Numbers section → picker returns.

### 5. Select a unit → quiet
Select tab → `Select` on a serial. URL gains `?trackedEntityId=<id>`, dialog closes,
and stays closed across further job UPDATEs.

### 6. Completion edge → re-opens once
Mark the held unit complete for this operation, then revalidate:
```sql
update "trackedEntity" set attributes = attributes ||
  jsonb_build_object('Operation <opId>', now()::text) where id='<heldEntityId>';
update job set "updatedAt"=now() where id='<jobId>';
```
Picker re-opens. Dismiss it → stays closed across further revalidations.

### 7. First operation unaffected
Open the `prior_deps = 0` op → loader seeds `?trackedEntityId`, **no** dialog.

## Selector Notes
- Modal detection: `document.querySelectorAll('[role=dialog]').length` — the picker has
  no stable test id; its text starts "Select Serial Number".
- The picker opens on the `Scan` tab; click the `Select` tab to get per-unit
  `Select` buttons.
- The Serial Numbers section's `Scan` button is the only manual re-open affordance.

## Common Failures
- **Picker re-opens after every dismiss** — the regression this playbook covers.
  Level-triggered re-prompt (`if (!selectedIsIncomplete) serialModal.onOpen()`) fires on
  every revalidation because `trackedEntities` gets a fresh array identity each time.
  Fixed by the edge-triggered `heldEntityRef` in `useOperation`.
- **No picker at all** — `jobMakeMethod.requiresSerialTracking` false (item wasn't
  `Serial` when the job was created), or the op has no `jobOperationDependency`
  (job not released → treated as the first operation → auto-select).
- **Only one tracked entity of quantity N** — no `itemSerialSequence`; the seed never
  split into serial units.
