# ADR: Production Planning-Execution Boundary (v1)

Date: 2026-08-15

## Status

Accepted for Phase 11C.1A (contract definition scope).

## Context

Observed data includes `job.quantityComplete=0` while operation completion reached 1 on the same order aggregate, while planned/prod aggregate can be 1. This invalidates any generic completed metric that conflates source layers.

## Decision

1. **Boundary**
   - ERPNext/Planning layer = planning authority.
   - Carbon MES = execution authority.
   - Factory OS = canonical projection and semantic contract.
2. **Linking**
   - Merge across systems only through explicit `SourceLineage.status === "confirmed"`.
   - No fuzzy matching by name/date/quantity.
3. **Quantity**
   - No v1 `completedQuantity` mapping.
   - No canonical progress computation.
4. **Lineage**
   - `ProductionRelease` and `SourceLineage` contracts are required for integration.
5. **Compatibility**
   - Existing jobs without lineage remain readable (`unlinked`) and unchanged.

## Rejected alternatives

- Fuzzy matching on identifiers or text fields.
- Treating quantity as a single canonical `completedQuantity`.
- Automatic canonical progress in v1.
- Declaring Factory OS as a third operational source of truth.
- Synthetic cross-system lineage without explicit evidence.
