<!-- Workflow pattern inspired by Open Mercato (MIT License)
     https://github.com/open-mercato/open-mercato
     Copyright (c) 2025-2026 Open Mercato contributors -->

---
name: fix
description: Implement the minimal code change from a root-cause brief. Writes code, adds regression tests, validates gates. No commit, no push, no PR — the conductor or open-pr handles that.
---

# fix — minimal code change from a root-cause brief

You are implementing the **smallest correct fix** for a bug that has already been analyzed. You have a root-cause brief (from `/root-cause` or equivalent) that tells you exactly what to change and why. Your job is to execute that change, prove it works, and stop.

**Announce at start:** "I'm using the fix skill to implement the change from the root-cause brief."

## 0. Prerequisites

Before writing any code:

1. **Read the root-cause brief.** If none exists, stop and run `/root-cause` first.
2. **Read `.ai/lessons.md`** — check for pitfalls in the affected area.
3. **Read the module AGENTS.md** for the affected package/module.
4. **Read `BACKWARD_COMPATIBILITY.md`** — know which surfaces are FROZEN, STABLE, or ADDITIVE-ONLY.
5. **Check issue assignment.** If working from a GitHub issue, ensure it's assigned to `carbon-agent` with the `agent:working` label:
   ```bash
   gh issue edit <number> --add-assignee carbon-agent --add-label "agent:working"
   ```

## 1. Plan the change

Before touching code, list:
- **Files to modify** (from the brief's "Files to change")
- **Files to create** (new test files, migrations)
- **Callers to update** (if changing a service function signature)

Verify the plan against the brief. If the brief says change 2 files and you're planning to change 8, stop and re-scope.

## 2. Implement

### Rules

- **One concern per change.** Fix the bug. Don't refactor, don't clean up, don't "improve while here."
- **Follow existing patterns.** Read the surrounding code and match its style. Use `grep` to find similar patterns in the codebase.
- **companyId scoping.** Every new or modified query that touches tenant data MUST include `companyId` filtering. This is Carbon's equivalent of a security gate — never skip it.
- **Service file discipline.** One `{module}.service.ts` and one `{module}.models.ts` per module. Never scatter new service/models files.
- **Import conventions.** `~/*` for app code, `@carbon/*` for workspace packages.
- **Schema changes.** If the fix requires a migration:
  - Read `.ai/rules/workflow-database-migration.md` first
  - Use `id('prefix')` for primary keys
  - Include `companyId` with composite PK `("id", "companyId")`
  - Add standard audit columns
  - Run `pnpm run generate:types` after applying the migration, BEFORE typechecking

## 3. Write regression tests

**Mandatory.** Every fix MUST include at least one test that:

1. **Would have failed** before the fix (red → green pattern)
2. **Passes** after the fix
3. **Guards against regression** — if someone reverts the fix, this test catches it

Place tests adjacent to the code following Carbon conventions:
- Module tests: `apps/erp/app/modules/{module}/__tests__/`
- Package tests: `packages/{package}/src/__tests__/`
- Use existing test utilities and patterns from sibling test files

## 4. Validate

Run the validation gates **in this order**. Every applicable gate must pass:

```bash
# 1. Regenerate types (only if schema changed)
pnpm run generate:types

# 2. Lint
pnpm run lint

# 3. Typecheck
pnpm run typecheck

# 4. Tests
pnpm run test
```

**If a gate fails:**
- Read the error carefully
- Fix it if the failure is caused by your change
- Re-run the failed gate
- If the failure is pre-existing (unrelated to your change), note it in the output but don't fix it

## 5. Self-review

Before declaring ready, check:

| Check | Question |
|-------|----------|
| **Scope** | Did I change only what the brief called for? |
| **companyId** | Does every new/modified query scope by `companyId` where needed? |
| **BC contract** | Does the change touch any FROZEN surface? Any STABLE surface without deprecation? |
| **Callers** | Did I update all callers of any changed signature? |
| **Tests** | Does my test actually fail without the fix? |
| **Imports** | Am I using `~/*` and `@carbon/*` correctly? |
| **Patterns** | Does my code match the style of surrounding code? |

## 6. Output

Produce exactly this structure:

```markdown
## Fix Summary

**Status:** READY | BLOCKED
<if BLOCKED: explain what's blocking and what's needed>

**Root-cause brief:** <link or path to the brief>

**Files changed:**
- `path/to/file.ts` — <what changed>
- `path/to/other.ts` — <what changed>

**Tests added:**
- `path/to/test.ts` — <what it verifies>

**Validation gates:**
- generate:types — PASS | SKIP (no schema change)
- lint — PASS
- typecheck — PASS
- test — PASS

**BC assessment:** NONE | <list touched surfaces and how they comply>

**Summary:** <2-3 sentences on what was fixed and how>
```

## Guardrails

- **No commit, no push, no PR.** The conductor or `/open-pr` handles that. Your job ends at "code is ready, gates pass."
- **No scope creep.** If you discover a related bug, note it in the output — don't fix it.
- **No guessing.** If the root-cause brief is unclear or you disagree with it, stop and say so. Don't implement a fix you don't believe in.
- **Minimal blast radius.** Prefer the fix that touches the fewest files and changes the fewest lines while being correct and complete.
