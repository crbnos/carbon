# Batch Materials & Output Lots

> Status: implemented
> Author: Claude (with Sid)
> Date: 2026-09-16
> Research: `.ai/research/batch-aggregated-material-consumption.md` (2026-09-15, input side) +
> `.ai/research/batch-output-lot-identity.md` (2026-08-27, output side) +
> `.ai/research/job-operation-batching.md` (composition/costing)
> Builds on: `.ai/specs/2026-08-21-job-operation-batching.md` (shipped, #1550) and
> `.ai/specs/2026-08-04-batch-split-identity-flip.md` (shipped — the `"Merge"` activity
> and `Batch Split` ledger patterns this spec reuses)
> Customer driver: Work Order Stitching use cases (treatment prep / sowing / harvest) —
> "one physical action = one pick and one output batch", Case B of the customer's
> harvest-merge proposal (single shared run, per-job lots, merged after)

## TLDR

Operation batching runs N job operations as one run, but the inventory story is still
per member: N material picks where one lot left the shelf once, and no tracked output
at all (batch mode disables tracked activity wholesale). This spec closes both halves:
(1) a **shared material pick** — the batch shows one summed material list, the operator
picks once, and the system records each member's own consumption from that lot;
(2) **output lots at batch completion** — one lot per member for batch-tracked produced
items, created on the completion screen; (3) a **lot merge** — a one-click prompt after
completion (and a batch-detail action) that combines same-item output lots into a single
lot with genealogy to every source job; and (4) a **produced-item compatibility rule**
so a process can require members to make the same item before they group. Jobs are
never merged; costing and genealogy stay per job throughout.

Industry grounding (research): aggregate the physical pick at the run, keep the ledger
per order (SAP EWM cross-order staging, pharma campaign weighing, Fulcrum pick-once);
a literal shared output lot is a deliberate same-item act layered on per-order lots —
which is exactly what the merge step is.

## Problem Statement

Two jobs, same crop, harvested in one batched run:

- **Input:** the batch's materials are loaded per member (`getJobMaterialsByOperationId`,
  `apps/mes/app/routes/x+/operation.$operationId.tsx:242`) and lot-tracked material is
  picked per operation (`issue` case `trackedEntitiesToOperation`). The operator picks
  the same seed lot twice: once for 4,000, once for 2,500 — two picks for one physical
  scoop of 6,500. Untracked materials backflush per member (`issue` case
  `jobOperation`), which is correct but invisible as a combined requirement.
- **Output:** batch mode passes `isTrackedActivity={!isBatched && …}`
  (`apps/mes/app/components/JobOperation/JobOperation.tsx:2501`), so a batch-tracked
  produced item cannot be completed through a batch at all — `BatchCompleteModal`
  records quantities only. The customer's "one output batch of 3 kg" is unreachable.
- **Eligibility:** `BATCH_RULE_DIMENSIONS` covers the consumed BOM line's item and
  material properties, but not the **produced** item — "same output" cannot be required.

## Proposed Solution

Four additions, all on top of the shipped batching feature. Nothing changes for
unbatched operations or for batches of untracked items beyond a display improvement.

### 1. Shared material pick (MES batch mode)

- The batch-mode materials panel loads materials for **all members** (new
  `getJobMaterialsByBatchId`), grouped by item with summed required/issued quantities.
  Per-member rows expand under each item group.
- **Untracked items: display-only aggregation.** Consumption keeps backflushing per
  member at completion Phase 2 — no new issue path, no double-issue risk.
- **Batch-tracked items: one pick action per source lot.** The existing pick modal, in
  batch mode, submits a new `issue` case `trackedEntitiesToBatch`
  `{ batchId, parentTrackedEntityId, children: [{trackedEntityId, quantity}], … }`.
  In one transaction the function reads each member's **remaining** requirement for
  that item and splits the picked quantity **pro-rata by remaining requirement**, using
  `distributeRoundingResidual` so member shares sum exactly to the picked quantity.
  It then performs the same per-member writes `trackedEntitiesToOperation` performs
  today (consumption records, activity attribution, ledger rows) — N records, one
  operator action, same downstream costing and genealogy as N manual picks.
