---
paths: ["packages/kv/src/**"]
triggers: ["@carbon/kv", "withResilience", "\"NX\""]
promoted: null
---
# `@carbon/kv` answers null for a miss and for an outage

**Context:** The ERP's internal postings endpoint used `redis.set(key, "1", "PX", ttl, "NX")` to refuse a nonce it had seen.

**Problem:** `withResilience` (`packages/kv/src/resilient.ts`) turns a Redis failure or a 2-second timeout into the command's fallback, `null`. `SET NX` also answers `null` for a key that exists. The two cases looked the same, so a Redis outage refused every MES posting as a replay.

**Rule:** Never read a `null` from `@carbon/kv` as "the key is there". Read the key back to tell the cases apart. Decide on purpose whether the feature fails open or closed when Redis is down, and log it.

**Applies to:** every `@carbon/kv` caller that branches on a command's result.
