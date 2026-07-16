# Heartbeat — Carbon Agent Wake Loop

The wake loop is implemented as OpenClaw cron jobs. CARBON_AGENT.md is the operating manual.

## Cron Jobs

### carbon-agent-heartbeat (every 30 min)
- **ID:** b17e876e-b319-4700-bfd4-f2dfed993c83
- **Type:** Isolated agentTurn (2h timeout)
- **Does:** One wake pass — mutex → reconcile → PR feedback → build → groom → GC
- **Architecture:** OpenClaw orchestrates; Claude Code (`claude -p`) builds
- **Delivery:** none (logs to daily notes)
- **CRITICAL:** Checks BOTH `gh issue list` AND `gh pr list --assignee` because `gh issue list` excludes PRs. Human-opened PRs assigned to carbon-agent are only visible via `gh pr list --assignee`.

### carbon-agent-watchdog (every 2h)
- **ID:** ae38ca3f-f990-4094-b1eb-85be430c850f
- **Type:** Isolated agentTurn (2 min timeout)
- **Does:** Health check — verifies heartbeat is running, no stuck state, disk OK
- **Alerts:** Sends to main session if unhealthy

### carbon-gc (every 4h)
- **ID:** 33ecad2e-7a89-4f00-9af1-3f3f76b8a859
- **Does:** Prune finished loop runs, docker volumes, orphaned worktrees

### daily-budget-reset (midnight UTC)
- **ID:** 5cf61bcc-d45d-4458-b977-7f70a94de6fe
- **Does:** Clear daily $ spent counter
