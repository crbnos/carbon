---
name: formal-verification
description: Check a change against Carbon's formal models of concurrent protocols (packages/models) and keep them in step with the code. Says whether the change touches verified code, runs every interleaving plus the database tests that pin each counterexample on the real code, tells a real bug from a modelling error, and moves the confirmation forward. Use when a diff touches a function listed in packages/models/coverage.json, when packages/models fails, when adding a model for a race, retry or status change, or when asked to choose what to model next. Do not use for a pure calculation or a single-request bug — use /tdd or /fix.
---

# formal-verification — keep the protocol models true to the code

Input: a change (working tree or branch). Output: one of "not verified code",
"confirmed" (with `confirmedAt` moved forward), "real bug" (a counterexample
trace on the real code) or "model updated" (a protocol change carried into the
model). The models live in `packages/models`; read `packages/models/AGENTS.md`
for how a model is written.

**Announce at start:** "Using the formal-verification skill — checking <change> against the protocol models."

## What is verified

| Model | Promise | Code (`coverage.json`) | Database test of the counterexample | Bounds |
|---|---|---|---|---|
| `accounting-period` | No period is Closed after an open one; only a Closed period has a balance snapshot and `closedAt`; status moves only Open ↔ Locked → Closed → Open | `accounting.service.ts`: `lockAccountingPeriod`, `unlockAccountingPeriod`, `setPeriodCloseStatus`, `lockPeriodLifecycle`, `closeAccountingPeriod`, `reopenAccountingPeriod` | `apps/erp/test/database/period-close-concurrency.test.ts` | every valid start × every 3 operations on 3 periods |
| `invoice-void` | A voided invoice nets to zero on every account; an invoice is reversed at most once | `invoicing.service.ts`: `changeInvoiceLineAccount`, `readInvoiceLinePosition`, and the lines holding "invoice is already voided" (the void branches sit inside `postSalesInvoice` / `postPurchaseInvoice`, too large to cover whole); `shared.service.ts`: `documentJournalLines` | `apps/erp/test/database/invoice-line-account-void.test.ts` | every sequence of up to 4 voids and line account changes, sales and purchase |
| `job-material-issue` | An automatic issue (operation completion, MES step backflush, job backflush) never takes more than the unit still needs; `quantityIssued` counts every unit that left the bin; a FIFO / LIFO cost layer is never relieved below zero or past its quantity, in every strict backflush setting | `inventory.service.ts`: `issueJobOperationMaterials`, and the lines holding `maxQuantityIssued` (the step issue's cap; the step issue sits inside `issueMaterial`, too large to cover whole); `shared.service.ts`: `lockUntrackedDraws`, `calculateCOGS`; `apps/mes/app/services/operations.service.ts`: `backflushUntrackedMaterialsOnStepRecord` (the backflush is SQL, `backflush_job_materials`, redefined by each new migration: it is not fingerprinted, and a change to it is caught only by `verify`) | `apps/erp/test/database/job-material-issue-concurrency.test.ts`, `apps/erp/test/database/backflush-cost-layer-concurrency.test.ts` | every multiset of up to 3 completions, step issues, step backflushes, job backflushes and other consumers of the layer, under strict backflush off, on, and on with negative stock allowed, with and without a cost layer |

`coverage.json` is the record: each model's file, the functions it covers, the
database tests, a hash of each covered function as it read when the model was
last confirmed (`fingerprints`), and `confirmedAt`, the commit it was confirmed
at. It compares content, not history, so a squash merge or a rebase does not
disturb it. The Models confirmed job in `.github/workflows/check.yml` runs
`touched` on every pull request: verified code cannot change unconfirmed.

**Not covered:** postings into a period (`check_accounting_period_open`), the
close checklist's contents, anything a single request gets wrong without
another one running. Liveness (that a waiting request eventually runs) is not
checked; deadlock is. An edit elsewhere inside `postSalesInvoice` or
`postPurchaseInvoice` (a moved `FOR UPDATE`) does not trip `touched`; the
invoice-void database tests catch it when `verify` runs.

**Why not TLA+:** CI has no Java or TLC, and the checks must run on every pull
request. The explorer (`packages/models/src/explore.ts`) runs in the existing
`pnpm test`, in under 10 seconds, with steps written against the repo's own
function names. Each model proves its search can fail: a test runs the same
search on the previous protocol and expects a violation.

## Step 1: does the change touch verified code?

```bash
pnpm --silent --filter @carbon/models touched
```

| Output | Do |
|---|---|
| every line `<model>: unchanged since <sha>`, exit 0 | Not verified code. Stop: report "not verified code". |
| `<model>: TOUCHED since <sha>:` + `<file>#<function>` lines, exit 2 | Go to Step 2 for that model; the lines name what changed. |
| a `<file>#<function>` listed for a function you did not edit | It was renamed or moved: its entry now hashes `missing`. Update the name in `coverage.json` `code`, then Step 2. |

## Step 2: run the model and its database tests

`SUPABASE_DB_URL` must be the local database (`crbn up` writes it to
`.env.local`).

```bash
export SUPABASE_DB_URL=$(grep -E '^SUPABASE_DB_URL' .env.local | cut -d= -f2-)
pnpm --silent --filter @carbon/models verify <model>
```

Expected when healthy:

```
accounting-period model: ok (Tests  5 passed (5))
accounting-period database: ok (Tests  6 passed (6))
invoice-void model: ok (Tests  7 passed (7))
invoice-void database: ok (Tests  6 passed (6))
job-material-issue model: ok (Tests  12 passed (12))
job-material-issue database: ok (Tests  5 passed (5))
```

`SUPABASE_DB_URL must name the local database` → no local database: run
`pnpm db:migrate` and `packages/dev/bin/crbn up --no-apps --no-migrate --no-regen --minimal`, then run again.
Never rebuild or reset a database for this.

## Step 3: read the result

| model | database | Meaning | Do |
|---|---|---|---|
| ok | ok | The code still runs the modelled protocol, or the change did not reach it. | Step 4. |
| ok | FAILED | The code no longer does what the model's shipped protocol says: a step was removed, reordered or weakened. | Real bug unless the change meant to alter the protocol. Read the failing database test's name and assertion; it names the interleaving. Report it as a finding with that trace. Do not edit the test or the model to pass. |
| FAILED | any | A model test failed: someone edited the model, or the explorer. | Read `explore()`'s trace in the failure. If the model change was meant to describe a protocol change, go to Step 5. Otherwise revert the model edit. |

Real bug or modelling error: put the model's trace next to the code. Walk each
step to the statement it names (`lockPeriodLifecycle`, the `FOR NO KEY UPDATE`
read, the UPDATE's WHERE). If every step matches a statement and the invariant
breaks, the bug is real. If a step has no statement, or merges two, the model
is wrong: fix the step, never the invariant.

## Step 4: confirm

Read each changed function `touched` named against the model's steps. When
every statement the model names is still there, in the same order, with the
same WHERE and lock, commit the code change, then:

```bash
pnpm --silent --filter @carbon/models confirm <model>
pnpm --silent --filter @carbon/models touched
```

`confirm` runs `verify` first and writes the new `fingerprints` and
`confirmedAt` only when it passes; on a failure it prints `verify failed:
nothing confirmed.` and changes nothing. It refuses a tree with any staged,
unstaged or untracked change, before and after `verify`, because `confirmedAt`
names HEAD. Name every model in one `confirm`: the first one's record dirties
the tree. `touched` must then print
`<model>: unchanged since <sha>`. Commit `packages/models/coverage.json` with
the change.

A statement the model names changed and `verify` still passes → the model is
not checking that statement. STOP and report it; do not run `confirm`.

## Step 5: the protocol changed on purpose

1. Add a switch to the model's `Protocol` for the change, and the steps it adds
   or removes, one statement or transaction boundary per step.
2. Add a test that runs the old protocol (switch off) and asserts the violation
   or trace it allowed, naming the commit.
3. Set `SHIPPED` to the new protocol. The exhaustive test must pass, and the
   "same search fails" test must still fail on the protocol before it.
4. When the change fixes a race, add a database test that reproduces the
   model's trace with the real functions and two connections (copy the
   `waitForBlockedConnection` pattern in `period-close-concurrency.test.ts`).
   It must fail before the code change and pass after.
5. Add any new function to `code` and any new test to `databaseTests` in
   `coverage.json`, then Step 4.

## Choosing a target

Use when asked to pick what to model ("add the next model", "where would a
model help"). The output is a proposal; build nothing until it is approved,
unless the request said to build.

1. List the fixes of the last year whose subject names a race, a retry or a
   repeat:

   ```bash
   git log --no-merges --since="12 months ago" --format='%h %ad %s' --date=short \
     | grep -iE ' fix.*\b(race|concurren\w*|twice|double|duplicate\w*|idempot\w*|retr(y|ies|ied)|seriali[sz]e\w*|reposted|already|stale|in flight|at once|lock(s|ed)? (the|a|its|before))\b'
   ```

   Expect a few dozen lines, most of them not races. Read `git show <sha>` for
   each plausible one: keep it only when two requests, a retry or a job
   running at the same time caused the bug.
2. Group the kept fixes by the protocol they fixed (the functions and the
   status they share), and drop any protocol already in `coverage.json`.
3. Pick the tool for each group:

   | The group | Tool | Model? |
   |---|---|---|
   | One write that must not happen twice (a duplicate row, a number reused) | a unique constraint or an atomic `UPDATE … RETURNING` | No |
   | A status that must not move backwards (Voided → Posted) | a guarded update (`WHERE status = <expected>`) or a trigger refusing the edge | No |
   | One known collision of two requests | a database test with two connections | No |
   | Several operations or code paths (TypeScript and SQL) taking locks in different orders, and the bug came back in another shape | a model plus a database test of its counterexample | **Yes** |

4. Rank the "Yes" groups: more fixes first; then damage (money, stock or
   another company's data over a 500); then a protocol still changing
   (`git log --since="3 months ago" -- <file>`).
5. Propose, then STOP for approval:

   ```
   target: <protocol> (<functions>, <files>)
   past bugs: <sha subject>, …
   why a model, not a constraint or test: <one line>
   actors: <operations that run at once>
   invariant: <the rule that must never break>
   not chosen: <group> → <constraint | test>, …
   ```

No group needs a model → report that, with the constraint or test each group
needs instead. That is a valid result.

## Adding a model

Copy `src/accounting-period.ts` and its test. Add an entry to
`coverage.json` (`model`, `code`, `databaseTests`), run `confirm <model>`, and
add a row to "What is verified" above and to the table in
`packages/models/AGENTS.md`. Before handing it over, break the property in the
real code (delete the lock or the WHERE the fix added), and confirm `touched`
reports it and `verify` fails; then restore the code and confirm both return to
the healthy output. A model whose `verify` stays green on that break is not
done.

## STOP rules

- Never weaken an invariant, delete a database test, or edit `fingerprints` /
  `confirmedAt` by hand: only `confirm` writes them.
- `verify` red twice after a fix attempt → STOP and report the trace.
- A model needs a step for code you cannot find → STOP; the model may describe
  code that no longer exists.

## Output

```
formal-verification: <change>
touched: <models or "none">
model: <ok|FAILED> · database: <ok|FAILED>
verdict: <not verified code | confirmed at <sha> | real bug | model updated>
trace: <the failing interleaving, when there is one>
```
