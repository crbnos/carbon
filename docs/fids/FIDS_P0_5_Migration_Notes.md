# FIDS P0.5 Migration Notes

## Component migration

- `ObjectHeader` now accepts a `FactoryObject`; metadata and composed actions remain UI concerns.
- `StatusBadge` consumes the shared `CanonicalStatusState` type.
- `RiskIndicator` consumes the shared `RiskLevel` type.
- `ExceptionCard` now accepts `FactoryException` and preserves fact/inference/recommendation separation.
- `EvidencePanel` now accepts structured `EvidenceRecord[]` and enforces unknown freshness when timestamps are absent.

The previous P0 component-only props had no production consumers in the repository. No compatibility shim was required; future callers should adapt source data before rendering.

## Source truth

ERPNext and Carbon MES models remain unchanged. The new adapters are pure utility functions and do not write source data. The showcase uses static fixtures and has no production route.

## Validation dependency

No new runtime validation dependency was introduced. Contracts are internal strongly typed values; boundary schema validation remains deferred until an external/API or stored semantic payload is introduced and an existing repository schema convention is selected.
