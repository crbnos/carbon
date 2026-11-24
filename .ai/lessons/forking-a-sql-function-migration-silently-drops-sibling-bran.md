---
paths: ["packages/database/supabase/migrations/*.sql"]
triggers: ["CREATE OR REPLACE FUNCTION", "complete_job_to_inventory", "backflush_job_materials", "get_inventory_quantities"]
promoted: null
---
# Forking a SQL function migration silently drops sibling branches added since your fork base

**Context:** `complete_job_to_inventory` gained a Non-Inventory branch in `20260707022142` (services post WIP→COGS, no inventory artifacts). Six days later, two migrations (`20260713190909` raw-materials split, `20260713222236` overhead fix) each forked the function from the older `20260630092517` baseline — silently deleting the Non-Inventory branch. Service job completions then posted phantom Finished Goods until the branch was restored in `20260714043017`.

**Problem:** "Fork from the newest definition" fails when the author greps for the migration that matters to *their* change and misses intermediate redefinitions that added orthogonal branches. The dropped branch produces no error — the divergent behavior only surfaces when someone exercises the other feature.

**Rule:** Before redefining a function, list EVERY migration that touches it (`grep -l '<fn_name>' migrations/*.sql | sort`), and fork from the last one — then diff your new body against that exact file (`diff <(sed -n 'a,bp' newest.sql) <(...)`) so the only hunks are your intended edits. If the timeline shows a branch you don't understand (an `itemTrackingType` guard, a feature flag), it is load-bearing — carry it forward, never re-derive the body from an older file or memory.

**Applies to:** `packages/database/supabase/migrations/` — any `CREATE OR REPLACE FUNCTION` fork; reviews of migrations that redefine shared functions (`complete_job_to_inventory`, `backflush_job_materials`, `get_inventory_quantities`, sync interceptors).

**Also after a merge (2026-09-28):** a branch's migration that added the Make to Asset branch to
`complete_job_to_inventory` and main's `20260925121735_rpc-function-guards` (forked from the
definition before it, to add one guard line) merged cleanly — different files. In timestamp
order main's copy ran last, so every fresh or local database lost the asset branch; production
pushes with `--include-all`, which applies the older branch file AFTER main's, so there the
guard went missing instead. `check-clobbers` compares against the merge base and reported
nothing. After merging main, list main's migrations newer than your branch's oldest and grep
them for every function and view your migrations define; for any hit, write a NEW migration
dated after both that carries both changes (here, since folded into
`20261006221601_complete-job-to-asset.sql`).

**Context:** Adding aging detail columns to `get_ap_open_by_supplier` kept the
supplier reference behavior, but changed the line breaks around fields added by
its previous migration.

**Problem:** `function-redefinition-keeps-changes` compares added SQL lines
literally, so the harmless layout change failed both CI conformance and tests.

**Rule:** When extending an RPC return shape, retain the exact lines introduced
by its newest definition where possible, and run the conformance test before
committing. Put new select expressions on separate lines.

**Applies to:** `packages/database/supabase/migrations/` function redefinitions
that add return columns.
