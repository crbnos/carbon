# FIDS v1 Baseline Review

## Scope

Review and stabilize the completed P0 FIDS plus P0.5 Semantic Hardening. The target branch is `factory-os-p0-fids`; no merge or push is performed. The only implementation scope is FIDS foundation/tokens, semantic components, contracts, adapters, tests, fixtures, showcase and FIDS documentation.

## Repository Baseline

- Starting branch: `factory-os-p0-fids`
- Starting HEAD: `f3b8217df58e8f1e8fc4fe097a56ba79f0fd69c7`
- Worktree: `E:/6.Factory OS/carbon-runtime/carbon/.worktrees/factory-os-p0-fids`
- Starting modified files: `packages/react/src/index.tsx`, `packages/utils/src/index.ts`, `pnpm-lock.yaml`
- Starting untracked scope: FIDS components/tests, `packages/utils/src/fids*`, `docs/fids/`, and the isolated FIDS showcase
- No unrelated application changes were found in `apps/erp` or `apps/mes`.

## Architecture Review

PASS. Contracts are pure TypeScript in `packages/utils/src/fids.ts`; React components consume them from `@carbon/utils`. Adapters are pure functions. No contract imports React, CSS, icons, page modules, database clients or network clients. The showcase depends on contracts/components but contracts do not depend on the showcase.

## FactoryObject Review

PASS. Factory OS identity is separate from source record identity; multiple source refs, raw source state, status, risk, typed relationships, evidence refs and action refs are supported. Unknown type/state is explicit. The contract is not Production-Order-specific.

Evidence: `packages/utils/src/fids.test.ts` covers deterministic identity, source-state retention, unknown type/state, multiple refs and operation→equipment relationship.

## Evidence Review

PASS. `EvidenceRecord` separates `observedAt`, `retrievedAt`, freshness, version and provenance. `enforceEvidenceFreshness()` forces unknown when both timestamps are absent; it never invents a threshold. `EvidencePanel` renders structured facts and provenance without default raw JSON.

Evidence: `packages/utils/src/fids.test.ts` and `packages/react/src/__tests__/FIDS.test.tsx`; `pnpm --filter @carbon/utils test` and `pnpm --filter @carbon/react test` passed.

## Exception Review

PASS. `FactoryException` keeps object status, risk, exception severity and lifecycle as separate types. Facts, inference and recommendations are separate fields and UI sections. Missing optional cause, owner, impact and recommendation data is omitted.

## Adapter Review

PASS. `adaptErpJobToFactoryObject` and `adaptCarbonOperationToFactoryObject` are deterministic and side-effect free. They preserve source refs/raw states, map only validated states and retain unknown values as unknown. The confirmed operation→equipment relationship has source evidence. No speculative reconciliation is included.

## Component Review

PASS. `ObjectHeader`, `StatusBadge`, `RiskIndicator`, `ExceptionCard` and `EvidencePanel` use shared contract types, visible unknown states, non-color text/icon semantics, structured facts/provenance, optional data handling and wrapping classes for long content.

## Token Review

PASS. [FIDS_Tokens.md](./FIDS_Tokens.md) aliases existing theme foundations and covers status, risk, freshness, governed-action states, density, focus and touch targets. No second theme engine or primitive palette was added.

## Status Model Review

PASS. [FIDS_Canonical_Status_Model.md](./FIDS_Canonical_Status_Model.md) covers Production Job, Operation, Machine/Equipment, Material, Quality, Risk, Exception and Governed Action. Uncertain mappings remain `REQUIRES_DOMAIN_CONFIRMATION`; failed, blocked and cancelled are not collapsed.

## API/Export Review

PASS. FIDS components are intentionally exported from `@carbon/react`; semantic contracts/adapters are exported from the existing `@carbon/utils` root. Showcase fixtures remain local to the showcase and are not exported as production API. No circular export was found.

## Duplication/Dead Code

