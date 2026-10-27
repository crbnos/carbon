---
name: test-driven-development
description: Carbon's red→green loop with vitest — prove a change with a failing test first, then decide whether that test earns a place in the repo or stays a scratch proof. Use when implementing a feature or bug fix test-first, or when about to add or change a committed test. The house style it enforces is `.claude/rules/testing.md`; `tdd` holds the general theory (seams, anti-patterns). For browser-only proofs use /test.
---

# test-driven-development — prove first, commit only what earns it

Two separate things happen in this loop, and confusing them is how the repo
filled up with tests that only confirmed their own change:

1. **Proof.** Before you trust a change, see a check fail without it and pass
   with it. Always.
2. **Regression guard.** A test committed to the repo, run on every change
   forever. Only when it passes the three questions in
   `.claude/rules/testing.md` (which bug turns it red, what seam, where the
   expected values come from).

Every guard is a proof. Most proofs are not guards. A proof that is not a
guard lives in your scratchpad or the run log, never in the repo.

Read `.claude/rules/testing.md` before writing a test that will be committed:
it is the house style (pure cores tested by value, fixture builders with
overrides, `it.each` tables, behaviour-sentence names, mocks only at the
network / clock / filesystem).

## The loop

### 1. RED — one failing check

One behaviour, named as a sentence (`"rejects a receipt line with zero
quantity"`). Decide the home first (rule → "Where a check lives"): pure core,
database test, conformance check, browser playbook, or scratch.

```bash
pnpm --filter <pkg> exec vitest run <path/to/file.test.ts>
# Expected: FAIL — an assertion about the missing behaviour
```

- Fails on the assertion → go on.
- **Passes** → it tests behaviour that already exists. Rewrite it.
- **Errors** (import, type, syntax) → fix until it fails for the right reason.
- vitest runs with `passWithNoTests: true`: a green run that collected **0
  tests** proves nothing. Read the count.

If the logic you need to prove is buried in glue (load → decide → write),
extract the decision into a pure function first and prove that. Don't mock
our own modules to reach it.

### 2. GREEN — the least code that passes

No extra options, no speculative parameters, nothing the check doesn't
demand. Then run the package:

```bash
pnpm --filter <pkg> exec vitest run <path/to/file.test.ts>
pnpm --filter <pkg> test
```

Check fails → fix the code, not the check. Another test fails → fix it now.

### 3. KEEP OR SCRATCH

Ask the three questions. Then:

- **Keep**: tidy it to the house style. Fold it into the existing file's
  fixture builder or `it.each` table rather than appending a near-duplicate.
- **Scratch**: move it out of the repo (scratchpad, or quote it in the run
  log), and say in the commit message how the change was proven.

Typical scratch proofs: a wiring fix between two of our modules, "this
function is now called with X", a regex showing a migration contains a
clause, a test that the new constant has the new value.

### 4. Typecheck

```bash
pnpm exec turbo run typecheck --filter=<pkg>
```

The repo uses `noUncheckedIndexedAccess`: indexed access in assertions needs
`rows[0]?.id`, which only typecheck surfaces.

## Done when

- [ ] Each new behaviour was proven by a check you watched fail, for the right reason
- [ ] Every committed test passes the three questions; the rest are scratch
- [ ] `pnpm --filter <pkg> test` green with a non-zero test count
- [ ] `pnpm exec turbo run typecheck --filter=<pkg>` green
