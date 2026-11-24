---
paths: []
triggers: []
promoted: null
---
# Measure completed typechecks before claiming a speedup

**Context:** The ERP typecheck speed investigation first produced an incremental
configuration and several bounded checks, but no completed before/after run.

**Problem:** A cache configuration looked promising, yet a cold check and edits
to large query-heavy services could still take minutes. Reporting the config
change as a speedup before measuring those cases obscured the remaining cost.

**Rule:** Complete and time a cold check, an unchanged rerun, and a representative
changed-file check before claiming a typecheck improvement. Report those cases
separately and keep Turbo cache hits distinct from TypeScript incremental runs.

**Applies to:** ERP typecheck performance work and other cached validation tasks.
