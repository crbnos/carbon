# Production Integration Contract v1

## Scope

This contract formalizes a safe, minimal handoff between ERP planning and MES execution for production orders.

```text
ERP Work Order
   └─(ProductionRelease)
       └─(SourceLineage)
           └─ Factory ProductionOrder Projection
               └─ Carbon Job / JobOperation
```

No canonical semantic is claimed for cross-system progress yet.

## Responsibilities

- ERPNext (or equivalent planner) provides planning facts:
  - work order identity and planned quantity.
- Carbon MES provides execution facts:
  - execution quantity, operation completion, and execution lifecycle.
- Factory OS provides semantic contract and explicit lineage-aware projection.

## Contract boundaries

1. A link is trusted only when `SourceLineage.status === "confirmed"`.
2. `ProductionOrderProjection` keeps source-specific IDs and metric semantics.
3. Cross-system identity is explicit (`Factory OS` identity ≠ planning ID ≠ execution ID).
4. Undefined progress and canonical completed quantity remain unsupported in v1.

## v1 acceptance baseline

- `ProductionRelease` contract exists (`docs/ontology/Production_Release_Contract.md`).
- `SourceLineage` contract exists (`docs/ontology/Source_Lineage_Contract.md`).
- Quantity ontology is explicit (`docs/ontology/Quantity_Ontology_v1.md`).
- Operation lineage semantics are explicit and non-fuzzy (`docs/ontology/Operation_Lineage_v1.md`).
- Golden fixtures and tests capture `productionAggregate=1`, `operation.quantityComplete=1`, `job.quantityComplete=0`.
- No production code path has been proven to automatically create Carbon Jobs from arbitrary ERP work order input in this branch.

## Current status

- PASS for contract modeling and validation in `@carbon/utils`.
- PARTIAL for runtime lineage persistence (no safe migration + insertion point proved in this branch).
