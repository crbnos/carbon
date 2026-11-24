---
paths: ["packages/database/src/types.ts", "packages/database/src/swagger-docs-schema.ts"]
triggers: ["<<<<<<<", "generate:types", "generate:swagger"]
promoted: null
---
# Resolve merge conflicts in GENERATED files by regenerating, not by hand-editing the markers

**Context:** Merging `origin/main` into a long-lived feature branch where both sides had added migrations. The only conflicts were generated outputs: `packages/database/src/types.ts` + `functions/lib/types.ts` (one FK-relationship hunk each) and `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`.

**Problem:** Git auto-combined most of the generated output but left one view's relationship list conflicting. Hand-picking a side drops one branch's relationships (the view genuinely has all the columns); union-merging risks duplicating entries; either way the result may not match what the real generator emits from the COMBINED schema. Generated files are outputs, not source — resolving their conflict markers by hand is guessing at the generator.

**Rule:** For a conflict in a generated file, regenerate instead of editing markers. For `@carbon/database` types: start the postgres container, apply BOTH branches' pending migrations (`pnpm db:migrate`), then `pnpm run generate:types` — it overwrites `types.ts` from the live schema, connects via `SUPABASE_DB_URL`, and needs only postgres. `swagger-docs-schema.ts` reads PostgREST: with the stack up, `pnpm generate:swagger`, then `pnpm generate:workflow-catalog`. No build regenerates it, and CI fails when it lags the migrations. `git add` the regenerated files to resolve. For build-time artifacts that regenerate on `pnpm dev`/build (`tool-metadata.json`), take the superset side (usually `main`'s) as a placeholder — it self-corrects on next build. `generate:types` FK ordering is non-deterministic, so ignore ordering-only churn afterward (see the turbo-regen lesson above). Applying pending migrations forward is NOT a DB rebuild — that is the normal path; a full reset still needs the user.

**Applies to:** merging `main` into any branch with migrations on both sides; conflicts in `packages/database/src/types.ts`, `swagger-docs-schema.ts`, `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`, and any committed generated artifact.
