---
paths: ["packages/ee/src/onshape/lib/client.ts"]
triggers: ["DEV_CACHEABLE_PATHS", "ONSHAPE_DEV_CACHE"]
promoted: null
---
# Dev response caches must allow-list, never blanket-cache GETs

**Context:** Caching Onshape API GETs in Redis during development (`ONSHAPE_DEV_CACHE=1`) to protect the annual API quota.

**Problem:** Caching every GET poisoned the translation poll loop: `GET /translations/{id}` was cached while `requestState` was still `ACTIVE`, so `waitForTranslation` saw the same in-flight state forever and the export never completed. The failure looks like a hung job, not a cache bug.

**Rule:** A dev-mode response cache must be an explicit allow-list of stable content reads (`DEV_CACHEABLE_PATHS` in `packages/ee/src/onshape/lib/client.ts`). Never add a polling or status endpoint. When adding a cacheable path, ask: can two reads of this URL legitimately differ within the TTL?

**Applies to:** `packages/ee/src/onshape/lib/client.ts`, any dev-mode HTTP cache in front of a third-party API.
