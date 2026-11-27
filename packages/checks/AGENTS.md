# @carbon/checks

Conformance checks, clobber detection, invariant queries and license headers
for the Carbon monorepo.

A conformance check is one rule about the code ("a view states
`security_invoker`", "a route writes through a service function"). The gate
fails on any violation the committed baseline does not list.

## Always

- **Fix the code, not the baseline.** A new violation is fixed where it is. The
  baseline (`src/conformance/baseline.json`) grandfathers only the sites that
  existed before a check did.
- **One check, one file.** `src/conformance/<subject>/<check-id>.ts` holds one
  check and nothing else: its imports, the comment that says why it exists
  (the rule, its exemptions, the incident), and one
  `export const <camelCaseId> = defineCheck({ … })`. Its tests are beside it in
  `<check-id>.test.ts`. A check file has no constants, helpers or types at
  module level. This guide does not repeat what the comments say.
- **Add a check as one file and one line.** Write the file, then import the
  check in `src/checks.ts` and add it to `CHECKS`. Nothing else registers it.
  A check declares every input it reads (`files`, or `reads`), and its rule
  gets them loaded and never sees the repo. Choose the first form that fits
  (`src/check.ts`):
  - **Data.** The rule bans patterns in each file: `files`, `within`,
    `snippet`, `banned`, and `except` / `mayContain` when needed (`Bans` in
    `src/sources/matches.ts`). Example: `server/no-zero-concurrency.ts`.
  - **`bans()`.** The same data, computed on first use. Example:
    `server/no-integration-id-branching.ts`.
  - **`rule()` with `files`.** Logic over one file at a time. `rule()` declares
    what the rule needs and returns the `scan`; it runs the first time the
    check runs, so importing a check builds nothing. Tests call
    `check.scan(file, contents)`. Example: `migrations/no-numeric-precision.ts`.
  - **`rule()` with `reads`.** Logic over several inputs:
    `reads: { name: loader, … }`, and `rule()` returns `find({ name, … })`.
    Tests call `check.find({ … })` with their own values. Examples:
    `drift/provider-role-backfilled.ts`, and `accounting/account-fk-classified.ts`
    for a per-file scan that needs data from the repo.
- **Put shared logic in `src/sources/`.** A function moves to a named file
  there, with its own test, when two checks use it, when it is generic (text,
  SQL, syntax tree), or when a test must call it with a stand-in (a fake
  registry, a pinned hash). The check that uses it is then a short `find` that
  calls it: `drift/offline-page-cache-bumped.ts`. Look in `src/sources/` before
  you write a helper. A file there does not import a check.
- **A list a developer edits has one home.** A list that a check's message
  tells you to edit is inside that check's `rule()` (`UNPAGED_ROUTES` in
  `authz/route-maps-to-page.ts`), or in `src/sources/` when a loader needs it
  too (`LIST_TABLES` in `sources/list-tables.ts`, `OFFLINE_PAGE` in
  `sources/offline-page.ts`). The message names the file.
- **Keep a check self-contained.** The gate runs the checks on worker threads,
  each taking the next check when it finishes one, so two checks may run in
  different threads in any order. A check shares nothing with another check but
  its loaders: no module state one check writes and another reads. The gate
  groups checks by the first loader each declares, so a check that also reads
  the migrations declares them first and shares the worker that parsed them.
- **Name every input as a loader.** A loader is a function `(root) => T`. The
  repo runs each loader once and shares the result, and the gate groups checks
  by it, so a loader is one module-level function in `src/sources/`, never
  inside a check: `src/sources/inputs.ts` for a plain set of files
  (`migrations`, `typescript`, `routeTypescript`, …), or the `sources/` file
  of the thing it reads.
