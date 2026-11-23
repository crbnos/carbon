# @carbon/models

Executable models of Carbon's concurrent protocols. `explore` (`src/explore.ts`)
runs every interleaving of a set of actors breadth-first and returns the
shortest trace that breaks an invariant, or deadlocks. The models run in
`pnpm test`, so CI checks them on every pull request, with no database.

A model is for a protocol where two requests, a retry or a job can interleave
and a past bug did: a read-then-write, a status change, a lock order. A pure
calculation gets a unit test next to its code instead
(`.claude/rules/testing.md`).

## Checking a change

`.claude/skills/formal-verification/SKILL.md` is the procedure: whether a change
touches verified code, how to run it, and how to tell a real bug from a
modelling error. `coverage.json` records each model's functions, its database
tests, a hash of each function as last confirmed, and `confirmedAt`.

```bash
pnpm --filter @carbon/models touched   # exit 2: covered code changed since its last confirm (CI runs this)
SUPABASE_DB_URL=… pnpm --filter @carbon/models verify   # models + their database tests; refuses to skip
SUPABASE_DB_URL=… pnpm --filter @carbon/models confirm <model>   # verify, then record the code as confirmed
```

## Models

| Model | Protocol | Code |
|---|---|---|
| `accounting-period.ts` | lock, unlock, close and reopen of accounting periods | `lockAccountingPeriod`, `unlockAccountingPeriod`, `closeAccountingPeriod`, `reopenAccountingPeriod` (`apps/erp/app/modules/accounting/accounting.service.ts`) |

## Always

- **One step is one statement or one transaction boundary, in the order the
  code runs them.** An autocommit read sees committed rows. An UPDATE waits for
  the row lock and then re-checks its WHERE against the row it waited for
  (READ COMMITTED). Writes inside a transaction stay in the actor's `pending`
  until its commit step.
- **Each fix is a switch on the model's `Protocol`, and a test replays the bug
  it closed** with that switch off, naming the commit. The test asserts the
  violated invariant or the trace, so it fails if the model stops reaching it.
- **`SHIPPED` is the protocol the code runs now.** Its test searches every
  small configuration (every start state that meets the invariants × every
  multiset of N operations), and a second test runs the same search on the
  previous protocol and expects it to fail. A search that cannot fail proves
  nothing.
- **Change the model in the same PR as the protocol.** A lock added, removed
  or moved in the code is a step added, removed or moved here.
- **Prove the trace on Postgres once.** A database test reproduces the
  model's counterexample with the real functions and two connections (see
  `apps/erp/test/database/period-close-concurrency.test.ts`): red before the
  fix, green after. The model then covers the interleavings the database test
  does not.

## Never

- Never model a step the code does not take, or merge two statements into one
  step: an interleaving between them is exactly what the model is for.
- Never weaken an invariant to make `SHIPPED` pass. Fix the protocol in the
  code, then flip the switch.

## Validation Commands

```bash
pnpm --filter @carbon/models test
pnpm --filter @carbon/models typecheck
```
