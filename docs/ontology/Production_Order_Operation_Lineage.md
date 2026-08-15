# Production Order Operation Lineage

## Relationships

```text
Factory ProductionOrder
        └── contains → Factory Operation
```

| Relationship | Cardinality | MVP status |
| --- | --- | --- |
| Carbon Job → Carbon JobOperation | `1:N` | Confirmed by `jobOperation.jobId → job.id`. |
| ERPNext Work Order → Work Order Operation / Job Card | `1:N` | Confirmed by the archived DocTypes. |
| ERP operation → Carbon JobOperation | `UNRESOLVED` | No cross-system operation key exists. |

The MVP keeps ERP and MES operation IDs in separate `sourceRefs`. It preserves
sequence, raw status, operation-level quantities and safe work-center refs. It
does not claim ERP operation = MES JobOperation and does not collapse ERP
Workstation into Carbon Work Center.
