# P2 Adapter Gap Analysis

## Current adapter surface

`packages/utils/src/fids.ts` contains pure adapters for an ERP-like Job fixture
and a Carbon MES Operation fixture. They preserve source references and raw
states, map only a validated subset, and never perform network calls or writes.
The focused tests cover deterministic identity, unknown state preservation,
operation-to-work-center relationship, evidence freshness, and exception field
separation.

## Gaps

| Gap | Evidence | Severity | Required before P2 UI |
| --- | --- | --- | --- |
| ERPNext source adapter is not connected to an ERPNext source | ERPNext Work Order/Job Card DocTypes exist in the external archive, but no Carbon connector/API/ingestion path consumes them | `P0 / blocking` | Yes |
| ERPNext ↔ Carbon correlation key | No mapping field/table/event found | `P0 / blocking` | Yes |
| Parent production-order reference on operation adapter | Current operation input has only operation/work center fields | `P0 / blocking` | Yes |
| Complete status crosswalk | Only three canonical mappings are implemented | `P1` | Yes for a trustworthy 360 |
| Quantity semantic contract | Job and operation quantities have distinct trigger/view rules | `P0 / blocking` | Yes |
| Schedule source/timezone/version policy | Dates exist, ownership and freshness do not | `P1` | Required for display; not a reason to invent data |
| Material/equipment ontology | Source relationships exist, canonical categories do not | `P2` | Non-blocking secondary confirmation |
| Exception/evidence freshness and action authorization | Typed contracts exist, no source adapter or governance policy | `P3/P4` | Defer governed actions |

## Adapter recommendation

Do not change adapters in this gate. After ERPNext evidence is supplied, add
small source-specific adapters with explicit input types, preserve each source
reference, carry raw state/quantities, and reject or mark unknown any unmapped
field. A reconciliation adapter must not be hidden inside a display component.
