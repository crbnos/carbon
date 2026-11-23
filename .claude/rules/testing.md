---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.test.sql"
  - "**/*-test-fixture.ts"
---

# Writing tests

How a Carbon test is written, and when one is written at all. A 2026-10 audit
of ~900 test files found most of them sound, but a recurring fifth that only
confirmed the change they shipped with: regexes over applied migrations, mock
call counts, constants echoed back, the same rule re-tested in three
providers. This page is the house style that keeps those out.

## Before you write one: three questions

1. **Which bug turns it red?** Name a plausible mistake a future change could
   make. "Someone renames a mock" or "someone edits an applied migration" is
   not an answer.
2. **What is the seam?** One of the homes below. Not a private helper, not
   the call shape between two of our own modules.
3. **Where do the expected values come from?** A worked example, a literal
   you computed by hand, the spec, an identity that must hold (debits =
   credits). Never the same formula the code uses.

If you cannot answer all three, the test is a **scratch proof**: it showed you
your change works, and it goes in your scratchpad or the run log
(`.ai/runs/`), not the repo. That is fine. A proof you needed once is not a
regression guard.

## Where a check lives

| What you are protecting | Home | Runs |
|---|---|---|
| A decision, calculation, parser, plan | **Pure core** test next to the code (`foo.ts` → `foo.test.ts`) | every `pnpm test` |
| Anything whose truth is in Postgres: posting, RLS, triggers, RPC results, ordering | **Database test**: `apps/erp/test/database/**` (vitest + `databaseTest`) or `packages/database/supabase/tests/*.test.sql` | local database only |
| A structural rule across many files ("every migration…", "no file imports…") | **Conformance check** in `packages/checks` | `pnpm test` (`@carbon/checks`) |
| A user flow across pages | **Browser playbook** via `/test`, cached in `.ai/playbooks/` | by hand / agents |
| "My change works" | **Scratch** | never committed |

`packages/checks` is the only place a test may read source or migration text.
Anywhere else, a regex over a `.sql` or `.ts` file is a change detector: an
applied migration never changes, and a later migration can redefine the
object while the test stays green.

## The house style

**Pull the decision out, test it by value.** Glue (load → decide → write)
gets its decision extracted into a pure function that returns plain data,
and the test asserts that data. The glue itself is covered by typecheck and
the database test or flow that uses it.

```ts
// packages/ee/src/oee/engine.test.ts
it("inserts a closed event for a run that starts and ends in one sync", () => {
  const result = planMachineTime(
    base({
      changes: [
        { state: "Running", changedAt: t("10:00:00") },
        { state: "Idle", changedAt: t("10:30:00") }
      ]
    })
  );
  expect(result.writes).toEqual([
    {
      kind: "insertMachineEvent",
      jobOperationId: "A",
      startTime: t("10:00:00"),
      endTime: t("10:30:00")
    }
  ]);
});
```

Other good models: `getJournalPostingDecision` in
`packages/jobs/.../accounting-sync-operations.test.ts`, `decideJobStep` in
`tasks/assembler-client.test.ts`, `supersession-pick.test.ts`.

**One fixture builder per file, with overrides.** `base({ ...overrides })`
holds the valid default; each test states only what differs. Never paste the
same 30-line literal into six tests.

**A table for inputs that hit one branch, an `it` per branch.**

```ts
it.each([undefined, null, Number.NaN, 12.34])(
  "rejects absent or ambiguous bare-number value %s",
  (value) => expect(parseVerifiedRampMinorAmount(value, "Amount").ok).toBe(false)
);
```

**Names are behaviour sentences.** "closes the open event when the machine
goes idle". Not "works", not "handles X correctly", not "regression for
#1234". The name must match what the test asserts.

**Assert the whole result.** `toEqual` on the returned value catches the
field you forgot. `toBeDefined()`, `toBeTruthy()` and `typeof x ===
"function"` prove almost nothing.

