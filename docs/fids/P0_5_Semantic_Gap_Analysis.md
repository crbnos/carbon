# P0.5 Semantic Gap Analysis

## Baseline evidence

Baseline branch: `factory-os-p0-fids` at `f3b8217df`. P0 FIDS components exist in `packages/react/src/` and are exported from the public barrel. The current showcase is static and isolated at `contrib/building/examples/fids-showcase`.

## Gaps found before hardening

| Gap | Evidence | P0.5 treatment |
|---|---|---|
| Identity is component props, not a shared business contract | `ObjectHeader.tsx` accepts `objectType`, `objectId`, `title` separately | Add `FactoryObject` with Factory OS identity separated from source references |
| Provenance is display-only and source fields are flattened | `EvidencePanel.tsx` accepts `sourceSystem`, `objectType`, `recordId` | Add `SourceReference` and structured `EvidenceRecord` |
| Freshness is a caller label without policy ownership | `EvidencePanel.tsx` accepts `freshness` and only forces unknown when timestamp is absent | Preserve observed/retrieved timestamps and make unknown the safe default; do not invent thresholds |
| Exception semantics are props, not a lifecycle contract | `ExceptionCard.tsx` separates displayed fact/inference/recommendation but has no subject, evidence or lifecycle IDs | Add `FactoryException` with typed subject, evidence refs and lifecycle |
| Status, risk and exception severity are separate in runtime components but not shared types | Types are declared independently in React files | Move shared canonical types to `@carbon/utils`; re-export component aliases for compatibility |
| No source adapter boundary exists | P0 showcase passes component fixtures directly | Add deterministic pure ERPNext Job and Carbon MES Operation adapters; unknown values remain unknown |
| Fixtures are embedded in the showcase | `_index.tsx` contains all records inline | Move deterministic fixtures to the pure semantic layer and feed the showcase contracts |

## Non-goals

P0.5 does not reconcile records, change ERPNext/MES source models, add a database/API/event bus, create ontology infrastructure, alter navigation, or start P1/P2/P3/P4 work.

## Contract boundary

```text
ERPNext / Carbon MES source values
          ↓ pure thin adapters
FactoryObject / FactoryException / EvidenceRecord
          ↓
FIDS React components
          ↓
Static showcase and future Factory OS experiences
```

Unknown mappings remain explicit and are recorded in the contract documents.
