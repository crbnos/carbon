# FIDS P0.5 QA Report

## Contract coverage

PASS. `packages/utils/src/fids.ts` defines `FactoryObject`, `FactoryObjectRef`, `FactoryObjectRelationship`, `EvidenceRecord`, `EvidenceFact`, `EvidenceProvenance`, `FactoryException`, `SourceReference`, canonical status/risk and exception lifecycle types. `docs/fids/FactoryObject_Contract.md`, `Evidence_Contract.md` and `Exception_Contract.md` describe the boundary and unresolved mappings.

## Adapter coverage

PASS. `adaptErpJobToFactoryObject` and `adaptCarbonOperationToFactoryObject` are pure deterministic adapters. They preserve raw source state and references, derive deterministic Factory OS IDs, create a confirmed operation→equipment relationship when a work center is supplied, and leave unknown source states as `unknown`.

## Component migration

PASS. `ObjectHeader` consumes `FactoryObject`; `StatusBadge` consumes shared `CanonicalStatusState`; `RiskIndicator` consumes shared `RiskLevel`; `ExceptionCard` consumes `FactoryException`; `EvidencePanel` consumes structured `EvidenceRecord[]`. No production ERP/MES callers required a compatibility shim.

## Unknown handling

PASS. Unknown source states remain unknown; unknown status/risk labels remain visible; missing evidence timestamps force unknown freshness via `enforceEvidenceFreshness()`; unknown exception lifecycle and severity render explicitly.

## Fact / inference separation

PASS. `FactoryException.facts`, `inferredCause` and `recommendations` are separate typed fields and separately labelled by `ExceptionCard`. Missing cause/recommendation data is omitted.

## Evidence freshness

PASS. `EvidenceRecord` separates `observedAt`, `retrievedAt`, `freshness`, `version` and provenance. No threshold is invented. A timestamp does not silently classify evidence; no timestamp cannot remain fresh.

## Tests

| Area | Command | Result |
|---|---|---|
| Contracts/adapters | `pnpm --filter @carbon/utils test -- src/fids.test.ts` | PASS — 7/7 |
| Utility typecheck | `pnpm --filter @carbon/utils typecheck` | PASS |
| FIDS components | `pnpm --filter @carbon/react test` | PASS — 2 files, 21/21 |
| FIDS component typecheck | `pnpm --filter @carbon/react typecheck` | PASS |
| Showcase typecheck | `pnpm --filter fids-showcase types` | PASS |

## Build

PASS. `pnpm --filter fids-showcase build` generated the static SPA. Vite emitted existing browser-externalization warnings for Node-oriented transitive modules; the build completed successfully.

## Regression risk

Low and scoped. Changes are limited to the pure utility contract layer, five FIDS components, their tests, the isolated showcase, documentation and workspace lockfile. ERP/MES source models, workflows, routes and navigation were not modified.

## Domain confirmations required

- Cross-system identity reconciliation and source-record merge policy.
- Machine/equipment taxonomy and source-state mapping beyond the validated work-center reference.
- Evidence freshness thresholds, clock/timezone ownership and revision semantics.
- Exception lifecycle authority, severity thresholds, ownership and action authorization.
- Material, risk-workflow and due-date-derived status mappings.

## Final gate

`git diff --check` passes with standard Windows line-ending normalization warnings only. P0.5 does not start P1 App Shell, P2 Production Order 360, P3 Exception Center or P4 AI Decision Workspace.
