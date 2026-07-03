---
name: fix
description: Implement the minimal code change from a root-cause brief, with a mandatory red→green regression test and scoped validation gates. Use after /root-cause (or when the cause is already proven) to write the fix. No commit, no push, no PR from this skill — /check-and-commit handles committing. Do not use without a root-cause brief, and do not use for features (use /plan + /execute).
---
<!-- Workflow pattern inspired by Open Mercato (MIT License)
     https://github.com/open-mercato/open-mercato
     Copyright (c) 2025-2026 Open Mercato contributors -->

# fix — minimal change from a root-cause brief

Input: a root-cause brief (from `/root-cause` or equivalent proof). Output: the
smallest correct fix plus a regression test, all gates green, ready for
`/check-and-commit`. Your job is to execute the brief, prove it, and stop.

**Announce at start:** "Using the fix skill — implementing the change from the
root-cause brief."

## Step 0: Prerequisites

1. **Read the brief.** No brief → STOP and run `/root-cause` first.
2. Read `.ai/lessons.md` for the affected area.
3. Read the affected module/package `AGENTS.md`.
4. Read `BACKWARD_COMPATIBILITY.md` if the brief lists any BC impact.
5. If working a GitHub issue: `gh issue edit <number> --add-assignee carbon-agent --add-label "agent:working"`.

## Step 1: Plan the change

List before touching code: files to modify (from the brief), files to create
(tests, migrations), callers to update (if a signature changes — grep for every
call site). If the brief says 2 files and your list says 8 → STOP and re-scope
with the human.

## Step 2: Write the failing test FIRST

Mandatory for every fix. Write a regression test that reproduces the bug, then
run it and **watch it fail** before changing any production code:

```bash
pnpm --filter <pkg> exec vitest run <path/to/test> 
# Expected: FAIL, for the reason the brief describes (not a typo/import error)
```

A test that passes immediately proves nothing — it isn't testing the bug. Test
locations: `apps/erp/app/modules/{module}/__tests__/` or
`packages/{pkg}/src/__tests__/` (or next to the source, matching siblings). Copy
setup patterns from a sibling test file.

If the bug is only provable in the browser (layout, visual state), the failing
proof is a `/test` run + BEFORE screenshot instead — say so explicitly.

## Step 3: Implement

- **One concern.** Fix the bug. No refactoring, no cleanup, no "while I'm here".
- **Match surrounding patterns** — grep for similar code and copy its idiom.
- **companyId scoping** on every new or modified tenant-data query. Never skip.
- **Module discipline**: one `{module}.service.ts`, one `{module}.models.ts`.
- **Imports**: `~/*` app code, `@carbon/*` workspace packages.
- **Schema changes**: follow `.ai/rules/workflow-database-migration.md`; then
  `pnpm run generate:types` BEFORE typechecking.
- **Minimal blast radius**: fewest files, fewest lines, still complete.

## Step 4: Validate (scoped gates, in order)

```bash
# 1. Types (only if schema changed)
pnpm run generate:types

# 2. Format + lint the files you touched
pnpm exec biome check --write <changed paths>

# 3. Typecheck each touched package — NEVER whole-repo (it OOMs)
pnpm exec turbo run typecheck --filter=<pkg>

# 4. Tests for each touched package — your new test must now PASS
pnpm --filter <pkg> test
```

Gate failed? Read the error. Caused by your change → fix and re-run. Clearly
pre-existing and unrelated → note it in the output, don't chase it. Two failed
fix attempts on the same gate → STOP, report BLOCKED.

## Step 5: Self-review

| Check | Question |
|-------|----------|
| Scope | Did I change only what the brief called for? |
| Red→green | Did I watch the test fail before the fix and pass after? |
| companyId | Every new/modified query scoped? |
| Callers | Every caller of a changed signature updated? |
| BC | Any FROZEN surface touched? STABLE without deprecation? |
| Patterns | Does the code read like its neighbors? |
| Leftovers | No debug logging, commented-out code, or stray files in the diff? |

## Step 6: Output

```markdown
## Fix Summary
**Status:** READY | BLOCKED <if BLOCKED: what and why>
**Root-cause brief:** <path/link>
**Files changed:** <path — what>
**Regression test:** <path — failed before fix (output), passes after (output)>
**Gates:** generate:types PASS|SKIP · biome PASS · typecheck(<pkgs>) PASS · test(<pkgs>) PASS
**BC assessment:** NONE | <surfaces and how they comply>
**Summary:** <2–3 sentences>
```

Then hand off to `/check-and-commit`.

## Guardrails

- **No commit, no push, no PR** from this skill.
- **No scope creep** — related bugs get one line in the output, not a fix.
- **No guessing** — if the brief is unclear or you disagree with it, STOP and
  say so. Don't implement a fix you don't believe in.

Red flags — thinking any of these means the process is off the rails; STOP:

- "the fix is obvious, I'll write the test after" (a test written after passes
  immediately and proves nothing — Step 2 comes first)
- "while I'm here, I'll clean this up too"
- "the test is hard to write, I'll just verify manually" (report BLOCKED instead)
- "the brief is probably right" (if the code you read doesn't confirm the cause,
  go back to /root-cause)
