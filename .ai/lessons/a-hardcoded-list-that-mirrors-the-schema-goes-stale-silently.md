---
paths: []
triggers: []
promoted: null
---
# A hardcoded list that mirrors the schema goes stale silently, and a restore still reports success

**Context:** Two independent cross-company restore defects, found together while
tracing one broken restored company. (1) #1148 (2026-07-20) added `glbPath` /
`graphPath` to `modelUpload` and removed `modelPath` from `STORAGE_PATH_COLUMNS`
without adding the two new columns, so restored assemblies pointed at the SOURCE
company's storage prefix. (2) `2a19048def` (2026-08-31) correctly widened
id-remapping to composite-PK tables, which swept in `part`/`material`/
`consumable`/`service`/`tool` — whose `id` is a human-authored part number
(`ADCS-001`) that the `parts` view joins against `item."readableId"`, not an
identifier. Every Items page rendered empty against 860 intact rows.

**Problem:** Both lists mirror a schema property no constraint expresses, so
neither compiler nor DB catches drift. Worse, the restore job reports SUCCESS in
both cases — the rows load and the files copy; only a join or a URL silently
resolves to nothing. And both are invisible on a same-company restore, where the
remap is a no-op, so the usual manual test passes.

**Rule:** When a list in code enumerates schema facts (path columns, tables
exempt from a transform), pin it with a test that fails when the schema outgrows
it, and state in the list's own doc comment what must be added alongside a new
column/table. When widening a rule that mints or rewrites ids, ask which of the
newly-swept tables use that column as a VALUE others match on rather than as an
identifier — `part.id` is a part number. Verify a restore by querying the view
the UI reads (`parts`), not the table (`part`); the table was always full.

**Applies to:** `packages/jobs/src/inngest/functions/tasks/company-backup.ts`
(`STORAGE_PATH_COLUMNS`, `READABLE_ID_TABLES`), `buildIdMaps` in
`company-backup.transforms.ts`, and any future cross-company restore work — test
cross-company, never same-company.
