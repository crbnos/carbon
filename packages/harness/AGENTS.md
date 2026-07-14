# @carbon/harness

AI agent harness — binding parsing, gate execution, the conductor loop, ledger, worktree management, and PR creation.

## Always

- **Parse bindings from `.loop.md` frontmatter** — `parseBinding(md)` extracts `id`, `kind`, `risk`, `title`, `acceptance[]`, and optional `issue` number
- **Commit early, push often** — every doer pass is checkpoint-committed and force-with-lease pushed BEFORE gates run; failures fix forward on the checkpoint, never `git checkout -- .`
- **The doer self-chunks** — a session that can't finish its task stops at a coherent slice and reports `remaining`; gate-green slices checkpoint, skip the judge, don't count as failed attempts, and the next session continues from them
- **A doer with no verdict never ends the run** — a capped/garbled session is checkpointed, counted as one failed attempt, and the task continues with a fresh session; `blocked` is only for an explicit doer-reported impossibility
- **Re-dispatch = resume** — `resolvePlan` reads the branch-committed `outcome.json`: non-shipped prior runs restore their plan, skip done/flagged tasks free, and carry `unverified`/`questions` forward
- **Run floor gates on the committed state** — `FLOOR_GATES` (lint, conformance, clobbers) are the minimum quality bar; a red gate means the next attempt fixes forward, and exhausted tasks park their attempts on `loop-rescue/<id>/t<k>` before resetting
- **Append to the JSONL ledger after every iteration** — `appendLedger(path, entry)` records iteration, task, change, gates, decision (keep/checkpoint/revert), reason, timestamp, and any `unverified`/`questions`/`assumptions`
- **Distinguish disproof from absence of proof** — a behavior gate that reached the state and saw the change fail reverts the iteration; a gate that could not verify either way (`unverified`) keeps judge-approved work and ships it as a draft PR labeled `agent:needs-verification`
- **A missing judge verdict is not a rejection** — no parseable JSON from the judge triggers one retry; still missing ⇒ gate-green work is kept flagged for human review (never reverted, never shipped-as-met); 2 consecutive verdict-less iterations ⇒ `blocked` + salvage PR
- **Never discard kept work** — non-shipped outcomes (plateau/blocked) with kept commits still open a `[partial]` salvage draft PR via `run-loop`
- **Never merge from the harness** — the loop ships PRs; merging is the human gate

## Ask First

- Adding new `FLOOR_GATES` (extends the CI quality bar for all agent builds)
- Changing the `runLoop` terminal-state machine (keep/revert/shipped logic)
- Modifying prompt templates in `runner/prompts.ts`

## Never

- Run the loop on `main` — it only operates in worktrees on feature branches
- Skip gates — even if the doer claims the change is trivial
- Merge PRs from harness code — PR approval is always the human gate

## Validation Commands

```bash
pnpm --filter @carbon/harness test     # vitest — unit tests
pnpm --filter @carbon/harness gates    # run floor gates
pnpm --filter @carbon/harness loop     # run the conductor loop (needs a binding)
pnpm --filter @carbon/harness gc       # prune old run directories
```

## Key Patterns

- **Binding**: `src/binding.ts` — YAML-ish frontmatter parser; `LoopKind = "bug" | "feature" | "usability" | "copy"`; the markdown body is captured as `notes` (grooming context injected into all prompts)
- **Plan**: `src/runner/plan.ts` — `buildPlan(binding, config, deps)` decomposes a >2-criteria binding into 2–6 small ordered `PlanTask`s (planner session; falls back to one whole-binding task, coverage completed by construction)
- **Gates**: `src/gates.ts` — `FLOOR_GATES[]` + `runGates(gates, exec)` → `GateResult[]`
- **Loop**: `src/runner/loop.ts` — `runLoop(binding, config, deps)` drives the plan task-by-task through doer → checkpoint(commit+push) → gates → behavior → judge(per-task diff) → done/fix-forward; collects `unverified`, `questions`, and `plan` statuses onto `LoopOutcome`
- **Behavior verdicts**: `src/runner/behavior.ts` — three-way `passed | failed | unverified`; stack-down, capped sessions, and unbuildable test data are `unverified`, never `failed`
- **Ledger**: `src/ledger.ts` — append-only JSONL log of iteration outcomes
- **PR**: `src/runner/pr.ts` — `openPr(binding, ledgerPath, shell, cwd, flags)`; `Closes #<issue>` when binding has `issue` (`Related to` on partial PRs); `flags.unverified`/`flags.partial` → draft + `agent:needs-verification` label
- **Shell**: `src/runner/shell.ts` — `sq()` for safe quoting; `src/runner/claude.ts` — headless Claude invocation

## Cross-References

- `packages/checks/` — `@carbon/checks test` and `clobbers` are floor gates
- `.ai/skills/conductor/SKILL.md` — the conductor skill that this harness implements
- `.ai/docs/outer-loop.md` — outer-loop design docs
- `packages/dev/` — `crbn up --run` for booting stacks in CI/headless
