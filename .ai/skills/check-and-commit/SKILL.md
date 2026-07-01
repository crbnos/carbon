<!-- Workflow pattern inspired by Open Mercato (MIT License)
     https://github.com/open-mercato/open-mercato
     Copyright (c) 2025-2026 Open Mercato contributors -->

---
name: check-and-commit
description: Pre-commit verification gate. Runs Carbon's validation suite in order, fixes straightforward failures, and commits+pushes only when all gates pass. Use after /fix or manual changes.
---

# check-and-commit — pre-commit verification gate

Run all validation gates, fix what's auto-fixable, and commit only when everything is green.

**Announce at start:** "I'm using the check-and-commit skill to verify and commit."

## 1. Detect schema changes

```bash
git diff --cached --name-only -- 'packages/database/supabase/migrations/' | head -1
```

If any migration files are staged or modified, set `SCHEMA_CHANGED=true`.

## 2. Run gates in order

Run each gate sequentially. Stop on failure, fix if straightforward, re-run.

### Gate 1: Generate types (if schema changed)

```bash
# Only if SCHEMA_CHANGED
pnpm run generate:types
```

If types changed, stage them: `git add packages/database/src/`.

### Gate 2: Lint

```bash
pnpm run lint
```

**Auto-fixable?** Run `pnpm run lint --fix`, stage fixed files, re-run lint to confirm.

### Gate 3: Typecheck

```bash
pnpm run typecheck
```

**Stale types?** If errors reference missing columns/types from a new migration and Gate 1 was skipped, run `pnpm run generate:types` now, then re-run typecheck.

**Other type errors from your changes?** Fix them directly, re-run.

### Gate 4: Test

```bash
pnpm run test
```

**Failures from your changes?** Fix the code or test, re-run.

**Pre-existing failures?** Note them in the report but don't block the commit.

### Gate 5: Build (if needed)

Only run if the change affects build outputs (package exports, config, SST):

```bash
pnpm run build
```

## 3. Fix policy

| Failure type | Action |
|-------------|--------|
| Lint auto-fixable (formatting, import order) | Fix automatically, re-run |
| Type error from stale generated types | Run `generate:types`, re-run |
| Type error from your change | Fix the code, re-run |
| Test failure from your change | Fix the code or test, re-run |
| Pre-existing / unrelated failure | Note in report, don't block |
| Build failure from your change | Fix, re-run |
| Unclear or complex failure | **Stop. Report as blocked.** |

**Limit: 2 fix-and-retry cycles per gate.** If a gate still fails after 2 attempts, stop and report as blocked.

## 4. Commit and push

Only when **all gates pass**:

```bash
git add -A
git commit -m "<type>(<scope>): <description>"
git push
```

Use conventional commits: `fix`, `feat`, `chore`, `refactor`, `test`, `docs`.

## 5. Report

```markdown
## Check & Commit Report

**Result:** COMMITTED | BLOCKED

**Gates:**
| Gate | Result | Notes |
|------|--------|-------|
| generate:types | PASS / SKIP | <if run, note what changed> |
| lint | PASS | <if auto-fixed, list files> |
| typecheck | PASS | |
| test | PASS | <note any pre-existing failures> |
| build | PASS / SKIP | |

**Auto-fixed:** <list files fixed during gate runs, or "none">

**Commit:** `<sha>` — `<commit message>`
**Branch:** `<branch-name>`
```

If blocked:

```markdown
**Result:** BLOCKED

**Blocking gate:** <gate name>
**Error:** <concise error summary>
**Attempts:** <what was tried>
```
