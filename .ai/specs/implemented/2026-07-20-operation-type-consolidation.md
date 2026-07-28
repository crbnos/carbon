# Operation Type Consolidation — one enum for operations and processes

> Status: implemented (branch feat/mes-assembly, migration 20260721004140)
> Author: Brad Barbin (design) + Claude (spec)
> Date: 2026-07-20
> Research: [.ai/research/operation-type-consolidation.md](../research/operation-type-consolidation.md)
> Supersedes: the "Operation Type + Kind merge" section and ADR §5.1 keying of [2026-07-14-mes-execution-views.md](2026-07-14-mes-execution-views.md)

## TLDR

The `feat/mes-assembly` branch added an `operationKind` column (`Operation | Assembly | Inspection`) alongside the pre-existing `operationType` enum (`Inside | Outside`), plus a UI-only "classification" shim that merges the two. That two-column model was a mistake. This spec collapses everything into a **single `operationType` Postgres enum with values `Process | Assembly | Inspection | Outside Processing`**, applied to `methodOperation`, `quoteOperation`, `jobOperation`, **and `process.processType`** (same enum type, so they can never drift). Data maps `Inside → Process`, `Outside → Outside Processing`, and folds `operationKind` in (`Assembly`/`Inspection` win over `Operation`; `Outside` wins over everything). All "inside" business logic becomes `operationType !== 'Outside Processing'` so future in-house types don't touch costing/scheduling/PO code; the MES assembly view keys on `operationType === 'Assembly'`.

## Problem Statement

- The branch shipped a bastardized model: the Items BoP editor uses a merged 4-value picker that writes two hidden columns; the Job BoP shows **two separate selects** (`operationType` + `operationKind`); the Quote BoP shows only the old binary select and can't classify at all. Three editors, three different UXes for the same concept.
- Two columns encode one user-facing concept, with an app-side mapping shim (`classificationFromTypeKind` / `typeKindFromClassification` in `apps/erp/app/modules/shared/operationKind.ts`) that every consumer must know about. Contradictory states (`Outside` + `Assembly`) are representable in the DB but meaningless.
- `process.processType` (`Inside | Outside | Inside and Outside`) uses the old vocabulary, so after the operation-side rename the two enums would describe the same axis with different words.
- Competitor research validates the single-enum shape: Oracle Fusion models exactly one per-operation type (`In-House | Supplier`); "Outside Processing" is the dominant industry term. "Assembly" as a type is novel (others attach instructions to any op) but safe because it behaves in-house everywhere except the MES view router.

## Proposed Solution

One enum, four values, everywhere:

```
operationType: 'Process' | 'Assembly' | 'Inspection' | 'Outside Processing'
```

