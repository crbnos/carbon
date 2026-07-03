# Outer Loop — Autonomous Agent Architecture

How the `carbon-agent` autonomous builder works. The outer loop runs on OpenClaw (scheduling, webhooks, state) and dispatches Claude Code headless (`claude -p`) for all coding work.

## Interface

**Assign a GitHub issue to `carbon-agent` → it builds it.** Assign nothing → it grooms the backlog so there's good work ready to assign.

## Architecture

```
OpenClaw runtime (heartbeat · webhooks · cron · sandbox · SQLite)
 └─ claude -p --dangerously-skip-permissions     ← outer-loop orchestration
     └─ crbn up --run 'pnpm --filter @carbon/harness loop …'  ← inner-loop dispatch
         └─ harness spawns claude -p (doer / judge / behavior)  ← conductor
```

- **OpenClaw** = runtime only (heartbeat, webhooks, cron, channels, state, sandbox)
- **Claude Code** = all reasoning (triage, binding synthesis, dispatch, grooming, PR feedback)
- **Harness** = the conductor inner loop that drives a Binding to a gated PR

## Wake Loop (every 30 min)

1. **Reconcile leases** — `agent:working` issues with no live build → stale → recover
2. **PR feedback** (highest priority) — unresolved review comments → re-enter inner loop on same branch
3. **Assigned work** — pick top issue by priority → synthesize Binding → dispatch conductor
4. **Slack ingest** — tagged in a thread → read context, create issue, self-assign
5. **Idle** → groom one backlog issue (comment spec + acceptance criteria, never build)
6. **GC** — prune worktrees, Docker volumes, loop runs

## Key Contracts

### Harness

```bash
crbn up --minimal --run 'pnpm --filter @carbon/harness loop <binding-path> --cwd <worktree-path>' --volumes
```

- Drives a `Binding` (in `.ai/runs/<id>/binding.loop.md`) to a gated PR
- Writes `.ai/runs/<id>/outcome.json` → `{ state, prUrl, reason }`
- `openPr` is idempotent (PR-feedback re-entry reuses the same branch/PR)
- GC: `pnpm --filter @carbon/harness run gc`

### Agent Labels

| Label | Meaning |
|-------|---------|
| `agent:working` | Build in flight (lease held) |
| `agent:groomed` | Spec proposed, ready to assign |
| `agent:needs-decomposition` | Epic-sized, breakdown proposed |
| `agent:blocked` | Build failed/plateaued, needs human |

### Safety

- Never merge — human approves every PR
- Never push to main — always feature branches
- One build at a time (`N=1`) — mutex via lockfile + process check
- Per-task + daily `$` budget caps
- Kill switch: unassign the issue

## Related Files

- **Conductor skill:** `.ai/skills/conductor/SKILL.md`
- **Harness:** `packages/harness/`
- **Agent labels workflow:** `.github/scripts/setup-agent-labels.sh`
- **Operating prompt:** lives on the OpenClaw box (not in this repo)
