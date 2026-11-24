---
paths: []
triggers: []
promoted: null
---
# `null` as "no bin chosen" and `null` as "no storage unit" are different things

**Context:** The untracked draw planner (`planStripedUntrackedDraw`) and its SQL twin in
`backflush_job_materials` took a preferred bin, where `null` meant "no bin chosen", and
listed the other bins as "every bin that is not the preferred one".

**Problem:** With no bin chosen, "not the preferred one" also dropped the bin whose id
is `null`: stock with no storage unit. A draw with 8 in a bin and 3 in no storage unit
took 20 from the bin and left the 3. TypeScript `id !== null` and SQL
`IS DISTINCT FROM NULL` both excluded it, so the twins agreed and unit tests passed.

**Rule:** When one value can mean "nothing chosen" and also name a real bucket, test the
"nothing chosen" case against stock in that bucket. In code, guard the comparison:
`preferred === null || id !== preferred`, and in SQL
`v_preferred IS NULL OR id IS DISTINCT FROM v_preferred`.

**Applies to:** `packages/database/src/picked-consumption.ts`, `backflush_job_materials`,
and any bin or stripe filter where `null` is both a key and "unset".
