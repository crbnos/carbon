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
- **Read a check in its subject's file.** `src/conformance/` has one file per
  subject (`migrations.ts`, `authz.ts`, `data-access.ts`, `ui.ts`, …). Each
  check's rule, its exemptions and the incident that prompted it are in the
  comments above it. This guide does not repeat them.
- **Add a check as one object and one line.** Write a `Check`
  (`src/check.ts`: `id`, `description`, `provenance`, `find(repo)`) in its
  subject's file and add it to the `checks` list at the end of that file.
  `src/checks.ts` joins those lists into `CHECKS`. Nothing else registers it.
  There are three ways to write one; copy the closest:
  - It reads one file at a time: `fileCheck(input, { …, scan })`. Tests call
    `scan(file, contents)` with a fixture string. Example:
    `noNumericPrecision` in `migrations.ts`.
  - Its scan needs data from the repo (the generated columns, the managed
    functions): keep a factory that takes the data, so tests pass their own,
    and export a `Check` that reads the data with `repo.read`. Example:
    `noAuthzDdlInMigrationsCheck` in `authz.ts`.
  - It compares several files: a pure `find*` function over its inputs, and a
    `Check` that reads them. Example: `providerRoleBackfilled` in `drift.ts`.
- **Keep a check self-contained.** The gate runs the checks on worker threads,
  each taking the next check when it finishes one, so two checks may run in
  different threads in any order. A check shares nothing with another check but
  its loaders: no module state one check writes and another reads. The gate
  groups checks by the loader each reads first (it calls `find` with a repo
  that throws at the first `repo.read`), so do no work before that read.
- **Read every input through `repo.read(loader)`.** A loader is a function
  `(root) => T`. `repo` runs each loader once and shares the result, so pass
  the same function every time:
  - An input several checks share is a named loader in `src/sources/inputs.ts`
    (`migrations`, `typescript`, `routeTypescript`, …) or a loader in
    `src/sources/`.
  - A loader that exists for one check lives in that check's file, beside the
    constants it reads. A file in `src/sources/` does not import a check.
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
  reads its findings (`routeActionShape` in `routes.ts` is the example). Then:
  - Enable it for its folders with an `overrides` entry in the root
    `.oxlintrc.json` (`"carbon/<check-id>": "warn"`).
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
  `conformance/` module exports, and fails one that is not in `CHECKS`. The
  checks of one module share its test file. Checks older than this rule are
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
| `src/check.ts` | The types (`Check`, `Repo`, `Violation`, `Provenance`) and `fileCheck`, `eachFile` |
| `src/checks.ts` | `CHECKS`: the subject files' `checks` lists, joined |
| `src/run.ts`, `src/run.worker.ts` | `collectFindings` (runs `CHECKS` on up to 4 worker threads, each with its own `repo`), `runChecks` (one `repo`, in process) and `newViolations` (minus the baseline) |
| `src/repo.ts` | `openRepo`: reads each input once |
| `src/conformance/` | One file per subject, with its tests in `<subject>.test.ts` |
| `src/sources/` | Loaders several checks share; `sql.ts` (parsed SQL), `syntax.ts` (parsed TypeScript) and `oxlint.ts` (plugin findings) |
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
