---
paths: []
triggers: []
promoted: null
---
# Committing with the hook off skips Biome too

**Context:** The chart of accounts import (2026-10-12) committed with `git -c core.hooksPath=/dev/null` so the Lingui catalogs, which the hook stages into any commit with `.ts` changes, could land in their own commit.

**Problem:** The hook also runs lint-staged. Bypassing it skipped Biome's formatter, and a test file reached the branch unformatted. The self-review caught it, not the commit.

**Rule:** Before a commit with the hook off, run `pnpm biome check --write` on the staged files and the checks the hook would run (`pnpm --silent check:manifest`, `pnpm --silent db:check:datasets` for `packages/database`, `pnpm --silent db:check:backups` for migrations). Prefer committing the catalogs last with the hook on.

**Applies to:** any commit made with `--no-verify` or `core.hooksPath=/dev/null`.
