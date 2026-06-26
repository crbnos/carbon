# @carbon/checks

Executable checks for the loop system's "core".

## Conformance net

Forbids deprecated code patterns in migrations. Existing violations are
grandfathered in `src/conformance/baseline.json`; only **new** violations fail CI.

- Add a check: implement a `ConformanceCheck` under `src/conformance/`, add it to
  `CONFORMANCE_CHECKS` in `src/run.ts`, then re-baseline.
- Re-baseline (after intentionally accepting current state): `pnpm --filter @carbon/checks baseline`
- Run the gate: `pnpm --filter @carbon/checks test`

Each check records `provenance` (the transition event that retired the old pattern).

**Grandfathering granularity** is per `(checkId, file, snippet)`, not per occurrence:
adding a *second* occurrence of an already-baselined pattern to an already-baselined
file is not flagged. This is acceptable because shipped migrations are immutable /
append-only — new migration files, and new check types in old files, are always caught.

## Clobber check

Detects when the same DB object (view, function, or event-trigger) is redefined
on **both** the current branch and `main` since their merge-base — a "concurrent
redefinition" that will silently overwrite whichever side merges last.

- **What counts as a clobber:** `CREATE OR REPLACE VIEW`, `CREATE OR REPLACE FUNCTION`,
  or `attach_event_trigger(...)` targeting the same object name on both sides.
- **Run at PR time:** `pnpm --filter @carbon/checks clobbers`
  (needs `origin/main` fetched — run `git fetch origin main` first if needed).
- **Grow coverage:** add a `{ kind, re }` row to `OBJECT_PATTERNS` in
  `src/clobber.ts` — the `objectRefs` and `findClobbers` functions pick it up
  automatically.
- **Not in `test` gate:** the check requires git/branch context and is not
  appropriate for the static `vitest run` job. Run it as a separate CI step.
- **When a clobber is flagged:** rebase onto the latest `main`, then re-fork your
  redefinition from `main`'s version so you incorporate the concurrent change.

## Invariant net

Runnable database assertions. Each invariant is a `.sql` file in `src/invariants/`
that SELECTs the rows which **violate** the rule (empty result = healthy).

- Add an invariant: drop a `.sql` file in `src/invariants/` — no code or registration.
- Run against a database: `DATABASE_URL=<conn> pnpm --filter @carbon/checks invariants`
  (exits non-zero if any invariant returns rows).
- Invariants run against a **live DB** (a loop's worktree DB, or nightly against prod),
  NOT the static CI `test` job. The runner is DB-agnostic (injected query), so the
  logic is unit-tested without a database.
