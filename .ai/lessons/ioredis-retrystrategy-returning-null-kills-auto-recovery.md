---
paths: ["packages/kv/src/client.ts", "packages/kv/src/resilient.ts"]
triggers: ["retryStrategy", "ioredis"]
promoted: null
---
# ioredis retryStrategy returning null kills auto-recovery

**Context:** Making the Redis client (`@carbon/kv`) resilient to outages (issue #1076).

**Problem:** A `retryStrategy` that returns `null` after N attempts (e.g. `if (times > 3) return null`) tells ioredis to **stop reconnecting permanently**. Once Redis is briefly unreachable the client gives up and every later command fails with "Connection is closed." even after Redis is healthy again — the app never recovers without a process restart. Command-level timeouts/try-catch cannot fix this; it is a connection-lifecycle setting. Unit tests with `ioredis-mock` do NOT catch it — only a real kill-and-restart test does.

**Rule:** For long-running servers, `retryStrategy` must keep reconnecting with capped backoff (`min(times * 200, 5000)`) and never return null. Bound per-command latency elsewhere (`maxRetriesPerRequest` + a timeout wrapper), not by abandoning reconnection. Verify recovery by stopping and restarting a real Redis, not just mocks.

**Applies to:** `packages/kv/src/client.ts`, `packages/kv/src/resilient.ts`, any ioredis client config.
