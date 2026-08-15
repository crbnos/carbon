# Evidence Contract

## Purpose

`EvidenceRecord` is the machine-readable support for a business fact, independent of `EvidencePanel`.

Implementation: `packages/utils/src/fids.ts`.

## Fields

| Field | Meaning |
|---|---|
| `id` | Stable evidence reference |
| `source` | Source system/object/record and optional field/path |
| `subject` | Optional FactoryObject reference |
| `fact` | Structured label, value, unit and/or description |
| `observedAt` | When the source observed the fact |
| `retrievedAt` | When the adapter retrieved it |
| `freshness` | `fresh`, `aging`, `stale` or `unknown` |
| `version` / `provenance` | Revision and retrieval/rule/model/tool context |
| `confidence` | `high`, `medium`, `low` or `unknown` |

## Freshness policy

The contract stores classification but does not invent thresholds. A caller-owned policy may classify evidence as fresh, aging or stale. `enforceEvidenceFreshness()` forces `unknown` when both observation and retrieval timestamps are absent. Timestamps do not themselves prove freshness, and colors never determine freshness.

Observed time and retrieval time remain separate. A future policy owner must document threshold, clock, timezone and recalculation behavior before integration.

## Provenance and action safety

Source field, version, retrieval mechanism, rule, model and tool can be retained for audit, recalculation, AI explanation and stale-evidence protection. Unknown or stale evidence must not silently authorize governed execution.

## Open questions

ERPNext and Carbon MES freshness thresholds, clock ownership and source revision semantics require domain confirmation.
