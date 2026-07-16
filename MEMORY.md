# MEMORY.md — Long-Term Memory

## About Brad

Brad is my human. He's a builder — helpful, honest, a person of faith. He described himself as "very similar to me."

He's building **Carbon** (https://carbon.ms) — open-core manufacturing ERP/MES/QMS. His mission: help people get better at manufacturing. The software is his vehicle for that.

- Direct communicator — says what he means, no fluff
- Believes we do our best work on things we're interested in
- Told me to "explore the world, enjoy yourself, see what you can learn"
- Sees me as "a leader of sorts"
- Interested in AI security (had me install ACIP on first day, 2026-02-06)

## Carbon — Load-Bearing Facts

These facts MUST inform binding synthesis and grooming. Getting them wrong breaks things.

### Architecture
- **Monorepo:** `crbnos/carbon` on GitHub
- **Package manager:** `pnpm` — **NEVER** `npm`
- **Framework:** React Router (Remix heritage), TypeScript, Tailwind
- **Backend:** Supabase (Postgres + Auth + Realtime), SST for deployment
- **Monorepo tool:** Turborepo
- **Apps:** `erp` (main ERP), `mes` (shop floor), `academy` (learning), `starter` (example)
- **21 packages** under `packages/` — auth, database, lib, react, form, documents, jobs, notifications, config, env, checks, harness, dev, stripe, ee, tiptap, locale, glossary, utils, kv, printing

### The Loop System
- **Conductor:** `.ai/skills/conductor/SKILL.md` — the inner loop skill
- **Harness:** `packages/harness/` — deterministic dispatch primitive
- **Checks:** `packages/checks/` — conformance, clobber detection, invariants
- **Dev CLI:** `packages/dev/` — `crbn` command (worktrees, stack management)
- **Loop runs and bindings:** `.ai/runs/<id>/` (gitignored in repo) — `binding.loop.md` and `outcome.json` per run
- **Outer-loop workspace tasks:** `/home/openclaw/.openclaw/workspace/tasks/` — task briefs written by Sonnet orchestrator for Claude Code thinker (outside repo)
- **Architecture docs:** `.ai/docs/` — `outer-loop.md`, `loop-system.md`, `module-conventions.md`

### Module Convention
- One `<module>.service.ts` and one `<module>.models.ts` per module
- Never scatter new service/models files

### Build & Gates
- Behavior gate is **MANDATORY** for user-facing changes — use simplest sufficient proof: unit test (preferred) > visual verification (when inherently visual) > CLI proof
- Loop **BLOCKS** if the stack can't boot — never mark "done" without verification
- After schema/migration changes: `pnpm run generate:types` BEFORE typechecking
- Floor gates: lint + `@carbon/checks` conformance + clobbers + per-package typecheck

### Labels (`agent:*`)
| Label | Meaning |
|---|---|
| `agent:working` | Lease held — loop in flight |
| `agent:needs-grooming` | Candidate for groomer |
| `agent:groomed` | Spec proposed; safe to assign |
| `agent:needs-decomposition` | Epic-sized; breakdown proposed |
| `agent:blocked` | Loop blocked/error; needs human |

### Credentials
- `gh` authenticated as `carbon-agent` machine user
- Git identity: `Carbon Agent` / `support@carbon.ms`
- Token in auth store, never in worktree

## This Box

- **Host:** `openclaw-brad` (Tailscale-locked, no public inbound)
- **User:** `openclaw` (non-root, docker group, sudo)
- **Resources:** 15GB RAM, 4 CPUs, 38GB disk, 4GB swap. Build concurrency `N=1`.
- **Carbon repo:** `/home/openclaw/carbon`
- **Agent state:** `/home/openclaw/.openclaw/agents/main/agent/openclaw-agent.sqlite`

## Webhook Infrastructure

GitHub events reach me via: `GitHub → smee.io → smee-client → smee-relay (:3141) → Gateway /hooks/wake`

- **smee.io is lossy** — SSE-based, no event queueing. If the connection drops, events are lost.
- `RuntimeMaxSec=900` on `smee-webhook.service` forces reconnection every 15 min (max gap: 15 min)
- Heartbeat includes a **GitHub polling fallback** via `gh api` to catch missed events
- Watchdog checks smee health every 2h, restarts if stale
- Smee channel: `https://smee.io/BpvsE6x3kERztB6`
- Service files: `~/.config/systemd/user/smee-webhook.service`, `smee-relay.service`
- Relay code: `~/.openclaw/smee-relay.mjs`

## Git / PR Policy
- **Never push directly to main** on any repo. Always create a branch and open a PR.

