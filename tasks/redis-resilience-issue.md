# Task Brief: Redis Resilience GitHub Issue

## Date
2026-07-06

## Source
Brad flagged via Slack: "critical vulnerability: any redis downtime kills the entire app"

## Objective
Create a well-scoped GitHub issue in `crbnos/carbon` that captures the Redis single-point-of-failure vulnerability, with clear acceptance criteria an agent (or human) can build against.

## Problem Statement
Redis is used throughout the Carbon app for caching, queuing, pub/sub, and session storage. Currently, if Redis goes down for any reason — crash, OOM kill, restart, network partition — the entire application fails. There is no graceful degradation: no circuit breakers, no fallbacks, no read-through to the source of truth. The result is a full app outage.

## Impact
- **Severity:** Critical
- **Blast radius:** Full application outage — all users, all tenants
- **Trigger conditions:** Redis crash, OOM kill, container restart, Redis memory exhaustion, network partition between app and Redis
- **Current behavior:** App throws unhandled errors / hangs on every Redis-dependent code path
- **Expected behavior:** App degrades gracefully — slower, possibly missing cache, but functional

## Scope of Work
1. **Audit:** Identify all Redis-dependent paths in the codebase (cache reads/writes, queue producers/consumers, pub/sub, session/auth, rate limiting, etc.)
2. **Circuit breakers:** Wrap Redis calls so failures don't propagate up as fatal errors
3. **Fallbacks per path type:**
   - **Cache reads:** fall through to source of truth (DB query)
   - **Cache writes:** fail silently (log + skip)
   - **Queue operations:** fail with appropriate HTTP error or retry later
   - **Pub/sub:** log and degrade notifications
   - **Rate limiting:** fail open (allow request) or use in-memory fallback
4. **Health endpoint:** Surface Redis health status in `/health` or similar
5. **Observability:** Emit metrics/alerts when Redis is degraded

## Acceptance Criteria (Suggested — Claude should refine these)
- [ ] All Redis calls wrapped in try/catch with explicit error handling (no unhandled rejections)
- [ ] Cache miss fallback: if Redis is unreachable, cache reads fall through to DB and return correct data
- [ ] Cache write failures are logged and silently skipped (no thrown error)
- [ ] Queue producers return a 503 (or equivalent) instead of crashing the process when Redis is unreachable
- [ ] Rate-limiter falls back to in-memory or fail-open behavior when Redis is unavailable
- [ ] Killing Redis (`docker stop redis` or equivalent) during a test run does NOT bring down the app process
- [ ] App recovers automatically (reconnects) within 30 seconds of Redis restart without process restart
- [ ] `/health` endpoint reflects Redis status (degraded vs healthy)
- [ ] Unit or integration tests cover the Redis-down scenario for each major path

## Labels to Apply
- `bug` (it IS a bug — missing resilience)
- `complexity: critical` (cross-cutting concern, requires significant audit + refactor)

## Assignee
`carbon-agent`

## Notes for Claude
- This is a cross-cutting concern; the issue should be thorough but still actionable as a single tracked item
- If the scope is too large for one PR, note that in the issue and suggest decomposition
- Acceptance criteria must be concrete and testable (not vague like "handle errors better")
- Keep the body clean: Problem → Impact → Technical Scope → Acceptance Criteria
