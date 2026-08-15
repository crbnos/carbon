# Factory OS P2 Production Order Domain Gate Result

## 1. Status

FAIL — the ERPNext source schema is confirmed, but the required runtime
ERPNext → Carbon MES identity/relationship chain is not reliable.

## 2. Baseline

Branch: `factory-os-p2-production-order-domain-gate`
Starting commit: `e88dc306f0fcce4192bc144a93914dceeffd45ba`
Worktree: `E:\6. Factory OS\carbon-runtime\carbon\.worktrees\factory-os-p2-production-order-domain-gate`

P0 protected baseline: `2111e7608`. Main, P0 and P1 worktrees were not modified.

## 3. Source Model Audit

ERPNext production object: Frappe `Work Order` DocType, with `name`, `status`,
`production_item`, `bom_no`, `qty`, `produced_qty`, `required_items`,
`operations`, planned/actual start/end and `expected_delivery_date`; the
external archive is `E:\6. Factory OS\Factory + ERP +MES\erpnext-develop.zip`.

Carbon MES job object: Carbon `job` row with `id`, company-scoped `jobId`, item,
status, quantities, dates, sales links and location.

Operation object: ERPNext Work Order operation/Job Card on the ERPNext side;
Carbon `jobOperation` on the MES side, with `jobId`, sequence/order, process,
status, quantities, dates, optional `workCenterId`, dependencies and execution
evidence.

Key source paths:

- `E:\6. Factory OS\Factory + ERP +MES\erpnext-develop.zip::erpnext/manufacturing/doctype/work_order/work_order.json`
- `E:\6. Factory OS\Factory + ERP +MES\erpnext-develop.zip::erpnext/manufacturing/doctype/work_order/work_order.py`
- `E:\6. Factory OS\Factory + ERP +MES\erpnext-develop.zip::erpnext/manufacturing/doctype/job_card/job_card.json`
- `packages/database/supabase/migrations/20240909194622_jobs.sql`
- `packages/database/supabase/migrations/20240927033740_job-operations-for-mes.sql`
- `packages/database/supabase/migrations/20260304000000_add-operation-due-date-to-functions.sql`
- `packages/database/supabase/migrations/20260428000000_sync-job-quantity-complete-on-production.sql`
- `apps/mes/app/services/operations.service.ts`
- `packages/utils/src/fids.ts`

## 4. Production Order Identity

FactoryObject strategy: retain separate `FactoryObject.id` and
`SourceReference[]`; the existing pure adapter strategy is safe but does not
reconcile records.

ERP anchor: ERPNext `Work Order.name` — `CONFIRMED`.

MES anchor: Carbon `job.id` / display `job.jobId`, with Carbon
`jobOperation.jobId → job.id` — `CONFIRMED` internally.

Mapping confidence: `NO_RELIABLE_MAPPING` for ERPNext Work Order → Carbon Job;
no shared external ID, mapping table, external-reference field, event or
adapter input was found.

## 5. Status Mapping

Confirmed mappings: Carbon raw enums and ERPNext Work Order/Job Card raw Select
values are confirmed. Existing FIDS mappings conservatively map only
`In Progress` → `in-progress`, `Completed`/`Done` → `completed`, and
`Cancelled`/`Canceled` → `cancelled`.

Unknown/unresolved mappings: ERPNext ↔ Carbon transition equivalence is
`REQUIRES_DOMAIN_CONFIRMATION`; all unmapped states remain raw/`unknown`.

## 6. Operation Mapping

Relationship: Carbon `job` contains `jobOperation`; ERPNext Work Order contains
operation rows and Job Card links to Work Order/Operation/Workstation. No proof
exists that an ERPNext operation row equals a Carbon `jobOperation`.

Cardinality: Carbon internal `1:N`; ERPNext-side `1:N`; cross-system
`UNRESOLVED`.

Confidence: `CONFIRMED` internally, `BLOCKED` across ERPNext → Carbon.

## 7. Quantity / Progress

Planned quantity owner: ERPNext Work Order `qty` and Carbon Job `quantity` are
source fields, but ownership across systems is unconfirmed.

Completed quantity owner: ERPNext `produced_qty`/Job Card
`total_completed_qty` and Carbon operation/job completion fields exist. The
canonical owner is `REQUIRES_DOMAIN_CONFIRMATION`.

Progress treatment: do not derive a canonical percentage. The repository
explicitly distinguishes production-quantity aggregates, operation
`quantityComplete`, and job `quantityComplete`; the regression case “aggregate
= 1, operation = 1, job = 0” must remain visible. This gate does not define
`completedQuantity = job.quantityComplete`.

