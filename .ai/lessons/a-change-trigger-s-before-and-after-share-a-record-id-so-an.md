---
paths: ["packages/jobs/src/workflows/engine/loader.ts", "packages/ee/src/workflows/runtime/**"]
triggers: ["triggerOutputs", "EntityCache", "RuntimeValue"]
promoted: null
---
# A change trigger's `before` and `after` share a record id, so an id-keyed cache collapses them

**Context:** The workflow engine caches loaded records per run, keyed
`${entity}:${id}`, and a record trigger hands out `record`, `before` and `after`.

**Problem:** All three are the same row id. Seeding one cache from all three
means whichever is written last wins, so `before.orderTotal <= 10000` silently
reads the **new** total — quietly defeating the PRD's whole "went up" case. Both
the spec and the plan missed this.

**Rule:** An entity `RuntimeValue` carries an optional inline `row`.
`triggerOutputs` attaches each trigger row to its own value, and seeds the shared
cache with the **current** state only (`record`/`after`). Never put a historical
snapshot into a cache keyed by identity alone.

**Applies to:** `packages/jobs/src/workflows/engine/loader.ts`,
`packages/workflows/src/runtime/`, and any future cache of "the record as it is"
that also has to represent "the record as it was".
