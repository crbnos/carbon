---
paths: ["packages/ee/src/workflows/definition/normalize.ts", "packages/documents/src/template/**"]
triggers: ["formatVersion", "migrateDefinition", "FORMAT_VERSION"]
promoted: null
---
# A read-time format-migration seam must run before the current-schema parse

**Context:** Versioned JSON documents stored in a JSONB column with a
`formatVersion` sibling column, upgraded on read so stored rows never need a
backfill (`packages/documents/src/template/`, `packages/workflows/`).

**Problem:** `packages/workflows` originally parsed the row against the *current*
zod schema and only then called `migrateDefinition`. A document old enough to need
migrating cannot satisfy the current schema by definition, so it failed the parse
and never reached the migration — the seam was dead on arrival. Worse, the parse
failure fell back to an empty canvas, so opening the version in the builder showed
nothing and the next save silently destroyed the stored nodes.

**Rule:** Run the migration on the **raw** JSON, before the current-schema parse.
Default a missing `formatVersion` to `1`, never to `CURRENT_*_FORMAT_VERSION` —
"current" skips the very migration a legacy row needs. Treat a `formatVersion`
greater than current as an explicit failure, and return a discriminated
`{ok: false, failure, message}` rather than an empty document, so a caller can
refuse to save over a row it could not read.

**Applies to:** any read-time `migrate*(payload, _from)` seam —
`packages/workflows/src/definition/normalize.ts`,
`packages/documents/src/template/defaults.ts`.