- **Semantic rule (the load-bearing invariant):** subcontract behavior keys on `=== 'Outside Processing'`; in-house behavior keys on `!== 'Outside Processing'`. Never enumerate the in-house values in business logic — that is what lets us add more in-house types later without touching costing, scheduling, PO generation, or the traveler.
- **MES view routing:** `Assembly → /x/assembly`, `Inspection → /x/inspection` (falls through to the operation view until the Phase-3 inspection view exists), everything else → `/x/operation`. Same redirect-guard architecture as today, re-keyed.
- **`process.processType` uses the same Postgres enum type** (`"operationType"`) and becomes the *default operation type* for operations using that process: BoP editors seed `operationType = process.processType` directly. The old "Inside and Outside" capability is expressed by data, not the enum: former "both" processes land as `Outside Processing` (their `workCenterProcess` links keep in-house execution possible), ProcessForm's work-center and supplier sections are both always visible, and an operation on any process can be overridden to either side.
- **App layer:** a single `operationTypes` const in `apps/erp/app/modules/shared/shared.models.ts` serves operations *and* processes (the separate `processTypes` const is deleted). `shared/operationKind.ts` is deleted entirely.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Value names | `Process`, `Assembly`, `Inspection`, `Outside Processing` | Brad's directive (renames the PRD's "Standard" → "Process"). "Outside Processing" matches Oracle/NetSuite/Infor and Carbon's own `purchaseOrderType` value. "Batch" stays dropped — it's the item tracking type's job. |
| Inside-logic pattern | `!== 'Outside Processing'` (never `=== 'Process'`, never in-house value lists) | Extensibility: new in-house types inherit costing/scheduling/PO behavior for free. Matches how SAP/Oracle hard-wire only the in-house/external boundary. |
| Data mapping | `Outside → Outside Processing` first, then `operationKind Assembly/Inspection → same`, else `Process` | Outside-wins precedence is the existing `classificationFromTypeKind` precedent; contradictory rows can't round-trip into the UI today. |
| processType | Same Postgres enum type as operations; `Inside → Process`, `Outside → Outside Processing`, `Inside and Outside → Outside Processing`; `processType` enum type dropped | Brad's decision (2026-07-20): "mirror the new enum exactly — use the same enum so it stays in sync; single const in shared.models.ts"; "inside and outside should land as outside processing". Former "both" processes keep in-house capability via their `workCenterProcess` links + per-operation override. |
| Migration mechanism | Rename old type aside → create new `"operationType"` → per-table `ALTER COLUMN ... TYPE ... USING CASE` (reads `operationKind` in the same expression) → drop `operationKind` columns → drop old types | Equivalent to the temp-column approach (the "temporary" artifact is the renamed old *type*, not a column) with one atomic, easily-guarded conversion per table and no column-order churn. Temp-column variant remains a valid fallback if plan-time validation finds a blocker. |
| Migration packaging | **(Amended by Brad, 2026-07-20)** Edit the squashed branch migration inline so `operationKind` never exists anywhere (branch SQL is unmerged); its `get_job_operation_by_id` redefinition surfaces `operationType` instead. One new forward migration (fresh timestamp `> 20260720094011`) handles only the enum swap for data that exists on deployed DBs. Local DBs are rebuilt with `crbn reset`, then types regenerate cleanly. | Cleanest possible history — no add-then-drop column. The reset eliminates the local-drift and polluted-types problems in one stroke (local Assembly/Inspection demo data is accepted as lost). |
| Enum labels in UI | Render raw enum values (existing `Enumerable`/options-map pattern); icons via `OperationTypeIcon` | Matches every other enum in the app; "Outside" badges become "Outside Processing". |
| H1 multi-tenancy | N/A — no new tables; columns live on existing tenant-scoped tables | Composite PKs/`companyId` untouched. |
| H2 service shape | No new services; existing signatures unchanged | Only literals and copied field lists change. |
| H3 RLS | Unchanged; recreated views keep `SECURITY_INVOKER=true` | No policy references either column (verified). |
| H4 permissions | Unchanged — existing route scopes cover all touched routes | No new routes. |
| H5 forms | Existing `ValidatedForm` validators keep field name `operationType`; `operationKind` fields removed | Single `z.enum(operationTypes)`; refines re-keyed. |
| H6 module layout | Consts in `shared.models.ts`; `shared/operationKind.ts` deleted; barrel updated | One const per Brad's directive. |
| H7 backward compatibility | Breaking for API filters/CSV templates that send `Inside`/`Outside`; CSV import accepts legacy aliases; configurator returns normalized at the get-method boundary | See Risks. Accepted as part of the directive; swagger schema regenerates. |

## Data Model Changes

