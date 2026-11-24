---
paths: ["packages/documents/scripts/generate-notification-previews.mjs", "packages/documents/src/email/previews/*"]
triggers: ["generate-notification-previews"]
promoted: null
---
# Regenerating `src/email/previews/` fixtures requires a follow-up biome format pass

**Context:** Adding ChangeOrder* entries to `packages/documents/scripts/generate-notification-previews.mjs` and re-running it to emit the per-event preview fixtures.

**Problem:** The generator writes raw `JSON.stringify(..., null, 6)` output (quoted keys, 6-space indent), but the committed fixtures are biome-formatted (unquoted keys, 2-space indent). Re-running the script therefore rewrites **all** existing fixtures into the raw style — 28 files of pure formatting churn drowning the 3 intended new files in the diff.

**Rule:** After running `generate-notification-previews.mjs`, always run `pnpm exec biome check --write packages/documents/src/email/previews/` before reviewing the diff. Only intended fixture changes should remain; if pre-existing fixtures still show as modified, something else changed.

**Applies to:** `packages/documents/scripts/generate-notification-previews.mjs`, `packages/documents/src/email/previews/*`, and any generator whose committed output is formatter-normalized.
