---
paths: ["packages/files/src/media/image-pipeline.ts", "packages/database/supabase/functions/deno.json"]
triggers: ["libheif-js", "@jsquash/"]
promoted: null
---
# A functions/shared source with npm deps must register them twice

**Context:** `functions/shared/image-pipeline.ts` follows the `precision.ts` pattern (source under `supabase/functions/`, re-exported by a Node package) but, unlike precision, imports npm packages (`libheif-js`, `@jsquash/*`).

**Problem:** Module resolution follows the FILE's location, not the importer's. Deno resolves the bare specifiers via `functions/deno.json` `imports`; Node/Vite resolve them from `packages/database/node_modules` — not from the re-exporting package. Registering the dep in only one place typechecks in one world and crashes in the other, and the versions can silently drift.

**Rule:** Obsolete: the pipeline moved to `@carbon/files` (`packages/files/src/media/image-pipeline.ts`, its deps in that package.json) and `functions/deno.json` no longer pins any deps. Still true: type declarations a module needs sit next to it (triple-slash reference) — ambient `.d.ts` files only load for programs that include them.

**Applies to:** `packages/files/src/media/image-pipeline.ts`.
