---
paths: []
triggers: []
promoted: null
---
# Enumerate the full ON DELETE graph before writing a data-deleting migration

**Context:** A migration deleted 50 `jobMaterial` rows where a job listed its own output item as a material. A dry run "passed": it completed, and `productionQuantity` was verified unchanged at 4,566 rows.

**Problem:** The verification only covered the one child table that happens to be `NO ACTION`. `jobMaterial → jobMakeMethod → jobOperation` cascades into **six** further tables — `productionEvent` (labor/time), `jobOperationTool`, `jobOperationStep`, `jobOperationParameter`, `rework`, `nonConformanceJobOperation` — all `CASCADE`, all silent. `productionQuantity` was noticed precisely because `NO ACTION` raises an error; the destructive edges said nothing. Comparing the restored database against the untouched backup showed `productionEvent` had gone 3,159 → 3,158: one real customer labor record destroyed by a migration that appeared to succeed.

**Rule:** Before any `DELETE` in a migration, query `pg_constraint` for `confrelid` of every table the delete can reach and read `confdeltype` for each edge (`c` = CASCADE, `r`/`a` = RESTRICT/NO ACTION, `n` = SET NULL). The `RESTRICT` edges are the ones that will teach you by failing; the `CASCADE` edges are where the data actually goes. Design the cleanup so the cascade cannot reach anything historical — here, detaching (`parentMaterialId = NULL`) every subtree containing ANY `jobOperation`, so only empty method copies are collected. Verify with a probe that builds the exact structure, runs the real delete statement, and asserts the child rows survive — and where a snapshot exists, diff the affected table's count against the backup rather than trusting that the statement completed.

**Applies to:** `packages/database/supabase/migrations/20260812032423_job-material-self-reference-guard.sql`, any migration under `packages/database/supabase/migrations/` containing `DELETE FROM`.