New migration `2026XXXXXX_operation-type-consolidation.sql` (fresh timestamp newer than main's `20260720094011`, random HHMMSS per convention). Every step guarded so a deploy-runner retry over partially-committed state is safe. Sketch (guards elided for readability — the plan writes them; the pattern is `DO $$` blocks checking `pg_type`/`information_schema.columns` state):

```sql
-- 1. Move the old enum aside and create the new one under the same name
--    (guard: skip if "operationType" already has label 'Process')
ALTER TYPE "operationType" RENAME TO "operationType__old";
CREATE TYPE "operationType" AS ENUM ('Process', 'Assembly', 'Inspection', 'Outside Processing');

-- 2. Drop dependent views (they all project t.*)
DROP VIEW IF EXISTS "jobOperationsWithMakeMethods";
DROP VIEW IF EXISTS "jobOperationsWithDependencies";
DROP VIEW IF EXISTS "quoteOperationsWithMakeMethods";
DROP VIEW IF EXISTS "processes";

-- 3. Convert the three operation tables (guard per table: skip if already new type)
--    Same block for "quoteOperation" and "jobOperation". No operationKind anywhere:
--    the squashed branch migration is edited inline so the column never existed.
ALTER TABLE "methodOperation" ALTER COLUMN "operationType" DROP DEFAULT;
ALTER TABLE "methodOperation"
  ALTER COLUMN "operationType" TYPE "operationType"
  USING (CASE
    WHEN "operationType"::text = 'Outside' THEN 'Outside Processing'
    ELSE 'Process'
  END)::"operationType";
ALTER TABLE "methodOperation" ALTER COLUMN "operationType" SET DEFAULT 'Process';

-- 4. Convert process.processType to the SAME enum type
ALTER TABLE "process" ALTER COLUMN "processType" DROP DEFAULT;
ALTER TABLE "process"
  ALTER COLUMN "processType" TYPE "operationType"
  USING (CASE
    WHEN "processType"::text = 'Inside' THEN 'Process'
    ELSE 'Outside Processing'   -- 'Outside' and 'Inside and Outside' both land here
  END)::"operationType";
ALTER TABLE "process" ALTER COLUMN "processType" SET DEFAULT 'Process';

-- 5. Drop the retired types (after the function redefinitions below — the old
--    get_job_operation_by_id signature references the old enum type)
DROP TYPE IF EXISTS "operationType__old";
DROP TYPE IF EXISTS "processType";

-- 6. Recreate the four views, forked verbatim from their NEWEST definitions:
--    jobOperationsWithMakeMethods, jobOperationsWithDependencies → 20260610151942_assembly-instructions.sql
--    quoteOperationsWithMakeMethods → 20250603011801_make-method-version.sql
--    processes → 20260120171236_process-active-column.sql

-- 7. Redefine get_job_operation_by_id: DROP FUNCTION + recreate bound to the NEW enum
--    (the edited squashed migration already surfaces "operationType" instead of
--    operationKind, but its signature is bound to the OLD enum type at that point in
--    history — recreate here before dropping "operationType__old").

-- 8. Re-land get_method_tree forked from main's NEWEST definition (20260714084035_remove-bom-line-effectivity.sql)
--    merged with the branch's methodOperationStepIds additions — see Risks (ordering bug).
```

Facts the sketch relies on (verified):
- `operationType` columns exist on exactly three tables, all `NOT NULL DEFAULT 'Inside'` (`20240823024502`, `20240915192542`). No other table has one.
- `operationKind` existed only in the squashed branch migration `20260705143722_mes-assembly-view.sql` (enum + 3 columns), which is edited inline by this work so the column and enum never exist; its `get_job_operation_by_id` redefinition now surfaces `operationType` (the MES router's input). Requires `crbn reset` on local DBs that applied the old version.
- No indexes, CHECK constraints, or triggers reference either column; no seed data writes them.
- Only two SQL functions reference them: `get_job_operation_by_id` (returns `operationKind` — the MES router's source) and `get_sales_order_lines_by_customer_id` (surfaces `jo."operationType"` into JSON pass-through — needs **no change**; converted row values flow through).
- `supplierProcesses` and `workCenters` views don't project `process.processType` — no recreation needed (verify at plan time).
- On prod at deploy time, migrations apply in timestamp order: the squashed branch migration adds `operationKind` (all rows default `'Operation'`), then this migration folds and drops it — so the `USING` expression is valid on both prod and already-migrated local DBs.

Post-migration: `pnpm run generate:types` (against a clean local DB — the branch previously hand-edited `types.ts`, see Risks), then propagate via the type chain. Generated diff: `Enums.operationType` → 4 values; `Enums.operationKind` and `Enums.processType` disappear; `process.processType` typed as `Enums.operationType`; `swagger-docs-schema.ts` regenerates.

## API / Service Changes

**Deleted:** `apps/erp/app/modules/shared/operationKind.ts` (whole file: `operationKinds`, `operationClassifications`, `OperationClassification`, `classificationFromTypeKind`, `typeKindFromClassification`) and its barrel line in `shared/index.ts:2`.

**Changed const (single source of truth):** `shared.models.ts:205` → `export const operationTypes = ["Process", "Assembly", "Inspection", "Outside Processing"] as const;` + `export type OperationType = (typeof operationTypes)[number];`. Delete `processTypes` (`shared.models.ts:223-227`); all its importers switch to `operationTypes`.

**Zod validators** — drop `operationKind` field, re-key refines (`=== "Inside"` → `!== "Outside Processing"`, `=== "Outside"` → `=== "Outside Processing"`):
- `items.models.ts:483-488` + Inside refines `:520,532,544,556,568,580`
- `production.models.ts:291-296` + Outside refines `:337,349,361,500,512,524,536` + Inside refines `:373-644` (19 sites)
- `sales.models.ts:434-439` + Outside refines `:474,486,498` + Inside refines `:510-606`
- `sales/ui/CustomerPortal/shared.ts:11` (picks up new values via the const)
- Resources: `resources.models.ts:306,312` (`processType !== "Outside"` → `!== "Outside Processing"`)

**Services / logic sites (ERP):**
- `production.service.ts:1638` `.eq("operationType", "Outside")` → `"Outside Processing"` (`getOutsideOperationsByJobId`)
- `sales.service.ts:4111` (`Inside` cost rollup → `!==`), `:4168` (`Outside` → `===`)
- `useLineCosts.tsx:152,360` (client mirror of the same)
- `utils/bom.ts:126` `calculateOperationUnitCost` (`Outside` → `Outside Processing`)
- `JobHeader.tsx:549` outside-ops PO check; `JobEstimatesVsActuals.tsx:297` `isOutside`
- BOM/cost API routes and CSV exports pass values through unchanged (plumbing): `api+/items.$itemId.recalculate-cost.ts:130`, `api+/*.bom.tsx`, `api+/*.bom[.]csv.tsx`

**Edge functions (Deno):**
- `get-method/index.ts` — remove `operationKind` from all 11 copy sites (`:730,1502,2261,2815,4961,5290,5792` verbatim; `:3216,3530,4178,4491` defaulted); `operationType: op.operationType ?? "Inside"` → `?? "Process"`; **normalize configurator returns**: `getConfiguredValue({ field: "operationType" })` (`:648,707,2169,2228`) may execute stored configuration-rule code returning legacy `'Inside'`/`'Outside'` — map them (`Inside → Process`, `Outside → Outside Processing`) before insert.
- `lib/methods.ts:667,748` — costing engine branches re-keyed
- `lib/scheduling/work-center-selector.ts:266` — skip `=== "Outside Processing"`
- `create/index.ts:421-422` — outside-ops filter for PO generation (`purchaseOrderType: "Outside Processing"` at `:586` is a different enum, already correct — untouched)
- `import-csv/method-import.ts:433-434,671,678,694` — gate on new values; **accept legacy aliases** `Inside → Process`, `Outside → Outside Processing` so existing CSV templates keep importing
- `import-csv/index.ts:2203-2204` — process import: map legacy `processType` values the same way
- `trigger-rework/index.ts:229` — copies `operationType`; no change beyond types

**MES:**
- `utils/operationView.ts` — resolver takes the new `OperationType`; `Assembly → "assembly"`, `Inspection → "inspection"`, default `"operation"` (Process, Outside Processing, null). Delete the local `OperationKind` type.
- `routes/x+/operation.$operationId.tsx:80` and `assembly.$operationId.tsx:78` — guards read `op.operationType` (now returned by the redefined RPC). Inspection still falls through to the operation view (no loop) until the inspection view ships.
- `services/operations.service.ts` — no literal changes; RPC return type flows from regenerated types.

**Packages:**
- `documents/pdf/blocks/jobTraveler/OperationsBlock.tsx:60` `isInside` → `!== "Outside Processing"`; `jobTraveler.samples.ts:50,66,82` fixture values updated
- `ee/paperless-parts/lib/lib.ts:2114-2115,3125-3126` → `operationType: process.processType` (identity — same enum now); `:2591` → `processType: is_outside_service ? "Outside Processing" : "Process"`
- `glossary/src/terms.ts` — rewrite `"operation-type"` definition for the 4-value model (currently describes binary inside/outside; the working tree is mid-edit on it); review `"outside-operation"` wording
- `packages/jobs`, `packages/utils`, academy, MCP routes: verified clean — no changes

## UI Changes

**All three BoP editors converge on one picker** (Items `BillOfProcess.tsx`, `JobBillOfProcess.tsx`, `QuoteBillOfProcess.tsx`): a single `SelectControlled name="operationType"` with the 4 options, `termId="operation-type"`, and `OperationTypeIcon` per option — replacing the Items editor's classification picker + 2 hidden inputs (`:1156-1196`), the Job editor's two separate selects (`:2987-3024`), and the Quote editor's binary select (`:1982-2001`).
- Defaults: `"Inside"` → `"Process"` (items `:211,1035`; job `:375,2836`; quote `:240,1836`); delete all `operationKind` defaults/state fields (`:212,1015,1036`; `:376,2816,2837`; `:241`)
- Process seeding: `onProcessChange` becomes `operationType: process.data?.processType ?? "Process"` (items `:1066`, job `:2906`, quote `:1905`) — the auto-suggest the PRD wanted, for free
- Unit-reset on change: reset setup/labor/machine units only when crossing the Outside Processing boundary (`(next === 'Outside Processing') !== (prev === 'Outside Processing')`), not on Process↔Assembly↔Inspection changes
- Conditional sections: `=== "Outside"` supplier fields → `=== "Outside Processing"` (items `:1298`-region, job `:3040`-region, quote `:2010`-region); `=== "Inside"` time fields → `!== "Outside Processing"` (items `:1346`, job `:3122`, quote `:2097`); tab-disabled logic (`Outside` ops have no steps/tools tabs): items `:578,618,664,719`; job `:867,904,929,964,989,1016`; quote `:586,650,693,735`
- Assembly steps sync gate: `item.data.operationKind === "Assembly"` → `operationType === "Assembly"` (items `:689`, job `:940`). Quote BoP intentionally still has no `AssemblyStepsSource` (non-goal)
- Cards/badges: `<Badge>Outside</Badge>` → renders the enum value ("Outside Processing") (items `:3824-3837`, job `:251-264`, quote `:183-196`, `SalesOrderLineJobs.tsx:434,470`)

**Icons** (`components/Icons.tsx`, currently uncommitted WIP): `OperationTypeIcon` re-typed to the new `OperationType`; `case "Standard"` → `case "Process"`; wire it into the new unified selects (it's currently defined but unused).

**Assembly sync UI:** `AssemblySyncModal.tsx:24,96-97` — `TargetOperation.operationKind` → `operationType`; badge shows when `operationType !== "Process"`; `routes/x+/assembly+/$id.sync-bop.tsx:49,68` select `operationType` instead of `operationKind`.

**Tables:** `MethodOperationsTable.tsx:63-71`, `JobOperationsTable.tsx:153-159` — filter options come from the new const automatically; `Enumerable` cells render new values.

**Process/resources UI (same-enum convergence):** `ProcessForm.tsx:137,152` — work-center and supplier sections both **always visible** (the enum is a default-type hint, not a capability gate; former "both" processes keep their work-center config on screen); `ProcessesTable.tsx:67,91`; `Form/Process.tsx:75`, `Form/Processes.tsx:48` defaults → `"Process"`; routes `processes.$processId.tsx:97`, `processes.new.tsx:78`; `imports.models.ts:1484-1494` (process import options) and `:254-266` (BoP import field: options → 4 values, default `Process`).

**Docs:** update docs-site pages describing inside/outside operations (carbon-docs sweep at implementation), and amend the MES execution-views PRD (glossary entry, ADR §5.1, Phase-4 roadmap item → done, changelog).

## Acceptance Criteria

- [ ] Migration on a DB with legacy rows maps: `(Inside, Operation) → Process`; `(Inside, Assembly) → Assembly`; `(Inside, Inspection) → Inspection`; `(Outside, anything) → Outside Processing`; `process` rows `Inside → Process`, `Outside → Outside Processing`, `Inside and Outside → Outside Processing`. Validated in a rolled-back psql transaction seeded with all combinations before applying anywhere.
- [ ] After migration: `operationKind` columns and the `operationKind`/`processType`/old `operationType` enum types no longer exist; all four converted columns are `NOT NULL DEFAULT 'Process'`; re-running the migration file end-to-end is a no-op (idempotency proof).
- [ ] All three BoP editors show one "Operation Type" select with exactly the 4 options + icons; choosing Outside Processing shows supplier-process fields and hides in-house time fields; the other three show time fields; submitted form data contains a single `operationType` field (no `operationKind`).
- [ ] Selecting a process whose `processType` is `Assembly` seeds the operation's type to Assembly (same for all values).
- [ ] Items + Job BoP show the assembly steps sync source exactly when `operationType === 'Assembly'`.
- [ ] MES: an Assembly operation opened at `/x/operation/:id` redirects to `/x/assembly/:id` and renders `AssemblyView`; a Process operation at `/x/assembly/:id` redirects back; an Inspection operation renders the standard operation view with no redirect loop.
- [ ] Costing parity: a quote line whose operations were `Inside` costs identically after conversion (labor/machine/overhead path for Process/Assembly/Inspection); an `Outside` operation costs identically as Outside Processing (min-clamped unit cost). Verified against a pre-migration costing snapshot.
- [ ] Job release still generates outside-processing POs for `Outside Processing` operations (`create` edge function), and JobHeader's outside-PO check finds them.
- [ ] Scheduling work-center assignment skips `Outside Processing` operations.
- [ ] CSV method import accepts the 4 new values AND legacy `Inside`/`Outside` (aliased); job traveler PDF renders in-house ops with the in-house layout and Outside Processing ops with the outside layout.
- [ ] get-method copies `operationType` verbatim method→job and method→quote for all 4 values; a configuration rule returning legacy `'Outside'` produces an `Outside Processing` operation.
- [ ] `pnpm run generate:types` produces a clean diff (4-value enum; no operationKind/processType enums); scoped typechecks pass for `erp`, `mes`, `@carbon/database`, `@carbon/documents`, `@carbon/ee`; `pnpm run lint` passes.
- [ ] Browser e2e (per house rule): create/edit operations of each type in the Items BoP, verify MES assembly routing, verify an outside-processing quote line's costs render.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Missed literal `'Inside'`/`'Outside'` site (loosely-typed: `bom.ts`, Deno edge functions, RPC JSON consumers) | High | Generated enum change turns typed comparisons into TS errors (impossible-comparison); finish with a repo-wide grep for `"Inside"`/`"Outside"` excluding the verified adjacent concepts (below). |
| Adjacent same-string concepts accidentally "fixed" | Med | Explicit exclusion list: `purchaseOrderType`/`supplierQuoteType` `= 'Outside Processing'` (already correct), `outsideCost` bucket label "Outside", `jobOperationStep.type = 'Inspection'` (step type), `itemTrackingType` "Batch". `processType` is now IN scope. |
| `get_method_tree` ordering bug (pre-existing): main's `20260714084035` redefines it NEWER than the squashed branch migration's step-link redefs — timestamp-ordered prod deploy would silently revert the branch's `methodOperationStepIds` feature | High | This migration re-lands `get_method_tree` forked from the newest definition merged with the branch's additions; extract verbatim + diff-verify (lessons: fork newest, sed-extract). |
| Squashed branch migration sub-section 8 (six `*MaterialStep`/`*ToolStep` join tables) has unguarded `CREATE TABLE`/`CREATE POLICY` — a deploy-retry over partial state would wedge | Med | Harden that section with `IF NOT EXISTS`/`DROP POLICY IF EXISTS` guards in the same PR (editing an unshipped branch file is safe; already-applied local DBs skip it by filename). |
| Enum swap rewrites 4 tables under ACCESS EXCLUSIVE locks | Low | Operation tables are moderate-sized; single-transaction migration during normal deploy window. |
| Configuration rules (`configurationRule` code) returning legacy values post-migration | Med | Normalize at the get-method boundary (only consumer); acceptance criterion covers it. |
| Branch `types.ts` was hand-edited (PRD §6 caveat); regen against a polluted dev DB | Med | Regenerate against a clean local DB after applying the migration; review the diff before commit. |
| API consumers filtering `rowFilter.*.operationType=Inside/Outside` break at deploy | Low | Accepted (Brad's directive). Swagger schema regenerates; note in release notes. No MCP/AI tool schemas reference the values (verified). |
| Paperless Parts import writes legacy values after deploy | Med | Mappings updated in the same PR (`packages/ee`); enum rejects stragglers loudly rather than corrupting. |
| Branch migrations remain backdated vs main (applied out of order on remotes) | Med | Contained: only `get_method_tree` collides (re-landed here); everything else in the squashed file creates new objects. Re-timestamping rejected — it would force a full re-run on local DBs through the non-idempotent section. |

## Open Questions

> All resolved before this spec was written (2026-07-20). Autonomous resolutions were surfaced in-session before writing; veto any and the spec gets amended.

- [x] What do the new `processType` values become, and where does `'Inside and Outside'` land? — **Answer (Brad):** mirror the new enum exactly and use the *same* Postgres enum type so it stays in sync, with a single const in `shared.models.ts`. `Inside → Process`, `Outside → Outside Processing`, and — per Brad's follow-up correction — `'Inside and Outside' → Outside Processing`. Consequence (autonomous): ProcessForm's work-center and supplier sections are both always visible so former "both" processes keep their work-center config reachable; capability lives in `workCenterProcess`/`supplierProcess` rows, not the enum.
- [x] Value naming: PRD had agreed "Standard"; directive says "Process" — **Answer (Brad, this request):** `Process`. Research note: no direct industry precedent for the label ("In-House"/"Standard" elsewhere) but conflict-free; adjacent "Process" entity (work center process) disambiguated by the select label "Operation Type" + glossary term.
- [x] Enum conversion mechanism: literal temporary column (as suggested) vs type-rename + `USING` cast? — **Autonomous (surfaced, no objection):** type-rename + `USING` cast; identical outcome and lock profile, one atomic guarded step per table, no column-order churn. Temp-column variant documented as fallback.
- [x] Contradictory rows (`Outside` + `Assembly`/`Inspection`)? — **Autonomous:** Outside wins → `Outside Processing`, matching `classificationFromTypeKind` precedence. Such rows can't be produced by the current UI.
- [x] Migration packaging: edit the squashed branch migration to never add `operationKind`, vs one new forward migration? — **Answer (Brad, implementation kickoff):** the branch SQL is unmerged — edit it inline so `operationKind` never exists, run `crbn reset` locally, regenerate types from the clean DB. The forward consolidation migration remains only for the enum swap of columns that exist on deployed DBs (`operationType` since 2024, `processType`). Section-8 idempotency hardening happens in the same inline edit.
- [x] CSV templates and API callers sending legacy values? — **Autonomous:** import boundary accepts `Inside`/`Outside` as aliases; REST/PostgREST filters are hard-switched (regenerated schema).
- [x] MES Inspection routing before the inspection view exists? — **Autonomous (PRD precedent):** unchanged — falls through to the operation view, no redirect, no loop.
- [x] Work-queue navigating directly by type (skip the redirect hop)? — **Autonomous:** deferred non-goal; guards are required regardless for stale links. Noted as follow-up now that the RPC returns `operationType`.
- [x] Should the Quote BoP gain assembly steps authoring now that quote ops can be `Assembly`? — **Autonomous:** no; out of scope (parity with today). Known gap recorded in the PRD.

## Non-Goals

- `purchaseOrderType` / `supplierQuoteType` enums (already use "Outside Processing"), the `outsideCost` cost bucket and its "Outside" label, `jobOperationStep.type` (step types include an unrelated "Inspection"), and item tracking types.
- The MES inspection view (Phase 3 of the PRD) — this refactor only preserves its routing slot.
- Quote BoP steps/assembly authoring; work-queue direct-by-type navigation (both recorded as follow-ups).

## Changelog

- 2026-07-20: Created after full-codebase inventory (DB, ERP, MES/packages) + competitor research. All open questions resolved pre-writing: processType/same-enum/single-const decisions by Brad in-session; remaining resolutions autonomous per spec-writing skill (surfaced for veto). Scope addition by Brad: `processType` folded into the same enum.
- 2026-07-20: Amended per Brad: `'Inside and Outside' → Outside Processing` (was Process). Knock-on folded in: ProcessForm sections fully ungated so converted "both" processes keep work-center config visible.
- 2026-07-20: Packaging amended per Brad at implementation kickoff: squashed branch migration edited inline (`operationKind` never exists), local DBs rebuilt via `crbn reset`, types regenerated clean. Consolidation migration simplifies accordingly (no operationKind folding).
- 2026-07-21: Implemented and verified. Migrations validated in rolled-back psql txns (all CASE branches + idempotent re-runs; the re-run test caught and fixed a would-be prod-deploy failure: the squashed file's `LANGUAGE sql` get_method_tree defs referenced effectivity columns main had already dropped — all transient defs removed, final def lives only in the consolidation migration). Post-reset: clean type regen; typechecks green (erp, mes, database, documents, ee); lint green; zero `operationKind` repo-wide. Browser-verified end-to-end: process form (4 values, ungated sections), BoP unified picker + process-type seeding (Assembly process → Assembly op), Outside Processing branch (supplier/costing fields, time fields hidden), saved method op → job via get-method (type copied verbatim) → MES `/x/operation` → `/x/assembly` redirect with AssemblyView rendering, and the reverse guard (Process op at `/x/assembly` → back). Drive-by fix: `useSupplierProcesses` no longer fires its fetcher with an empty processId (pre-existing route-error-boundary 404 when picking Outside Processing before a process). Docs: `reference/jobs.mdx` operation-type section rewritten; glossary terms updated.
