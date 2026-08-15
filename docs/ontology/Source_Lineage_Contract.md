# SourceLineage Contract (v1)

## Purpose

Represent explicit cross-system identity links between planning sources and execution records.

## Type contract

```ts
type SourceLineageStatus = "confirmed" | "unlinked" | "conflict" | "unknown";
type SourceLineageRelation =
  | "released-to"
  | "derived-from"
  | "executes"
  | "contains";

interface SourceLineage {
  status: SourceLineageStatus;
  erpSourceId?: string;
  mesSourceId?: string;
  relation?: SourceLineageRelation;
  evidenceRefs?: readonly string[];
  establishedBy?: string;
  establishedAt?: string;
  version?: string;
}
```

## v1 validity rules

Implemented in `validateProductionOrderSourceLineage()`:

- `confirmed` requires both `erpSourceId` and `mesSourceId`
- unknown relation strings are rejected
- no fuzzy matching or matching by date/name/quantity

## Merge behavior

`mergeProductionOrderProjections()` uses lineage as follows:

- only `status === "confirmed"` with matching IDs can merge into `FactoryProductionOrder`
- all other statuses remain separated with lineage attached
- default `relation: "derived-from"` is used if relation is not explicitly supplied
