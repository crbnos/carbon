# Slice 6C.3B — authorized Impact reconciliation from Refresh

## Goal

Wire the existing Impact workspace **Refresh** control to the already-authorized
provenance reconciliation boundary. A user with Change Notice view access,
Items update access, and the relevant source-domain view access may refresh the
workspace and reconcile persisted provenance before the normal React Router
loader revalidation. A read-only viewer must retain the previous GET-only
refresh behavior.

This slice changes no decision, snapshot, conclusion, task, source record, or
read-model contracts. Provenance intervals and their feature history remain the
only records the reconciliation service may change.

## Baseline

- Branch: `feat/change-notice-operational-impact`
- Baseline: `2389439f84c732c1358b7bd9737031dd4f076a0e`
- Worktree/index: clean before this slice
- No merge, rebase, or cherry-pick is active
- The server-authorized wrapper already exists in
  `apps/erp/app/modules/items/items.server.ts` and is covered by its focused
  authorization test.
- The Impact route already exports
  `revalidateIgnoringImpactDisplay`; its mutation branch must continue to
  return the router default so an action submission revalidates normally.

## Allowlisted files

Only these five files may change:

- `.ai/plans/2026-09-13-slice6c3b-impact-refresh-reconciliation.md`
- `apps/erp/app/routes/x+/items+/change-notice+/$id.impact._index.tsx`
- `apps/erp/app/routes/x+/items+/change-notice+/$id.impact._index.test.ts`
- `apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeImpactWorkspace.tsx`
- `apps/erp/app/modules/items/ui/ChangeNotice/ChangeNoticeImpactWorkspace.test.tsx`

No service, server wrapper, schema, migration, generated type, permission, MCP,
translation, task, source-domain, or configuration file is in scope.

## Implementation checklist

- [x] Add a narrow POST action to the Impact index route.
  - Require `assertIsPost` and `requirePermissions({ update: "parts" })`.
  - Keep the action narrow to the route's refresh POST and validate the route
    Change Notice id before invoking the wrapper.
  - Call `reconcileAuthorizedChangeNoticeImpactProvenance` with only the
    server-owned client, user, company, and route id.
  - Return structured success data or a flashed, user-facing structured error.
- [x] Change only the workspace Refresh handler.
  - Keep the control visible to read-only users.
  - For users without Items update permission, call the existing GET-only
    `revalidator.revalidate()` path.
  - For users with update permission, submit to the Impact index action with
    `useFetcher` and the typed `path.to.changeNoticeImpact` helper.
  - Let the router's normal post-action revalidation load the updated DTO; do
    not add a second manual revalidation after a successful POST.
  - Keep URL search/filter state untouched and rely on Carbon's flashed error
    as the single user-facing failure mechanism.
- [x] Add route tests for the server-owned authorization context, successful
  reconciliation response, error flashing, missing route id, and continued
  mutation revalidation behavior.
- [x] Extend the focused workspace tests only with behavior that can be tested
  without mounting the full Carbon UI; preserve existing read-only decision and
  selection assertions.

## Invariants

- The action is the only new write entry point and cannot receive source access,
  a database client, a target list, a decision operation, or a history event from
  the browser.
- Source permissions stay inside the existing server wrapper. Restricted source
  domains are reported by the wrapper and are never inferred in the component.
- Reconciliation never changes an Impact decision row, revision, snapshot,
  conclusion, resolution note, task, or source record.
- Read-only users do not trigger a provenance write.
- A POST remains subject to `shouldRevalidate`'s default mutation behavior.
- No commit or generated-file update is part of this slice.

## Verification checklist

- [x] Focused route and workspace Vitest tests pass: 2 files, 29 tests,
  including the method guard, authorization rejection, forged-body, and
  minimal response assertions.
- [x] ERP typecheck passes with `pnpm --filter erp typecheck`.
- [x] Targeted Biome checks pass for the four source/test files.
- [x] `pnpm --filter erp typegen` completes without generated-file changes.
- [x] `git diff --check` passes.
- [x] Final status contains only the five allowlisted files, all uncommitted.

## Verification record

- `pnpm --filter erp exec vitest run --config vitest.config.ts app/routes/x+/items+/change-notice+/$id.impact._index.test.ts app/modules/items/ui/ChangeNotice/ChangeNoticeImpactWorkspace.test.tsx` passed: 2 files, 29 tests.
- `pnpm --filter erp typecheck` passed.
- Targeted `pnpm exec biome check` passed for the two Impact route files and two workspace files.
- `pnpm --filter erp typegen` passed and did not change generated files.
- `pnpm run build:erp` passed. The build emitted the pre-existing pnpm config warning, Babel large-file notes, plugin timing info, and Rolldown `@daybrush/utils` invalid pure-annotation warning only.
- `git diff --check` passed. No commit, push, rebase, reset, stash, or amend was performed.
