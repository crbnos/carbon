# Operation batching

> Group identical operations from several jobs to run as one setup and one timer at a work center, with time and cost split back per job by quantity.

Some processes physically run several jobs at once: a laser table nests parts from many work orders on one sheet, a furnace treats many jobs in one cycle, a plating bath coats whatever fits. An operation batch models that run. It groups unstarted job operations from different jobs, all on the same batchable process, to run together at one work center, with one shared setup and one shared timer.

The jobs are never merged and no BOM changes: each member stays a first-class operation on its own job, and at completion the shared time is sliced back per member in proportion to its quantity, so job costing and the GL post per job with nothing special-cased.

An operation batch (`BAT000001`) is a production-run concept. It is unrelated to the lot/batch **numbers** that trace quantities through inventory — see `docs/reference/traceability`. Same word, different feature.

## Making a process batchable

Batching is switched on per **process**, not per item or method. On the process form (**Resources → Processes**), turn on **"Batchable"** and pick a **"Batch type"**: **"Sequential"** (parts run one after another, like a saw or laser table) or **"Simultaneous"** (parts run together in one load, like a furnace, oven, or plating bath). The type drives the run-time estimate: sequential sums the members' times, simultaneous takes the longest.

The same card holds the **"Compatibility rules"**: how strictly each dimension must match for operations to share a batch. Six describe the material consumed (material, substance, grade, dimension, form, finish) and a seventh, **"Produced item"**, describes what each job makes. Each is set to **"Require Match"**, **"Suggest Match"**, or **"Ignore"**. By default substance, grade, and dimension suggest a match and the rest are ignored. Requiring a match on "Produced item" keeps a run to a single output item, which is what makes its [output lots](#completing-the-batch) mergeable afterwards.

Only "Require Match" ever blocks anything; a suggested mismatch just warns. A work center can additionally carry an advisory **"Batch Capacity"** and **"Minimum Batch Quantity"**; the builder shows a fill bar against them but never refuses a batch over them.

## Building a batch

Open **Production → Batches** and press **"New Batch"** (the production dashboard's **"Unbatched Operations"** card and a job header's *"N awaiting batching"* badge lead to the same place). Pick a **Location** and a **Batchable process**, and the builder lists every eligible operation: unstarted, not already in a batch, on that process, with no production recorded.

Operations whose "Require Match" dimensions clash with your selection stay visible but locked, and mixed "Suggest Match" materials get an amber tag plus a warning to confirm they nest together on this run.

The builder also proposes ready-made groupings: operations sharing a material signature and due within the same seven-day window, ranked by setup saved, urgency, and capacity fit. Finish with **"Create batch"** (the batch waits as **"Planned"**) or **"Create & Release"** (it goes straight to the floor). A work center is optional at this point: leave it blank and the scheduler auto-assigns the earliest-finishing candidate on release, writing it to the batch and every member.

## Lifecycle

  - **Planned**: Composed but not on the floor. Members still schedule as individual operations, the batch is invisible in the shop floor app, and it can be freely edited or dissolved.
  - **Released**: On the floor as one unit: one schedule reservation, one shared timer. Members appear in the shop floor app even when their own job isn't released yet.
  - **Completing**: Completion has started: quantities are recorded and time is sliced. If a downstream step fails, the batch stays here and the operator retries from the shop floor.
  - **Completed**: Done. Each member operation is marked "Done" with its own time, quantity, and cost, and the jobs proceed independently.

There is no cancelled state: **"Dissolve Batch"** returns the members to the schedule un-run and deletes the batch, and removing the last member does the same. **"Unrelease Batch"** puts a released batch back to "Planned".

The moment a single timer event is recorded against the batch, membership is permanent: adding, removing, changing the work center, unreleasing, and dissolving are all refused, and the only exit is completing it. Decide the composition before work starts.

A batched operation is visible to operators when its **batch** is released, even if its own job is still "Draft" or "Planned"; the batch's schedule outranks the job's. Releasing recalculates requirements for those unreleased member jobs first, so materials are known, but it does not run MRP. The same job's other, unbatched operations stay hidden until the job itself is released.

## On the schedule

A released batch is one scheduling unit: it books a single work-center reservation sized by the batch type, placed before the per-job passes so member jobs plan around it.

On the `docs/reference/scheduling`, the batch renders as one card listing its jobs; dragging it to another column reassigns the batch's work center, and reordering it moves every member's priority together. The Batches list also offers bulk actions — select planned batches and **"Release N batches"** in one go, or dissolve several at once.

## On the shop floor

There is no separate batch screen in the shop floor app: any member's operation view *is* the batch UI. A batch chip shows the `BAT…` number, the member jobs, and a **"Print batch list"** action; the timer is shared, so starting it runs one clock for the whole batch, and planned time shows the batch total.

## Picking materials

The run is shared, so the materials list is too. Each material row carries a second **"Batch"** figure beside the member's own: what this operation needs, and what the whole batch needs.

Picking a lot-tracked material issues it to every member at once. The quantity defaults to the batch's outstanding requirement, and Carbon divides what you pick across the members in proportion to what each still needs. Costing and lot `docs/reference/traceability` stay per job; only the operator's trip to the shelf is pooled.

The split is proportional, so a smaller pick is divided across every member rather than filling one of them. On a batch needing 4,000 and 2,500, picking 4,000 leaves both members short instead of completing the first. Take the default, which is the batch total.

Materials that are not lot-tracked show a batch total for reference only. They are still consumed per job automatically at completion.

## Completing the batch

Completion happens once, for the whole batch, in the **"Complete Batch"** modal: one row per member with **Quantity** and **Scrap**, pre-filled with each operation's remaining quantity. Leave a row at zero to skip that operation, which detaches it and returns it to the schedule un-run, with no time or quantity recorded.

When a member produces a lot-tracked item, its row also carries a **"Batch Number"** for the lot that run creates. It is required: pre-filled from the batch number on the job (assigned in the job's properties sidebar) when one exists, and entered here otherwise.

On submit, any running timer stops, the shared time is sliced into per-member events in proportion to each member's planned quantity, scrap is recorded per member exactly as typed, each member's output lot is created, materials issue, costs post, and every remaining member is marked **"Done"**.

Entering less than the pre-filled quantity records less output, but the member operation is marked "Done" regardless. The only way to keep a member open is to zero it out entirely so it leaves the batch. If a downstream step fails mid-completion, the batch parks at "Completing" and the modal's button becomes **"Retry Completion"**. The retry must resubmit the recorded quantities, and corrections happen after completion.

Each member gets its own lot, because each job has its own cost and history. When the run physically produced one homogeneous quantity, give those members the **same batch number**: the form confirms they will complete as one merged lot, and the merge happens at completion. Distinct numbers keep the lots separate. One number across different items never completes — edit the numbers instead. Completing the batch also completes each member job whose batched operation was its last, so the merged lot's full quantity is on hand immediately; a member with operations still remaining completes later and adds its share then. A completed batch's drawer still offers **"Merge output lots"** for lots kept separate.

The merged lot holds the summed quantity and the earliest expiry date of the lots that went into it, and its genealogy still reaches back through every member job to the materials each one consumed. A quality event on it resolves to the exact jobs involved, which a single directly-produced lot could never tell you.

## Related

  - Scheduling How a released batch appears on the timeline, and why an estimate-less batch can't be scheduled.
  - Jobs The work orders whose operations a batch groups.
  - Work centers Where a batch runs, and the advisory capacity numbers the builder reads.
  - MES The shop floor app where the shared timer runs and completion happens.
  - Traceability The lots a batch consumes and produces, and how a merged lot still traces to every member job.

## Internals, exact strings, and troubleshooting

Tables: `jobOperationBatch` header (PK `("id","companyId")`, status enum `jobOperationBatchStatus` = Planned | Active | Completing | Completed, default Planned; migration `20260905132037_job-operation-batching.sql`); membership via `jobOperation.jobOperationBatchId`; `productionEvent.jobOperationBatchId` tags the shared timer; `capacityReservation.jobOperationBatchId` marks the one coalesced schedule hold. Readable id sequence prefix `BAT`, size 6, seed name "Operation Batch". Process config: `process.batchable`, `process.batchType` (Sequential|Simultaneous), `process.batchRules` JSONB (six dimensions × must|guide|ignore; defaults: substance/grade/dimension=guide, item/form/finish=ignore — `shared/batch-compatibility.ts`, re-exported by `@carbon/utils`). Work center: `batchCapacity` / `minimumBatchQuantity`, advisory only; validator enforces min ≤ capacity.

**"Active" is displayed as "Released" everywhere** (`BatchesTable.tsx:60`; raw value in the tooltip). Never write "activate a batch". Colors: `BATCH_STATUS_COLOR_MAP` (`@carbon/utils/status-colors`).

All mutations go through the `batch-operations` edge function (`packages/database/supabase/functions/batch-operations/index.ts`), permission `update: "production"` for every type — including create (the RLS INSERT policy names `production_create`, but the edge fn's Kysely path makes `production_update` the effective gate). ERP routes: list `/x/production/batches` (view: production), builder `/x/production/batches/new` (update: production — deliberate, so the wizard never dead-ends at submit), bulk `/x/production/batches/release` and `/dissolve`, board updates via `/x/priority/batching/update`. Batch list PDF at `/file/batch/:id.pdf` is permissionless by design (tenant safety from explicit companyId scoping). No plan gate and no companySettings flag exists — `process.batchable` is the only enablement switch.

Eligibility (`assertEligible`): same company, same process, process batchable, `jobOperationBatchId IS NULL`, status ∈ Todo|Ready|Waiting, zero production events; candidate RPC (`get_batchable_operations`) also requires a non-terminal job but NOT a released one. Floor visibility (`get_active_job_operations_by_location`): batched op visible iff batch is Active/Completing; enforced again in the MES operation loader, start route, and `getOpenJobs`.

Two-phase completion (`completeBatch`): phase 1 in one transaction — detach excluded members, auto-close a running timer at NOW(), slice events per member ∝ `operationQuantity` (largest-remainder whole seconds; `productionEvent.duration` is GENERATED so cost follows), insert per-member `productionQuantity` rows (Production when qty>0, Scrap when scrap>0), flip Active→Completing. Phase 2 idempotent — issue materials per member with qty>0, flip members Done (fires `sync_finish_job_operation` each), post GL per sliced event skipping already-posted, finalize Completing→Completed. MES batch timers skip `post-production-event` at End (`apps/mes/app/routes/x+/event.tsx:129-132`); cost posts once at completion. Scheduler: `batch-scheduler.ts` pre-pass places Active/Completing batches as one unit (Planned excluded), auto-assigns earliest-finish work center when blank (guarded `WHERE workCenterId IS NULL`), writes one reservation anchored on the min open member op; the reservation is spared by per-job regen and retired only by the status trigger (`20260907155426_cleanup-reservations-on-batch-exit.sql`) on entry to Planned/Completed; dissolve self-heals via FK SET NULL. Employee finiteness is deliberately absent in v1 — the batch reserves the work center only.

Materials and output lots (spec `.ai/specs/2026-09-16-batch-materials-and-output-lots.md`). Shared pick: `issue` case `trackedEntitiesToBatch` (permission `update: "production"`) resolves the accounting period BEFORE opening its transaction (`getCurrentAccountingPeriod` reads over HTTP but writes in-transaction, so N members in one transaction would each try to create a missing month), locks the members' `jobMaterial` rows `FOR UPDATE`, and splits each picked lot with `splitPickAcrossMembers` (`shared/batch-pick-split.ts`, re-exported by `@carbon/utils`) weighted by each member's REMAINING requirement, via `distributeRoundingResidual`. Per-member writes reuse `consumeTrackedEntitiesIntoOperation`, the sequence extracted from `trackedEntitiesToOperation`, so genealogy and ledger rows are identical to N manual picks. Each picked lot is split separately, so every member ends up linked to every lot it actually drew from (complete recall coverage). MES panel totals come from `getBatchMaterialTotals`; the pick modal's `batchRemainingQuantity` prop is what makes the default the batch total rather than the member's share. Untracked materials are display-only and still backflush in completion phase 2.

Output lots: completion phase 2 calls `issue` case `jobOperationBatchOutput` per member whose `jobMakeMethod.requiresBatchTracking` is true, between the material issue and the Done flip. It is the `Produce` activity plus the entity flip to Available, extracted from `jobOperationBatchComplete` WITHOUT that case's `productionQuantity` insert (phase 1 wrote it) or backflush (the issue step ran). Idempotent: an already-Available entity returns `{ created: false }`. A member that requires batch tracking but carries no `trackedEntityId` is refused rather than silently skipped.

Lot merge: `issue` case `mergeTrackedEntities` (permission `update: "inventory"`) → `buildBatchMergeRecords` (`shared/batch-merge.ts`). Parents keep their quantity and flip `Consumed`; the merged entity is a fresh id with the summed quantity, the EARLIEST parent `expirationDate`, attributes kept only where all parents agree, `"Merged From Entity IDs"` provenance, and the FIRST parent's `readableId` when the caller passes none (the edge fn orders parents by the caller's list, so "first" is deterministic). Genealogy is one `trackedActivity` `type: "Merge"`, inputs = each parent at its quantity, output = the merged entity; ledger gets `Batch Merge` rows sized by each parent's RECEIVED (on-ledger) balance — the merge is identity-only, so lots merged straight off a completed batch (nothing received yet) write no ledger rows at all, and each member job's later receipt posts against the merged lot (`complete_job_to_inventory` walks Merge activities to the terminal output; migration `20260916131445_merge-aware-job-receipt.sql`; enum added by `20260915201233_batch-merge-ledger-enum.sql`). **Both callers derive the parent ids server-side from batch membership** — MES `getOutputLotMergeGroups` in `batch.$batchId.complete.tsx` (groups the persisted output lots by itemId + readableId and merges each group right after completion succeeds), ERP `getBatchOutputLots` in the `mergeOutputs` intent — because these routes invoke `issue` with the service role, so the edge fn's `inventory` check validates the service role rather than the operator. No entity ids travel through a form. There is no post-completion prompt: the batch number IS the merge intent, confirmed inline in `BatchCompleteModal`, and one number across different items is refused before completion (client-side block plus a server-side pre-check on jobMakeMethod itemIds).

Compatibility: `producedItem` is the seventh entry in `BATCH_RULE_DIMENSIONS`, default `ignore`, resolved from the job's item readable id on both the client fold and the edge fn's `assertMaterialCompatible`. Batch completion completes member JOBS too: `sync_finish_job_operation`'s status gate admits Draft/Planned jobs when the Done operation carries a `jobOperationBatchId` (migration `20260916155634_batch-completion-completes-draft-jobs.sql`) — a Draft job's op can only reach Done through a released batch, so the run genuinely happened; the job's receipt posts before the route's merge, which is why a merged lot's on-hand equals its full quantity. Serial-tracked members are unchanged by all of the above — batch mode still disables tracked activity for them.

Key refusal strings (edge fn): "The process is not batchable"; "Operation {id} is already in a batch"; "Operation {id} has already started"; "Operations with recorded production events cannot be batched"; "These operations can't share a batch — the {dims} must match on this process"; "Cannot add operations to a batch with status {status}"; "The batch has already started — complete it instead"; "Cannot remove operations: production has been recorded. Complete the batch instead."; "Cannot change the work center: production has been recorded."; "Only a planned batch can be released"; "Cannot release an empty batch"; "Only an active batch can be unreleased"; "Cannot dissolve: production has been recorded. Complete the batch instead — member jobs then proceed independently."; "Every operation is excluded — dissolve the batch instead of completing it"; "Operation {id} was included when completion started — retry with the recorded values; corrections happen after completion."; "Quantities were already recorded for this batch ({detail}). Retry with the recorded values; corrections happen after completion."; "One or more operations were already claimed by another batch — refresh and try again"; "Pick of {n} exceeds the batch's remaining requirement of {m}"; "No member operation still requires this item"; "Batch is already completed"; "Operation {id} produces a batch-tracked item — its output lot is required"; "Operation {id} produces a batch-tracked item — its batch number is required"; "Only lots of the same item can be merged"; "At least two lots are required to merge"; "Lot {readableId} is not available to merge"; "Lot {readableId} has no quantity to merge"; "No mergeable output lots" (ERP mergeOutputs, when server-side derivation finds nothing); "Batch number {n} is used for different items — edit the numbers and complete again" (MES completion pre-check). MES gates: "This operation is part of a batch that has not been released to the floor"; "This operation's job has not been released to the floor". Builder add-mode: "Only a planned or active batch can take more operations". Scheduling conflict: "{Batch} has no estimated time — add setup, labor, or machine time to its operations to schedule it".

### The batch card is missing from the operations board / MES
Planned batches are invisible outside the Batches list and the builder: the board and the floor only surface Active ("Released") and Completing batches. Release it.

### Can't dissolve, unrelease, remove a member, or change the work center
Production has been recorded against the batch — membership and placement are frozen; complete the batch instead. A "Completing" batch can only be retried from the shop floor (the schedule card links "Completion in progress — retry in Shop Floor").

### An operator sees a job that was never released
Its operation is in a released batch — the batch's release outranks the job's for that operation only. Expected; the job's other operations stay hidden.

### Retry Completion rejects my corrected quantities
By design: a resume must match what phase 1 recorded (mismatches are quoted back). Complete with the recorded values; correct afterwards on the job.

### The builder hides some operations on the process
The hidden-ops note explains: "{n} already started", "{n} already in a batch". Started or event-carrying operations can never be batched.

### The pick modal says a batch number is not available
The lot picker lists stock at the member job's location that is Available with a positive on-hand and a storage unit on its ledger. A lot in another location, with no bin, or already allocated to a picking list will not appear. The Scan field matches the tracked entity id a label encodes, not the human-readable lot number.

### A shared pick left every member short
Expected when less than the batch's outstanding requirement was picked: `splitPickAcrossMembers` divides whatever was picked pro-rata across every member with remaining need (largest-remainder at internal scale, so shares sum exactly). Pick the batch total, which is the modal default in batch mode.

### Completed the batch but the lots did not merge
Merging happens only for members completed under the SAME batch number (per item). Distinct numbers mean separate lots by design; serial-tracked members never merge. Lots kept separate can still be merged from the completed batch's drawer ("Merge output lots") until they are consumed.

### Suggested batches look wrong / too small
Suggestions group by material signature split into 7-day due windows, scored by setup saved (0.4), urgency (0.35), capacity fit (0.15), specificity (0.1); top 6 shown. Undated members ride the earliest dated cluster. They're suggestions — manual selection is never constrained by them.
