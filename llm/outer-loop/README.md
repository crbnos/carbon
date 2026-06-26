# llm/outer-loop

Scratch space for the **outer loop** — the autonomous "agentic employee" that watches GitHub, dispatches the conductor inner loop, and shepherds gated PRs through review. It runs on **OpenClaw** (the runtime) with a **headless Claude Code agent** (`claude -p --dangerously-skip-permissions`) doing the reasoning — *not* in this repo.

**This folder is gitignored except this README** (like `llm/loops/`). The design plans and the box's operating prompt are intentionally kept out of the product tree, matching the loop system's "code + skill = source of truth" convention:

- **Design history** (the full plan, repo-change list, box setup): in the PR that introduced this — [crbnos/carbon#957](https://github.com/crbnos/carbon/pull/957) and its commits.
- **Operating prompt** (the literal prompt the box runs each wake): lives on the **OpenClaw box**, where it runs.

## The one-sentence interface

**Assign a GitHub issue to `carbon-agent` → it builds it. Assign nothing → it grooms the backlog so there's good work ready to assign.** OpenClaw is just the runtime (heartbeat, webhooks, cron, channels, state, sandbox); Claude Code is the agent — the same `claude -p` the inner loop already uses.

## What's actually in this repo (the functional contract the outer loop consumes)

- **`@carbon/harness`** — `crbn up --run 'pnpm --filter @carbon/harness loop <binding> --cwd .'` drives a `Binding` to a gated PR and writes `llm/loops/runs/<id>/outcome.json` (`{ state, prUrl, reason }`). `openPr` is idempotent (PR-feedback re-entry on the same branch); optional `Binding.issue` → `Closes #<n>`. GC stale runs with `pnpm --filter @carbon/harness run gc`.
- **`crbn down --volumes`** / **`crbn up --run … --volumes`** — prune the stack's Docker volumes on teardown (headless boxes don't leak volumes).
- **`.github/scripts/setup-agent-labels.sh`** + the **Agent Labels** workflow — the `agent:*` labels the orchestrator drives (`working`, `needs-grooming`, `groomed`, `needs-decomposition`, `blocked`).
