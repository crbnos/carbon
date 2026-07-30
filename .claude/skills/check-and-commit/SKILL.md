---
name: check-and-commit
description: Pre-commit verification gate — runs Carbon's validation gates in order (generate:types if schema changed, biome, scoped typecheck, scoped tests, build if needed, and /translate to fill missing i18n .po strings when UI/locale files changed), fixes straightforward failures, then commits the specific files with a conventional message. Use after /fix, after an /execute task, or after manual changes when the work should be committed. Commits only when every gate is green; pushes only if the branch already tracks a remote or the user asked.
---
<!-- Workflow pattern inspired by Open Mercato (MIT License)
     https://github.com/open-mercato/open-mercato
     Copyright (c) 2025-2026 Open Mercato contributors -->

# check-and-commit — verification gate, then commit

Run the gates in order, fix what's mechanically fixable, and commit only when
everything is green. This skill is the only place in the workflow that commits.

**Announce at start:** "Using the check-and-commit skill — running the gates,
then committing."

## Step 1: Identify what changed

```bash
git status --porcelain
git diff --name-only HEAD   # staged + unstaged vs HEAD — the full change set
```

Derive every flag below from `git diff --name-only HEAD` (all changes vs the last
commit). Plain `git diff --name-only` omits already-staged files, which would let
staged UI/`.po` files slip past `I18N_RELEVANT` and skip Gate 6. From the changed
paths, derive:

- `SCHEMA_CHANGED` — any file under `packages/database/supabase/migrations/`
- `AGENT_KB_RELEVANT` — the diff touches `docs/content/**` or
  `scripts/generate-agent-kb.ts`. When true, Gate 1b regenerates the agent's doc
  corpus (`apps/erp/app/modules/agent/kb/`) so the generated copy ships in this same
  commit instead of drifting behind the docs (same model as the `.po` files —
  see `.ai/rules/agent-knowledge-base.md`).
- `I18N_RELEVANT` — the diff adds/edits UI source that can introduce new
  translatable strings (`apps/erp/app/**`, `apps/mes/app/**`,
  `packages/react/src/**`) **or** touches any `packages/locale/locales/**/*.po`.
  When true, Gate 3 (i18n) fills missing translations so they ship in this same
  commit instead of drifting behind the code.
- the set of **touched packages** — run this to map changed files to workspace
  package names (these are the `--filter` values for the gates):

  ```bash
  git diff --name-only HEAD | while read -r f; do
    d=$(dirname "$f")
    while [ "$d" != "." ] && [ ! -f "$d/package.json" ]; do d=$(dirname "$d"); done
    [ -f "$d/package.json" ] && sed -n 's/.*"name": *"\([^"]*\)".*/\1/p' "$d/package.json" | head -1
  done | sort -u
  ```

- whether any file is **outside** the intended change (leftover debug file,
  unrelated edit). If yes → exclude it from staging and mention it in the report.

## Step 2: Run the gates in order

Stop on failure, apply the fix policy (Step 3), re-run the failed gate.

```bash
# Gate 1 — types (only if SCHEMA_CHANGED)
pnpm run generate:types
# then include the regenerated files in the commit

# Gate 1b — agent knowledge base (only if AGENT_KB_RELEVANT)
pnpm run generate:agent-kb
# then include the regenerated apps/erp/app/modules/agent/kb/** in the commit
# (runs before biome so the regenerated manifest.json gets formatted too)

# Gate 2 — format + lint (auto-fixes in place)
pnpm exec biome check --write --no-errors-on-unmatched <changed paths>

# Gate 3 — typecheck, one package at a time. NEVER whole-repo (`pnpm typecheck`
# runs every package at once and OOMs the machine).
pnpm exec turbo run typecheck --filter=<pkg>   # repeat per touched package

# Gate 4 — tests per touched package
pnpm --filter <pkg> test

# Gate 5 — build, ONLY if the change affects build outputs
# (package exports, config files, SST infra)
pnpm exec turbo run build --filter=<pkg>
```

### Gate 6 — i18n translations (only if `I18N_RELEVANT`)

Run **last**, after the code gates are green — so no Haiku translation effort is
spent on a commit that would fail typecheck/tests. Fill missing `.po`
translations by invoking the **translate skill** (`/translate`), not by hand:

- Invoke `/translate`. It refreshes catalogs (`lingui:extract`), fans missing
  `msgstr` out to Haiku subagents, merges deterministically, and verifies with
  `linguito check` — see `.claude/skills/translate/SKILL.md` for the full loop.
- If it reports `NOTHING_TO_TRANSLATE` / `linguito check` already clean → nothing
  to add; mark the gate SKIP and continue.
- Otherwise it fills `packages/locale/locales/**/*.po`. Treat the gate as PASS
  only when `/translate` finishes with `Remaining ... : 0` and `linguito check`
  exits 0. If it stops with a residual after its 3-round cap → **STOP, report
  BLOCKED** (don't commit half-translated catalogs).
- The filled `.po` files are now part of this change — add them explicitly in
  Step 4 alongside the code (their package is `@carbon/locale`). `/translate`
  removes its own `.ai/scratch/translate/` scratch; never stage that.

## Step 3: Fix policy

| Failure | Action |
|---------|--------|
| Biome formatting/import order | Already fixed by `--write`; re-run to confirm clean |
| Type error from stale generated types | Run Gate 1, re-run typecheck |
| Type/test error caused by this change | Fix the code, re-run |
| Pre-existing failure, unrelated to this change | Note in report; don't block, don't fix |
| Anything unclear or still failing after **2** fix attempts | STOP — report BLOCKED |

"Pre-existing" must be proven, not assumed: the failing file/test is untouched
by this diff, or the same failure reproduces on the merge-base. If you can't
show one of those, treat it as caused by this change.

Red flags — thinking any of these means the gate is being weakened; STOP:

- "I'll run the gates once at the end instead of in order"
- "`git add -A` is faster"
- "that failure is probably pre-existing" (prove it — see above)
- "the gate is flaky, I'll just retry until it passes"

## Step 4: Commit

Only when all applicable gates pass:

```bash
git add <each changed file, listed explicitly>   # NEVER `git add -A` or `git add .`
git commit -m "<type>(<scope>): <description>"
```

- Types: `fix`, `feat`, `chore`, `refactor`, `test`, `docs`. Scope = module or
  package (`fix(inventory): …`).
- Staging is explicit because worktrees accumulate runtime files (env files,
  screenshots, `.jsonl` debug logs) that must never be committed.
- **Push only if** the branch already tracks a remote (`git rev-parse
  --abbrev-ref @{upstream}` succeeds) **or** the user asked to push. Otherwise
  leave the commit local and say so.

## Step 5: Report

```markdown
## Check & Commit Report
**Result:** COMMITTED | BLOCKED

| Gate | Result | Notes |
|------|--------|-------|
| generate:types | PASS / SKIP | |
| biome | PASS | <files auto-fixed> |
| typecheck (<pkgs>) | PASS | |
| test (<pkgs>) | PASS | <pre-existing failures noted> |
| build | PASS / SKIP | |
| i18n (/translate) | PASS / SKIP | <N filled across locales, or "no missing"> |

**Commit:** `<sha>` — `<message>`  ·  **Pushed:** yes/no
**Excluded from staging:** <files left uncommitted and why, or "none">
```

If BLOCKED: name the gate, the concise error, and what was attempted.
