# Ramp main sync and migration-order repair

## Goal

Merge current `origin/main` into the published Ramp branch without losing local work,
then ensure every effect-bearing Ramp migration is forward-dated after main's latest
migration.

## Tasks

- [x] Preserve the dirty card-transaction route and untracked run records.
- [x] Merge `origin/main` without committing and resolve the five predicted conflicts.
- [x] Tombstone the three applied effect-bearing migrations and recreate their bodies in
      fresh ordered migrations: schema reconciliation, integration patch RPC, lifecycle CHECK.
- [x] Apply migrations and regenerate database artifacts from the combined schema.
- [x] Run database compatibility checks, scoped typechecks, lint, and focused Ramp tests.
- [x] Commit and push the atomic merge/migration-order repair.
- [x] Restore the preserved local work and confirm only the expected files remain dirty.

## Verification

```bash
pnpm db:migrate
pnpm run generate:types
pnpm db:check:datasets
pnpm db:check:backups -- --stage
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/jobs --filter=@carbon/erp
pnpm run lint
```

Run the focused Ramp lifecycle SQL, Deno posting suites, and real-database staging suite
after the combined schema is applied. Expected result: all pass, backup manifest stages the
combined Returns + Ramp schema, and the branch is zero commits behind `origin/main`.
