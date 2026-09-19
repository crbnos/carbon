# Accounting Projects — Ramp slice (slice 3) — implementation plan

**Spec:** `.ai/specs/2026-09-11-accounting-projects-crud.md` (Follow-on Contract #3)
**Branch:** `feat/feat-ramp` (shared worktree; commit only listed files via explicit pathspecs + `--no-verify`)
**Base:** clean — brisbane-96's ramp draft-bill work committed (`93de84efef`).
**Precedent:** cost-center Ramp sync (`packages/ee/src/ramp/lib/cost-centers.ts` + `coding.ts` + `ramp-sync*.ts` + `post-card-transaction*`/`post-purchase-invoice`). Mirror it EXACTLY.

## Already done (slice 2) — do NOT repeat
- `dimensionEntityType` already has `'Project'` (commit `4af666fd3d`).
- A group-level `Project` dimension row exists per company group (backfill + seed). `ensureProjectDimension` will FIND it, not create a duplicate.

## Two phases

### Phase 3a — Outbound field sync + coding (projects appear in Ramp as a picklist)
Self-contained, no schema change, no edge-function change. Delivers: Carbon projects push to Ramp as the `carbon-project` SINGLE_CHOICE field (create/rename/**HIDE inactive**), and outbound coded draft bills carry the project selection; inbound decode recognizes it.

### Phase 3b — Inbound persistence round-trip (a project picked in Ramp lands as a Project dimension)
Schema + edge-function changes (beyond the written spec; touches posting paths). Delivers: a project chosen on a Ramp card transaction / bill flows back and persists as a `journalLineDimension` (entityType Project) on the posted journal.

---

## Status: COMPLETE
- Phase 3a: `76e7627671` (projects.ts field convergence, coding encode/decode, orchestration).
- Phase 3b schema: `1a22855b5b` (projectId columns on cardTransactionLine/purchaseInvoiceLine).
- Phase 3b code: `3dd5f63e30` (staging threading + edge-function Project journalLineDimension writes + repayment scaling).
- Docs: `83fa47f9de` (ramp-integration.md).
- Verified: erp/ee/jobs/database typecheck clean; ee 1170 tests + jobs 694 tests pass; edge functions produce zero deno-check errors in the edited files. Browser/live-Ramp-sandbox verification NOT done (needs a running stack + Ramp sandbox creds).

## Phase 3a tasks

### Task A1: `projects.ts` — Ramp field convergence (clone of cost-centers.ts)
**Files:** create `packages/ee/src/ramp/lib/projects.ts`; add `RAMP_PROJECT_FIELD_ID = "carbon-project"` to `coding.ts`.
Clone every helper from `cost-centers.ts` with `project`/`Project` naming: `projectFingerprint`, `buildProjectFieldBody` (`SINGLE_CHOICE`, `is_splittable: true`), `buildProjectOptionsBody` (option id = `project.id`), `diffProjectOptions` (identical create/rename/show/**hide-when-absent** logic), `ensureProjectField`, `ensureProjectDimension` (finds the existing slice-2 Project dimension by `entityType = "Project"`), `pushProjects`, and the internal mapping helpers using new `externalIntegrationMapping` entityTypes **`"project"`** (option) and **`"projectField"`** (field). Load desired from `.from("project").select("id, name").eq("companyId", companyId).eq("active", true)` — **active only** (inactive → absent from desired → HIDDEN in Ramp, matching the soft-delete decision).
**Verify:** `pnpm --filter @carbon/ee typecheck`; new `projects.test.ts` for `diffProjectOptions` (create/rename/hide/untracked-adopt).

### Task A2: `coding.ts` encode/decode
**Files:** `packages/ee/src/ramp/lib/coding.ts`, `__tests__/coding.test.ts`.
Add `projectId` to `RampCoding`; add the decode branch in `codeSelections` (`category_info.external_id === RAMP_PROJECT_FIELD_ID`); extend `buildLineCodingSelections` line to `{accountId, costCenterId, projectId}` + `pushed.pushedProjectIds`, emitting the project selection when pushed. Mirror the cost-center tests (incl. round-trip).
**Verify:** `pnpm --filter @carbon/ee test` (coding.test.ts) + typecheck.

### Task A3: outbound orchestration wiring
**Files:** `packages/ee/src/ramp/lib/service.ts` (export projects API), `packages/ee/src/ramp/hooks.server.ts` (`convergeRamp`: `pushProjects` next to `pushCostCenters`, same try/catch), `packages/jobs/src/inngest/functions/integrations/ramp-sync.ts` (new `ramp-projects` step cloned from `ramp-cost-centers`, folded into failure count + return), `ramp-sync-outbound.ts` (add `getAllByIntegration("ramp","project")` → `pushedProjectIds`), `spend.ts` `pushInvoiceDraftBill` (resolve line project from `line.dimensions?.find(d => pushed.pushedProjectIds.has(d.valueId))?.valueId`; pass `projectId`; extend `pushed` type). Update `hooks.server.test.ts` to assert `pushProjects` is called.
**Verify:** `pnpm --filter @carbon/ee typecheck && pnpm exec turbo run typecheck --filter=@carbon/jobs`; `pnpm --filter @carbon/ee test`.

## Phase 3b tasks

### Task B1: schema — `projectId` on line tables
**Files:** new migration. Add nullable `"projectId" TEXT` + tenant-composite FK `("projectId","companyId") REFERENCES "project"("id","companyId")` (verify project PK shape) + index, on `cardTransactionLine` and `purchaseInvoiceLine`, mirroring their existing `costCenterId` columns. `pnpm db:migrate` + regenerate types.
**Verify:** `db:check:datasets`, `db:check:backups`, `@carbon/database` typecheck.

### Task B2: staging + verify threading
**Files:** `ramp-sync-card.ts` (`BuiltLine.projectId`), `ramp-sync-shared.ts` (`verifyProjects` cloned from `verifyCostCenters`), `ramp-sync-card-stage.ts` (write `cardTransactionLine.projectId`), `ramp-sync-bill.ts`/`ramp-sync-bill-stage.ts` + `ramp-sync-reimbursement.ts` (write `purchaseInvoiceLine.projectId`).
**Verify:** `pnpm exec turbo run typecheck --filter=@carbon/jobs`.

### Task B3: edge-function posting — write the Project journalLineDimension
**Files (SENSITIVE posting paths):** `post-card-transaction/post-card-transaction-post.ts` (+ `-void.ts`, `build-card-transaction-journal.ts`), `post-purchase-invoice/index.ts`. Clone the CostCenter → `journalLineDimension` block: validate `projectId`s against `project`, resolve the active `Project` dimension, insert `{ journalLineId, dimensionId: projectDimensionId, valueId: line.projectId, companyId }`; mirror in void.
**Verify:** edge tests if present; typecheck; browser/round-trip verification (blocked without a running stack + Ramp sandbox).

---

## Risks / notes
- **Ask-First class** (`@carbon/ee` AGENTS): a new custom Ramp field round-tripping as a dimension. Phase 3b edits sensitive posting edge functions and adds columns to financial line tables — beyond the written spec. Confirm scope before 3b.
- Keep Cost Center convergence UNCHANGED (parallel field, own constant id).
- Ramp gotcha (from brisbane-96): a draft-bill line with `remote_id` set must NOT send `enable_accounting_sync:false` (422).
- Browser/round-trip verification needs a running `crbn up` ERP + Ramp sandbox creds — likely blocked (shared worktree). Field-convergence + coding are unit-testable without the stack.
