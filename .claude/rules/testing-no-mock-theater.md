---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

# Tests: no mock theater

A test that fakes every collaborator and then asserts call counts against the
fakes proves the mocks work, not the code. One such file was deleted from a PR
on sight (`accounting-auth-failure.test.ts`, 2026-09-17: hand-rolled redis +
supabase + Inngest step fakes, assertions like "redis.del was called with these
keys"). Do not write tests like that.

## The rule

Stub only the **real external boundary** — the thing the code genuinely cannot
reach in a test process:

- an HTTP endpoint → stub global `fetch` (see `core/oauth-refresh.test.ts`:
  four tests, one stub, pins real branching in `refresh()`)
- the wall clock → fake timers
- the filesystem → a temp dir

Everything between the test and that boundary runs real. If the unit under
test touches redis, the database, AND a runtime harness, and you would have to
fake all three to test it, **don't write the test** — either extract the pure
decision into its own function and test that (the codebase's established
pattern: `reconcile.ts`, `mrp-companies.ts`, `posting-policy` are all pure
cores with real tests), or leave it untested and let an integration path cover
it.

## Smells that mean delete-and-rethink, not refactor-the-test

- A hand-rolled in-memory fake of redis/supabase/Kysely inside a test file.
- `expect(mock).toHaveBeenCalledWith(...)` as the primary assertion — you are
  pinning the implementation's call shape, not its behavior.
- The fake needs its own logic (NX semantics, builder chains) to make the test
  pass — the fake is now a second implementation that can drift from the real
  one.
- A loop driving the code N times purely to trip a threshold inside mocks.

## What a test must earn

A test exists to fail when the LOGIC breaks. Before keeping one, ask: "which
real bug flips this red?" If the only answer is "someone renamed the mock's
method", it has earned nothing. A branch worth testing is worth testing
through real values at a real boundary; a glue function that just wires
collaborators together is verified by typecheck + the integration that uses
it, not by a puppet show.