## 8. Due Date / Schedule

Safe fields: ERPNext Work Order `planned_start_date`, `planned_end_date`,
`expected_delivery_date`; ERPNext Job Card expected/actual dates; Carbon Job
`startDate`/`dueDate`/`deadlineType`; Carbon operation start/due dates.

Unknown/deferred fields: cross-system date ownership, timezone, revision,
actual-finish derivation and freshness/version policy.

## 9. Material Context

P2 treatment: `P2_PARTIAL`. ERPNext Work Order `required_items` and BOM links,
and Carbon `jobMaterial` item/method/required/issued/supply links, can support a
source-backed material section once correlated. Do not infer shortage or risk.

Confidence: `HIGH_CONFIDENCE` within each source; cross-system mapping
`REQUIRES_DOMAIN_CONFIRMATION`.

## 10. Equipment Context

P2 treatment: `PARTIAL`. ERPNext uses Workstation/Workstation Type; Carbon uses
Work Center and production-event work-center references. They must not be
collapsed into one equipment object without a mapping.

Confidence: `CONFIRMED` for source references, `PARTIAL` for ontology/cross-map.

## 11. Exception / Evidence Attachment

Exception: `FactoryException` can reference a Production Order or Operation by
current contracts. Carbon conflict fields, non-conformance links and ERPNext
Job Card/Work Order status/evidence are candidate attachment points, but no
cross-system exception source is wired.

Evidence: `EvidenceRecord[]` can attach to the same FactoryObject references;
Carbon production events/quantities provide operation-linked facts.

Freshness limitation: no final freshness thresholds or clock/version policy;
missing observation/retrieval time remains `freshness = unknown`.

## 12. Adapter Impact

Changes: none. This gate changed documentation only; no adapter, route, schema,
workflow or database code changed.

Deferred: ERPNext ingestion, correlation/reconciliation, full status/quantity
crosswalk, schedule ownership, material/equipment ontology, exception freshness
and governed actions.

## 13. Domain Confirmation Backlog

BLOCKING:

- ERPNext Work Order → Carbon Job correlation key and lifecycle.
- Authoritative Production Order anchor and source ownership.
- Operation cross-system identity/relationship.
- Quantity owner and the 1/1/0 regression contract.

NON_BLOCKING:

- Material method/availability semantics.
- Work Center versus Workstation/equipment mapping.
- Schedule timezone/freshness details, provided unknowns remain visible.

DEFERRED:

- Exception lifecycle/severity governance, evidence thresholds and action
  authorization.

## 14. P2 UI Readiness

SAFE_TO_RENDER:

- Source-labeled Carbon Job/Operation references only after a confirmed source
  context is selected.
- Raw source values with their source system labels.

SAFE_WITH_UNKNOWN:

- Material and equipment sections as explicitly unknown/deferred.
- Evidence freshness when timestamps/policy are absent.

PLACEHOLDER_ONLY:

- P1 empty object-context slot and deferred navigation affordance.

DO_NOT_RENDER_YET:

- Cross-system Production Order identity, canonical completion/progress,
  ERPNext↔MES operation map, exception actions, AI recommendations or any
  Production Order 360 route.

## 15. Tests / QA

Lint: not run; documentation-only gate, no source files changed.
Typecheck: not run; documentation-only gate, no source files changed.
Tests: `pnpm --filter @carbon/utils test -- --run packages/utils/src/fids.test.ts`
could not start because this isolated worktree has no `node_modules`/`vitest`;
existing baseline FIDS tests cover deterministic IDs, source refs, known/unknown
status, work-center relationship and evidence freshness, but no P2 ERPNext↔MES
or 1/1/0 quantity regression test exists.
`git diff --check`: PASS.

## 16. Product-Code Impact

ERP workflow changes: NONE.
MES workflow changes: NONE.
P1 shell changes: NONE.
P2 UI changes: NONE.

## 17. Commit

Created: YES
Commit hash: documentation commit at repository HEAD (reported in task handoff)
Commit message: `chore(factory-os): validate P2 production order domain mapping`

## 18. Gate Recommendation

`P2_BLOCKED`

## 19. Next Best Action

Obtain a non-secret ERPNext Work Order → Carbon Job correlation sample and
authoritative quantity contract, including the 1/1/0 regression fixture, then
rerun this gate before authorizing P2 UI implementation.
