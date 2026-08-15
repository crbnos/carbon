# Production Order Identity Contract

## Invariants

```text
Factory ProductionOrder ID ≠ ERP Work Order.name ≠ Carbon Job.id
```

The MVP reuses `FactoryObject`/`SourceReference` semantics. A source projection
has one source reference and a deterministic Factory ID. A merged projection
has both references and a deterministic linked Factory ID; the IDs remain
source-labelled in provenance.

## Link status

| Status | Meaning | Merge behavior |
| --- | --- | --- |
| `confirmed` | Explicit ERP record ID and Carbon Job ID match the lineage contract. | Merge is allowed. |
| `unlinked` | A source exists but no lineage proof is supplied. | Keep projections separate. |
| `conflict` | Lineage says conflict or confirmed IDs do not match. | Keep both projections and preserve evidence. |
| `unknown` | Link status is unavailable. | Keep projections separate. |

No matching by name, item, date or quantity is implemented. A confirmed lineage
must carry exact `erpSourceId` and `mesSourceId`; mismatches produce `conflict`.
Optional `evidenceRefs` are retained on the merged projection and are not
treated as proof unless lineage is explicitly `confirmed`.

## Projection anchors

- ERP: `system: "erpnext"`, `objectType: "WorkOrder"`, `recordId = Work
  Order.name`.
- MES: `system: "carbon-mes"`, `objectType: "Job"`, `recordId = job.id`.
- Operation refs remain separate as `WorkOrderOperation` and `JobOperation`.

The synthetic fixtures are explicitly `SCHEMA_VALIDATED_FIXTURE` and
`NOT_PRODUCTION_RECORD`.
