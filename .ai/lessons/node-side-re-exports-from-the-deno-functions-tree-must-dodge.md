---
paths: ["packages/database/src/client.ts", "packages/database/src/sampling.ts", "packages/database/src/quality.ts"]
triggers: ["lib/database.ts", "supabase/functions/shared"]
promoted: null
---
# Node-side re-exports from the Deno functions tree must dodge lib/database.ts

**Context:** `@carbon/database` re-exports code from `packages/database/supabase/functions/` into the node world (`src/client.ts` → `lib/postgres/index.ts`). The shared inspection engine (`src/quality.ts`) needed `getNextSequence` from `supabase/functions/shared/get-next-sequence.ts`, which imported its `DB` type from `../lib/database.ts`.

**Problem:** `lib/database.ts` imports `./driver.ts` — the Deno-postgres driver whose types (`queryObject`, deno `Pool`) don't typecheck under the node tsconfig. Pulling any `shared/*.ts` helper that touches `lib/database.ts` into a `src/*` file breaks `pnpm --filter @carbon/database typecheck`, even though the runtime graph would have been fine.

**Rule:** Obsolete: `src/client.ts` is now the Node-only implementation and nothing in `packages/database/src` imports the Deno tree. Original rule: when making a Deno-tree helper importable from `packages/database/src/*`, its type-only imports must come from `../lib/postgres/index.ts` (node-clean, already the `src/client.ts` re-export source), never `../lib/database.ts`. `import type { KyselyDatabase as DB } from "../lib/postgres/index.ts"` is behavior-neutral for Deno. Check the full import chain (`lib/utils.ts` is safe; `lib/database.ts`/`lib/driver.ts` are not) before re-exporting.

**Applies to:** `packages/database/src/{client,sampling,quality}.ts`.
