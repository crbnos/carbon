---
paths: ["packages/jobs/src/scripts/**", "packages/database/src/seed-*.ts", "packages/database/src/check-*.ts", "ci/src/**"]
triggers: ["does not provide an export named", "\"type\": \"module\""]
promoted: null
---
# Bare-tsx scripts: isolate the import chain, never flip a shared package's `type`

**Context:** `pnpm db:check:backups` (`packages/jobs/src/scripts/check-backups.ts`) runs under bare `tsx`, which cannot named-import a CJS workspace package at runtime. Its import of `company-backup.ts` pulled in `@carbon/logger` via a module-scope `getLogger`, and the branch "fixed" the resulting crash by adding `"type": "module"` to `packages/logger/package.json` — a module-system change to a package consumed by 13 others, made for one dev script.

**Problem:** Flipping a shared package's `type` field changes resolution for every consumer to satisfy one entrypoint, and the connection between the flip and its reason is invisible — the next person hitting the same error flips the next package. The actual dependency was incidental: the script needed six pure functions that sat in a file whose module scope also called the logger.

**Rule:** When a bare-`tsx` (or plain-node) script hits `does not provide an export named …`, fix the SCRIPT's runtime import chain: move the pure logic it needs into a module with no runtime `@carbon/*` imports (type-only imports are fine — they erase) and import that. `packages/jobs/src/backups/schema.ts` is the pattern; `packages/database`'s seed scripts (relative `.ts` imports only) are the older precedent. Never change a shared package's `type`/`exports` for one script's benefit.

**Applies to:** `packages/jobs/src/scripts/**`, `packages/database/src/{seed,check}-*.ts`, `ci/src/**`, and any new `tsx`-run script in a CJS-rooted package.
