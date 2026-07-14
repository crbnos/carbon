# Loop System — Bindings, Runs, and the Conductor

The conductor loop drives a **Binding** (a scoped work item) through iterative doer → gates → judge cycles to produce a gated PR. All loop infrastructure lives in `@carbon/harness` (`packages/harness/`).

## Architecture

```
outer-loop (OpenClaw cron → Claude Code headless)
  └─ synthesizes a Binding from an assigned issue
  └─ dispatches: crbn up --minimal --run 'pnpm --filter @carbon/harness loop <binding> --cwd <worktree>' --volumes
       └─ harness runLoop (pure function, side effects via deps)
            ├─ planner (claude -p) — decomposes the binding into small ordered
            │    tasks (skipped for ≤2 criteria; falls back to one task)
            └─ per task, up to taskMaxAttempts FAILED attempts:
                 ├─ doer   (claude -p) — one focused session on THIS task;
                 │    may end early at a coherent SLICE (reports `remaining`)
                 ├─ CHECKPOINT — commit + push BEFORE gates (work preserved first)
                 ├─ floor gates — lint, conformance, clobbers
                 ├─ per-package typecheck — only touched packages
                 ├─ behavior gate — UI verification (passed | failed | unverified)
                 ├─ correctness gate — doer's testCommand
                 ├─ judge  (claude -p) — reviews THIS task's diff (startSha..HEAD);
                 │    skipped for slices (nothing complete to approve yet)
                 └─ done → next task · slice → next session continues (not a failure)
                    not done → fix forward on the checkpoint
                    failed attempts exhausted → rescue branch + reset → end (salvage PR)
```

**The doer chunks its own work too.** Its prompt tells it its exact session
caps (turns + budget) and: if the task won't fit in one budgeted session, stop
early at a coherent, committable slice and report `remaining` — a clean partial
slice is success; racing the turn/budget cap to a broken finish is failure.
Gate-green slices are checkpointed and pushed, skip the judge, reset the
failure counter, and hand the next session the remaining work — so no session
ever needs to be bigger than what it can finish cleanly.

**A doer session with no verdict never ends the run.** A capped/garbled doer
session (no JSON handoff) is checkpointed as-is, counted as one failed attempt,
and the task continues with a fresh session; `blocked` is reserved for the doer
*explicitly* reporting a hard impossibility. (#1031's second run died at T4 on
the old no-verdict → blocked behavior.)

