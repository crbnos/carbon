# Production Order Mapping MVP Audit

## Scope

This MVP extends the existing FIDS semantic contract in `packages/utils/src/`
with pure ProductionOrder projections, explicit lineage, authority-aware merge,
mapping validation and sanitized fixtures. It does not build a second ontology
framework or touch ERP/MES runtime workflows.

## Existing ontology/data-definition module

No repository-native `ontology`, entity registry, relationship registry or
mapping runtime module exists in the protected P2 worktree. The closest stable
architecture is:

- `packages/utils/src/fids.ts`: `FactoryObject`, `SourceReference`, typed
  relationships, evidence and exception contracts.
- `packages/utils/src/index.ts`: public utility barrel.
- `docs/fids/FactoryObject_Contract.md` and `docs/fids/Evidence_Contract.md`:
  semantic boundaries and provenance rules.

## Extension strategy

`packages/utils/src/production-order-mapping.ts` is the narrow extension point.
It reuses `SourceReference` and the existing `production-order` object type. It
does not introduce a database, service, event bus, sync job, reconciliation
engine or UI route. `production-order-mapping.fixtures.ts` contains only
schema-validated, non-production examples.

## Audited capability matrix

| Capability | Existing evidence | MVP treatment |
| --- | --- | --- |
| Entity identity | `FactoryObject.id` + `SourceReference[]` | Add source-specific projections and distinct Factory IDs |
| Attributes | `FactoryObject.metadata`, evidence facts | Use typed quantity/date/status fields in projections |
| Relationships | `FactoryObjectRelationship` | Preserve operation and work-center refs; merge only explicit lineage |
| Mapping registry | None | Add a small typed registry in `@carbon/utils` |
| Validation | Existing pure Vitest patterns | Add mapping/lineage/safety assertions |
| Runtime consumers | FIDS components only | No new consumer in this MVP |

## Boundary

ERPNext remains planning/business authority, Carbon MES remains execution
authority, and Factory OS remains a canonical experience projection. A
synthetic confirmed lineage fixture proves contract behavior only; it does not
prove a production ERPNext integration.