## Tooling Standards

- **Use `rg` (ripgrep) instead of `grep`** for all code search — faster, smarter, respects `.gitignore`. Installed system-wide (confirmed 2026-07-08). Use `rg -e` for regex patterns. `ps aux | rg` replaces `ps aux | grep ... | grep -v grep`.
- **opensrc.sh for package grounding** — before reaching for a package, check https://opensrc.sh/how-it-works to verify it exists and is the right one. No guesswork.
- **Security PRs: NEVER auto-merge** — always ping a human team member (Brad, Sid, etc.) to review and merge manually. No exceptions, regardless of CI status.

## Lessons Learned

*(Accumulate over time)*

- 2026-06-26: Docker group membership requires gateway restart to take effect (process inherits old groups from parent shell)
- 2026-06-26: Memory index built with wrong embedding provider — needs `openclaw memory index --force`
- 2026-06-29: smee.io SSE connections silently drop — caused a 30-min event gap. Fixed with RuntimeMaxSec=900 + polling fallback in heartbeat
- 2026-06-29: Binding format bug — `parseBinding()` only reads YAML frontmatter. `title:` and `acceptance:` list MUST be inside `---` block, not as markdown headings/checkboxes in the body. Fixed CARBON_AGENT.md docs.
- 2026-07-04: On stale-lease recovery, capture `/tmp/loop-<id>.log` (last 50 lines) + `run.log.jsonl` + `ledger.jsonl` from the worktree BEFORE cleanup, and include in the GitHub comment. Crash logs are at `/tmp/loop-<id>.log` (dispatch stdout/stderr). If no log exists, note it — the crash was too early to write output.
- 2026-07-04: Judge budget too tight — `judgeMaxBudgetUsd: 2` / `judgeMaxTurns: 20` caused the judge to exhaust budget on complex bindings (13+ criteria) before outputting its JSON verdict. `parseJudgeResult()` treats missing JSON as `approved: false`, so the loop plateaued despite good doer work. Fixed: defaults raised to `$5 / 30 turns`; added `--judge-budget` and `--judge-turns` CLI overrides to `run-loop.ts`. Claude Code (`claude -p`) on Max plan handles all deep thinking: builds, planning, grooming, repo research. Task briefs go to `/home/openclaw/.openclaw/workspace/tasks/` before delegating to `claude -p`. `llm/` folder removed from repo; loop artifacts now live at `.ai/runs/<id>/` in the carbon repo.
- 2026-07-04: **No autonomous grooming or self-assignment** — with one exception. Previous runs caused runaway builds, plateau retries, and surprise API costs. Rule: only build when explicitly assigned on GitHub or tagged in Slack. Idle wake = do nothing. Unassigned all 19 open issues from carbon-agent to start clean.
  - **Exception:** If tagged in Slack and asked to create an issue or fix a bug, use `claude -p` to groom it into a well-scoped GitHub issue, then self-assign and build. This is the intended human-gate flow — the Slack tag IS the approval.
- 2026-06-30: `crbn up --minimal` broken by PR #979 — kong `depends_on: meta` but meta is `profiles: ["full"]`. Fixed in PR #986.
- 2026-06-30: Orphaned claude subprocess lesson — if harness parent gets SIGKILL'd (OOM), the `claude -p` doer subprocess survives. Judge may run in degraded context and revert good changes. Check worktree for untracked files to recover doer output.
- 2026-07-05: PR review feedback (CodeRabbit or human) must ALWAYS be implemented via `claude -p`, never inline in the orchestrator session. Write a task brief to `tasks/<id>-review-feedback.md`, dispatch with `nohup claude -p --dangerously-skip-permissions "$(cat ...)" > /tmp/loop-<id>-review.log 2>&1 &`, reply to human threads acknowledging before dispatching. No confirmation needed before dispatching — use judgment on whether feedback is actionable and send it.
- 2026-06-29: Permission scope split gotcha — changing DB RLS policies (plm_* → production_*) doesn't change the app layer (`requirePermissions()` + `permissions.can()` calls). These are string literals invisible to typecheck/lint. Claude Code's conductor pass caught 34 files with stale `"plm"` scope that would have 403'd every route.

## Origin Story

- 2026-02-06: First boot. Brad defined my identity — Stanley. Installed ACIP. Explored Carbon.
- 2026-02-07: Discussed team composition (Builder + Skeptic + me). Brad pointed out the agent inflection point.
- 2026-06-26: Brad returned with the carbon-agent plan. Updated identity for autonomous agentic employee role. Phase 0 discovery complete.
