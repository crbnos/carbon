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

1. **Reconcile leases** — `agent:working` issues with no live build → stale → follow the Crash Recovery protocol below (never delete the branch)
2. **PR feedback** (highest priority) — unresolved review comments → re-enter inner loop on same branch. **Respond immediately on `pull_request_review` / `pull_request_review_comment` webhook — don't wait for heartbeat.** Human org-member comments always act; CodeRabbit Major+ act; CodeRabbit Trivial/Nitpick skip.
3. **Assigned work** — pick top issue by priority → run the pre-dispatch gate (below) → synthesize Binding → dispatch conductor
4. **Slack ingest** — tagged in a thread → read context, create issue, self-assign
5. **Idle** → groom one backlog issue (comment spec + acceptance criteria, never build)
6. **GC** — prune worktrees, Docker volumes, loop runs — **never `loop/*` or `loop-rescue/*` branches on origin** (worktrees are disposable; branches are the work)

## Grooming Contract — questions die here, not in the loop

The conductor loop is unattended: it cannot ask a human anything. Every
question that would stall a build must be answered **on the issue, at grooming
time**, and the answers folded into the binding body. HIL development is what
we are avoiding — the loop either builds or returns; it never waits on a person.

**Pre-dispatch gate.** Before synthesizing a binding and dispatching, verify:

1. **Every acceptance criterion is checked against the current code.** If a
   criterion's premise doesn't match the code (the described mechanism doesn't
   exist), or it encodes a product decision no agent can make (default values,
   intentional behavior changes), post the question as an issue comment, label
   `agent:needs-grooming`, and do **not** dispatch.
2. **The repro is confirmed or statically verifiable.** A bug report whose
   mechanism can't be found in the code needs a human-confirmed repro
   (screenshot, steps) on the issue first.
3. **Each criterion has a plausible proof method** — unit test, browser check,
   or CLI. If browser proof would require heavy test data, either write the
   data recipe into the binding body (which records/seeds to use, step by
   step) or state explicitly that the criterion is *expected to ship
   unverified* for human verification.
4. **The binding body carries all grooming answers** — resolved questions,
   repro steps, test-data hints, precedent pointers. The harness feeds it to
   the doer, judge, and behavior gate.
5. **The binding is loop-sized: at most ~8 acceptance criteria.** The harness
   now chunks internally (its planner decomposes any >2-criteria binding into
   small tasks, each with its own doer session, judge review, and checkpoint
   commit), so moderate bindings are safe to dispatch as-is. But a binding
   whose criteria span multiple modules or need >6 tasks is an epic wearing a
   binding's clothes (#1031: 13 criteria) — label `agent:needs-decomposition`,
   propose the split, and dispatch the pieces as separate issues.

**After a run**, any `questions` in `outcome.json` (disputed criteria, doer
assumptions) get posted to the issue. A human answers; the next grooming pass
folds the answers into the spec **before** any re-dispatch — the same question
must never block two runs.

## Key Contracts

### Harness

```bash
crbn up --minimal --run 'pnpm --filter @carbon/harness loop <binding-path> --cwd <worktree-path>' --volumes
```

- Drives a `Binding` (in `.ai/runs/<id>/binding.loop.md`) to a gated PR
- Writes `.ai/runs/<id>/outcome.json` → `{ state, prUrl, reason, unverified?, questions? }`
- `openPr` is idempotent (PR-feedback re-entry reuses the same branch/PR)
- The binding's **markdown body** is grooming context injected into the doer/judge/behavior prompts — resolved questions, repro steps, test-data hints belong there
- GC: `pnpm --filter @carbon/harness run gc`

### Outcome handling — the orchestrator's contract

| `outcome.json` | What it means | Orchestrator action |
|---|---|---|
| `state: shipped`, no `unverified` | Fully proven, PR open | Comment PR link on issue, drop `agent:working` |
| `state: shipped` + `unverified` | Work kept & judge-approved; behavior proof was impossible (test data, environment). PR is a **draft** labeled `agent:needs-verification` | Comment PR link + the `unverified` gaps on the issue; label issue `agent:needs-verification`, **not** `agent:blocked` |
| `state: plateau/blocked/error` + `prUrl` | Partial salvage draft PR (`[partial]`, `Related to #<n>`) — committed work survived | Comment PR link + reason; label `agent:blocked`; the branch/PR carry the work forward |
| `state: plateau/blocked/error`, no `prUrl` | No committed work was produced (or PR creation failed — the pushed branch still exists) | Label `agent:blocked` with the reason; mention the branch if it exists on origin |
| any outcome with `questions` | Product questions surfaced (disputed criteria, doer assumptions) | Post them as an issue comment; a human answer + re-groom (fold answers into the binding body) precedes any re-dispatch |
| any outcome with `plan` | Task plan + statuses (`done`/`flagged`/`failed`/`pending`) | Include in the issue comment; `failed` tasks name a `loop-rescue/<id>/t<k>` branch holding the attempts |

**"We couldn't prove it" ≠ "it doesn't work."** Kept work always ships in a PR — flagged, draft, never auto-merged — rather than being reverted and GC'd with the worktree.

### Crash Recovery — a mechanical protocol, no judgment required

The harness commits and pushes every doer pass to `loop/<id>` as it goes, so a
dead PID loses at most one uncommitted edit. When a lease is stale (process
dead, no `outcome.json`):

1. **Never delete the branch.** GC may remove the *worktree* and Docker
   volumes; branches on origin (`loop/<id>`, `loop-rescue/<id>/*`) are the
   work — they stay until their PR closes.
2. Check origin: `git ls-remote origin "refs/heads/loop/<id>"`.
   - **Branch exists** → re-dispatch the SAME binding in a worktree based on
     it: `crbn new loop/<id> --base origin/loop/<id> --yes`, then
     `git merge origin/main` (always merge before starting), then the normal
     harness command. The loop re-plans, sees the committed progress, and
     continues from where it died. `openPr` is idempotent — same branch, same PR.
   - **No branch** → nothing was produced; re-dispatch fresh (base `origin/main`).
3. Before re-dispatching after a second consecutive crash, capture evidence
   instead of retrying blind: post the tail (~50 lines) of the dispatch
   process's stdout/stderr and `.ai/runs/<id>/run.log.jsonl` (if the worktree
   survives) as an issue comment, label `agent:blocked`.

### Agent Labels

| Label | Meaning |
|-------|---------|
| `agent:working` | Build in flight (lease held) |
| `agent:groomed` | Spec proposed, ready to assign |
| `agent:needs-decomposition` | Epic-sized, breakdown proposed |
| `agent:blocked` | Build failed/plateaued, needs human |
| `agent:needs-verification` | Draft PR shipped without full behavior proof (or partial) — human verifies before merge |

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
