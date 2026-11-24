---
paths: ["**/*.test.ts", "**/*.test.tsx"]
triggers: []
promoted: null
---
# A test that stays green when you break the code guards nothing

**Context:** A 2026-11 prune of every test file in the repo (1,268 files) deleted about 300 tests and rewrote about 300 more.

**Problem:** Most of them passed when the code was wrong. Some had an expected value computed by the function under test. Some checked only that two legs sum to zero, which still passes with the signs swapped. Some never reached the branch their name describes, and some ran a fake that ignores the filter it tests. Others failed when nothing a user sees had changed: pinned UI copy, call order, a constant echoed back. A test that only guarded the same rule in another package doubled the upkeep.

**Rule:** Before you commit a test, make the bug it names in the code and watch the test fail. Write expected values as literals. Grep for an existing test of the same rule first. The full list of patterns is in `.claude/rules/testing.md` → "Before you commit one: break the code".

**Applies to:** every committed `*.test.ts` / `*.test.tsx`, including the regression test of a fix.
