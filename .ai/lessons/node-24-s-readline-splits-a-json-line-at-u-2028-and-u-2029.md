---
paths: []
triggers: []
promoted: null
---
# Node 24's readline splits a JSON line at U+2028 and U+2029

**Context:** `deserializeTable` read a backup table's NDJSON with
`readline.createInterface`. Restores worked locally (Node 22) and failed on BYOC
(Node 24) with "Unterminated string in JSON at position 662".

**Problem:** From Node 24, readline also ends a line at U+2028 (line separator)
and U+2029 (paragraph separator). `JSON.stringify` leaves both unescaped, so a
row holding text pasted from Word or a PDF was cut mid-string. `jq` reads the
same file without complaint, so checking the archive with it passes.

**Rule:** Read NDJSON by splitting on "\n" yourself (the one separator the
writer emits), never with readline. Reproduce JSON-reading bugs on the Node
version the deployment runs (`mise exec node@24 -- …`).

**Applies to:** `packages/jobs/src/inngest/functions/tasks/company-backup.ts`
(`deserializeTable`) and any new NDJSON or JSON-lines reader.
