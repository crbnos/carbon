---
paths: []
triggers: []
promoted: null
---
# A function redefinition forked from an old copy reverts every migration between

**Context:** `20261014171619_receive-consumed-serial-units` (2026-10-15) changed one branch of `complete_job_to_inventory`. Its header says it was "forked from 20261006221601".

**Problem:** two later migrations had redefined the function: `20261009010412` (every company posts job costing, Provisional before the cutover) and `20261014135003` (lock the production events a completion posts). The fork's `CREATE OR REPLACE` replaced the whole body, so both changes were silently undone: a company with no cutover got no Job Receipt journal, and a concurrent production-event post could double-post. The SQL tests that would have caught it either predated always-post or failed already and were not run.

**Rule:** copy a function's body from its NEWEST definition (`grep -l "FUNCTION <name>" migrations | tail -1`), then diff your body against that one before writing the migration. The `function-redefinition-keeps-changes` check fails a redefinition that drops lines its predecessor added. Run the SQL tests that call the function (`scripts/run-local-accounting-check.ts psql -f …`).

**Applies to:** any migration with `CREATE OR REPLACE FUNCTION` on a function defined more than once, especially the long posting functions (`complete_job_to_inventory`, `backflush_job_materials`).
