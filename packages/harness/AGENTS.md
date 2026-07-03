# @carbon/harness

AI agent harness — binding parsing, gate execution, the conductor loop, ledger, worktree management, and PR creation.

## Always

- **Parse bindings from `.loop.md` frontmatter** — `parseBinding(md)` extracts `id`, `kind`, `risk`, `title`, `acceptance[]`, and optional `issue` number
- **Run floor gates before accepting changes** — `FLOOR_GATES` (lint, conformance, clobbers) are the minimum quality bar; the loop reverts on gate failure
- **Append to the JSONL ledger after every iteration** — `appendLedger(path, entry)` records iteration, change, gates, decision (keep/revert), reason, and timestamp
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

- **Binding**: `src/binding.ts` — YAML-ish frontmatter parser; `LoopKind = "bug" | "feature" | "usability" | "copy"`
- **Gates**: `src/gates.ts` — `FLOOR_GATES[]` + `runGates(gates, exec)` → `GateResult[]`
- **Loop**: `src/runner/loop.ts` — `runLoop(binding, config, deps)` drives one work item through doer → behavior → judge → gates → keep/revert
- **Ledger**: `src/ledger.ts` — append-only JSONL log of iteration outcomes
- **PR**: `src/runner/pr.ts` — creates GitHub PR with `Closes #<issue>` when binding has `issue`
- **Shell**: `src/runner/shell.ts` — `sq()` for safe quoting; `src/runner/claude.ts` — headless Claude invocation

## Cross-References

- `packages/checks/` — `@carbon/checks test` and `clobbers` are floor gates
- `.ai/skills/conductor/SKILL.md` — the conductor skill that this harness implements
- `.ai/docs/outer-loop.md` — outer-loop design docs
- `packages/dev/` — `crbn up --run` for booting stacks in CI/headless