**Re-dispatch = resume.** The full plan (tasks + statuses) is written into
`outcome.json`, which is committed with the branch (#1070). Re-dispatching the
same binding on the same branch resumes deterministically: `done`/`flagged`
tasks are skipped without spending a session, `pending`/`failed` ones re-run,
and the prior run's `unverified`/`questions` flags carry into the new PR body.
A prior `shipped` outcome never resumes — PR-feedback re-entry gets a fresh
plan. The outer loop needs zero judgment: "run the same dispatch command again"
is always the right recovery move.

**Nothing is ever thrown away.** Every doer pass is committed and force-with-lease
pushed to the loop branch before gates run; failed attempts stay on the branch as
checkpoints that the next attempt fixes forward; a failed task's attempts are
pushed to `loop-rescue/<id>/t<k>` before the branch resets to the last green
checkpoint; a crashed process loses at most one uncommitted edit.

**Design docs:**
- `.ai/docs/outer-loop.md` — orchestrator architecture, wake loop, safety
- `.ai/skills/conductor/SKILL.md` — the inner-loop skill (what Claude Code follows during a build)

## Runtime Layout

Loop runtime state lives under `.ai/runs/<id>/` (`RUNS_DIR` in `layout.ts`). Per-run **directories** are gitignored (`.ai/runs/*/`); the committed markdown run logs from the plan/execute skills (`.ai/runs/*.md`) share the same root and stay tracked. Run dirs don't exist in a fresh checkout — `run-loop.ts` creates them when a loop executes.

```
.ai/runs/<id>/               # one loop run's ephemeral artifacts — GITIGNORED
├── binding.loop.md          # the binding this run was driven from
├── ledger.jsonl             # append-only per-iteration record
├── run.log.jsonl            # full event log
├── outcome.json             # final LoopOutcome (machine-readable result)
└── screenshots/             # behavior-gate captures (hosted on loop-artifacts branch)
```

Outer-loop scratch (`agent-state.db`, daily notes) lives on the OpenClaw box, not in this repo.


**Key exports from `layout.ts`:**
- `RUNS_DIR` — repo-relative root for run artifacts
- `runDir(cwd, id)`, `bindingPath(cwd, id)`, `ledgerPath(cwd, id)`, `logPath(cwd, id)`, `outcomePath(cwd, id)`, `screenshotsDir(cwd, id)`, `hostedScreenshotPath(id, name)`

## Binding Format

Bindings live at `.ai/runs/<id>/binding.loop.md`. The parser (`parseBinding` in `binding.ts`) reads the YAML frontmatter for structured fields; the **markdown body after the frontmatter is captured as `notes`** — grooming context (resolved questions, repro steps, test-data hints) that is injected into the doer, judge, and behavior-gate prompts. Put everything the loop needs to not ask questions there.

```markdown
---
id: bug-reorder-align
kind: bug
title: Reorder button misaligns on short rows
risk: low
acceptance:
  - Reorder button vertically centers in the row at <640px
  - No new console errors on the line-items page
---

Freeform notes / context for the loop (optional).
```

| Field | Type | Values |
|-------|------|--------|
| `id` | string | unique identifier for the run |
| `kind` | enum | `bug` · `feature` · `usability` · `copy` |
| `title` | string | concise description |
| `risk` | enum | `low` · `med` · `high` (⚠️ `med`, not `medium`) |
| `acceptance` | string[] | concrete, testable criteria (contiguous `- item` lines) |
| `issue` | number? | GitHub issue number (PR body gets `Closes #<n>`; `Related to #<n>` on partial PRs) |
| `notes` | string? | markdown body — grooming context fed to doer/judge/behavior prompts |

**Validation:** `parseBinding` requires `id` and a valid `kind`. Risk defaults to `"low"` if absent. Acceptance must be inside the frontmatter block as contiguous `- item` lines — a blank line or another key ends the list.

## Floor Gates

Every dirty iteration runs these before the judge sees the change:

| Gate | Command |
|------|---------|
| `lint` | `pnpm exec biome check` |
| `conformance` | `pnpm --filter @carbon/checks test` |
| `clobbers` | `pnpm --filter @carbon/checks clobbers` |

Plus **per-package typecheck** for each package the doer touched.

## Runner Configuration

`DEFAULT_CONFIG` in `runner/types.ts`:

| Setting | Value | Notes |
|---------|-------|-------|
| `taskMaxAttempts` | 3 | doer attempts per plan task before rescue+reset |
| `maxIterations` | 16 | hard ceiling on total iterations across all tasks |
| `plannerMaxTurns` | 25 | |
| `plannerMaxBudgetUsd` | $2 | |
| `doerMaxTurns` | 60 | |
| `doerMaxBudgetUsd` | $5 | |
| `judgeMaxTurns` | 30 | per-task judge sessions are small — see #1063 for overrides |
| `judgeMaxBudgetUsd` | $5 | |
| `behaviorMaxTurns` | 300 | raised from 40 in #961 |
| `behaviorMaxBudgetUsd` | $15 | raised from $3 in #961 |

(`plateauAfter` is gone — progress control is per-task attempts now, not a
global no-progress counter.)

## Terminal States

`LoopOutcome.state` is one of:

| State | Meaning |
|-------|---------|
| `shipped` | all plan tasks concluded, PR opened (or updated) — possibly flagged `unverified` |
| `blocked` | doer reported a hard blocker, or the judge went silent on 2 consecutive tasks |
| `plateau` | a task failed after `taskMaxAttempts` (attempts on its rescue branch), or `maxIterations` hit |
| `error` | unexpected failure (tree checkpointed + pushed first) |

`LoopOutcome` also carries:

- **`unverified?: string[]`** — proof gaps on kept work: the behavior gate could not verify **either way** (missing test data it couldn't construct, capped session, stack down). Absence of proof is *not* disproof — the work still ships, as a **draft PR** labeled `agent:needs-verification` whose body names exactly what a human must verify. Only a gate that *reached the state and saw the change not work* (`verdict: "failed"`) counts as a red gate — and even then the checkpoint stays for the next attempt to fix forward.
- **`questions?: string[]`** — product questions raised mid-loop: acceptance criteria the judge *disputed* (wrong premise / needs a product decision — excluded from `unmet` so the loop doesn't churn on them) plus assumptions the doer made instead of blocking. The outer loop posts these back to the issue so grooming resolves them before any re-dispatch.
- **`plan?`** — the task list and each task's status (`done` / `flagged` / `failed` / `pending`); rendered as a checklist in the PR body.
- **Judge no-verdict handling** — a judge session that produces no parseable JSON (capped budget/turns, garbled output) is **absence of review, not rejection**. The loop retries the judge once with a fresh session; if the verdict is still missing, the task concludes **`flagged`** — kept and pushed, marked "kept without judge review" — rather than reverted. Two consecutive verdict-less tasks end the run `blocked`, with all kept work already on the branch. (Issue #1031 lost ~$8.5 of correct doer work to the old revert-on-no-verdict behavior.)
- **`prUrl?`** — set for shipped runs *and* for **salvage PRs**: when a run ends `plateau`/`blocked`/`error` but committed work exists (any `keep` or `checkpoint` ledger entry), `run-loop` still opens a draft PR marked `[partial]` (`Related to #<n>`, never `Closes`) instead of letting the worktree GC discard paid-for work. Since every checkpoint is pushed, the branch survives even if PR creation itself fails.

The outer loop reads `outcome.json` to decide next steps (report, label, escalate).

## GC

Prune finished runs with:

```bash
pnpm --filter @carbon/harness run gc -- [--cwd <dir>] [--keep-last <n>] [--max-age-days <n>]
```

`pruneRuns`, `listRuns`, and `readOutcome` are exported from `@carbon/harness` for the outer-loop janitor. **Unfinished runs (no `outcome.json`) are never pruned** — they may be in flight.

## Harness Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `loop` | `pnpm --filter @carbon/harness run loop <binding-path> [--cwd <worktree>] [--no-pr]` | run one loop to a gated PR |
| `gates` | `pnpm --filter @carbon/harness run gates` | run floor gates only |
| `gc` | `pnpm --filter @carbon/harness run gc [--cwd <dir>] [--keep-last <n>] [--max-age-days <n>]` | prune finished runs |