**Expected values are literals or identities.** `toBe(15)`, not
`toBe(items.reduce(...))`. For money, a worked example in the comment is
better than a computed expectation (`lease-liabilities.test.ts` starts from
the spec's example and checks maturity − interest = liability).

**Test a shared rule once, where it lives.** A label fallback in
`core/card-charge-source.ts` is tested there, not again in the QuickBooks,
Xero and Rillet tests.

**Don't pin copy.** UI text, descriptions and messages change for good
reasons. Assert a string only when it is a contract (an API error code, a
file name format, an external payload).

**Comments say why the rule exists, in one line.** Not the history of the
change, not which PR added it.

**Size follows the logic.** A test file larger than the code it tests usually
has duplicate cases or pasted setup. Look before adding more.

## Mocks

Stub only what a test process cannot reach:

- the network: stub global `fetch` (`core/oauth-refresh.test.ts`)
- the clock: fake timers or an injected `now`
- the filesystem: a temp dir
- randomness: an injected seed

Never mock a first-party module (`vi.mock("./x")`, `vi.mock("../x.service")`,
`vi.mock("~/...")`). If the code needs the database, a job runner and Redis
faked to be testable, extract the decision instead, or let a database test
cover it. Asserting `toHaveBeenCalledWith` on our own collaborators pins the
wiring and passes while the rule is wrong.

A **stateful in-memory fake** at a data boundary is fine when it keeps rows,
applies filters, and the assertions read the resulting state
(`rules/sales/invoice-shipto.test.ts`, `accounting-master-sync-loop.test.ts`).
A fake that replays a scripted queue of 18 responses in a fixed order is not:
any reorder of queries breaks it, and it cannot catch a filtering bug.

Mocks that exist only so the module can be imported (`@lingui/core/macro`,
`@carbon/env`, `@carbon/logger`) are an import-graph problem. Import the
smaller module, or fix the side effect at import time. Don't copy the mock
into the next file.

## Component tests

Test a component's rule by pulling it into a function (`deriveRows`,
`canSubmit`) and testing that. A test that replaces `React.useState`, mocks
the form kit, or greps rendered HTML for a library's markup tests the mocks.
Interaction belongs in a browser playbook.

## Database tests

- Use `databaseTest` and `connectLocalTestDatabase`
  (`apps/erp/test/database/fixtures/local-database.ts`). `databaseTest` skips
  cleanly with no local database; never `if (!client) return;` inside a test,
  which turns green without running. Each fixture makes its own company, so
  tests do not see each other's rows.
- `connectLocalTestDatabase` is ONE connection with triggers suppressed. Two
  `Promise.all` posts over it are serialized, so it cannot test a race: open a
  second connection (`post-payment-concurrency.test.ts`). And with triggers off,
  raw inserts can build states the app never produces; reach a state through
  the real operations where you can.
- Call the real operation (`postReceipt`, the RPC, an insert as a role) and
  assert the business outcome (ledger rows, balances, what the role may see).
  Re-reading a row the test itself just inserted proves nothing.
- Build setup from the shared fixtures in `fixtures/`; add to them rather than
  hand-building a company, item and location in each file.
- Never gate on an opt-in env var (`RUN_X_DB_TESTS`) nobody sets. Gate on the
  database being present, as `databaseTest` does.
- Run: `SUPABASE_DB_URL=… pnpm --filter erp exec vitest run test/database/<file>`.

## Bug fixes

Reproduce the bug first, red then green. Then ask the three questions. A bug
in a decision gets a committed test at that decision's seam. A wiring bug (a
wrong argument passed between two of our modules, a missing `await`) usually
has no honest committed test: typecheck or the database test covers it.
Record the proof in the run log and say so in the commit message.

## When a test breaks on a refactor

If behaviour did not change, the test was pinned to the implementation.
Delete it or move it to the seam. Don't edit it until it passes again.

## Enforced

`packages/checks` flags, outside its own directory:

- `test-reads-source`: a test reading `.sql`, `.ts` or `.tsx` files as text
- `test-mocks-own-module`: `vi.mock` / `vi.doMock` of a relative or `~/` path

Existing cases sit in the baseline. Don't add new ones.
