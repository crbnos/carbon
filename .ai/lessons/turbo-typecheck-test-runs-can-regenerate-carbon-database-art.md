---
paths: ["packages/database/src/types.ts", "packages/database/src/swagger-docs-schema.ts"]
triggers: ["turbo run", "generate:types"]
promoted: null
---
# Turbo typecheck/test runs can regenerate `@carbon/database` artifacts as ride-along churn

**Context:** Running `pnpm exec turbo run typecheck --filter=erp` and `turbo run test --filter=@carbon/jobs` to verify unrelated changes (notification filter, invite-link fix).

**Problem:** Turbo builds dependency packages first, and a `@carbon/database` build step regenerated `src/types.ts` (nondeterministic FK-relationship ordering), `src/swagger-docs-schema.ts`, and `supabase/functions/lib/types.ts` — none of which the task touched. Committing them would mix generated-file drift into an unrelated PR; the drift can also reflect whatever local DB happens to be running, not migrations.

**Rule:** After any turbo run, check `git status` for modified generated files under `packages/database/` before committing. If you didn't intentionally run `pnpm run generate:types`, revert them (`git checkout -- packages/database/src/...`). Regenerate deliberately and separately when schema actually changed. A branch that adds migrations commits the regenerated `types.ts` and `swagger-docs-schema.ts`: the Database types CI job (`.github/workflows/database-types.yml`) fails when either lags the migrations, so never revert a swagger diff that traces to a migration.

**Applies to:** `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`; any branch running turbo tasks that build `@carbon/database`.
