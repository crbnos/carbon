---
paths: []
triggers: []
promoted: null
---
# Parallel subagents each running the heavy checks exhaust the machine

- **Context:** A review fanned out to six subagents. Each ran the `erp` typecheck, `generate:mcp` or a raw `tsc` in `apps/erp` to verify its own part.
- **Problem:** The `erp` typecheck peaks near 10 GB and `generate:mcp` near 5 GB. Five of them at once took about 28 GB.
- **Rule:** Only the main agent runs the heavy checks, once, after its subagents finish. Never raise `--max-old-space-size` to make one fit. `packages/dev/bin/heavy-lock` queues them machine-wide, so an extra run waits instead of running in parallel. A waiting run prints `heavy-lock: waiting for …`: that is the queue working, not a hang. Do not kill it.
- **Applies to:** Any skill or workflow that dispatches subagents (review, execute, fix, conductor).
