# llm/loops — loop bindings + ledgers

Home for the conductor loop's work items.

## Layout

- **`llm/loops/`** — committed docs only (this README; design docs live in siblings like `llm/outer-loop/`).
- **`llm/loops/runs/<id>/`** — **all** runtime artifacts for one loop run. Gitignored wholesale (`llm/loops/runs/`), so runtime can never leak into git and docs are tracked by default. The harness owns every path here via `@carbon/harness`'s `layout.ts` — nothing should hardcode these strings.

Per run:

| File | Written by | What |
|------|-----------|------|
| `binding.loop.md` | run-loop | the binding the run was driven from (persisted for inspection / re-entry) |
| `ledger.jsonl` | `appendLedger` | append-only per-iteration record (change, gates, keep/revert, reason) |
| `run.log.jsonl` | run-loop | full event log |
| `outcome.json` | run-loop | the final `LoopOutcome` (incl. `prUrl`) — the machine-readable result an external orchestrator reads instead of scraping stdout |
| `screenshots/` | behavior gate | before/after captures (hosted on the `loop-artifacts` branch for the PR) |

## Lifecycle / GC

Finished runs accumulate; prune them with:

```
pnpm --filter @carbon/harness run gc -- [--cwd <dir>] [--keep-last <n>] [--max-age-days <n>]
```

(Script is named `gc`, not `prune` — `pnpm prune` is a built-in pnpm command.)

`pruneRuns` (and `listRuns` / `readOutcome`) are exported from `@carbon/harness` for the outer-loop janitor to call. **Unfinished runs (no `outcome.json`) are never pruned** — they may be in flight.

## Binding format

```markdown
---
id: bug-reorder-align
kind: bug            # bug | feature | usability | copy
title: Reorder button misaligns on short rows
risk: low            # low | med | high
acceptance:
- Reorder button vertically centers in the row at <640px
- No new console errors on the line-items page
---

Freeform notes / context for the loop (optional).
```

Each `acceptance` bullet is a definition-of-done the loop must satisfy and prove via a gate.