- Multi-lot picks are N invocations of the same case (one per source lot); because each
  split is pro-rata by remaining requirement, every member is linked to every lot it
  physically consumed from — recall traceability is complete.

### 2. Output lots at batch completion

- For members whose produced item `requiresBatchTracking`, `BatchCompleteModal` gains a
  per-member batch-number field (pre-filled from the tracking sequence, editable),
  alongside the existing per-member quantity field.
- Batch completion Phase 2 finalizes each member's output entity via a new lean `issue`
  case `jobOperationBatchOutput` (per member, the member's own WIP `trackedEntityId`):
  the `Produce` activity + `Available` flip extracted from `jobOperationBatchComplete`,
  WITHOUT that case's `productionQuantity` insert (Phase 1 already recorded it) and
  WITHOUT its backflush (Phase 2's issue step already ran). Inserted between the
  material-issue step and the Done flip, idempotent like its neighbors (skip members
  whose entity is already `Available` — resume-safe).
- Serial-tracked members are **out of scope**: they keep today's behavior exactly
  (quantities only, no tracked activity in batch mode). Eligibility is unchanged.

### 3. Lot merge

- New `issue` case `mergeTrackedEntities` `{ trackedEntityIds (min 2), companyId, userId }`:
  - All parents must be the same item, `Available` status, and same company/location.
  - Creates ONE new entity: summed quantity, fresh id, new batch number,
    `expirationDate` = **earliest** parent expiry, properties kept only where all
    parents agree.
  - Genealogy: one `trackedActivity` `type: "Merge"` — inputs = each parent at its
    quantity, output = the merged entity (the type already exists:
    `packages/database/supabase/functions/shared/batch-split.ts:252`).
  - Ledger: net-zero `Batch Merge` rows at the parents' resolved bin (−q per parent,
    +Σq merged), mirroring `Batch Split`'s shape. Parents become `Consumed`.
- **Completion prompt (the customer's banner):** after a batch completes with ≥2
  same-item output lots, the MES completion flow offers "N lots of the same item —
  merge into one?" One click invokes the merge. The same action appears on the ERP
  batch detail drawer for completed batches with unmerged same-item outputs.
- Auto-merge (no click) is deliberately **deferred**: a wrong automatic merge needs a
  split to undo; a click does not. Revisit as a `process` setting once the banner flow
  has real usage.

### 4. Produced-item compatibility rule

- `producedItem` joins `BATCH_RULE_DIMENSIONS` (`shared/batch-compatibility.ts`),
  default `"ignore"` so every existing process behaves byte-for-byte as before.
- `must`/`guide`/`ignore` semantics identical to the existing dimensions: enforced
  client-side in the builder and server-side in the edge fn's compatibility gate, on
  create + add; `guide` splits suggestion groups.
- The process form's "Compatibility rules" card gains the row.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pick aggregation model | Aggregate the PICK, keep the LEDGER per member — never one consumption row split at costing time | Research consensus (SAP EWM cross-order staging, pharma campaign weighing); zero changes to costing, GL, or traceability, same principle as the shipped time-slice design |
| Member split basis | Each member's own remaining BOM requirement; `distributeRoundingResidual` for exact sums | The aggregate is just the sum of per-member requirements (customer math: 4,000+2,500=6,500); precision rule forbids independent rounding |
| Multi-lot attribution | Pro-rata by remaining requirement per pick — every member links to every lot it drew from | Sid 2026-09-16. Physically honest for blended preps; sequential fill under-links recalls |
| Fan-out ownership | New `issue` case `trackedEntitiesToBatch`, one Kysely transaction | A client-side loop of N invokes is not transactional; `issue` already owns every consumption shape |
| Tracked scope v1 | Batch-tracked + untracked only; serial-tracked members unchanged, eligibility untouched | Sid 2026-09-16. Serial per-unit identity inside batch completion is real work with no customer driver; changing shipped eligibility could strand existing users' batches |
| Untracked materials | Display-only aggregation; backflush at completion unchanged | Sid 2026-09-16. Manual early issue would duplicate backflush and invite double-issue |
| Output lot shape | One lot PER MEMBER at completion, then merge — never one lot written directly across jobs | Case B (customer-agreed). Per-member lots are what per-job genealogy requires; the 08-27 research shows direct shared lots destroy per-order identity everywhere they exist |
| Output creation path | New lean `issue` case `jobOperationBatchOutput` per member (the `Produce` activity + entity flip EXTRACTED from `jobOperationBatchComplete`), inside completion Phase 2, idempotent | The shipped case also inserts a `productionQuantity` row and backflushes materials (`issue/index.ts:1180`) — both already owned by batch completion Phase 1/2; calling it verbatim would double-count. Extracting keeps one source of truth for the Produce write |
| Merge mechanism | New `issue` case `mergeTrackedEntities`; `trackedActivity` `type: "Merge"`; net-zero `Batch Merge` ledger rows; parents → `Consumed` | Mirrors the shipped `Batch Split` pattern in reverse; `"Merge"` activity type already exists from merge-on-return |
| Merged lot identity | New entity, fresh id, NEW batch number | Matches the customer's own `-M` diagram, the split precedent (children get new ids), and the industry "deliberate act" framing |
| Merge conflict policy | Same item required; expiry = earliest parent; properties kept only where all parents agree | Sid 2026-09-16. Conservative and standard; blocking on hour-level expiry differences would kill the one-click flow |
| Merge surfaces | MES post-completion prompt + ERP batch detail drawer action; generic inventory-wide merge UI deferred | The feature's own surfaces; a generic merge tool is scope creep until someone asks |
| Auto-merge | Deferred (future `process` setting) | Sid: undoing a wrong merge needs a split; a click is cheap. Validate the banner first |
| `producedItem` rule default | `"ignore"` | Same rule as every dimension added so far: an unconfigured process behaves byte-for-byte as before |
| Multi-tenancy | No new tables. New `issue` cases validate every record id under `companyId`; merge validates all parents share it | Heuristics 1/4; edge-fn rule: payload ids re-read under companyId |
| Service shape | `(client, …) → {data, error}` wrappers in `production.service.ts` (batch materials) and `inventory.service.ts` (merge); mutations via `issue` edge fn | Heuristics 2/6; one service/models per module |
| RLS / permissions | No new tables → no new policies. `trackedEntitiesToBatch` requires `update: "production"`; `mergeTrackedEntities` requires `update: "inventory"` | Matches the surfaces that invoke them (MES batch page; inventory lot action) |
| Form pattern | `BatchCompleteModal` stays `ValidatedForm` + zod (batch-number fields join the member array); merge prompt is a plain action button (no user input) | Heuristic 5; a confirm with zero fields needs no form machinery |
| Backward compatibility | No frozen surface touched. One additive enum migration (`Batch Merge`). Unbatched ops, untracked batches, serial members: byte-for-byte unchanged | Heuristic 7 |

## Data Model Changes

No new tables. One additive migration:

```sql
-- Merge ledger rows, mirroring 'Batch Split' (20250225145619, 20260504000000)
ALTER TYPE "itemLedgerDocumentType" ADD VALUE IF NOT EXISTS 'Batch Merge';
ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Batch Merge';
```

`process.batchRules` is sparse JSONB — `producedItem` needs no migration.
`trackedActivity.type` is TEXT — `"Merge"` is already written by merge-on-return.
After the migration: `pnpm run generate:types` before typecheck.

## API / Service Changes

### `issue` edge function — two new cases

- `trackedEntitiesToBatch` `{ batchId, parentTrackedEntityId, children: [{trackedEntityId, quantity}], overrideExpired?, overrideReason?, companyId, userId }`
  — permission `update: "production"`. One transaction: load the batch's member
  operations + their `jobMaterial` rows for the parent entity's item; compute each
  member's remaining requirement; split each child draw pro-rata with
  `distributeRoundingResidual`; per member, perform the same writes as
  `trackedEntitiesToOperation` (reusing its internals, extracted if needed — no
  copy-paste). Rejects a batch with no member requiring that item, and a batch that is
  `Completed`.
- `mergeTrackedEntities` `{ trackedEntityIds (min 2), companyId, userId }` — permission
  `update: "inventory"`. Validates same item / same company / `Available`; creates the
  merged entity (fresh id, new batch number via the tracking sequence, earliest expiry,
  agreed properties); writes the `Merge` activity (inputs = parents, output = merged);
  net-zero `Batch Merge` ledger rows at the resolved bin
  (`resolveTrackedEntityBin` — see `.ai/lessons.md` "actual bin"); parents `Consumed`.
  Returns `{ trackedEntityId }`.

### `batch-operations` edge function

- `complete` Phase 2: after material issue, before the Done flip — for each member
  whose produced item `requiresBatchTracking`, invoke `issue`
  `jobOperationBatchComplete` with that member's submitted batch number/quantity.
  Idempotent: skip members whose output entity already exists. Payload's member rows
  gain optional `batchNumber`.
- Completion result gains `outputTrackedEntityIds` so the MES route can offer the
  merge prompt without a refetch.

### Services

- `production.service.ts` (ERP) + MES services: `getJobMaterialsByBatchId(client, { batchId, companyId })`
  — member materials grouped for the batch panel.
- `inventory.service.ts`: `mergeTrackedEntities(client, payload)` → invoke wrapper.
- `production.models.ts` / MES `models.ts`: completion validator member rows gain
  optional `batchNumber`; merge payload validator.
- `shared/batch-compatibility.ts` (+ `@carbon/utils` re-export): `producedItem` in
  `BATCH_RULE_DIMENSIONS`, `DEFAULT_BATCH_RULES.producedItem = "ignore"`, value-set
  fold extended; `batch-builder-logic.ts` signature/facets updated symmetrically.

## UI Changes

| Surface | Change |
|---------|--------|
| MES operation page, batch mode | Materials panel switches to the batch-wide list: item groups with summed required/issued, member rows expanded beneath; pick modal submits `trackedEntitiesToBatch`; per-item progress reflects all members |
| `BatchCompleteModal` (MES) | Per-member batch-number field (pre-filled, editable) for members with batch-tracked output; hidden otherwise. On success with ≥2 same-item output lots: merge prompt — "N lots of the same item — merge into one?" with the new lot's number shown after |
| ERP batch detail drawer (`BatchDetailDrawer`) | For a `Completed` batch with unmerged same-item output lots: "Merge output lots" action; after merge, shows the merged lot's readable id linking to traceability |
| Process form, "Compatibility rules" card | New "Produced item" row with the standard Require Match / Suggest Match / Ignore choices |
| Batch builder | `producedItem` participates in signatures/facets exactly like existing dimensions when its rule is not `ignore` |

All new strings via lingui (`<Trans>`/`t`) in both apps; `/translate` after.

## Acceptance Criteria

- [ ] A batch of 2 members (BOM 4,000 + 2,500 of the same batch-tracked seed item) shows one materials row "6,500" with both member rows beneath; one pick of 6,500 from lot L1 records 4,000 to member 1 and 2,500 to member 2, both referencing L1; each job's cost carries only its own share; the lot's where-used shows both jobs.
- [ ] Picking 4,000 from L1 then 2,500 from L2 (two invocations) links BOTH members to BOTH lots pro-rata by remaining requirement, and per-member totals still sum exactly to 4,000/2,500 (`distributeRoundingResidual` — no drift at 5-decimal scale).
- [ ] A pick exceeding the batch's remaining requirement for that item is rejected with a specific error; a pick against a `Completed` batch is rejected.
- [ ] Untracked materials appear in the batch materials list with summed quantities but no pick action; completion still backflushes them per member exactly as before (ledger rows identical to pre-feature behavior).
- [ ] Completing a batch whose members produce a batch-tracked item creates one output entity per member with the entered batch numbers and quantities; a Phase-2 failure after output creation resumes without duplicating entities.
- [ ] After completion with 2 same-item output lots, the merge prompt appears; one click yields ONE new entity (summed quantity, new batch number, earliest parent expiry), a `Merge` activity with both parents as inputs, net-zero `Batch Merge` ledger rows, parents `Consumed`; the traceability graph walks merged lot → both jobs → their inputs.
- [ ] Merging entities of different items is rejected server-side with a specific error; the prompt never offers it.
- [ ] Serial-tracked members batch and complete exactly as today (no batch-number field, no entities, no eligibility change).
- [ ] A process with `producedItem: "must"` refuses (client and server) a batch mixing produced items; `"guide"` splits suggestion groups; an unconfigured process's suggestions and gates are byte-for-byte unchanged.
- [ ] `pnpm exec turbo run typecheck --filter=erp --filter=mes`, lint, and unit tests green; new tests: pro-rata split (exact sums, multi-lot), merge validation + conflict policy, compatibility fold with `producedItem`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Pro-rata split drifts against member BOM totals across many partial picks | Med | Split by REMAINING requirement each pick + `distributeRoundingResidual`; unit test the multi-pick sequence to exact sums |
| Double consumption if `trackedEntitiesToBatch` and a member-level manual pick race | Med | Both paths read remaining requirement inside their transaction; the batch case locks the member `jobMaterial` rows (`FOR UPDATE`) |
| Output-entity creation breaks Phase 2 resume idempotency | Med | Existence check per member before create, same pattern as the backflush cap and `postedToGL` skip; covered by a resume test |
| Merged lot hides a parent-specific quality signal | Low | Deliberate and customer-chosen: genealogy keeps both parents one hop away; earliest-expiry policy is conservative |
| `producedItem` rule reshuffles existing suggestion groups | Low | Default `"ignore"` reproduces current signatures exactly; pinned by the compatibility fold test |
| Enum migration ordering vs generated types | Low | Standard flow: migrate → `pnpm run generate:types` → typecheck |

## Open Questions

> All resolved 2026-09-16 with Sid before this spec was written; the customer's
> proposals (harvest-merge cases) and follow-ups resolved the output-side questions.

- [x] **Multi-lot pick: how are lots attributed to members?** — **Answer:** pro-rata by
  remaining requirement per pick — every member links to every lot it drew from.
  Sequential fill rejected: under-links recalls for physically blended preps.
- [x] **Serial-tracked members?** — **Answer:** out of scope v1; behavior and
  eligibility unchanged. Including serial (per-unit assignment) rejected for v1 scope;
  blocking serial from batching rejected as a regression to shipped behavior.
- [x] **Merge policy on conflicting expiry/properties?** — **Answer:** allow; earliest
  parent expiry wins; properties kept only where parents agree; same item always
  required. Blocking on mismatch rejected: hour-level differences would defeat the
  one-click flow.
- [x] **Untracked materials in the batch panel?** — **Answer:** display-only
  aggregation; backflush unchanged. Aggregated manual issue rejected: duplicates
  backflush, double-issue risk.
- [x] **Output: one shared lot written directly, or per-member lots merged?** —
  **Answer:** per-member lots + merge (customer's Case B, agreed by the customer);
  direct shared lot (Case A / merged jobs) rejected — severs per-job cost and history,
  contradicts both research files.
- [x] **Output quantity split: coefficient or per-member entry?** — **Answer:**
  per-member entry, pre-filled proportionally from planned quantities (customer
  confirmed; real yields differ per cycle — 45/44 kg — so a fixed % would fabricate
  yields). Time/cost remains the shipped proportional split.
- [x] **Auto-merge without the click?** — **Answer:** deferred; candidate `process`
  setting after the banner flow sees real usage (a wrong auto-merge needs a split to
  undo).

## Changelog

- 2026-09-16 (live-test follow-up, Sid): completing a batch now completes its
  Draft/Planned member jobs (sync_finish_job_operation admits them when the
  Done op carries a jobOperationBatchId — 20260916155634). Their receipts post
  before the route's merge, so a merged lot's on-hand equals its combined
  quantity immediately. Supersedes the earlier "keep manual, surface it" call;
  the drawer nudge remains for members with operations still open.

- 2026-09-16 (UX simplification, Sid): the post-completion merge prompt is
  gone. The batch number is the merge intent — members completed under one
  number (same item) merge at completion, confirmed inline in the Complete
  Batch form; one number across different items is refused (client block +
  server pre-check) so duplicate lot numbers are never minted. BatchMergePrompt
  deleted; route merges via getOutputLotMergeGroups after completion; the
  drawer's "Merge output lots" remains for lots kept separate.

- 2026-09-16 (post-ship, user-found): the merge's net-zero ledger rows assumed
  every parent was already received into stock. Merging at batch completion
  (before member job receipts) subtracted unreceived quantity and stranded the
  remaining jobs' receipts ("Tracked entity not found" — the job's lot was
  Consumed). Redesigned identity-only: merge ledger rows are sized by each
  parent's on-ledger balance (none when unreceived), and
  complete_job_to_inventory resolves through Merge activities so each member
  job's receipt posts against the merged lot
  (20260916131445_merge-aware-job-receipt.sql).

- 2026-09-16: Created, all questions resolved pre-writing (Sid + customer answers).
- 2026-09-16: Implemented on `feat/batch-materials-and-output-lots`. Five changes
  the design did not anticipate, all found by end-to-end testing rather than by
  typecheck or unit tests:
  - **Accounting period pre-resolution.** `getCurrentAccountingPeriod` reads over
    HTTP but writes in-transaction, so N members in ONE pick transaction each
    tried to create the same missing month and the unique index rolled the whole
    pick back. Resolved before the transaction opens.
  - **Merge-prompt fetcher ownership.** Completing the batch is exactly what makes
    the loader stop passing `batch`, unmounting `BatchCompleteModal` — so a
    fetcher owned there took the prompt's payload with it and the prompt could
    never render. `JobOperation` owns the fetcher and renders `BatchMergePrompt`.
  - **Merged lot identity.** Neither caller passed a `readableId`, so every merged
    lot landed `Available` with a NULL batch number (unidentifiable on the floor;
    in real data every `Available` lot has one). It now inherits the FIRST
    parent's, matching the split child's inheritance, and the edge fn orders
    parents by the caller's list so "first" is deterministic rather than DB row
    order.
  - **Shared-pick default quantity.** The pick modal defaulted to the member's own
    share, which the pro-rata split then divided again across all members (a 6,500
    batch requirement picked as 4,000 became 2461.54/1538.46, satisfying neither).
    Batch mode defaults to the batch's outstanding requirement.
  - **Merge authorization.** The MES merge action took `trackedEntityIds` from the
    form and invoked `issue` with the SERVICE ROLE, so the edge fn's `inventory`
    check validated the service role rather than the operator — a
    production-only user could merge any two same-item lots in the company. Both
    entry points now derive the parent ids server-side from the batch's
    membership (`getMergeableOutputLots`), mirroring the ERP route.
