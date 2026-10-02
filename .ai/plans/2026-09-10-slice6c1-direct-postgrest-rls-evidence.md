# Slice 6C.1 — Direct PostgREST/RLS evidence

## Scope

Establish trustworthy direct PostgREST/RLS evidence for Change Notice Impact without changing production policies, routes, MCP behavior, UI behavior, or product decisions. Isolate the known task-link assertion from unrelated local rows and exercise API-key plus employee-session authorization across the two fixture companies and three Impact source types.

## Baseline evidence

- TypeScript harness: `pnpm --filter @carbon/database exec tsx supabase/tests/change-notice-impact.rls.test.ts`
- The baseline reproduced a collection-wide false failure: an HTTP 200 task-link response included pre-existing local rows unrelated to the random per-run fixture. The rows belonged to existing Job Material Change Notices, not the fixture, so the failure did not establish an RLS leak.
- SQL schema harness: `packages/database/supabase/tests/change-notice-impact.test.sql`, executed against the running local PostgreSQL/PostgREST stack through the repository's `pg` dependency.

## Implementation

- [x] Use exact fixture decision, task, and company filters for task-link visibility; add fixture links for the permitted PO, Job, and Job Material controls so both source directions are proven.
- [x] Replace the arbitrary employee mutation with a dedicated Supabase Auth employee/JWT fixture, including normal public-user, employee-group, membership, and permission setup.
- [x] Exercise all four Impact tables through API-key and employee/JWT reads across both fixture companies, while keeping source-domain checks and composite `(id, companyId)` checks on exact fixture identities.
- [x] Track and verify cleanup for Auth/public users, company and group memberships, employees, employee types/groups, Impact rows, tasks/links, API keys, companies, and generated audit/search tables; cleanup failures set a non-zero exit code.

## Verification

- [x] TypeScript RLS harness passes and leaves no fixture residue; the direct `pg` residue query reports zero matching companies, Auth/public users, and generated audit/search tables.
- [x] SQL schema harness passes.
- [x] `pnpm --filter @carbon/database typecheck` passes; Biome stdin format check and `git diff --check` pass.
- [x] `pnpm run lint` completes successfully with pre-existing warnings in unrelated packages.
- [x] Worktree contains only Slice 6C.1 evidence/test/lesson changes; no commit, push, rebase, reset, or amend.
