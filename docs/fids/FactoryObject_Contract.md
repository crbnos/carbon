# FactoryObject Contract

## Purpose

`FactoryObject` is the read-only Factory OS identity layer between source adapters and FIDS. It does not replace ERPNext or Carbon MES records.

Implementation: `packages/utils/src/fids.ts`, exported by `@carbon/utils`.

## Identity and provenance

`id` is a deterministic Factory OS identity, separate from source `recordId`. The current adapters use:

```text
<factory-object-type>:<source-system>:<source-record-id>
```

Example: `production-order:erpnext:WO-0815`. This is a deterministic presentation-layer identity, not hidden reconciliation. `sourceRefs` retains every source-system identity supplied by the adapter.

## Fields

| Field | Contract |
|---|---|
| `id` / `type` | Stable identity and typed object kind; `unknown` is allowed |
| `displayName` | Human label, optional |
| `sourceRefs` | One or more system/object/record references |
| `sourceState` | Raw source state, never overwritten by canonical presentation |
| `status` / `risk` | Separate `CanonicalStatus` presentation and assessed `RiskLevel` values |
| `relationships` | Typed relationship, target ref, source and confidence |
| `metadata` | Extension values; no UI nodes or network clients |
| `evidenceRefs` / `actionRefs` | References only, not embedded execution behavior |

## Relationships

The P0.5 vocabulary is limited to `requests`, `requires`, `contains`, `executes-on`, `affects`, `supplied-by` and `unknown`. A relationship is `confirmed`, `inferred` or `unknown`. No relationship is invented when source evidence is absent.

## Open questions

- Cross-system reconciliation may later replace the deterministic fallback with a governed identity registry.
- Machine/equipment source taxonomy remains `REQUIRES_DOMAIN_CONFIRMATION`.