PASS. Shared semantic enums and contract interfaces live only in `packages/utils/src/fids.ts`; React files re-export compatibility type names without redefining them. No obsolete P0 prop consumers exist in the repository. No unrelated cleanup was performed.

## Documentation Review

PASS. The FIDS README, P0/P0.5 gap analysis, token/status docs, contract docs, migration notes, QA report and this review use consistent terminology. The governing design skill is available as the external input `E:/下载/factory-industrial-design-SKILL.md`; it is not copied into the product commit.

## Test Coverage

PASS. Contract/adapters: 7 focused tests; full utils suite: 11 files/145 tests; React suite: 2 files/21 tests. Coverage includes identity, refs, unknowns, relationships, observed/retrieved timestamps, freshness, provenance, fact/inference/recommendation separation and accessible component labels.

## Validation

| Check | Command | Result |
|---|---|---|
| Biome | `pnpm exec biome check ...` (scoped FIDS files/docs) | PASS |
| Utils typecheck | `pnpm --filter @carbon/utils typecheck` | PASS |
| React typecheck | `pnpm --filter @carbon/react typecheck` | PASS |
| ERP typecheck | `pnpm --filter erp typegen && pnpm --filter erp typecheck` | PASS |
| MES typecheck | `pnpm --filter mes typegen && pnpm --filter mes typecheck` | PASS |
| Utils tests | `pnpm --filter @carbon/utils test` | PASS — 145/145 |
| React tests | `pnpm --filter @carbon/react test` | PASS — 21/21 |
| Showcase types | `pnpm --filter fids-showcase types` | PASS |
| Showcase build | `pnpm --filter fids-showcase build` | PASS |
| Diff hygiene | `git diff --check` | PASS |

## Domain Confirmation Backlog

| Domain | Source value | Current treatment | Question | Recommended owner | Blocking P1? | Blocking P2? |
|---|---|---|---|---|---|---|
| Identity | Same record across ERPNext/MES | Deterministic IDs, no reconciliation | What is the governed cross-system identity key? | Data governance | No | Yes |
| Equipment | Runtime machine states | Unknown except confirmed work-center relation | Which source enum is authoritative? | MES/work-center owner | No | Yes |
| Material | Supply categories | Unknown/preserve raw label | Which categories are canonical? | ERP planning owner | No | Yes |
| Evidence | Freshness states | Caller-owned, no thresholds | Who owns threshold and clock policy? | Audit/data governance | No | Yes |
| Exception | Severity/lifecycle | Typed vocabulary only | Who authorizes lifecycle/action transitions? | Factory OS governance | No | Yes |

## Findings

BLOCKER: None.
HIGH: None.
MEDIUM: No repository-native axe/visual regression runner; documented as a tooling limitation, not a semantic blocker.
LOW: External governing skill is not part of the product commit; the source path is recorded.
NOTE: Vite emits existing Node-module externalization warnings during showcase build; build succeeds.

## Fixes Applied

- Added shared `CanonicalStatus` alias while retaining `CanonicalStatusState` compatibility.
- Added explicit retrieved-vs-observed evidence test coverage.
- Added explicit unknown object type test coverage.
- Updated P0.5 QA and baseline documents with exact validation evidence and backlog.

## Remaining Risks

Business confirmation remains required for identity reconciliation, equipment/material ontology, evidence thresholds and governed exception actions. No source workflow is changed by this baseline.

## Baseline Decision

READY_TO_COMMIT

## P1 Readiness

P1_READY_WITH_CONSTRAINTS. P1 may use FIDS foundation, identity, status/risk, Exception/Evidence contracts and components. It must not assume complete reconciliation, final freshness policy or autonomous actions.

## P2 Readiness

P2_READY_WITH_DOMAIN_CONFIRMATIONS. The contracts support Production Order identity, operation relationships, status/risk/evidence/exception references, but ERP/MES mappings and equipment/material semantics still require confirmation. P2 must not begin automatically.
