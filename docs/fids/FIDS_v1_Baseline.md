# FIDS v1 Baseline

## Baseline purpose

Freeze the reviewed P0 FIDS foundation and P0.5 semantic contracts as a safe dependency for later Factory OS experiences. This baseline contains no P1/P2/P3/P4 implementation.

## Architecture

```text
ERPNext / Carbon MES source models
             ↓
Pure source adapters (`@carbon/utils`)
             ↓
FactoryObject / FactoryException / EvidenceRecord
             ↓
FIDS semantic components (`@carbon/react`)
             ↓
Future Factory OS experiences
```

## Contracts and components

- `FactoryObject`, `FactoryObjectRef`, `FactoryObjectRelationship`, `SourceReference`
- `EvidenceRecord`, structured `EvidenceFact`, freshness and provenance
- `FactoryException`, separate facts/inference/recommendations and lifecycle
- `ObjectHeader`, `StatusBadge`, `RiskIndicator`, `ExceptionCard`, `EvidencePanel`

## Adapters

The baseline includes deterministic pure adapters for ERPNext Job-like input and Carbon MES Operation-like input. Unknown source states remain unknown. No source record mutation or reconciliation is performed.

## Validation

- `pnpm --filter @carbon/utils test` — 11 files, 145 tests passed
- `pnpm --filter @carbon/utils typecheck` — passed
- `pnpm --filter @carbon/react test` — 2 files, 21 tests passed
- `pnpm --filter @carbon/react typecheck` — passed
- `pnpm --filter erp typegen && pnpm --filter erp typecheck` — passed
- `pnpm --filter mes typegen && pnpm --filter mes typecheck` — passed
- `pnpm --filter fids-showcase types` — passed
- `pnpm --filter fids-showcase build` — passed
- Biome scoped check — passed
- `git diff --check` — passed with standard Windows line-ending warnings

## Known limitations

- Cross-system identity reconciliation is not implemented.
- Equipment/material ontology and several source lifecycle mappings require domain confirmation.
- Freshness thresholds, exception governance and action authorization are not frozen.
- No automated axe or visual-regression runner exists in the repository.

## Domain-confirmation backlog

| Domain | Current treatment | Owner needed | Blocking P1? | Blocking P2? |
|---|---|---|---|---|
| Cross-system identity | Deterministic adapter ID; no reconciliation | Data governance | No | Yes |
| Equipment states | Unknown except confirmed operation→work-center relationship | MES/work-center owner | No | Yes |
| Material supply states | Explicitly unresolved | ERP planning/procurement owner | No | Yes |
| Evidence freshness | Caller-owned classification; no threshold | Data governance/audit | No | Yes |
| Exception lifecycle/severity | Typed semantic vocabulary only | Factory OS governance | No | Yes |
| Governed action authority | Documentation only; no execution | Factory OS governance/security | No | Yes |

## What P1 may assume

P1 may use the FIDS foundation, shared status/risk types, FactoryObject identity, Exception/Evidence contracts and the five semantic components. P1 must retain raw source refs and unknown states.

## What P2 must not assume yet

P2 must not assume complete cross-system reconciliation, final equipment/material ontology, final freshness thresholds, final exception governance or autonomous actions. Production Order 360 remains explicitly deferred.
