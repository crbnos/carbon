# CARBON_AGENT_HEARTBEAT.md — staged wake loop (NOT YET ACTIVE)

> ⚠️ **This is a staging file. It is NOT `HEARTBEAT.md`, so it does nothing yet.**
> Autonomy stays OFF until the Phase 10 supervised smoke test passes end-to-end.
> **Activation (Phase 10, after smoke test):** copy this body into `HEARTBEAT.md`.
> **Kill switch:** empty `HEARTBEAT.md` (or comment it out) to stop the wake loop.

When active, this is the periodic tick. The low-latency driver is the webhook
relay (Phase 5); this heartbeat provides **durability** — it catches anything the
WebSocket missed and runs the idle groomer. Full operating rules: `CARBON_AGENT.md`.

---

## On each wake (act as `carbon-agent`)

First read `CARBON_AGENT.md` for the safety rails and the dispatch recipe. Then
run the wake loop **in order**, single-threaded (one wake at a time). Stop at the
first step that has work; do at most one build and at most one groom per wake.

**0. Pre-flight.**
   - Confirm not paused (kill switch) and under the daily `$` budget. Over budget → report and stop.
   - Watermark: check free disk/RAM. Below threshold → run GC (step 5) first; if still low, refuse to dispatch and report.

**1. Reconcile leases.** For each open issue assigned to `carbon-agent` with `agent:working`:
   - Has an open `carbon-agent` PR? → it's in review; handle in step 2.
   - No PR **and** no live build (no dispatch handle in SQLite)? → crashed mid-build → drop `agent:working` (keep the assignment), reap the dead worktree/stack, mark re-pickable.

**2. PR feedback** (highest priority — finish in-flight before starting new):
   - For each open `carbon-agent` PR with new, actionable, unresolved review comments since the SQLite cursor (skip nits/approvals):
     → synthesize a feedback Binding and re-enter the inner loop on that branch (CARBON_AGENT.md → "PR-feedback re-entry"). Cap ~3 rounds, then `agent:blocked` + escalate. Advance the cursor.

**3. Assigned & not done?** (only if the build semaphore `N=1` has a free slot):
   - Pick the top assigned, un-leased issue (board order).
   - Synthesize a Binding (refusal path → `agent:needs-decomposition` if vague/epic).
   - Take the lease (`agent:working` + SQLite handle), dispatch, read `outcome.json`, act on the state (CARBON_AGENT.md → "Acting on the outcome").

**4. Else (idle): groom one issue.**
   - One un-groomed backlog issue (skip closed/`agent:groomed` unless changed since). Post a proposed spec + acceptance, label `agent:groomed`. Epic → one breakdown comment + `agent:needs-decomposition`. **Never builds.** Rate-limited: one per idle wake.

**5. GC + report.**
   - `pnpm --filter @carbon/harness run gc` (prunes finished `llm/loops/runs/`).
   - Scoped Docker prune (Carbon compose project + `openclaw-sbx-*` only — never blanket).
   - Remove finished worktrees (`crbn remove --prune`).
   - Post outcomes to the reporting channel: `shipped PR #N`, `blocked: <reason>`, `needs-decomposition #N`, PR-feedback escalations.

If nothing needed attention, reply `HEARTBEAT_OK`.
