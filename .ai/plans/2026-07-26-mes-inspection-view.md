# MES Inspection Execution View (`operationType = 'Inspection'`)

## Context

This branch (feat/mes-assembly) added three pillars: (1) the MES Assembly view, (2) the unified quality-module inspection execution UI (tracked + non-tracked, currently receipt-only), and (3) the `operationType` consolidation (`Process | Assembly | Inspection | Outside Processing`) that routes MES execution views. The final step ties them together: a MES view at `/x/inspection/:operationId` for Inspection operations that executes the operation's inspection plan using the same quality `inspection` lot system, while keeping shop-floor actions (time, parts, scrap, rework, quality issues).

Everything is staged for this:
- `jobOperation.inspectionDocumentId` FK = the plan link ("the FK is the truth", migration `20260721022847`)
- `inspection.sourceDocument` enum already has `'Job Operation'`; unique partial index on `(sourceDocument, sourceDocumentLineId)`; `dispositionInspection` already guards receipt-only stock logic ("Job Operation inspections act on WIP")
- MES `resolveOperationView('Inspection') → "inspection"` is a reserved slot; `operation.$operationId.tsx:77-82` documents the fall-through "until its route ships (Phase 3)"
- The 2026-07-21 spec: InspectionView was built data-prop "so the same UI can be attached to job operations in MES next"

Note: the older 2026-07-14 spec §5.4 designed a separate `jobOperationInspectionRecord` table — **superseded** by the 2026-07-22 inspections refactor (generic source documents). This plan updates the spec accordingly.

## Key decisions (approved via this plan)

1. **One shared engine, no duplication.** The inspection engine (`upsertInspectionSample`, `upsertInspectionMeasurement`, `dispositionInspection`, `reconcileInspectionSamplingPlans`, `changeInspectionDocument`, `valuateMeasurement`) moves from `apps/erp/app/modules/quality/quality.server.ts` to a new **`@carbon/database/quality`** export (`packages/database/src/quality.ts`). Functions gain a `db: Kysely<KyselyDatabase>` first param; ERP's `quality.server.ts` becomes thin wrappers with unchanged names/signatures (zero ERP route changes). Verified: the engine's only deps are kysely, `KyselyDatabase`, validator-inferred types (replaced by plain package-side types), and the sampling resolver — no ERP-only imports.
   - `packages/database/src/sampling.ts` re-exports the pure Deno `supabase/functions/shared/sampling-engine.ts` (same pattern `src/client.ts` already uses for the postgres client).
2. **Lot creation is lazy find-or-create.** New `getOrCreateJobOperationInspection(db, { jobOperationId, companyId, userId })` in the package, called by the MES loader on first open. Mirrors post-receipt: resolves `itemSamplingPlan` + `companySettings.samplingStandard` (lotSize = `operationQuantity`), per-feature plans from the operation's `inspectionDocumentId`, inserts `inspection` (+ `inspectionSamplingPlan`) idempotently against the partial unique index (select-first in txn + 23505 fallback). Fields: `sourceDocument='Job Operation'`, `sourceDocumentId=job.id`, `sourceDocumentLineId=jobOperationId`, `sourceDocumentReadableId=job.jobId`, human id via the node-safe Deno `get-next-sequence` helper (sequence key `inspection`). **No DB migration needed** — verified enum, index, sequence re-key, and RLS all exist.
3. **MES-native UI, same concepts.** MES cannot import ERP app code; ERP's grid depends on ERP-only `~/components/Table`/`Editable`. So (AssemblyView precedent): a new MES `InspectionView` (full-screen, `size="lg"`) with a **new plain-table measurement matrix** implementing the same contract as ERP's grid (features × samples, live valuation, derived statuses, quiet per-cell POSTs, synthetic "Overall result" row when no features, disabled cells beyond a feature's n). `InspectionDrawingPane` (react-pdf + konva balloons) copies **verbatim** (zero ERP deps); `RejectLotModal` copies near-verbatim (action URL already a prop); `ScanInspectionSample` adapts (`@carbon/form` imports, make-method WIP entities instead of receipt entities).
4. **Job-op lots never touch WIP entity status.** Add `sourceDocument === "Receipt"` guards at the two entity-flip call sites (`upsertInspectionSample` ~L187, `upsertInspectionMeasurement` ~L744-767) during the move — receipt behavior is bit-identical; job WIP entities stay Reserved. `dispositionInspection` is already guarded (job-op Reject returns `writeOff: null` → no post-nonconformance invoke in MES).
5. **Shop-floor actions reuse existing MES routes/modals** exactly as AssemblyView does: TimerControl → `/x/event`, Log Completed → QuantityModal → complete/finish, Scrap → QuantityModal → `/x/scrap`, Rework → ReworkModal, Quality Issue → QualityIssueModal → `/x/quality-issue/new`.
6. **Reject creates the NCR via MES's own path** (not ERP's `insertIssue` flow): extract the NCR creation from `quality-issue.new.tsx` into `apps/mes/app/services/quality.server.ts` `createQualityIssue(...)` (links `nonConformanceJobOperation`), and the reject route adds the `nonConformanceInspection` link + ERP's failed-features description block (pure string building, copied).
7. **New MES deps** (mirror ERP pins; needs approval per repo rules): `kysely: catalog:`, `konva ^9.3.22`, `react-konva ^18.2.10`, `pdfjs-dist 5.4.296`, plus ERP's canvas SSR stub + vite alias + pdf.js worker bootstrap.