- **A rule about what SQL does reads parsed SQL, not a regex.**
  `src/sources/sql.ts` gives the statements Postgres's own parser returns
  (`libpg-query`, the version `@carbon/database` uses). Its header explains the
  API: `sqlFragments`, `sqlNodes`, `ancestorsOf`, `typeNamesIn`, `tokensFrom`.
  Three things to know:
  - A file is several pieces of SQL: the file, each function body and DO block,
    and the SQL an `EXECUTE` of a plain string runs. `fragment.inside` says
    which.
  - Text that is not SQL has no statements. Write a test fixture as a whole
    statement (`CREATE TABLE t (…)`, not a bare column), or the test passes
    without testing anything.
  - The PL/pgSQL parser has no catalog and refuses about 1% of bodies Postgres
    accepts (a `%ROWTYPE` variable, an undeclared variable in a fixture). Their
    statements are then read one by one, without conditions or loop queries.
- **A rule about TypeScript syntax is an oxlint plugin rule, not a regex.**
  Add a rule to the `carbon` plugin in `oxlint-plugins/carbon.mjs` (ESLint's
  `create(context)` API; the rule name is the check id) and a `Check` that
  reads its findings (`routes/route-action-shape.ts` is the example). Then:
  - Enable it for its folders with an `overrides` entry in the root
    `oxlint.config.ts` (`"carbon/<check-id>": "warn"`).
  - Keep it at `warn`, so the editor shows it and `oxlint` still passes. The
    gate reads the same diagnostics by rule id (`src/sources/oxlint.ts`).
  - Report the callee, not the whole call: the baseline key is the matched
    source with comments and whitespace removed.
  - Test it in `src/sources/oxlint.test.ts` (`scanWith`).
- **A rule that needs the syntax tree and cannot be a plugin reads oxc's.**
  `src/sources/syntax.ts` gives `parseTypescript` and `walk` (`oxc-parser`:
  ESTree with the TypeScript and JSX nodes, offsets into the text). A check
  that compares files, or needs data from the repo, cannot be a plugin rule.
  Test whether the file can matter with a cheap text test before you parse it.
- **A new check proves itself on the bug it exists for.** Its
  `provenance.incidents` names the commit of the past fix. Its test file names
  each sha in a case that replays the code from before the fix
  (`git show <sha>^:<file>`) and expects a finding, beside a case where the fix
  passes. `src/provenance.test.ts` enforces this for every `Check` a
  `conformance/` file exports, and fails one that is not in `CHECKS`. Checks older than this rule are
  listed in `UNPROVEN_CHECKS` there; the list only shrinks.
- **Test a check by value.** A fixture string in, the literal violations out.
  Add the case that must not match as well, and make sure it could fail: break
  the guard it protects and watch the test go red.
- **Write an invariant as a `.sql` file** in `src/invariants/`. It returns the
  rows that violate the rule (none means healthy). Its header says what it
  guards.

## Ask First

- Regenerating the baseline (`pnpm --filter @carbon/checks baseline`): it
  grandfathers every current violation.
- Adding to `OBJECT_PATTERNS` in clobber detection: it widens what counts as a
  redefined database object.
- Changing what an existing check reports: it changes the CI gate.

## Never

- Ignore a clobber warning. It means a view or function is redefined on your
  branch and on main since the merge base. Rebase first.
- Remove a check to silence a violation. Add the site to the baseline if it
  should be grandfathered.
- Run `oxlint --fix-suggestions` or `--fix-dangerously` here. Those fixes
  can change what the code does; `oxlint --fix` applies only safe ones.

## Validation Commands

```bash
pnpm --filter @carbon/checks test             # every test, the gate included
pnpm --filter @carbon/checks exec vitest run src/run.test.ts   # the gate alone
pnpm exec turbo run typecheck --filter=@carbon/checks
pnpm --filter @carbon/checks clobbers         # migration clobber risks
pnpm --filter @carbon/checks invariants       # SQL invariants (needs a database)
pnpm --filter @carbon/checks workflow-events  # workflow event ids (needs a database)
pnpm --filter @carbon/checks license-headers  # write missing license headers
pnpm --filter @carbon/checks guarded-code [base] [--root <repo>]
pnpm --filter @carbon/checks baseline         # regenerate the baseline (ask first)
```

