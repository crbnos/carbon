# Source Adapter Strategy

## Boundary

Adapters are pure, deterministic functions from source-shaped inputs to Factory OS contracts. They do not import database clients, mutate source records, fetch data or reconcile identities.

Implementation: `packages/utils/src/fids.ts`.

## Validated examples

| Adapter | Input evidence | Output |
|---|---|---|
| `adaptErpJobToFactoryObject` | ERPNext Job-like `recordId`, `displayName`, `status` | `production-order` object with ERPNext source reference |
| `adaptCarbonOperationToFactoryObject` | Carbon MES Operation-like `recordId`, `displayName`, `status`, optional work center | `operation` object with operation and work-center references |

Known source states map conservatively: ERP `In Progress`/`Completed`/`Cancelled` and Carbon `In Progress`/`Done`/`Canceled`. Other values retain `sourceState` and map to canonical `unknown`.

## Deferred mappings

Machine ontology, material supply categories, risk workflow states, due-date derivations and cross-system reconciliation are not adapter behavior yet. They require `REQUIRES_DOMAIN_CONFIRMATION` and must not be guessed.
