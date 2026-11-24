---
paths: []
triggers: ["CREATE OR REPLACE VIEW"]
promoted: null
---
# `CREATE OR REPLACE VIEW` cannot reorder columns — DROP + CREATE when `t.*` grows

**Context:** The work-center batch-capacity migration added `batchCapacity`/`minimumBatchQuantity` to `workCenter` and re-declared the `workCenters` view (which selects `wc.*` before aliased join columns like `locationName`) with `CREATE OR REPLACE VIEW`.

**Problem:** `CREATE OR REPLACE VIEW` can only APPEND columns at the end — the new `wc.*` columns expand in the middle, shifting `locationName` to a new position, and Postgres refuses with `cannot change name of view column "locationName" to "batchCapacity"`. The migration fails at apply time even though the SQL looks like a routine re-declare.

**Rule:** When a view selects `t.*` and the underlying table gains columns that land BEFORE any explicitly-aliased column, re-declare with `DROP VIEW IF EXISTS` + `CREATE VIEW` (checking dependent views first) — not `CREATE OR REPLACE`. Only a pure append at the end of the select list is REPLACE-safe.

**Applies to:** every `packages/database/supabase/migrations/*.sql` that re-declares a `SELECT t.*, …` view after an `ALTER TABLE … ADD COLUMN` (`workCenters`, `processes`, `jobs`, and siblings).
