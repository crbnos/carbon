---
paths: ["packages/ee/src/workflows/definition/nodes.ts"]
triggers: ["WorkflowNodeType", "z.discriminatedUnion"]
promoted: null
---
# A `default:` arm silently defeats discriminated-union exhaustiveness

**Context:** Several functions switching on the same discriminated union
(`WorkflowNode["type"]` across handles, refs, outputs, type checks, config checks).

**Problem:** Five switches each had a `default:` or simply returned `undefined`
for unhandled members, so adding a seventh node type produced **zero** compile
errors — verified with `tsc --noEmit`. The new node type got default handles and
no validation at all, and would activate.

**Rule:** For behaviour that must exist for every member of a union, prefer one
record keyed by a mapped type (`{ [K in Kind]: ... }`) over N switches: a missing
key is a `TS2741` error. Where a switch is genuinely right, omit `default:` and end
with a `never` assertion. A `Record<Union, T>` gives the same guarantee — that is
what caught the missing `OPERATOR_LABELS` entries when `Operator` was extended.

**Applies to:** `packages/workflows/src/definition/nodes.ts`, and any
`switch (x.type)` over a zod discriminated union.
