# Executor instructions — Job Operation Batching v2 (for Opus)

You are executing a fully-planned feature. All design decisions are made and
locked; your job is mechanical execution with verification. Do not redesign,
do not re-litigate decisions, do not improvise around blockers.

## Mission

Implement Job Operation Batching on branch `feat/job-operation-batching-v2`
by following `.ai/plans/2026-08-21-job-operation-batching.md` task by task.

Read these three files completely before touching any code:

1. `.ai/plans/2026-08-21-job-operation-batching.md` — the 13 tasks. This is
   your script. Its "Executor ground rules" and "Conflict watch" sections are
   binding.
2. `.ai/specs/2026-08-21-job-operation-batching.md` — the design. Consult it
   when a task's intent is unclear. Spec wins over plan; code wins over both —
   if they disagree, stop and report the conflict instead of picking one.
3. `.ai/research/job-operation-batching.md` — background only; no action items.

## Context you need (30 seconds of history)

- This is the third attempt at this feature (issue #1010). Two prior
  implementations exist and BOTH are salvage sources, not ancestors:
  - `feat/job-operation-batching` (git ref `$SRC`, tip `8f7fc8a67`) — most of
    the code comes from here, including the already-built two-phase completion.
  - `origin/loop/1010-20260714010219` (PR #1137, closed) — one test file only.
- The branch you are on was cut fresh from `main` on 2026-08-21. Three doc
  commits are already on it. `main` has moved a month past both salvage
  sources, so ported hunks WILL conflict in places — the plan tells you how to
  resolve each one (every modified file has an "intent" line; resolve toward
  the intent, keep main's surrounding code).
- A large open PR (#1151, capacity planning) overlaps this feature. You do NOT
  handle the overlap — the plan's Task 2 pre-flight detects if it merged and
  tells you to stop. If that happens, stop.

## Hard rules (violating any of these is failure)

1. **Never `git merge`, `git rebase`, or `git cherry-pick` from the salvage
   refs.** Port files exactly as the plan's ground rules 2–3 describe
   (`git show` for new files, `git diff | git apply --3way` for modified ones).
2. **Never rebuild, reset, or re-seed the database.** `pnpm db:migrate` (apply
   pending) is allowed and required. If the DB is unreachable, stop and ask.
3. **Never push.** Commit locally per task; pushing needs the user's explicit
   per-push approval.
4. **Never run a whole-repo typecheck** (it OOMs). Only
   `pnpm exec turbo run typecheck --filter=erp` / `--filter=mes` /
   `--filter=@carbon/utils`.
5. **Never hand-edit generated files**: `packages/database/src/types.ts`,
   `packages/database/supabase/functions/lib/types.ts`, `*.po` catalogs,
   swagger. Regenerate them.
6. **Working-tree hygiene:** the tree carries uncommitted files from unrelated
   licensing work (`.ai/specs/2026-08-19-licensing-*`,
   `.ai/research/2026-08-19-*`, and local edits to both generated types files
   and `tool-metadata.json`). NEVER commit, revert, or delete them. Commit
   only files your current task touched, listed explicitly in the `git commit`
   command — no `git add -A`, no `git commit -a`.
7. **Evidence before assertions.** Run every Verify block, read the output,
   and only then state the result. Never claim green without output. If a
   verify fails, fix and re-run; do not proceed on red.
8. **Banned term:** the pattern `st[i]tch` (case-insensitive) must not appear
   in anything you write — code, SQL, comments, commit messages.
9. **No new dependencies, no schema beyond the plan's migration, no scope
   changes.** Anything that seems to need one → stop and ask.

## Execution loop

For each task N in the plan's Progress list, in dependency order:

1. Re-read the full task text.
2. Do the steps exactly. Where a step says "STOP and report", that is a real
   instruction — end the task, describe the situation, and wait.
3. Run the Verify block; paste its real output into the run log (see below).
4. Check the task off in the plan file's Progress list (edit the `- [ ]` to
   `- [x]`).
5. Commit via the `/check-and-commit` skill (it runs the right gates and
   commits only when green). Conventional commit message, e.g.
   `feat(production): <what task N added>`. No AI attribution lines.
6. Append a short entry to the run log.

Run log: create `.ai/runs/2026-08-21-job-operation-batching.md` at start with
a heading per task; per task record: what was ported/created, conflicts hit
and how resolved (file + one line), verify output tail, commit SHA.

Tasks 4 and 5 are independent of each other; everything else follows the
plan's dependency graph. Doing them sequentially is fine.

## Known traps (each has burned a previous attempt — do not rediscover them)

1. `productionEvent.duration` is a GENERATED column. Never write it. Slices
   write start/end windows only; cost follows automatically.
2. Importing from a new directory barrel (`~/modules/.../Batching`) crashes
   Vite SSR with a cached resolution miss. Routes import concrete files
   (`./BatchingBoard`, `./types`). The salvage already does this — keep it.
3. Components must not import types from route files (breaks tsgo whole-program
   inference in unrelated files). Shared UI types live in
   `ui/Schedule/Batching/types.ts`.
4. RVF only coerces a repeated form field to an array at ≥2 values. Array
   fields use `zfd.repeatable` / `zfd.repeatableOfType`, never `z.array`.
5. MES completion pre-fill: `targetQuantity` is 0 (not null), so
   `targetQuantity ?? operationQuantity` pre-fills 0. Pre-fill from
   `operationQuantity`. Per-member number fields use `NumberControlled`.
6. `production.models.ts` contains `"Cancelled"` in JOB status consts — those
   are correct. Only the `jobOperationBatchStatus` const must be exactly
   `["Active", "Completing", "Completed"]`.
7. After `pnpm run generate:types`, check `git diff --stat` on the types file.
   Mass deletions of unrelated tables = stale local DB → stop and ask; do not
   commit deletions.
8. `pnpm` only, never `npm`. The ERP package filter name is `erp`, not
   `@carbon/erp`.
9. No JavaScript `Date` for parsing/formatting/arithmetic in app code — the
   salvage code already follows this; keep it that way in any glue you write.

## Blockers — stop and ask instead of working around

- Task 2 pre-flight expectations fail (capacity planning or anything else
  redefined the view/RPC on main).
- The local dev DB is unreachable, or `pnpm db:migrate` errors.
- Generated types diff shows mass unrelated deletions.
- A salvage file references a function/component that no longer exists on
  main and the fix is not obvious from the task's intent line.
- Anything in Ask-First territory: schema beyond the plan's migration,
  auth/RBAC/tenancy logic, public contracts, new dependencies.
- Task 13 needs the user's running dev stack; if it is not up, finish Task 12,
  report, and ask — do not start servers yourself and do not skip the task
  silently.

## Definition of done

- All 13 Progress boxes checked in the plan file.
- Every Verify block ran green with output captured in the run log.
- One commit per task (13 commits, plus fixes), nothing pushed.
- Spec changelog updated (Task 11).
- Final message to the user: two-line summary, list of commit SHAs, any
  deviations from the plan (there should be none that weren't reported), and
  the Task 13 browser-verification evidence or the reason it is pending.