The gate runs in four places with the same command
(`vitest run src/run.test.ts`): CI (`.github/workflows/check.yml`), the harness
(`packages/harness/src/gates.ts`), the pre-commit hook
(`scripts/git-hooks/pre-commit`, on a staged `.ts`, `.tsx` or `.sql` under
`apps/` or `packages/`; `CARBON_SKIP_CONFORMANCE_CHECK=1` skips it) and
`/check-and-commit`.

## Where things are

| Path | Holds |
|---|---|
| `src/check.ts` | The types (`Check`, `Loader`, `Repo`, `Violation`, `Provenance`) and `defineCheck`, `eachFile` |
| `src/checks.ts` | `CHECKS`: every check, by name, subject by subject |
| `src/run.ts`, `src/run.worker.ts` | `collectFindings` (runs `CHECKS` on up to 4 worker threads, each with its own `repo`), `runChecks` (one `repo`, in process) and `newViolations` (minus the baseline) |
| `src/repo.ts` | `openRepo`: reads each input once |
| `src/conformance/<subject>/` | One file per check, `<check-id>.ts`, with its tests in `<check-id>.test.ts` |
| `src/sources/` | The loaders, and the logic checks share: `matches.ts` (banned patterns), `sql.ts` (parsed SQL), `syntax.ts` (parsed TypeScript), `oxlint.ts` (plugin findings), and a file per thing read (`rls-policies.ts`, `route-pages.ts`, `row-writes.ts`, …) |
| `oxlint-plugins/carbon.mjs` | The oxlint plugin rules |
| `src/baseline.ts`, `src/conformance/baseline.json` | The grandfathered violations |
| `src/provenance.ts` | The rule that a check replays its past fix |
| `src/invariants/` | SQL invariants, run against a live database |
| `src/clobber.ts`, `src/guarded-code.ts`, `src/license-headers.ts` | The other tools, below |

## The other tools

- **Baseline.** A violation is keyed by check id, file and snippet, with no
  line number, so an edit above a grandfathered site does not un-grandfather
  it. A second occurrence of the same snippet in the same file is therefore not
  reported.
- **Clobber detection.** `findClobbers(branch, main)` finds a database object
  redefined on both sides since the merge base.
- **Guarded code** is a warning, not a gate. `guarded-code.json` maps
  race-protected code to the database tests that prove its fix: a top-level
  function of a file (or `Class.method`), or a `markers` string on the line
  that opens a guarded block inside a very large function. The script reads the
  diff from the merge base and prints one GitHub warning per touched function.
  It always exits 0. CI runs it in the Lint job. Add an entry when a fix closes
  a race and a database test with two connections proves it. The pure part is
  `src/guarded-code.ts`; `.claude/rules/concurrency.md` has the rules.
- **Invariants** need a live connection and do not run in CI.
  `loadInvariants(dir)` loads them, and the runner takes an injected `Query` so
  it can be tested.
- **Workflow drift** has two database-backed checks that answer different
  questions. `src/invariants/workflow-trigger-event-drift.sql` compares each
  active workflow's `workflowTriggerEvent` rows with its active version's
  trigger nodes. `src/scripts/check-workflow-events.ts` asks whether an event id
  a live workflow subscribes to still exists in the generated catalog, which is
  what a catalog rename leaves behind. Neither runs in CI: both open a Postgres
  connection (`DATABASE_URL` / `SUPABASE_DB_URL`) and no CI job has database
  credentials. Run them by hand against staging or production after a catalog
  change.

## Cross-References

- `.claude/skills/find-repeated-mistakes/SKILL.md`: how to find a mistake fixed
  three or more times and turn it into a check proven on the real past fix.
- `.claude/rules/concurrency.md`: the rules `status-write-guarded` and
  `counter-write-relative` enforce, and when to add a `guarded-code.json` entry.
- `.claude/rules/testing.md`: the house style for tests. This package is the
  one place a test may read source text.
- `packages/harness/src/gates.ts`: `FLOOR_GATES` includes
  `@carbon/checks test` and `clobbers`.
