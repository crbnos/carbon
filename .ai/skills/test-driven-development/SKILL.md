---
name: test-driven-development
description: Red→green→refactor discipline for Carbon (vitest) — write the failing test first, watch it fail for the right reason, write minimal code to pass. Use when implementing any feature or bug fix, before writing implementation code. Exceptions (throwaway prototypes, generated code, config) require the user's explicit OK. For browser-only proofs use /test instead.
---

# test-driven-development — red, green, refactor

The rule: **no production code without a failing test first.** A test written
after the code passes immediately — and a test you never saw fail proves
nothing: it may test the wrong thing, test the implementation instead of the
behavior, or miss the exact case you got wrong.

Already wrote code before the test? Stash or delete it, write the test, watch
it fail, then re-implement. Don't keep it open "as reference" — that is
writing tests after, with extra steps.

## The cycle

### 1. RED — write one failing test

One behavior per test, named for the behavior
(`"rejects a receipt line with zero quantity"`, not `"test1"`). Test real code;
mock only what you cannot run (network, clock). Copy setup from a sibling test
file in the same package.

Where tests live: `packages/{pkg}/src/**/*.test.ts` or
`apps/erp/app/modules/{module}/__tests__/` (match the neighbors). Runner is
vitest via the `@carbon/config` preset.

### 2. Verify RED — watch it fail (mandatory, never skip)

```bash
pnpm --filter <pkg> exec vitest run <path/to/file.test.ts>
# Expected: FAIL — assertion failure for the missing behavior
```

- Fails with an assertion about the missing behavior → proceed.
- **Passes** → it tests existing behavior; rewrite the test.
- **Errors** (import/type/syntax) → fix the error, re-run until it *fails
  correctly*.
- Carbon gotcha: vitest runs with `passWithNoTests: true` — a green run that
  collected **0 tests** proves nothing. Check the test count in the output.

### 3. GREEN — minimal code to pass

Write the simplest code that makes the test pass. No extra options, no
speculative parameters, no refactoring of neighboring code, nothing the test
doesn't demand.

```bash
pnpm --filter <pkg> exec vitest run <path/to/file.test.ts>   # your test passes
pnpm --filter <pkg> test                                     # the package still passes
```

Test fails → fix the code, not the test. Other tests fail → fix now, not later.

### 4. REFACTOR — only while green

Remove duplication, improve names, extract helpers. No new behavior. Re-run the
package tests after. Then loop to the next failing test.

After editing tests, also typecheck the package —
`pnpm exec turbo run typecheck --filter=<pkg>` (never whole-repo). The repo uses
`noUncheckedIndexedAccess`: indexed access in assertions needs optional chaining
(`rows[0]?.id`), and that only surfaces in typecheck, not in the test run.

## Bug fixes

A bug fix is TDD with the test written from the bug report: the failing test
reproduces the bug, the fix turns it green, and the test stays as the
regression guard. Never fix a bug without one (see `/fix`, which enforces this).

## Rationalizations — all of them mean "write the test first"

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks; the test costs 30 seconds |
| "I'll test after" | Passing-immediately proves nothing |
| "I manually tested it" | Not repeatable, no record, gone on the next change |
| "Deleting X hours of work is wasteful" | Sunk cost; unverified code is the actual debt |
| "Just this once / this is different" | The exception becomes the habit |
| "Test is hard to write" | Hard to test = hard to use; simplify the interface |

## Done when

- [ ] Every new behavior has a test you watched fail, for the right reason
- [ ] `pnpm --filter <pkg> test` green, with a non-zero collected-test count
- [ ] `pnpm exec turbo run typecheck --filter=<pkg>` green
- [ ] Output pristine — no stray warnings/errors you introduced

When adding mocks or test utilities, read
[testing-anti-patterns.md](testing-anti-patterns.md) first — it covers testing
mock behavior instead of real behavior, test-only methods on production
classes, and mocking without understanding the dependency.