## Tasks

### 1. Deps + plumbing
- `apps/mes/package.json`: add `kysely`, `konva`, `react-konva`, `pdfjs-dist` (mirror `apps/erp/package.json` pins).
- Copy `apps/erp/app/ssr-shims/canvas-stub.cjs` → `apps/mes/app/ssr-shims/`; add vite `resolve.alias` `canvas` entry (mirror `apps/erp/vite.config.ts:65`).
- Add pdf.js worker bootstrap to `apps/mes/app/entry.client.tsx` (from ERP `entry.client.tsx:1-5`).
- NEW `apps/mes/app/services/database.server.ts` — copy ERP's 30-line Kysely singleton verbatim.
- Verify: `pnpm install && pnpm exec turbo run typecheck --filter=mes`

### 2. Shared engine package (`@carbon/database/quality` + `/sampling`)
- NEW `packages/database/src/sampling.ts`: `export * from "../supabase/functions/shared/sampling-engine.ts"`.
- NEW `packages/database/src/quality.ts`: move engine bodies from ERP `quality.server.ts` (inventory: `Result`/`errResult`, `computeLotStatus`, `applySampleEntityStatus` (private), `upsertInspectionSample`, `dispositionInspection`, `parseSpecNumber`, `valuateMeasurement`, `upsertInspectionMeasurement`, `reconcileInspectionSamplingPlans`, `changeInspectionDocument`). Add `db` first param (replace internal `getDatabaseClient()`); declare plain input types package-side (`InspectionSampleInput`, `InspectionMeasurementInput`, `InspectionDispositionInput` — structurally assignable from ERP's zod-inferred types); sampling imports from `./sampling.ts`. Apply the Receipt guards (decision 4) here.
- `packages/database/package.json`: add `"./quality"` + `"./sampling"` exports.
- Verify: `pnpm exec turbo run typecheck --filter=@carbon/database`

### 3. ERP wrappers (behavior-preserving)
- Rewrite `apps/erp/app/modules/quality/quality.server.ts` as ~60 lines of wrappers passing `getDatabaseClient()`; re-export `errResult`, `valuateMeasurement`, `type Result` (consumed by `quality-disposition.server.ts` and `quality.server.test.ts`). Zero changes to ERP routes.
- Verify: `pnpm exec turbo run typecheck --filter=erp && pnpm --filter erp test`

### 4. `getOrCreateJobOperationInspection` (package)
- Append to `packages/database/src/quality.ts` per decision 2. Blueprint: `post-receipt/index.ts` L694-800 (plan resolution) + L1903-1935 (inserts); sequence via node-safe `../supabase/functions/shared/get-next-sequence.ts`. Stamp `inspectionDocumentId` from the operation FK; `sampleSize` = max across feature plans (or lot snapshot); insert `inspectionSamplingPlan` rows on create only.
- Verify: `pnpm exec turbo run typecheck --filter=@carbon/database`

### 5. MES validators + types + read services
- `apps/mes/app/services/models.ts`: append `inspectionSampleValidator`, `inspectionMeasurementValidator` (copy shapes from ERP `quality.models.ts:487-535`).
- NEW `apps/mes/app/services/quality.service.ts` (supabase-js reads, copied from ERP quality.service.ts): `getInspection`, `getInspectionSamplingPlans`, `getInspectionMeasurements`, `getIssueTypesList`, plus simplified `getInspectionDocumentWithBalloons` (doc name/content + the 5 balloon fields). Types via `Awaited<ReturnType<...>>` in `apps/mes/app/services/types.ts`.
- Verify: `pnpm exec turbo run typecheck --filter=mes`

### 6. MES path helpers + action routes + NCR helper
- `apps/mes/app/utils/path.ts`: `inspection(operationId)` → `/x/inspection/:operationId`; lot actions under a distinct prefix (param is the **inspection id**, not operation id): `inspectionMeasurement|Sample|Accept|Reject(id)` → `/x/inspection-lot/:id/{measurement,sample,accept,reject}`.
- NEW routes in `apps/mes/app/routes/x+/` (flat dot-notation, precedent `record.$id.delete.tsx`): `inspection-lot.$id.measurement.tsx`, `inspection-lot.$id.sample.tsx`, `inspection-lot.$id.accept.tsx`, `inspection-lot.$id.reject.tsx`. Each: `requirePermissions({ update: "quality" })` → MES validator → engine call with `getDatabaseClient()`. Response shapes must match the grid contract: measurement returns `data(result)` (`body.data.{sampleId,measurementStatus,sampleStatus,...}`); sample returns `{ success, sampleId }` honoring `quiet`.
- NEW `apps/mes/app/services/quality.server.ts`: `createQualityIssue(serviceRole, args)` extracted verbatim from `quality-issue.new.tsx` (sequence RPC, `nonConformance` insert, `nonConformanceJobOperation`/item/entity links, `create` edge-fn tasks invoke, compensating deletes). Rewire `quality-issue.new.tsx` action as a thin wrapper (same UX).
- Reject route: `dispositionInspection(Reject)` → if `createNcr`: failed-features description (copy ERP `$id.reject.tsx:159-196`), `createQualityIssue(...)` with `jobOperationId = inspection.sourceDocumentLineId`, then insert `nonConformanceInspection` link. Redirect back to `path.to.inspection(operationId)` (hidden field) with flash. No post-nonconformance invoke (writeOff is null for job-op source).
- Verify: `pnpm exec turbo run typecheck --filter=mes`

### 7. MES view route + redirect branch
- `operation.$operationId.tsx:77-82`: replace the fall-through comment with `if (resolveOperationView(op?.operationType) === "inspection") throw redirect(path.to.inspection(operationId) + url.search);`
- NEW `apps/mes/app/routes/x+/inspection.$operationId.tsx` mirroring `assembly.$operationId.tsx`: job/op fetch + error redirects; guard (`!== "inspection"` → operation route, no loops); `getOrCreateJobOperationInspection`; `reconcileInspectionSamplingPlans` when the lot has a document; parallel reads — inspection/features/measurements/doc+balloons/issue types (new quality.service), WIP entities via `getTrackedEntitiesByMakeMethodId` (NOT the receipt-specific read), plus the shop-floor set from the assembly loader (events, quantities reduced to `{scrap, production, rework}`, work center, make method, ncrs, thumbnail, company settings). Returns props for `<InspectionView />`; `pdfUrl = doc?.content?.pdfUrl ?? null`.
- Verify: `pnpm exec turbo run typecheck --filter=mes`

### 8. MES components (`apps/mes/app/components/Inspection/`)
- `InspectionDrawingPane.tsx` — copy verbatim from ERP (lazy + ClientOnly).
- `RejectLotModal.tsx` — copy; inline the `IssueTypeListItem` type; add hidden `operationId` field support.
- `ScanInspectionSample.tsx` — adapt: `@carbon/form` (`Hidden`,`Submit`,`TextArea`), MES validator/path/types; `remaining` = make-method entities minus sampled; posts to `path.to.inspectionSample(id)`.
- `InspectionMeasurementMatrix.tsx` — NEW plain `<table>` matrix, ERP grid contract (props incl. `activeFeatureId` sync, `OVERALL_ROW_ID`), big touch cells (`size="lg"` idiom, `inputMode="decimal"`, commit on blur/Enter, P/F toggles for attribute features), cells beyond a feature's n disabled; port `persistMeasurement`/`persistOverall` quiet-fetch logic + local status mirroring from ERP grid L174-265.
- `InspectionView.tsx` — NEW full-screen AssemblyView-pattern: header (job/item/thumbnail, lot id + status badge, sampling summary n/Ac/Re, Add Sample for serial with auto-open-once on fresh lots, Accept/Reject); port ERP's pure-react gating state verbatim (`canAccept`/`canReject`/`failedFeatureSummary` etc., InspectionView.tsx:230-420); drawing pane above matrix when `pdfUrl` (fixed split for v1), balloon↔row sync; TimerControl (copy from AssemblyView L2355) posting `/x/event`; Log Completed mirroring AssemblyView's wiring; bottom action sheet: Scrap / Rework / Quality Issue / Finish via the shared JobOperation modals. No client-side permission gating (MES convention); four-eyes + document-switch are ERP-only for v1.
- New strings use `Trans`/`useLingui`; run `pnpm lingui:extract` (+ fill via /translate flow) at the end.
- Verify: `pnpm exec turbo run typecheck --filter=mes && pnpm --filter mes build` (gates konva SSR + pdf worker)

### 9. Docs sync (same PR, keep-sources-in-sync)
- `.claude/rules/inspection-system.md`: Job Operation source now live (creation path, MES routes, entity-flip guards, engine home `@carbon/database/quality`).
- `.claude/rules/mes-job-operation-ui.md`: inspection route + redirect branch.
- `apps/erp/app/modules/quality/AGENTS.md` (+ `packages/database/AGENTS.md` if it lists exports): engine move.
- `.ai/specs/implemented/2026-07-14-mes-execution-views.md`: mark §5.4 result-record superseded by the unified inspection tables; §5.1 Phase-3 shipped. `.ai/specs/implemented/2026-07-21-inbound-inspection-execution.md`: MES attachment note.
- Copy this plan to `.ai/plans/2026-07-26-mes-inspection-view.md` with checkboxes.

### 10. Verification (end-to-end)
- `pnpm exec turbo run typecheck --filter=@carbon/database --filter=erp --filter=mes`; `pnpm --filter erp test`; `pnpm run lint`.
- No migration → no `generate:types`.
- Browser (dev stack, /auth + /test skills, screenshots for PR): author method op `operationType='Inspection'` + inspection document → create job → `/x/operation/:id` redirects to `/x/inspection/:id` → lot auto-created (`sourceDocument='Job Operation'`, INS-seq readable id, idempotent on reload) → record measurements (live valuation, statuses without reload) → serial: Add Sample scan flow → clock in/out + Log Completed → Accept gated until n covered → Reject creates NCR with `nonConformanceJobOperation` + `nonConformanceInspection` links → WIP `trackedEntity.status` unchanged by failed samples → ERP regression: receipt inspection still records + flips entities (wrapper + guards preserved behavior) → ERP `/x/quality/inspections` list shows the job-op lot.

## Risks
- **Kysely ON CONFLICT vs partial unique index** — mitigated: select-first inside the txn + 23505-catch fallback.
- **Node import of Deno-tree helpers** (`get-next-sequence.ts` chain) — verified side-effect-free/node-safe; `src/client.ts` is the precedent.
- **konva/react-pdf first run in MES SSR** — config copied from working ERP; `pnpm --filter mes build` is the gate.
- **Engine move regressions in ERP receipts** — guards are bit-identical for Receipt source; ERP vitest + manual receipt regression cover it.
- **Ops prerequisites** — operators need `quality_update`; NCR path expects ≥1 `nonConformanceType`.
