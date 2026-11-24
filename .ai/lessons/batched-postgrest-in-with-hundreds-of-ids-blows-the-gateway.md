---
paths: []
triggers: []
promoted: null
---
# Batched PostgREST `.in()` with hundreds of ids blows the gateway URL limit — use Kysely for big id-list reads in edge functions

**Context:** Fixing the N+1 traversal in `get-method`'s `itemToJob` by prefetching `itemReplenishment` for a whole method tree (260 item ids) with `client.from(...).in("itemId", ids)` chunked at 200 ids per request.

**Problem:** PostgREST encodes `.in()` filters in the query string. 200 UUID-length ids ≈ 8KB of URL, which exceeded the local gateway's request-line limit — the request failed outright, the prefetch threw, and every job created for a large-BOM item silently landed with an empty BOM (the caller logs the invoke error and continues). A chunk size that works in tests fails on the tenant with the most data.

**Rule:** In server functions (and edge functions), batch reads keyed by a large id list go through the Kysely `db` handle (bind parameters, no URL cap) whenever no PostgREST embed is needed. If an embed forces PostgREST, chunk conservatively (≤50 ids) and include `res.error.message` in the thrown error so the failure names its cause. Never swallow a prefetch error into a bare string with no detail.

**Applies to:** posting batch reads (`apps/erp/app/modules/*/*.service.ts`); any `.in(...)` over tree-collected or list-collected ids.
